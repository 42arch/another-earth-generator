import type { Camera } from 'three'
import type { GeoJsonFeatureHit } from '@/core/data-source'
import type { SceneLayerManager } from '@/core/rendering/scene-layer-manager'
import type { LayerFactoryContext } from '@/core/rendering/shared/styled/layer-factory'
import type { StyledLayerBehavior, StyledLayerUpdateContext, ViewportBounds } from '@/core/rendering/shared/styled/styled-layer-behavior'
import type { WorldConfig } from '@/core/simulation/config'
import type { MapStyleRenderer } from '@/core/styles'
import { subscribeMapDataSourceChanges } from '@/core/data-source'
import { getActiveStyleLayersByRenderer, haveStyleOverlayChanges, LayerFactory } from '@/core/rendering/shared/styled/layer-factory'
import { CollisionGrid, isSettlementPickableLayer, isViewportUpdatableLayer } from '@/core/rendering/shared/styled/styled-layer-behavior'
import { getMapStyleDocument, getMapStyleLayer, havePointStyleOverlayChanges, resolveEffectiveSurfaceMode } from '@/core/styles'

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
  const labelOverlaysChanged = settlementLabelsChanged
    || previousOverlays['nation-labels'] !== nextOverlays['nation-labels']
    || previousOverlays['religion-labels'] !== nextOverlays['religion-labels']
    || previousOverlays['ethnicity-labels'] !== nextOverlays['ethnicity-labels']
    || previousOverlays['language-labels'] !== nextOverlays['language-labels']
  const overlayLightingChanged = view === 'globe'
    && nextMode === 'satellite'
    && (previousOverlays['day-night'] !== nextOverlays['day-night']
      || (previous.appearance.climateMonth !== next.appearance.climateMonth && nextOverlays['day-night']))
  const lineSurfaceChanged = view === 'globe' && (modeChanged || thematicFillsChanged)

  const plan: AppearanceRebuildPlan = {}
  if (styleChanged || haveStyleOverlayChanges(next.appearance.mapStyle, 'river-ribbon', previousOverlays, nextOverlays))
    plan['river-ribbon'] = styleChanged
  if (lineSurfaceChanged || styleChanged || overlayLightingChanged
    || haveStyleOverlayChanges(next.appearance.mapStyle, 'line', previousOverlays, nextOverlays)) {
    plan.line = lineSurfaceChanged || styleChanged || overlayLightingChanged
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

  private lastStyleZoom = Number.NaN
  private lastViewZoom = Number.NaN
  private lastStyleId = ''
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

    this.lastStyleZoom = Number.NaN
    this.lastViewZoom = Number.NaN
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
    this.lastStyleId = ''
    this.lastStyleZoom = Number.NaN
    this.lastViewZoom = Number.NaN
  }

  updateZoom(styleZoom: number, viewZoom: number, viewportBounds?: ViewportBounds): void {
    const context = this.getContext()
    if (!context)
      return

    const styleId = context.params.appearance.mapStyle
    if (styleId === this.lastStyleId
      && Math.abs(styleZoom - this.lastStyleZoom) < 0.001
      && Math.abs(viewZoom - this.lastViewZoom) < 0.001) {
      return
    }
    this.lastStyleId = styleId
    this.lastStyleZoom = styleZoom
    this.lastViewZoom = viewZoom

    if (context.view === 'map') {
      const collisionGrid = new CollisionGrid(0.25)
      const symbolIds = [...this.layerIds.symbol]
      const orderedIds = [
        ...symbolIds.filter(id => getMapStyleLayer(styleId, id)?.source !== 'settlement-labels'),
        ...symbolIds.filter(id => getMapStyleLayer(styleId, id)?.source === 'settlement-labels'),
      ]
      for (const id of orderedIds) {
        if (this.isConfigurationHidden('symbol', id))
          continue
        const symbolLayer = this.sceneLayers.get<StyledLayerBehavior>(rendererKey('symbol', id))
        if (symbolLayer) {
          symbolLayer.updateStyle({
            layerId: id,
            styleId,
            view: 'map',
            styleZoom,
            viewZoom,
            collisionGrid,
            viewportBounds,
          })
          this.applyVisibility('symbol', id, symbolLayer)
        }
      }
    }
    else {
      for (const id of this.layerIds.symbol) {
        if (this.isConfigurationHidden('symbol', id))
          continue
        const symbolLayer = this.sceneLayers.get<StyledLayerBehavior>(rendererKey('symbol', id))
        if (symbolLayer) {
          symbolLayer.updateStyle({ layerId: id, styleId, view: 'globe', styleZoom, viewZoom })
          this.applyVisibility('symbol', id, symbolLayer)
        }
      }
    }

    const updateContext = { styleId, view: context.view, styleZoom, viewZoom }
    this.updateZoomedLayers('line', updateContext)
    this.updateZoomedLayers('circle', updateContext)
    this.updateZoomedLayers('fill', updateContext)
    this.updateZoomedLayers('river-ribbon', updateContext)
  }

  updateViewport(width: number, height: number): void {
    const context = this.getContext()
    if (!context)
      return
    for (const lineLayerId of this.layerIds.line) {
      const layer = this.sceneLayers.get<StyledLayerBehavior>(rendererKey('line', lineLayerId))
      if (layer && isViewportUpdatableLayer(layer))
        layer.updateViewport(width, height)
    }
    if (context.view !== 'map')
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
    context: Omit<StyledLayerUpdateContext, 'layerId'>,
  ): void {
    for (const id of this.layerIds[renderer]) {
      if (this.isConfigurationHidden(renderer, id))
        continue
      const layer = this.sceneLayers.get<StyledLayerBehavior>(rendererKey(renderer, id))
      if (!layer)
        continue
      layer.updateStyle({ ...context, layerId: id })
      this.applyVisibility(renderer, id, layer)
    }
  }

  private isConfigurationHidden(renderer: StyledLayerRenderer, layerId: string): boolean {
    return this.sceneLayers.getHiddenReason(rendererKey(renderer, layerId)) === 'configuration'
  }

  private applyVisibility(
    renderer: StyledLayerRenderer,
    layerId: string,
    layer: StyledLayerBehavior,
  ): void {
    if (!layer.group.visible) {
      this.sceneLayers.hide(rendererKey(renderer, layerId), 'style-visibility')
    }
    else {
      this.sceneLayers.setVisible(rendererKey(renderer, layerId), true)
    }
  }
}
