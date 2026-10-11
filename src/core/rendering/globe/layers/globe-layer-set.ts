import type { Camera, Scene, Vector3 } from 'three'
import type { GeoJsonFeatureHit } from '@/core/data-source/geojson'
import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { subscribeMapDataSourceChanges } from '@/core/data-source/data-sources'
import { Atmosphere } from '@/core/rendering/globe/atmosphere'
import { GlobeCellBoundaryLayer } from '@/core/rendering/globe/layers/globe-cell-boundary-layer'
import { GlobeCloudLayer } from '@/core/rendering/globe/layers/globe-cloud-layer'
import { GlobeGraticuleLayer } from '@/core/rendering/globe/layers/globe-graticule-layer'
import { GlobeRiverLayer } from '@/core/rendering/globe/layers/globe-river-layer'
import { GlobeClimateVectorLayer } from '@/core/rendering/globe/layers/globe-vector-layer'
import { GlobeWaterLayer } from '@/core/rendering/globe/layers/globe-water-layer'
import { SceneLayerManager } from '@/core/rendering/scene-layer-manager'
import { StyledFillLayer } from '@/core/rendering/shared/styled-fill-layer'
import { StyledLineLayer } from '@/core/rendering/shared/styled-line-layer'
import { StyledPointLayer } from '@/core/rendering/shared/styled-point-layer'
import { StyledSymbolLayer } from '@/core/rendering/shared/styled-symbol-layer'
import { getFillStyleLayerEntries } from '@/core/rendering/styles/fill-layer-discovery'
import { getSegmentLineStyleLayerEntries } from '@/core/rendering/styles/line-layer-discovery'
import { getGlobeStyleZoom, getMapStyleDocument, getMapStylePaint, getPointStyleLayerEntries, isMapStyleLayerVisible } from '@/core/rendering/styles/style-runtime'
import { getSymbolStyleLayerEntries } from '@/core/rendering/styles/symbol-layer-discovery'

const TERRAIN_VERTICAL_SCALE = 0.04

export type GlobeLayerId
  = | 'water'
    | 'vectors'
    | 'clouds'
    | 'rivers'
    | 'cell-boundaries'
    | 'graticule'
    | 'atmosphere'

export interface GlobeLayerContext {
  mesh: SphericalMesh
  data: WorldSimulationState
  params: WorldConfig
  smoothedRegionCorners: Float32Array | null
  sunlight: Vector3
}

export class GlobeLayerSet {
  private readonly manager: SceneLayerManager
  private readonly getContext: () => GlobeLayerContext | null
  private readonly pointLayerIds = new Set<string>()
  private readonly fillLayerIds = new Set<string>()
  private readonly lineLayerIds = new Set<string>()
  private readonly symbolLayerIds = new Set<string>()
  private readonly unsubscribeSourceChanges: () => void

  constructor(
    scene: Scene,
    getContext: () => GlobeLayerContext | null,
  ) {
    this.getContext = getContext
    this.manager = new SceneLayerManager(scene, () => Boolean(this.getContext()))
    this.unsubscribeSourceChanges = subscribeMapDataSourceChanges((id) => {
      const context = this.getContext()
      if (!context)
        return
      const changed = getMapStyleDocument(context.params.appearance.mapStyle).layers.filter(layer => id === '*' || layer.source === id)
      if (changed.some(layer => layer.renderer === 'fill')
        || (id === 'world-surface' && context.params.appearance.baseMap === 'cartographic'))
        this.rebuildFillLayers()
      if (changed.some(layer => layer.renderer === 'line' && layer.id !== 'rivers'))
        this.rebuildLineLayers()
      if (changed.some(layer => layer.renderer === 'circle'))
        this.rebuildPointLayers()
      if (changed.some(layer => layer.renderer === 'symbol'))
        this.rebuildSymbolLayers()
      if (id === '*' || id === 'river-network')
        this.rebuild('rivers')
    })
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
      'water',
      'vectors',
      'clouds',
      'rivers',
      'cell-boundaries',
      'graticule',
    ] as const) {
      this.rebuild(id)
    }
    this.rebuildLineLayers()
  }

  rebuildLineLayers(): void {
    const context = this.getContext()
    if (!context)
      return
    const { mesh, data, params, sunlight } = context
    const entries = getSegmentLineStyleLayerEntries(params.appearance.mapStyle, 'globe', params.appearance.overlays)
    const nextIds = new Set(entries.map(({ layer }) => layer.id))
    for (const id of this.lineLayerIds) {
      if (!nextIds.has(id))
        this.manager.dispose(`style-line:${id}`)
    }
    const terrainVerticalScale = params.core.planetRadius * TERRAIN_VERTICAL_SCALE
    const usesElevationGeometry = this.usesElevationGeometry(params)
    for (const { layer, order } of entries) {
      this.manager.replace(`style-line:${layer.id}`, () => new StyledLineLayer(mesh, data, params, layer.id, {
        view: 'globe',
        terrainVerticalScale,
        usesElevationGeometry,
        sunDirection: [sunlight.x, sunlight.y, sunlight.z],
        renderOrder: 6.75 + order * 0.25,
      }))
    }
    this.lineLayerIds.clear()
    for (const id of nextIds)
      this.lineLayerIds.add(id)
  }

  rebuildPointLayers(): void {
    const context = this.getContext()
    if (!context)
      return
    const { mesh, data, params, sunlight } = context
    const entries = getPointStyleLayerEntries(params.appearance.mapStyle, 'globe', params.appearance.overlays)
    const nextIds = new Set(entries.map(({ layer }) => layer.id))
    for (const id of this.pointLayerIds) {
      if (!nextIds.has(id))
        this.manager.dispose(`style-point:${id}`)
    }
    const terrainVerticalScale = params.core.planetRadius * TERRAIN_VERTICAL_SCALE
    const usesElevationGeometry = this.usesElevationGeometry(params)
    for (const { layer, order } of entries) {
      this.manager.replace(`style-point:${layer.id}`, () => new StyledPointLayer(mesh, data, params, layer.id, {
        view: 'globe',
        sunlight,
        terrainVerticalScale,
        usesElevationGeometry,
        renderOrder: 8 + order * 0.01,
      }))
    }
    this.pointLayerIds.clear()
    for (const id of nextIds)
      this.pointLayerIds.add(id)
  }

  rebuildFillLayers(): void {
    const context = this.getContext()
    if (!context)
      return
    const { mesh, data, params } = context
    const entries = getFillStyleLayerEntries(params.appearance.mapStyle, 'globe', params.appearance.baseMap, params.appearance.overlays)
    const nextIds = new Set(entries.map(({ layer }) => layer.id))
    for (const id of this.fillLayerIds) {
      if (!nextIds.has(id))
        this.manager.dispose(`style-fill:${id}`)
    }
    for (const { layer, order } of entries) {
      this.manager.replace(`style-fill:${layer.id}`, () => new StyledFillLayer(mesh, data, params, layer.id, {
        view: 'globe',
        planetRadius: params.core.planetRadius,
        renderOrder: 1 + order * 0.01,
      }))
    }
    this.fillLayerIds.clear()
    for (const id of nextIds)
      this.fillLayerIds.add(id)
  }

  rebuildSymbolLayers(): void {
    const context = this.getContext()
    if (!context)
      return
    const { mesh, data, params } = context
    const entries = getSymbolStyleLayerEntries(params.appearance.mapStyle, 'globe', params.appearance.overlays)
    const nextIds = new Set(entries.map(({ layer }) => layer.id))
    for (const id of this.symbolLayerIds) {
      if (!nextIds.has(id))
        this.manager.dispose(`style-symbol:${id}`)
    }
    const terrainVerticalScale = params.core.planetRadius * TERRAIN_VERTICAL_SCALE
    const usesElevationGeometry = this.usesElevationGeometry(params)
    for (const { layer, order } of entries) {
      this.manager.replace(`style-symbol:${layer.id}`, () => new StyledSymbolLayer(mesh, data, params, layer.id, {
        view: 'globe',
        terrainVerticalScale,
        usesElevationGeometry,
        planetRadius: params.core.planetRadius,
        renderOrder: 8.5 + order * 0.01,
      }))
    }
    this.symbolLayerIds.clear()
    for (const id of nextIds)
      this.symbolLayerIds.add(id)
  }

  rebuildAll(): void {
    this.rebuildEnvironment()
    this.rebuildFillLayers()
    this.rebuildPointLayers()
    this.rebuildSymbolLayers()
    this.rebuild('atmosphere')
  }

  disposeAll(): void {
    this.manager.disposeAll()
    this.pointLayerIds.clear()
    this.fillLayerIds.clear()
    this.lineLayerIds.clear()
    this.symbolLayerIds.clear()
  }

  destroy(): void {
    this.unsubscribeSourceChanges()
    this.disposeAll()
  }

  updateStyleZoom(distance: number): void {
    const context = this.getContext()
    if (!context)
      return
    const styleId = context.params.appearance.mapStyle
    const styleZoom = getGlobeStyleZoom(distance, context.params.core.planetRadius)
    for (const id of this.symbolLayerIds)
      this.manager.get<StyledSymbolLayer>(`style-symbol:${id}`)?.updateGlobeZoom(styleId, styleZoom, distance)
    for (const id of this.pointLayerIds)
      this.manager.get<StyledPointLayer>(`style-point:${id}`)?.updateStyleZoom(styleId, styleZoom)
    const riverWidth = Number(getMapStylePaint(styleId, 'rivers', 'line-width', styleZoom) ?? 1)
    this.manager.get<GlobeRiverLayer>('rivers')?.updateWidthScale(riverWidth)
    for (const id of this.lineLayerIds)
      this.manager.get<StyledLineLayer>(`style-line:${id}`)?.updateStyleZoom(styleId, styleZoom)
    for (const id of this.fillLayerIds)
      this.manager.get<StyledFillLayer>(`style-fill:${id}`)?.updateStyleZoom(styleId, styleZoom)
    const visibility: Array<[GlobeLayerId, string]> = [
      ['rivers', 'rivers'],
    ]
    for (const [layerId, styleLayerId] of visibility) {
      const group = this.manager.get(layerId)?.group
      const visible = isMapStyleLayerVisible(styleId, styleLayerId, styleZoom, 'globe')
      if (group)
        group.visible = visible
    }
  }

  pickSettlement(event: PointerEvent, canvas: HTMLCanvasElement, camera: Camera): number | null {
    const context = this.getContext()
    if (!context)
      return null
    const entries = getSymbolStyleLayerEntries(context.params.appearance.mapStyle, 'globe', context.params.appearance.overlays)
    for (const { layer } of entries) {
      if (layer.source !== 'settlement-labels')
        continue
      const picked = this.manager.get<StyledSymbolLayer>(`style-symbol:${layer.id}`)?.pickFeature(
        event,
        canvas,
        camera,
        feature => !feature.properties.isSacredSite,
      )
      if (picked !== null && picked !== undefined)
        return picked
    }
    return null
  }

  pickGeoJsonFeature(event: PointerEvent, canvas: HTMLCanvasElement, camera: Camera): GeoJsonFeatureHit | null {
    const pick = (kind: string, ids: Set<string>, method: 'pickFeature' | 'pickGeoJsonFeature'): GeoJsonFeatureHit | null => {
      for (const layerId of [...ids].reverse()) {
        const layer = this.manager.get<StyledSymbolLayer | StyledPointLayer | StyledLineLayer | StyledFillLayer>(`style-${kind}:${layerId}`)
        const hit = method === 'pickGeoJsonFeature'
          ? (layer as StyledSymbolLayer | null)?.pickGeoJsonFeature(event, canvas, camera)
          : (layer as StyledPointLayer | StyledLineLayer | StyledFillLayer | null)?.pickFeature(event, canvas, camera)
        if (hit)
          return { layerId, ...hit }
      }
      return null
    }
    const pickRiver = (): GeoJsonFeatureHit | null => {
      const hit = this.manager.get<GlobeRiverLayer>('rivers')?.pickFeature(event, canvas, camera)
      return hit ? { layerId: 'rivers', ...hit } : null
    }
    return pick('symbol', this.symbolLayerIds, 'pickGeoJsonFeature')
      ?? pick('point', this.pointLayerIds, 'pickFeature')
      ?? pick('line', this.lineLayerIds, 'pickFeature')
      ?? pickRiver()
      ?? pick('fill', this.fillLayerIds, 'pickFeature')
  }

  private shouldCreate(id: GlobeLayerId, context: GlobeLayerContext): boolean {
    const { params } = context
    if (id === 'atmosphere')
      return params.appearance.overlays.atmosphere
    return true
  }

  private create(id: Exclude<GlobeLayerId, 'atmosphere'>, context: GlobeLayerContext) {
    const {
      mesh,
      data,
      params,
      smoothedRegionCorners,
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
        return new GlobeRiverLayer(mesh, data, params, terrainVerticalScale, usesElevationGeometry)
      case 'cell-boundaries':
        return new GlobeCellBoundaryLayer(mesh, data, params, terrainVerticalScale, usesElevationGeometry, smoothedRegionCorners)
      case 'graticule':
        return new GlobeGraticuleLayer(params, terrainVerticalScale, usesElevationGeometry)
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
