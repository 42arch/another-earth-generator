import type { Scene, Vector3 } from 'three'
import type SphericalMesh from '@/core/mesh/mesh'
import type { GlobeLayerFactoryContext } from '@/core/rendering/shared/styled/layer-factory'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { Atmosphere } from '@/core/rendering/globe/atmosphere'
import { GlobeWaterLayer } from '@/core/rendering/globe/water-layer'
import { BaseLayerSet } from '@/core/rendering/shared/layers/base-layer-set'
import { CellBoundaryOverlayLayer } from '@/core/rendering/shared/layers/cell-boundary-layer'
import { ClimateVectorOverlayLayer } from '@/core/rendering/shared/layers/climate-vector-layer'
import { CloudOverlayLayer } from '@/core/rendering/shared/layers/cloud-layer'
import { GraticuleOverlayLayer } from '@/core/rendering/shared/layers/graticule-layer'
import { getGlobeStyleZoom, resolveEffectiveSurfaceMode } from '@/core/styles'

const TERRAIN_VERTICAL_SCALE = 0.04

export type GlobeLayerId
  = | 'water'
    | 'vectors'
    | 'clouds'
    | 'cell-boundaries'
    | 'graticule'
    | 'atmosphere'

export interface GlobeLayerContext {
  mesh: SphericalMesh
  data: WorldSimulationState
  params: WorldConfig
  sunlight: Vector3
  viewportWidth: number
  viewportHeight: number
}

export class GlobeLayerSet extends BaseLayerSet<GlobeLayerContext, GlobeLayerId, GlobeLayerFactoryContext> {
  constructor(
    scene: Scene,
    getContext: () => GlobeLayerContext | null,
  ) {
    super(scene, getContext)
  }

  updateOverlayVisibility(): void {
    const context = this.getContext()
    if (!context)
      return
    const overlays = context.params.appearance.overlays
    const effectiveMode = resolveEffectiveSurfaceMode(context.params.appearance)

    // atmosphere
    if (this.usesElevationColor(effectiveMode) || !overlays.atmosphere) {
      this.manager.setVisible('atmosphere', false, 'configuration')
    }
    else {
      const atmo = this.manager.ensure('atmosphere', () => new Atmosphere(context.params.core.planetRadius))
      if (atmo)
        this.manager.setVisible('atmosphere', true)
    }

    // water (only on satellite when atmosphere is on)
    if (effectiveMode === 'satellite' && overlays.atmosphere) {
      const water = this.manager.ensure('water', () => this.create('water', context))
      if (water)
        this.manager.setVisible('water', true)
    }
    else {
      this.manager.setVisible('water', false, 'configuration')
    }

    // 同步通用覆盖层 (clouds, graticule, cell-boundaries, vectors)
    this.syncCommonOverlays(context, effectiveMode)
  }

  updateStyleZoom(distance: number): void {
    const context = this.getContext()
    if (!context)
      return
    const styleZoom = getGlobeStyleZoom(distance, context.params.core.planetRadius)
    this.styledLayers.updateZoom(styleZoom, distance)
  }

  updateViewport(width: number, height: number): void {
    this.styledLayers.updateViewport(width, height)
  }

  protected getFactoryContext(context: GlobeLayerContext): GlobeLayerFactoryContext {
    return {
      view: 'globe',
      mesh: context.mesh,
      data: context.data,
      params: context.params,
      sunlight: context.sunlight,
      terrainVerticalScale: context.params.core.planetRadius * TERRAIN_VERTICAL_SCALE,
      usesElevationGeometry: this.usesElevationGeometry(context.params),
      viewportWidth: context.viewportWidth,
      viewportHeight: context.viewportHeight,
    }
  }

  protected create(id: Exclude<GlobeLayerId, 'atmosphere'>, context: GlobeLayerContext) {
    const {
      mesh,
      data,
      params,
    } = context
    const terrainVerticalScale = params.core.planetRadius * TERRAIN_VERTICAL_SCALE
    const usesElevationGeometry = this.usesElevationGeometry(params)

    switch (id) {
      case 'water':
        return new GlobeWaterLayer(mesh, data, params, usesElevationGeometry)
      case 'vectors':
        return new ClimateVectorOverlayLayer(mesh, data, params, { view: 'globe' })
      case 'clouds':
        return new CloudOverlayLayer(mesh, data, params, {
          view: 'globe',
          terrainVerticalScale,
          usesElevationGeometry,
        })
      case 'cell-boundaries':
        return new CellBoundaryOverlayLayer(mesh, data, params, {
          view: 'globe',
          planetRadius: params.core.planetRadius,
          terrainVerticalScale,
          usesElevationGeometry,
        })
      case 'graticule':
        return new GraticuleOverlayLayer(params, {
          view: 'globe',
          planetRadius: params.core.planetRadius,
          terrainVerticalScale,
          usesElevationGeometry,
        })
      default:
        throw new Error(`Unknown globe layer: ${id}`)
    }
  }

  private usesElevationGeometry(params: WorldConfig): boolean {
    const effectiveMode = resolveEffectiveSurfaceMode(params.appearance)
    return params.appearance.elevationDisplacement
      && (effectiveMode === 'dem'
        || effectiveMode === 'heightmap'
        || effectiveMode === 'satellite')
  }

  private usesElevationColor(mode: string): boolean {
    return mode === 'dem' || mode === 'heightmap'
  }
}
