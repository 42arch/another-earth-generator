import type { Vector3 } from 'three'
import type { MapStyleSourceDefinition } from '@/core/data-source'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import type { StyledLayerBehavior } from '@/core/rendering/shared/styled/styled-layer-behavior'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import type { MapStyleLayer, MapStyleRenderer, MapStyleView } from '@/core/styles'
import { getMapStyleSource, hasGeoJsonSource } from '@/core/data-source'
import { StyledFillLayer } from '@/core/rendering/shared/styled/styled-fill-layer'
import { StyledLineLayer } from '@/core/rendering/shared/styled/styled-line-layer'
import { StyledPointLayer } from '@/core/rendering/shared/styled/styled-point-layer'
import { StyledRiverLayer } from '@/core/rendering/shared/styled/styled-river-layer'
import { StyledSymbolLayer } from '@/core/rendering/shared/styled/styled-symbol-layer'
import { getMapStyleDocument, resolveEffectiveSurfaceMode } from '@/core/styles'

export interface GlobeLayerFactoryContext {
  view: 'globe'
  mesh: SphericalMesh
  data: WorldSimulationState
  params: WorldConfig
  sunlight: Vector3
  terrainVerticalScale: number
  usesElevationGeometry: boolean
  viewportWidth: number
  viewportHeight: number
}

export interface MapLayerFactoryContext {
  view: 'map'
  mesh: SphericalMesh
  data: WorldSimulationState
  params: WorldConfig
  projection: MapProjection
  centralMeridian: number
  viewportWidth: number
  viewportHeight: number
}

export type LayerFactoryContext = GlobeLayerFactoryContext | MapLayerFactoryContext

/**
 * Checks whether a given style layer should be active in the current view and appearance settings.
 */
export function isStyleLayerActive(
  layer: MapStyleLayer,
  view: MapStyleView,
  params: WorldConfig,
  styleSources?: Record<string, MapStyleSourceDefinition>,
): boolean {
  if (layer.views && !layer.views.includes(view))
    return false

  // Check overlay toggle (layer.overlay takes precedence, source.overlay as fallback)
  const source = getMapStyleSource(layer.source, styleSources)
  const overlayId = layer.overlay ?? source?.overlay
  if (overlayId && !params.appearance.overlays[overlayId])
    return false

  const surfaceMode = resolveEffectiveSurfaceMode(params.appearance)

  // Check thematic fills toggle or baseMaps restriction
  if (layer.thematic) {
    const isThematicActive = Boolean(params.appearance.thematicFills?.[layer.thematic])
    const isBaseMapActive = layer.baseMaps ? layer.baseMaps.includes(surfaceMode) : false
    if (!isThematicActive && !isBaseMapActive)
      return false
  }
  else if (layer.baseMaps) {
    if (!layer.baseMaps.includes(surfaceMode))
      return false
  }

  // Check source availability if geojson
  if (source?.kind === 'geojson' && !hasGeoJsonSource(layer.source))
    return false

  return true
}

export const RENDER_ORDER = {
  FILL_BASE: 1.0,
  LINE_BASE_GLOBE: 6.75,
  LINE_BASE_MAP: 5.25,
  POINT_BASE: 8.0,
  SYMBOL_BASE: 8.5,
} as const

/**
 * Checks whether an overlay toggle change affects layers using the given renderer.
 */
export function haveStyleOverlayChanges(
  styleId: string | undefined,
  renderer: MapStyleRenderer,
  previous: Record<string, boolean>,
  next: Record<string, boolean>,
): boolean {
  const style = getMapStyleDocument(styleId)
  return style.layers.some((layer) => {
    if (layer.renderer !== renderer)
      return false
    const overlay = layer.overlay ?? getMapStyleSource(layer.source, style.sources)?.overlay
    return overlay !== undefined && previous[overlay] !== next[overlay]
  })
}

/**
 * Returns all active style layer entries from a style document matching the view and settings.
 */
export function getActiveStyleLayers(
  styleId: string | undefined,
  view: MapStyleView,
  params: WorldConfig,
): Array<{ layer: MapStyleLayer, order: number }> {
  const style = getMapStyleDocument(styleId)
  const entries: Array<{ layer: MapStyleLayer, order: number }> = []

  style.layers.forEach((layer, order) => {
    if (isStyleLayerActive(layer, view, params, style.sources))
      entries.push({ layer, order })
  })

  return entries
}

/**
 * Returns active style layer entries filtered by renderer type.
 */
export function getActiveStyleLayersByRenderer(
  styleId: string | undefined,
  view: MapStyleView,
  params: WorldConfig,
  renderer: MapStyleRenderer,
): Array<{ layer: MapStyleLayer, order: number }> {
  return getActiveStyleLayers(styleId, view, params).filter(entry => entry.layer.renderer === renderer)
}

/**
 * Unified Factory to instantiate 2D / 3D scene layers from MapStyleLayer specifications.
 */
export class LayerFactory {
  static createLayer(
    layer: MapStyleLayer,
    order: number,
    context: LayerFactoryContext,
  ): StyledLayerBehavior | null {
    const { params, mesh, data } = context

    switch (layer.renderer) {
      case 'fill': {
        if (context.view === 'globe') {
          return new StyledFillLayer(mesh, data, params, layer.id, {
            view: 'globe',
            planetRadius: params.core.planetRadius,
            renderOrder: RENDER_ORDER.FILL_BASE + order * 0.01,
          })
        }
        return new StyledFillLayer(mesh, data, params, layer.id, {
          view: 'map',
          projection: context.projection,
          centralMeridian: context.centralMeridian,
          renderOrder: RENDER_ORDER.FILL_BASE + order * 0.01,
        })
      }

      case 'river-ribbon': {
        if (context.view === 'globe') {
          return new StyledRiverLayer(mesh, data, params, {
            view: 'globe',
            planetRadius: params.core.planetRadius,
            terrainVerticalScale: context.terrainVerticalScale,
            usesElevationGeometry: context.usesElevationGeometry,
          })
        }
        return new StyledRiverLayer(mesh, data, params, {
          view: 'map',
          projection: context.projection,
          centralMeridian: context.centralMeridian,
          viewportWidth: context.viewportWidth,
          viewportHeight: context.viewportHeight,
        })
      }

      case 'line': {
        if (context.view === 'globe') {
          const fillLayers = getActiveStyleLayersByRenderer(params.appearance.mapStyle, 'globe', params, 'fill')
          let surfaceClearance = context.usesElevationGeometry ? 0.22 : 0.04
          if (fillLayers.some(({ layer: fill }) => fill.source !== 'land-areas'))
            surfaceClearance = 0.27
          else if (fillLayers.length > 0)
            surfaceClearance = 0.20
          return new StyledLineLayer(mesh, data, params, layer.id, {
            view: 'globe',
            terrainVerticalScale: context.terrainVerticalScale,
            usesElevationGeometry: context.usesElevationGeometry,
            surfaceClearance,
            viewportWidth: context.viewportWidth,
            viewportHeight: context.viewportHeight,
            sunDirection: [context.sunlight.x, context.sunlight.y, context.sunlight.z],
            renderOrder: RENDER_ORDER.LINE_BASE_GLOBE + order * 0.25,
          })
        }
        return new StyledLineLayer(mesh, data, params, layer.id, {
          view: 'map',
          projection: context.projection,
          centralMeridian: context.centralMeridian,
          depth: 0.325 + order * 0.025,
          viewportWidth: context.viewportWidth,
          viewportHeight: context.viewportHeight,
          renderOrder: RENDER_ORDER.LINE_BASE_MAP + order * 0.75,
        })
      }

      case 'circle': {
        if (context.view === 'globe') {
          return new StyledPointLayer(mesh, data, params, layer.id, {
            view: 'globe',
            sunlight: context.sunlight,
            terrainVerticalScale: context.terrainVerticalScale,
            usesElevationGeometry: context.usesElevationGeometry,
            renderOrder: RENDER_ORDER.POINT_BASE + order * 0.01,
          })
        }
        return new StyledPointLayer(mesh, data, params, layer.id, {
          view: 'map',
          projection: context.projection,
          centralMeridian: context.centralMeridian,
          depth: 0.5 + order * 0.005,
          renderOrder: RENDER_ORDER.POINT_BASE + order * 0.01,
        })
      }

      case 'symbol': {
        if (context.view === 'globe') {
          return new StyledSymbolLayer(mesh, data, params, layer.id, {
            view: 'globe',
            terrainVerticalScale: context.terrainVerticalScale,
            usesElevationGeometry: context.usesElevationGeometry,
            planetRadius: params.core.planetRadius,
            renderOrder: RENDER_ORDER.SYMBOL_BASE + order * 0.01,
          })
        }
        return new StyledSymbolLayer(mesh, data, params, layer.id, {
          view: 'map',
          projection: context.projection,
          centralMeridian: context.centralMeridian,
          renderOrder: RENDER_ORDER.SYMBOL_BASE + order * 0.01,
        })
      }

      default:
        return null
    }
  }
}
