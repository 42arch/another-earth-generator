import type { Camera } from 'three'
import type { GeoJsonFeatureHit } from '@/core/data-source/geojson'
import type { SceneLayerManager } from '@/core/rendering/scene-layer-manager'
import type { LayerFactoryContext } from '@/core/rendering/shared/layer-factory'
import type { StyledLayerBehavior, StyledLayerUpdateContext, SymbolCollisionBox } from '@/core/rendering/shared/styled-layer-behavior'
import type { MapStyleLayer, MapStyleRenderer } from '@/core/rendering/styles/style-spec'
import type { WorldConfig } from '@/core/simulation/config'
import { subscribeMapDataSourceChanges } from '@/core/data-source/data-sources'
import { getActiveStyleLayers, getActiveStyleLayersByRenderer, haveStyleOverlayChanges, LayerFactory } from '@/core/rendering/shared/layer-factory'
import { isSettlementPickableLayer, isViewportUpdatableLayer } from '@/core/rendering/shared/styled-layer-behavior'
import { getMapStyleDocument, havePointStyleOverlayChanges, isMapStyleLayerVisible, resolveEffectiveSurfaceMode } from '@/core/rendering/styles/style-runtime'

export type StyledLayerRenderer = Exclude<MapStyleRenderer, 'raster'>
type AppearanceRebuildPlan = Partial<Record<StyledLayerRenderer, boolean>>

const rendererKinds: readonly StyledLayerRenderer[] = ['fill', 'line', 'river-ribbon', 'circle', 'symbol']

function rendererKey(renderer: StyledLayerRenderer, layerId: string): string {
  const kind = renderer === 'circle' ? 'point' : renderer
  return `style-${kind}:${layerId}`
}

/** Resolve which style renderers need rebuilding for an appearance change. */
function getAppearanceRebuildPlan(
  view: LayerFactoryContext['view'],
  previous: WorldConfig,
  next: WorldConfig,
): AppearanceRebuildPlan {
  const previousMode = resolveEffectiveSurfaceMode(previous.appearance)
  const nextMode = resolveEffectiveSurfaceMode(next.appearance)
  const modeChanged = previousMode !== nextMode
  const styleChanged = previous.appearance.mapStyle !== next.appearance.mapStyle
  const previousOverlays = previous.appearance.overlays
  const nextOverlays = next.appearance.overlays
  const thematicFillsChanged = Object.keys({
    ...(previous.appearance.thematicFills ?? {}),
    ...(next.appearance.thematicFills ?? {}),
  }).some(id => previous.appearance.thematicFills?.[id] !== next.appearance.thematicFills?.[id])
  const settlementLabelsChanged = previousOverlays.cities !== nextOverlays.cities
    || previousOverlays['sacred-sites'] !== nextOverlays['sacred-sites']
  const labelOverlaysChanged = settlementLabelsChanged
    || previousOverlays['nation-labels'] !== nextOverlays['nation-labels']
    || previousOverlays['religion-labels'] !== nextOverlays['religion-labels']
    || previousOverlays['ethnicity-labels'] !== nextOverlays['ethnicity-labels']
    || previousOverlays['language-labels'] !== nextOverlays['language-labels']
  const overlayLightingChanged = view === 'globe'
    && nextMode === 'satellite'
    && (previousOverlays['day-night'] !== nextOverlays['day-night']
      || (previous.appearance.climateMonth !== next.appearance.climateMonth && nextOverlays['day-night']))

  const plan: AppearanceRebuildPlan = {}
  if (styleChanged)
    plan['river-ribbon'] = true
  if (styleChanged || overlayLightingChanged
    || haveStyleOverlayChanges(next.appearance.mapStyle, 'line', previousOverlays, nextOverlays)) {
    plan.line = styleChanged || overlayLightingChanged
  }
  if (styleChanged || overlayLightingChanged
    || havePointStyleOverlayChanges(next.appearance.mapStyle, previousOverlays, nextOverlays)) {
    plan.circle = styleChanged || overlayLightingChanged
  }
  if (modeChanged || styleChanged || thematicFillsChanged)
    plan.fill = styleChanged
  if (modeChanged || styleChanged || labelOverlaysChanged)
    plan.symbol = styleChanged
  return plan
}

/** Owns the shared style-driven layer lifecycle for either map or globe scenes. */
export class StyledLayerManager {
  private readonly sceneLayers: SceneLayerManager
  private readonly getContext: () => LayerFactoryContext | null
  private readonly layerIds: Record<StyledLayerRenderer, Set<string>> = {
    'fill': new Set(),
    'line': new Set(),
    'river-ribbon': new Set(),
    'circle': new Set(),
    'symbol': new Set(),
  }

  private lastMapSymbolZoom = Number.NaN
  private readonly unsubscribeSourceChanges: () => void

  constructor(
    sceneLayers: SceneLayerManager,
    getContext: () => LayerFactoryContext | null,
  ) {
    this.sceneLayers = sceneLayers
    this.getContext = getContext
    this.unsubscribeSourceChanges = subscribeMapDataSourceChanges(this.handleSourceChange)
  }

  rebuild(renderer: StyledLayerRenderer, forceRecreate = false): void {
    const context = this.getContext()
    if (!context)
      return

    const entries = getActiveStyleLayersByRenderer(
      context.params.appearance.mapStyle,
      context.view,
      context.params,
      renderer,
    )
    const activeIds = new Set(entries.map(({ layer }) => layer.id))
    const ids = this.layerIds[renderer]

    if (forceRecreate) {
      for (const id of ids)
        this.sceneLayers.dispose(rendererKey(renderer, id))
      ids.clear()
    }
    else {
      for (const id of ids) {
        if (!activeIds.has(id))
          this.sceneLayers.hide(rendererKey(renderer, id), 'configuration')
      }
    }

    for (const { layer, order } of entries) {
      const created = this.sceneLayers.ensure(
        rendererKey(renderer, layer.id),
        () => LayerFactory.createLayer(layer, order, context)!,
      )
      if (created)
        this.sceneLayers.setVisible(rendererKey(renderer, layer.id), true)
      ids.add(layer.id)
    }

    if (renderer === 'symbol')
      this.lastMapSymbolZoom = Number.NaN
  }

  rebuildAll(forceRecreate = true): void {
    for (const renderer of rendererKinds)
      this.rebuild(renderer, forceRecreate)
  }

  /** Reconcile style-driven renderers after an appearance configuration change. */
  reconcileAppearance(previous: WorldConfig, next: WorldConfig): void {
    const context = this.getContext()
    if (!context)
      return

    const plan = getAppearanceRebuildPlan(context.view, previous, next)
    for (const renderer of ['river-ribbon', 'line', 'circle', 'fill', 'symbol'] as const) {
      const forceRecreate = plan[renderer]
      if (forceRecreate !== undefined)
        this.rebuild(renderer, forceRecreate)
    }
  }

  /** Clear tracking after the owning SceneLayerManager has disposed every layer. */
  resetTracking(): void {
    for (const ids of Object.values(this.layerIds))
      ids.clear()
    this.lastMapSymbolZoom = Number.NaN
  }

  updateZoom(styleZoom: number, viewZoom: number): void {
    const context = this.getContext()
    if (!context)
      return

    const styleId = context.params.appearance.mapStyle
    const activeLayers: Record<StyledLayerRenderer, Map<string, { layer: MapStyleLayer, order: number }>> = {
      'fill': new Map(),
      'line': new Map(),
      'river-ribbon': new Map(),
      'circle': new Map(),
      'symbol': new Map(),
    }
    for (const entry of getActiveStyleLayers(styleId, context.view, context.params)) {
      const { layer } = entry
      if (layer.renderer === 'raster')
        continue
      activeLayers[layer.renderer].set(layer.id, entry)
    }

    if (context.view === 'map') {
      const symbols = [...activeLayers.symbol.values()]
      const symbolVisibilityChanged = symbols.some(({ layer }) => {
        const symbolLayer = this.sceneLayers.get<StyledLayerBehavior>(rendererKey('symbol', layer.id))
        return symbolLayer != null
          && symbolLayer.group.visible !== isMapStyleLayerVisible(styleId, layer.id, styleZoom, 'map')
      })
      if (Math.abs(viewZoom - this.lastMapSymbolZoom) >= 0.015
        || Number.isNaN(this.lastMapSymbolZoom)
        || symbolVisibilityChanged) {
        this.lastMapSymbolZoom = viewZoom
        const occupied: SymbolCollisionBox[] = []
        const orderedSymbols = [
          ...symbols.filter(({ layer }) => layer.source !== 'settlement-labels'),
          ...symbols.filter(({ layer }) => layer.source === 'settlement-labels'),
        ]
        for (const { layer } of orderedSymbols) {
          const symbolLayer = this.sceneLayers.get<StyledLayerBehavior>(rendererKey('symbol', layer.id))
          if (symbolLayer) {
            symbolLayer.updateStyle({
              layerId: layer.id,
              styleId,
              view: 'map',
              styleZoom,
              viewZoom,
              occupiedSymbols: occupied,
            })
            this.applyVisibility('symbol', layer.id, symbolLayer, activeLayers.symbol.has(layer.id))
          }
        }
      }
    }
    else {
      for (const { layer } of activeLayers.symbol.values()) {
        const symbolLayer = this.sceneLayers.get<StyledLayerBehavior>(rendererKey('symbol', layer.id))
        if (symbolLayer) {
          symbolLayer.updateStyle({ layerId: layer.id, styleId, view: 'globe', styleZoom, viewZoom })
          this.applyVisibility('symbol', layer.id, symbolLayer, activeLayers.symbol.has(layer.id))
        }
      }
    }

    const updateContext = { styleId, view: context.view, styleZoom, viewZoom }
    this.updateZoomedLayers('line', activeLayers.line, updateContext)
    this.updateZoomedLayers('circle', activeLayers.circle, updateContext)
    this.updateZoomedLayers('fill', activeLayers.fill, updateContext)
    this.updateZoomedLayers('river-ribbon', activeLayers['river-ribbon'], updateContext)
  }

  updateViewport(width: number, height: number): void {
    const context = this.getContext()
    if (!context || context.view !== 'map')
      return
    for (const riverLayerId of this.layerIds['river-ribbon']) {
      const layer = this.sceneLayers.get<StyledLayerBehavior>(rendererKey('river-ribbon', riverLayerId))
      if (layer && isViewportUpdatableLayer(layer))
        layer.updateViewport(width, height)
    }
  }

  pickSettlement(event: PointerEvent, canvas: HTMLCanvasElement, camera: Camera): number | null {
    const context = this.getContext()
    if (!context)
      return null

    const entries = getActiveStyleLayersByRenderer(context.params.appearance.mapStyle, context.view, context.params, 'symbol')
    for (const { layer } of entries) {
      if (layer.source !== 'settlement-labels')
        continue
      const symbolLayer = this.sceneLayers.get<StyledLayerBehavior>(rendererKey('symbol', layer.id))
      if (!symbolLayer?.group.visible || !isSettlementPickableLayer(symbolLayer))
        continue
      const picked = symbolLayer.pickSettlementFeature(event, canvas, camera)
      if (picked !== null && picked !== undefined)
        return picked
    }
    return null
  }

  pickGeoJsonFeature(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    camera: Camera,
  ): GeoJsonFeatureHit | null {
    const pick = (
      renderer: StyledLayerRenderer,
    ): GeoJsonFeatureHit | null => {
      for (const layerId of [...this.layerIds[renderer]].reverse()) {
        const layer = this.sceneLayers.get<StyledLayerBehavior>(rendererKey(renderer, layerId))
        if (!layer?.group.visible)
          continue
        const hit = layer.pickGeoJsonFeature(event, canvas, camera)
        if (hit)
          return { layerId, ...hit }
      }
      return null
    }

    return pick('symbol')
      ?? pick('circle')
      ?? pick('line')
      ?? pick('river-ribbon')
      ?? pick('fill')
  }

  destroy(): void {
    this.unsubscribeSourceChanges()
    for (const renderer of rendererKinds) {
      for (const id of this.layerIds[renderer])
        this.sceneLayers.dispose(rendererKey(renderer, id))
    }
    this.resetTracking()
  }

  private handleSourceChange = (id: string): void => {
    const context = this.getContext()
    if (!context)
      return

    const changedLayers = getMapStyleDocument(context.params.appearance.mapStyle).layers.filter(layer => id === '*' || layer.source === id)
    for (const renderer of rendererKinds) {
      if (changedLayers.some(layer => layer.renderer === renderer)
        || (id === 'world-surface' && renderer === 'fill'
          && resolveEffectiveSurfaceMode(context.params.appearance) === 'cartographic')) {
        this.rebuild(renderer, true)
      }
    }
  }

  private updateZoomedLayers(
    renderer: StyledLayerRenderer,
    activeLayers: ReadonlyMap<string, { layer: MapStyleLayer, order: number }>,
    context: Omit<StyledLayerUpdateContext, 'layerId' | 'occupiedSymbols'>,
  ): void {
    for (const id of this.layerIds[renderer]) {
      const layer = this.sceneLayers.get<StyledLayerBehavior>(rendererKey(renderer, id))
      if (!layer)
        continue
      layer.updateStyle({ ...context, layerId: id })
      this.applyVisibility(renderer, id, layer, activeLayers.has(id))
    }
  }

  private applyVisibility(
    renderer: StyledLayerRenderer,
    layerId: string,
    layer: StyledLayerBehavior,
    active: boolean,
  ): void {
    if (!active) {
      this.sceneLayers.hide(rendererKey(renderer, layerId), 'configuration')
    }
    else if (!layer.group.visible) {
      this.sceneLayers.hide(rendererKey(renderer, layerId), 'style-visibility')
    }
    else {
      this.sceneLayers.setVisible(rendererKey(renderer, layerId), true)
    }
  }
}
