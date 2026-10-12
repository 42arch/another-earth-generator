import type { Camera, Scene } from 'three'
import type { GeoJsonFeatureHit } from '@/core/data-source/geojson'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import type { MapLayerFactoryContext } from '@/core/rendering/shared/layer-factory'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { MapCellBoundaryLayer } from '@/core/rendering/map/layers/map-cell-boundary-layer'
import { MapCloudLayer } from '@/core/rendering/map/layers/map-cloud-layer'
import { MapGraticuleLayer } from '@/core/rendering/map/layers/map-graticule-layer'
import { MapClimateVectorLayer } from '@/core/rendering/map/layers/map-vector-layer'
import { SceneLayerManager } from '@/core/rendering/scene-layer-manager'
import { StyledLayerManager } from '@/core/rendering/shared/styled-layer-manager'
import { getMapStyleZoom, resolveEffectiveSurfaceMode } from '@/core/rendering/styles/style-runtime'

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

export class MapLayerSet {
  private readonly manager: SceneLayerManager
  private readonly styledLayers: StyledLayerManager
  private readonly getContext: () => MapLayerContext | null

  constructor(
    scene: Scene,
    getContext: () => MapLayerContext | null,
  ) {
    this.getContext = getContext
    this.manager = new SceneLayerManager(scene, () => Boolean(this.getContext()))
    this.styledLayers = new StyledLayerManager(this.manager, () => {
      const context = this.getContext()
      return context ? this.getFactoryContext(context) : null
    })
  }

  rebuild(id: MapLayerId): void {
    const context = this.getContext()
    if (!context)
      return
    this.manager.dispose(id)
    this.updateOverlayVisibility()
  }

  updateOverlayVisibility(): void {
    const context = this.getContext()
    if (!context)
      return
    const overlays = context.params.appearance.overlays
    const effectiveMode = resolveEffectiveSurfaceMode(context.params.appearance)

    // Shared overlays
    this.manager.syncVisibility('clouds', overlays.clouds, () => this.create('clouds', context))
    this.manager.syncVisibility('graticule', overlays.graticule, () => this.create('graticule', context))
    this.manager.syncVisibility('cell-boundaries', overlays.wireframe, () => this.create('cell-boundaries', context))

    this.styledLayers.rebuild('river-ribbon')

    // vectors
    const vectorMode = effectiveMode === 'wind' || effectiveMode === 'ocean-current'
    this.manager.syncVisibility('vectors', vectorMode, () => this.create('vectors', context))
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

  reconcileAppearance(previous: WorldConfig, next: WorldConfig): void {
    this.styledLayers.reconcileAppearance(previous, next)
  }

  updateViewport(width: number, height: number): void {
    this.styledLayers.updateViewport(width, height)
    this.manager.get<MapClimateVectorLayer>('vectors')?.updateViewport(width, height)
  }

  update(zoom: number): void {
    this.manager.get<MapClimateVectorLayer>('vectors')?.updateLineWidth(zoom)

    const context = this.getContext()
    if (!context)
      return
    const styleZoom = getMapStyleZoom(zoom)
    this.styledLayers.updateZoom(styleZoom, zoom)
  }

  pickSettlement(event: PointerEvent, canvas: HTMLCanvasElement, camera: Camera): number | null {
    return this.styledLayers.pickSettlement(event, canvas, camera)
  }

  pickGeoJsonFeature(event: PointerEvent, canvas: HTMLCanvasElement, camera: Camera): GeoJsonFeatureHit | null {
    return this.styledLayers.pickGeoJsonFeature(event, canvas, camera)
  }

  private getFactoryContext(context: MapLayerContext): MapLayerFactoryContext {
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

  private create(id: MapLayerId, context: MapLayerContext) {
    const {
      mesh,
      data,
      params,
      projection,
      centralMeridian,
    } = context

    switch (id) {
      case 'clouds':
        return new MapCloudLayer(mesh, data, params, projection, centralMeridian)
      case 'vectors':
        return new MapClimateVectorLayer(mesh, data, params, projection, centralMeridian)
      case 'cell-boundaries':
        return new MapCellBoundaryLayer(mesh, data, params, projection, centralMeridian)
      case 'graticule':
        return new MapGraticuleLayer(params, projection, centralMeridian)
      default:
        throw new Error(`Unknown map layer: ${id}`)
    }
  }
}
