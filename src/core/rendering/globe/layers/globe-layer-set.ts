import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import type { Camera, Scene, Vector3 } from 'three'
import { SceneLayerManager } from '@/core/rendering/scene-layer-manager'
import { Atmosphere } from '@/core/rendering/globe/atmosphere'
import { GlobeCellBoundaryLayer } from '@/core/rendering/globe/layers/globe-cell-boundary-layer'
import { GlobeCloudLayer } from '@/core/rendering/globe/layers/globe-cloud-layer'
import { GlobeGraticuleLayer } from '@/core/rendering/globe/layers/globe-graticule-layer'
import { GlobePolityBorderLayer } from '@/core/rendering/globe/layers/globe-polity-border-layer'
import { GlobeRiverLayer } from '@/core/rendering/globe/layers/globe-river-layer'
import { GlobeRouteLayer } from '@/core/rendering/globe/layers/globe-route-layer'
import { GlobeSacredSiteLayer } from '@/core/rendering/globe/layers/globe-sacred-site-layer'
import { GlobeSettlementMarkerLayer } from '@/core/rendering/globe/layers/globe-settlement-marker-layer'
import { GlobeClimateVectorLayer } from '@/core/rendering/globe/layers/globe-vector-layer'
import { GlobeWaterLayer } from '@/core/rendering/globe/layers/globe-water-layer'
import { GlobeLabelLayer } from '@/core/rendering/globe/layers/globe-label-layer'
import { GlobeSettlementLayer } from '@/core/rendering/globe/layers/globe-settlement-layer'
import { SphericalRegionTopologyBuilder } from '@/core/rendering/shared/spherical-region-topology'

const TERRAIN_VERTICAL_SCALE = 0.04

export type GlobeLayerId =
  | 'water'
  | 'vectors'
  | 'clouds'
  | 'rivers'
  | 'routes'
  | 'cell-boundaries'
  | 'polity-borders'
  | 'graticule'
  | 'labels'
  | 'settlement-markers'
  | 'settlement-labels'
  | 'sacred-sites'
  | 'atmosphere'

export interface GlobeLayerContext {
  mesh: SphericalMesh
  data: WorldSimulationState
  params: WorldConfig
  smoothedRegionCorners: Float32Array | null
  regionTopologyBuilder: SphericalRegionTopologyBuilder
  canvas: HTMLCanvasElement
  sunlight: Vector3
}

export class GlobeLayerSet {
  private readonly manager: SceneLayerManager
  private readonly getContext: () => GlobeLayerContext | null

  constructor(
    scene: Scene,
    getContext: () => GlobeLayerContext | null,
  ) {
    this.getContext = getContext
    this.manager = new SceneLayerManager(scene, () => Boolean(this.getContext()))
  }

  rebuild(id: GlobeLayerId): void {
    const context = this.getContext()
    if (!context)
      return
    if (!this.shouldCreate(id, context)) {
      this.manager.dispose(id)
      return
    }
    if (id === 'atmosphere') {
      if (this.usesElevationColor(context.params.appearance.baseMap)) {
        this.manager.dispose(id)
        return
      }
      this.manager.replace(id, () => new Atmosphere(context.params.core.planetRadius))
      return
    }
    this.manager.replace(id, () => this.create(id, context))
  }

  rebuildEnvironment(): void {
    for (const id of [
      'water', 'vectors', 'clouds', 'rivers', 'routes',
      'cell-boundaries', 'polity-borders', 'graticule',
    ] as const) {
      this.rebuild(id)
    }
  }

  rebuildAll(): void {
    this.rebuildEnvironment()
    this.rebuild('labels')
    this.rebuild('settlement-markers')
    this.rebuild('settlement-labels')
    this.rebuild('sacred-sites')
    this.rebuild('atmosphere')
  }

  disposeAll(): void {
    this.manager.disposeAll()
  }

  updateViewport(width: number, height: number): void {
    this.manager.get<GlobePolityBorderLayer>('polity-borders')?.updateViewport(width, height)
  }

  updateSettlementLOD(distance: number): void {
    this.manager.get<GlobeSettlementLayer>('settlement-labels')?.updateLOD(distance)
  }

  pickSettlement(event: PointerEvent, canvas: HTMLCanvasElement, camera: Camera): number | null {
    return this.manager.get<GlobeSettlementMarkerLayer>('settlement-markers')?.pick(event, canvas, camera) ?? null
  }

  private shouldCreate(id: GlobeLayerId, context: GlobeLayerContext): boolean {
    const { params, data } = context
    if (id === 'labels')
      return Boolean(data.society)
    if (id === 'settlement-markers' || id === 'settlement-labels')
      return Boolean(params.appearance.overlays.cities && data.society?.settlements.length)
    if (id === 'sacred-sites')
      return Boolean(params.appearance.overlays['sacred-sites'] && data.society?.religions?.sacredSites.length)
    if (id === 'atmosphere')
      return params.appearance.overlays.atmosphere
    return true
  }

  private create(id: Exclude<GlobeLayerId, 'atmosphere'>, context: GlobeLayerContext) {
    const {
      mesh, data, params, smoothedRegionCorners, regionTopologyBuilder, canvas, sunlight,
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
      case 'rivers':
        return new GlobeRiverLayer(mesh, data, params, smoothedRegionCorners, terrainVerticalScale, usesElevationGeometry)
      case 'routes':
        return new GlobeRouteLayer(
          mesh, data, params, terrainVerticalScale, usesElevationGeometry,
          params.appearance.overlays['day-night'] ? [sunlight.x, sunlight.y, sunlight.z] : undefined,
        )
      case 'cell-boundaries':
        return new GlobeCellBoundaryLayer(mesh, data, params, terrainVerticalScale, usesElevationGeometry, smoothedRegionCorners)
      case 'polity-borders':
        return new GlobePolityBorderLayer(
          mesh, data, params, terrainVerticalScale, usesElevationGeometry, smoothedRegionCorners,
          regionTopologyBuilder, canvas.clientWidth, canvas.clientHeight, sunlight,
        )
      case 'graticule':
        return new GlobeGraticuleLayer(params, terrainVerticalScale, usesElevationGeometry)
      case 'labels':
        return new GlobeLabelLayer(mesh, data, params, terrainVerticalScale)
      case 'settlement-markers':
        return new GlobeSettlementMarkerLayer(mesh, data, params, sunlight, terrainVerticalScale, usesElevationGeometry)
      case 'settlement-labels':
        return new GlobeSettlementLayer(mesh, data, params, terrainVerticalScale)
      case 'sacred-sites':
        return new GlobeSacredSiteLayer(mesh, data, params, sunlight, terrainVerticalScale, usesElevationGeometry)
      default:
        throw new Error(`Unknown globe layer: ${id}`)
    }
  }

  private usesElevationGeometry(params: WorldConfig): boolean {
    return params.appearance.elevationDisplacement
      && (params.appearance.baseMap === 'dem'
        || params.appearance.baseMap === 'heightmap'
        || params.appearance.baseMap === 'satellite')
  }

  private usesElevationColor(mode: string): boolean {
    return mode === 'dem' || mode === 'heightmap'
  }
}

