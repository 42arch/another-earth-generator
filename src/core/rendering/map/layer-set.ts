import type { Scene } from 'three'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import type { MapLayerFactoryContext } from '@/core/rendering/shared/styled/layer-factory'
import type { ViewportBounds } from '@/core/rendering/shared/styled/styled-layer-behavior'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { BaseLayerSet } from '@/core/rendering/shared/layers/base-layer-set'
import { CellBoundaryOverlayLayer } from '@/core/rendering/shared/layers/cell-boundary-layer'
import { ClimateVectorOverlayLayer } from '@/core/rendering/shared/layers/climate-vector-layer'
import { CloudOverlayLayer } from '@/core/rendering/shared/layers/cloud-layer'
import { GraticuleOverlayLayer } from '@/core/rendering/shared/layers/graticule-layer'
import { getMapStyleZoom, resolveEffectiveSurfaceMode } from '@/core/styles'

export type MapLayerId
  = | 'clouds'
    | 'vectors'
    | 'cell-boundaries'
    | 'graticule'

export interface MapLayerContext {
  mesh: SphericalMesh
  data: WorldSimulationState
  params: WorldConfig
  projection: MapProjection
  centralMeridian: number
  viewportWidth: number
  viewportHeight: number
}

export class MapLayerSet extends BaseLayerSet<MapLayerContext, MapLayerId, MapLayerFactoryContext> {
  constructor(
    scene: Scene,
    getContext: () => MapLayerContext | null,
  ) {
    super(scene, getContext)
  }

  updateOverlayVisibility(): void {
    const context = this.getContext()
    if (!context)
      return
    const effectiveMode = resolveEffectiveSurfaceMode(context.params.appearance)
    this.syncCommonOverlays(context, effectiveMode)
  }

  updateViewport(width: number, height: number): void {
    this.styledLayers.updateViewport(width, height)
  }

  update(zoom: number, viewportBounds?: ViewportBounds): void {
    const context = this.getContext()
    if (!context)
      return
    const styleZoom = getMapStyleZoom(zoom)
    this.styledLayers.updateZoom(styleZoom, zoom, viewportBounds)
  }

  protected getFactoryContext(context: MapLayerContext): MapLayerFactoryContext {
    return {
      view: 'map',
      mesh: context.mesh,
      data: context.data,
      params: context.params,
      projection: context.projection,
      centralMeridian: context.centralMeridian,
      viewportWidth: context.viewportWidth,
      viewportHeight: context.viewportHeight,
    }
  }

  protected create(id: MapLayerId, context: MapLayerContext) {
    const {
      mesh,
      data,
      params,
      projection,
      centralMeridian,
    } = context

    switch (id) {
      case 'clouds':
        return new CloudOverlayLayer(mesh, data, params, {
          view: 'map',
          projection,
          centralMeridian,
        })
      case 'vectors':
        return new ClimateVectorOverlayLayer(mesh, data, params, {
          view: 'map',
          projection,
          centralMeridian,
        })
      case 'cell-boundaries':
        return new CellBoundaryOverlayLayer(mesh, data, params, {
          view: 'map',
          projection,
          centralMeridian,
        })
      case 'graticule':
        return new GraticuleOverlayLayer(params, {
          view: 'map',
          projection,
          centralMeridian,
        })
      default:
        throw new Error(`Unknown map layer: ${id}`)
    }
  }
}
