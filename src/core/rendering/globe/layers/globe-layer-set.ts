import type { Camera, Scene, Vector3 } from 'three'
import type { GeoJsonFeatureHit } from '@/core/data-source/geojson'
import type SphericalMesh from '@/core/mesh/mesh'
import type { GlobeLayerFactoryContext } from '@/core/rendering/shared/layer-factory'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { Atmosphere } from '@/core/rendering/globe/atmosphere'
import { GlobeCellBoundaryLayer } from '@/core/rendering/globe/layers/globe-cell-boundary-layer'
import { GlobeCloudLayer } from '@/core/rendering/globe/layers/globe-cloud-layer'
import { GlobeGraticuleLayer } from '@/core/rendering/globe/layers/globe-graticule-layer'
import { GlobeClimateVectorLayer } from '@/core/rendering/globe/layers/globe-vector-layer'
import { GlobeWaterLayer } from '@/core/rendering/globe/layers/globe-water-layer'
import { SceneLayerManager } from '@/core/rendering/scene-layer-manager'
import { StyledLayerManager } from '@/core/rendering/shared/styled-layer-manager'
import { getGlobeStyleZoom, resolveEffectiveSurfaceMode } from '@/core/rendering/styles/style-runtime'

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
}

export class GlobeLayerSet {
  private readonly manager: SceneLayerManager
  private readonly styledLayers: StyledLayerManager
  private readonly getContext: () => GlobeLayerContext | null

  constructor(
    scene: Scene,
    getContext: () => GlobeLayerContext | null,
  ) {
    this.getContext = getContext
    this.manager = new SceneLayerManager(scene, () => Boolean(this.getContext()))
    this.styledLayers = new StyledLayerManager(this.manager, () => {
      const context = this.getContext()
      return context ? this.getFactoryContext(context) : null
    })
  }

  rebuild(id: GlobeLayerId): void {
    const context = this.getContext()
    if (!context)
      return
    this.manager.dispose(id)
    this.updateOverlayVisibility()
  }

  reconcileAppearance(previous: WorldConfig, next: WorldConfig): void {
    this.styledLayers.reconcileAppearance(previous, next)
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

    // Shared overlays
    this.manager.syncVisibility('clouds', overlays.clouds, () => this.create('clouds', context))
    this.manager.syncVisibility('graticule', overlays.graticule, () => this.create('graticule', context))
    this.manager.syncVisibility('cell-boundaries', overlays.wireframe, () => this.create('cell-boundaries', context))

    this.styledLayers.rebuild('river-ribbon')

    // vectors
    const vectorMode = effectiveMode === 'wind' || effectiveMode === 'ocean-current'
    this.manager.syncVisibility('vectors', vectorMode, () => this.create('vectors', context))
  }

  rebuildEnvironment(): void {
    this.updateOverlayVisibility()
    this.styledLayers.rebuild('line', true)
  }

  rebuildAll(): void {
    this.disposeAll()
    this.styledLayers.rebuildAll()
    this.updateOverlayVisibility()
  }

  disposeAll(): void {
    this.manager.disposeAll()
    this.styledLayers.resetTracking()
  }

  destroy(): void {
    this.styledLayers.destroy()
    this.disposeAll()
  }

  updateStyleZoom(distance: number): void {
    const context = this.getContext()
    if (!context)
      return
    const styleZoom = getGlobeStyleZoom(distance, context.params.core.planetRadius)
    this.styledLayers.updateZoom(styleZoom, distance)
  }

  pickSettlement(event: PointerEvent, canvas: HTMLCanvasElement, camera: Camera): number | null {
    return this.styledLayers.pickSettlement(event, canvas, camera)
  }

  pickGeoJsonFeature(event: PointerEvent, canvas: HTMLCanvasElement, camera: Camera): GeoJsonFeatureHit | null {
    return this.styledLayers.pickGeoJsonFeature(event, canvas, camera)
  }

  private getFactoryContext(context: GlobeLayerContext): GlobeLayerFactoryContext {
    return {
      view: 'globe',
      mesh: context.mesh,
      data: context.data,
      params: context.params,
      sunlight: context.sunlight,
      terrainVerticalScale: context.params.core.planetRadius * TERRAIN_VERTICAL_SCALE,
      usesElevationGeometry: this.usesElevationGeometry(context.params),
    }
  }

  private create(id: Exclude<GlobeLayerId, 'atmosphere'>, context: GlobeLayerContext) {
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
        return new GlobeClimateVectorLayer(mesh, data, params)
      case 'clouds':
        return new GlobeCloudLayer(mesh, data, params, terrainVerticalScale, usesElevationGeometry)
      case 'cell-boundaries':
        return new GlobeCellBoundaryLayer(mesh, data, params, terrainVerticalScale, usesElevationGeometry)
      case 'graticule':
        return new GlobeGraticuleLayer(params, terrainVerticalScale, usesElevationGeometry)
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
