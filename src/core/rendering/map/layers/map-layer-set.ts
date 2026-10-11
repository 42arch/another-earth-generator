import type { Camera, Scene } from 'three'
import type { GeoJsonFeatureHit } from '@/core/data-source/geojson'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import type { SymbolCollisionBox } from '@/core/rendering/shared/styled-symbol-layer'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { subscribeMapDataSourceChanges } from '@/core/data-source/data-sources'
import { MapCellBoundaryLayer } from '@/core/rendering/map/layers/map-cell-boundary-layer'
import { MapCloudLayer } from '@/core/rendering/map/layers/map-cloud-layer'
import { MapGraticuleLayer } from '@/core/rendering/map/layers/map-graticule-layer'
import { MapRiverLayer } from '@/core/rendering/map/layers/map-river-layer'
import { MapClimateVectorLayer } from '@/core/rendering/map/layers/map-vector-layer'
import { SceneLayerManager } from '@/core/rendering/scene-layer-manager'
import { StyledFillLayer } from '@/core/rendering/shared/styled-fill-layer'
import { StyledLineLayer } from '@/core/rendering/shared/styled-line-layer'
import { StyledPointLayer } from '@/core/rendering/shared/styled-point-layer'
import { StyledSymbolLayer } from '@/core/rendering/shared/styled-symbol-layer'
import { getFillStyleLayerEntries } from '@/core/rendering/styles/fill-layer-discovery'
import { getSegmentLineStyleLayerEntries } from '@/core/rendering/styles/line-layer-discovery'
import { getMapStyleDocument, getMapStylePaint, getMapStyleZoom, getPointStyleLayerEntries, isMapStyleLayerVisible } from '@/core/rendering/styles/style-runtime'
import { getSymbolStyleLayerEntries } from '@/core/rendering/styles/symbol-layer-discovery'

export type MapLayerId
  = | 'clouds'
    | 'rivers'
    | 'vectors'
    | 'cell-boundaries'
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
}

export class MapLayerSet {
  private readonly manager: SceneLayerManager
  private readonly getContext: () => MapLayerContext | null
  private readonly pointLayerIds = new Set<string>()
  private readonly fillLayerIds = new Set<string>()
  private readonly lineLayerIds = new Set<string>()
  private readonly symbolLayerIds = new Set<string>()
  private lastSymbolZoom = Number.NaN
  private readonly unsubscribeSourceChanges: () => void

  constructor(
    scene: Scene,
    getContext: () => MapLayerContext | null,
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

  rebuild(id: MapLayerId): void {
    const context = this.getContext()
    if (!context)
      return
    this.manager.replace(id, () => this.create(id, context))
  }

  rebuildPointLayers(): void {
    const context = this.getContext()
    if (!context)
      return
    const { mesh, data, params, projection, centralMeridian } = context
    const entries = getPointStyleLayerEntries(params.appearance.mapStyle, 'map', params.appearance.overlays)
    const nextIds = new Set(entries.map(({ layer }) => layer.id))
    for (const id of this.pointLayerIds) {
      if (!nextIds.has(id))
        this.manager.dispose(`style-point:${id}`)
    }
    for (const { layer, order } of entries) {
      this.manager.replace(`style-point:${layer.id}`, () => new StyledPointLayer(mesh, data, params, layer.id, {
        view: 'map',
        projection,
        centralMeridian,
        depth: 0.5 + order * 0.005,
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
    const { mesh, data, params, projection, centralMeridian } = context
    const entries = getFillStyleLayerEntries(params.appearance.mapStyle, 'map', params.appearance.baseMap, params.appearance.overlays)
    const nextIds = new Set(entries.map(({ layer }) => layer.id))
    for (const id of this.fillLayerIds) {
      if (!nextIds.has(id))
        this.manager.dispose(`style-fill:${id}`)
    }
    for (const { layer, order } of entries) {
      this.manager.replace(`style-fill:${layer.id}`, () => new StyledFillLayer(mesh, data, params, layer.id, {
        view: 'map',
        projection,
        centralMeridian,
        renderOrder: 1 + order * 0.01,
      }))
    }
    this.fillLayerIds.clear()
    for (const id of nextIds)
      this.fillLayerIds.add(id)
  }

  rebuildLineLayers(): void {
    const context = this.getContext()
    if (!context)
      return
    const { mesh, data, params, projection, centralMeridian } = context
    const entries = getSegmentLineStyleLayerEntries(params.appearance.mapStyle, 'map', params.appearance.overlays)
    const nextIds = new Set(entries.map(({ layer }) => layer.id))
    for (const id of this.lineLayerIds) {
      if (!nextIds.has(id))
        this.manager.dispose(`style-line:${id}`)
    }
    for (const { layer, order } of entries) {
      this.manager.replace(`style-line:${layer.id}`, () => new StyledLineLayer(mesh, data, params, layer.id, {
        view: 'map',
        projection,
        centralMeridian,
        depth: 0.325 + order * 0.025,
        renderOrder: 5.25 + order * 0.75,
      }))
    }
    this.lineLayerIds.clear()
    for (const id of nextIds)
      this.lineLayerIds.add(id)
  }

  rebuildSymbolLayers(): void {
    const context = this.getContext()
    if (!context)
      return
    const { mesh, data, params, projection, centralMeridian } = context
    const entries = getSymbolStyleLayerEntries(params.appearance.mapStyle, 'map', params.appearance.overlays)
    const nextIds = new Set(entries.map(({ layer }) => layer.id))
    for (const id of this.symbolLayerIds) {
      if (!nextIds.has(id))
        this.manager.dispose(`style-symbol:${id}`)
    }
    for (const { layer, order } of entries) {
      this.manager.replace(`style-symbol:${layer.id}`, () => new StyledSymbolLayer(mesh, data, params, layer.id, {
        view: 'map',
        projection,
        centralMeridian,
        renderOrder: 8.5 + order * 0.01,
      }))
    }
    this.symbolLayerIds.clear()
    for (const id of nextIds)
      this.symbolLayerIds.add(id)
    this.lastSymbolZoom = Number.NaN
  }

  rebuildAll(): void {
    this.rebuildFillLayers()
    this.rebuildPointLayers()
    this.rebuildLineLayers()
    this.rebuildSymbolLayers()
    const ids: MapLayerId[] = [
      'clouds',
      'rivers',
      'vectors',
      'cell-boundaries',
      'graticule',
    ]
    for (const id of ids)
      this.rebuild(id)
  }

  disposeAll(): void {
    this.manager.disposeAll()
    this.pointLayerIds.clear()
    this.fillLayerIds.clear()
    this.lineLayerIds.clear()
    this.symbolLayerIds.clear()
    this.lastSymbolZoom = Number.NaN
  }

  destroy(): void {
    this.unsubscribeSourceChanges()
    this.disposeAll()
  }

  updateViewport(width: number, height: number): void {
    this.manager.get<MapRiverLayer>('rivers')?.updateViewport(width, height)
    this.manager.get<MapClimateVectorLayer>('vectors')?.updateViewport(width, height)
  }

  update(zoom: number): void {
    this.manager.get<MapClimateVectorLayer>('vectors')?.updateLineWidth(zoom)

    const context = this.getContext()
    if (!context)
      return
    const styleId = context.params.appearance.mapStyle
    const styleZoom = getMapStyleZoom(zoom)
    if (Math.abs(zoom - this.lastSymbolZoom) >= 0.015 || Number.isNaN(this.lastSymbolZoom)) {
      this.lastSymbolZoom = zoom
      const occupied: SymbolCollisionBox[] = []
      const symbols = getSymbolStyleLayerEntries(styleId, 'map', context.params.appearance.overlays)
      for (const { layer } of symbols.filter(({ layer }) => layer.source !== 'settlement-labels'))
        this.manager.get<StyledSymbolLayer>(`style-symbol:${layer.id}`)?.updateMapZoom(styleId, zoom, styleZoom, occupied)
      for (const { layer } of symbols.filter(({ layer }) => layer.source === 'settlement-labels'))
        this.manager.get<StyledSymbolLayer>(`style-symbol:${layer.id}`)?.updateMapZoom(styleId, zoom, styleZoom, occupied)
    }
    const riverWidth = Number(getMapStylePaint(styleId, 'rivers', 'line-width', styleZoom) ?? 1)
    this.manager.get<MapRiverLayer>('rivers')?.updateWidthScale(zoom, riverWidth)
    for (const id of this.lineLayerIds)
      this.manager.get<StyledLineLayer>(`style-line:${id}`)?.updateStyleZoom(styleId, styleZoom)
    for (const id of this.fillLayerIds)
      this.manager.get<StyledFillLayer>(`style-fill:${id}`)?.updateStyleZoom(styleId, styleZoom)
    for (const id of this.pointLayerIds)
      this.manager.get<StyledPointLayer>(`style-point:${id}`)?.updateStyleZoom(styleId, styleZoom)
    const setVisible = (layerId: MapLayerId, styleLayerId: string, visible: boolean) => {
      const group = this.manager.get(layerId)?.group
      if (group)
        group.visible = visible && isMapStyleLayerVisible(styleId, styleLayerId, styleZoom, 'map')
    }
    setVisible('rivers', 'rivers', true)
  }

  pickSettlement(event: PointerEvent, canvas: HTMLCanvasElement, camera: Camera): number | null {
    const context = this.getContext()
    if (!context)
      return null
    const entries = getSymbolStyleLayerEntries(context.params.appearance.mapStyle, 'map', context.params.appearance.overlays)
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
      const hit = this.manager.get<MapRiverLayer>('rivers')?.pickFeature(event, canvas, camera)
      return hit ? { layerId: 'rivers', ...hit } : null
    }
    return pick('symbol', this.symbolLayerIds, 'pickGeoJsonFeature')
      ?? pick('point', this.pointLayerIds, 'pickFeature')
      ?? pick('line', this.lineLayerIds, 'pickFeature')
      ?? pickRiver()
      ?? pick('fill', this.fillLayerIds, 'pickFeature')
  }

  private create(id: MapLayerId, context: MapLayerContext) {
    const {
      mesh,
      data,
      params,
      projection,
      centralMeridian,
      smoothedRegionCorners,
      viewportWidth,
      viewportHeight,
    } = context

    switch (id) {
      case 'clouds':
        return new MapCloudLayer(mesh, data, params, projection, centralMeridian)
      case 'rivers':
        return new MapRiverLayer(mesh, data, params, projection, centralMeridian, viewportWidth, viewportHeight)
      case 'vectors':
        return new MapClimateVectorLayer(mesh, data, params, projection, centralMeridian)
      case 'cell-boundaries':
        return new MapCellBoundaryLayer(mesh, data, params, projection, centralMeridian, smoothedRegionCorners)
      case 'graticule':
        return new MapGraticuleLayer(params, projection, centralMeridian)
      default:
        throw new Error(`Unknown map layer: ${id}`)
    }
  }
}
