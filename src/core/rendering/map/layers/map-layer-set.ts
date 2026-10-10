import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import type { Scene } from 'three'
import { SceneLayerManager } from '@/core/rendering/scene-layer-manager'
import { MapCellBoundaryLayer } from '@/core/rendering/map/layers/map-cell-boundary-layer'
import { MapCloudLayer } from '@/core/rendering/map/layers/map-cloud-layer'
import { MapGraticuleLayer } from '@/core/rendering/map/layers/map-graticule-layer'
import { MapLabelLayer } from '@/core/rendering/map/layers/map-label-layer'
import { MapPolityBorderLayer } from '@/core/rendering/map/layers/map-polity-border-layer'
import { MapRiverLayer } from '@/core/rendering/map/layers/map-river-layer'
import { MapRouteLayer } from '@/core/rendering/map/layers/map-route-layer'
import { MapSettlementLayer } from '@/core/rendering/map/layers/map-settlement-layer'
import { MapClimateVectorLayer } from '@/core/rendering/map/layers/map-vector-layer'
import { SphericalRegionTopologyBuilder } from '@/core/rendering/shared/spherical-region-topology'

export type MapLayerId =
  | 'settlements'
  | 'labels'
  | 'clouds'
  | 'rivers'
  | 'vectors'
  | 'routes'
  | 'cell-boundaries'
  | 'polity-borders'
  | 'graticule'

export interface MapLayerContext {
  mesh: SphericalMesh
  data: WorldSimulationState
  params: WorldConfig
  projection: MapProjection
  centralMeridian: number
  smoothedRegionCorners: Float32Array | null
  viewportWidth: number
  viewportHeight: number
  regionTopologyBuilder: SphericalRegionTopologyBuilder
}

export class MapLayerSet {
  private readonly manager: SceneLayerManager
  private readonly getContext: () => MapLayerContext | null

  constructor(
    scene: Scene,
    getContext: () => MapLayerContext | null,
  ) {
    this.getContext = getContext
    this.manager = new SceneLayerManager(scene, () => Boolean(this.getContext()))
  }

  rebuild(id: MapLayerId): void {
    const context = this.getContext()
    if (!context)
      return
    this.manager.replace(id, () => this.create(id, context))
  }

  rebuildAll(): void {
    const ids: MapLayerId[] = [
      'settlements', 'labels', 'clouds', 'rivers', 'vectors', 'routes',
      'cell-boundaries', 'polity-borders', 'graticule',
    ]
    for (const id of ids)
      this.rebuild(id)
  }

  disposeAll(): void {
    this.manager.disposeAll()
  }

  updateViewport(width: number, height: number): void {
    this.manager.get<MapRiverLayer>('rivers')?.updateViewport(width, height)
    this.manager.get<MapClimateVectorLayer>('vectors')?.updateViewport(width, height)
    this.manager.get<MapPolityBorderLayer>('polity-borders')?.updateViewport(width, height)
  }

  update(zoom: number): void {
    this.manager.get<MapLabelLayer>('labels')?.updateLOD(zoom)
    this.manager.get<MapRiverLayer>('rivers')?.updateWidthScale(zoom)
    this.manager.get<MapClimateVectorLayer>('vectors')?.updateLineWidth(zoom)
    this.manager.get<MapPolityBorderLayer>('polity-borders')?.updateLineWidth(zoom)
  }

  private create(id: MapLayerId, context: MapLayerContext) {
    const {
      mesh, data, params, projection, centralMeridian,
      smoothedRegionCorners, viewportWidth, viewportHeight,
      regionTopologyBuilder,
    } = context

    switch (id) {
      case 'settlements':
        return new MapSettlementLayer(mesh, data, params, projection, centralMeridian)
      case 'labels':
        return new MapLabelLayer(mesh, data, params, projection, centralMeridian)
      case 'clouds':
        return new MapCloudLayer(mesh, data, params, projection, centralMeridian)
      case 'rivers':
        return new MapRiverLayer(mesh, data, params, projection, centralMeridian, smoothedRegionCorners, viewportWidth, viewportHeight)
      case 'vectors':
        return new MapClimateVectorLayer(mesh, data, params, projection, centralMeridian)
      case 'routes':
        return new MapRouteLayer(mesh, data, params, projection, centralMeridian)
      case 'cell-boundaries':
        return new MapCellBoundaryLayer(mesh, data, params, projection, centralMeridian, smoothedRegionCorners)
      case 'polity-borders':
        return new MapPolityBorderLayer(
          mesh, data, params, projection, centralMeridian, smoothedRegionCorners,
          regionTopologyBuilder, viewportWidth, viewportHeight,
        )
      case 'graticule':
        return new MapGraticuleLayer(params, projection, centralMeridian)
      default:
        throw new Error(`Unknown map layer: ${id}`)
    }
  }
}
