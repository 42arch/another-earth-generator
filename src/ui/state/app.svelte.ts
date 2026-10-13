import type { MapProjectionId } from '@/core/projections/map-projection'
import type { WorldViewMode } from '@/core/rendering'
import type { WorldConfig } from '@/core/simulation/config'
import type { LayerStatistics } from '@/core/world/layer-statistics'
import type WorldEngine from '@/core/world/world-engine'
import type { SelectedRegionInfo, WorldSummaryInfo } from '@/core/world/world-info'
import { tick } from 'svelte'
import { applyShareHash, createShareHash } from '@/core/sharing/share-link'
import { cloneWorldConfig, DEFAULT_WORLD_CONFIG } from '@/core/simulation/config'

export class AppState {
  engine: WorldEngine | null = null
  params: WorldConfig = $state(cloneWorldConfig(DEFAULT_WORLD_CONFIG))
  selectedRegion = $state<SelectedRegionInfo | null>(null)
  worldSummary = $state<WorldSummaryInfo>({
    regionCount: 0,
    triangleCount: 0,
    plateCount: 0,
    totalPopulation: 0,
    settlementCount: 0,
    roadCount: 0,
    seaRouteCount: 0,
    ethnicGroupCount: 0,
    languageCount: 0,
    polityCount: 0,
    districtCount: 0,
    religionCount: 0,
    sacredSiteCount: 0,
  })

  lastGeneratedParamsString = $state('')

  get hasUnappliedChanges(): boolean {
    if (!this.lastGeneratedParamsString)
      return false
    const current = JSON.stringify({
      core: $state.snapshot(this.params.core),
      terrain: $state.snapshot(this.params.terrain),
      geology: $state.snapshot(this.params.geology),
      climate: $state.snapshot(this.params.climate),
      civilization: $state.snapshot(this.params.civilization),
    })
    return current !== this.lastGeneratedParamsString
  }

  // 面板开关与生成状态
  isGenerating = $state(true)
  loadingStageText = $state('正在构建球面拓扑网格…')
  parameterPanelOpen = $state(false)
  layerDrawerOpen = $state(false)
  layerStatistics = $state<LayerStatistics | null>(null)
  inspectorOpen = $state(false)
  viewMode = $state<WorldViewMode>('globe')
  mapProjection = $state<MapProjectionId>('mercator')

  init(engine: WorldEngine) {
    this.engine = engine
    this.engine.setViewMode(this.viewMode)
    this.engine.setMapProjection(this.mapProjection)
  }

  restoreFromShareHash(hash: string): boolean {
    return applyShareHash(this.params, hash)
  }

  createShareUrl(): string {
    const url = new URL(window.location.href)
    url.hash = createShareHash(this.params).slice(1)
    return url.toString()
  }

  private syncShareUrlToAddressBar(): void {
    window.history.replaceState(window.history.state, '', this.createShareUrl())
  }

  setGenerating(generating: boolean, text = '正在构建球面…') {
    this.isGenerating = generating
    if (text)
      this.loadingStageText = text
  }

  private updateDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private generationRequestId = 0

  updateParam<C extends keyof WorldConfig, K extends keyof WorldConfig[C]>(category: C, key: K, value: WorldConfig[C][K], immediate = true) {
    this.params[category][key] = value
    if (!this.engine)
      return

    // 外观显示层切换立即响应
    const isAppearanceParam = category === 'appearance'

    if (isAppearanceParam) {
      this.engine.updateParams(this.params)
      this.engine.updateAppearance()
      if (this.layerDrawerOpen)
        this.refreshLayerStatistics()
      return
    }

    if (this.updateDebounceTimer) {
      clearTimeout(this.updateDebounceTimer)
      this.updateDebounceTimer = null
    }

    const executeRecalculation = () => void this.regenerateWorld()

    if (immediate) {
      executeRecalculation()
    }
    else {
      this.updateDebounceTimer = setTimeout(() => {
        this.updateDebounceTimer = null
        executeRecalculation()
      }, 160)
    }
  }

  setBaseMap(mode: string) {
    this.updateParam('appearance', 'baseMap', mode)
  }

  setSurfaceField(field: string) {
    if (field === 'plates' || field === 'continents' || field === 'koppen' || field === 'biome') {
      this.params.appearance.thematicFills = {
        ...this.params.appearance.thematicFills,
        [field]: true,
      }
      this.params.appearance.surfaceField = 'default'
      this.params.appearance.baseMap = this.params.appearance.mapStyle === 'satellite' ? 'satellite' : 'cartographic'
      this.updateParam('appearance', 'thematicFills', { ...this.params.appearance.thematicFills })
      this.updateParam('appearance', 'baseMap', this.params.appearance.baseMap)
      return
    }

    const normalizedField = field
    this.params.appearance.surfaceField = normalizedField
    if (normalizedField === 'default') {
      this.params.appearance.baseMap = this.params.appearance.mapStyle === 'satellite' ? 'satellite' : 'cartographic'
    }
    else {
      this.params.appearance.baseMap = normalizedField
    }
    this.updateParam('appearance', 'baseMap', this.params.appearance.baseMap)
  }

  toggleThematicFill(fillId: string) {
    this.setThematicFill(fillId, !this.params.appearance.thematicFills?.[fillId])
  }

  setThematicFill(fillId: string, enabled: boolean) {
    if (!this.params.appearance.thematicFills)
      this.params.appearance.thematicFills = {}

    this.params.appearance.thematicFills[fillId] = enabled
    if (!enabled && (this.params.appearance.surfaceField === fillId
      || (this.params.appearance.surfaceField === 'default' && this.params.appearance.baseMap === fillId))) {
      this.params.appearance.surfaceField = 'default'
      this.params.appearance.baseMap = this.params.appearance.mapStyle === 'satellite' ? 'satellite' : 'cartographic'
    }
    this.updateParam('appearance', 'thematicFills', { ...this.params.appearance.thematicFills })
  }

  setOverlay(overlayId: string, enabled: boolean) {
    this.params.appearance.overlays[overlayId] = enabled
    this.updateParam('appearance', 'overlays', { ...this.params.appearance.overlays })
  }

  setMapStyle(style: WorldConfig['appearance']['mapStyle']) {
    this.params.appearance.mapStyle = style
    if (!this.params.appearance.surfaceField || this.params.appearance.surfaceField === 'default') {
      this.params.appearance.baseMap = style === 'satellite' ? 'satellite' : 'cartographic'
    }
    if (!this.engine)
      return
    this.engine.updateParams(this.params)
    this.engine.updateAppearance()
    if (this.layerDrawerOpen)
      this.refreshLayerStatistics()
  }

  toggleLayerDrawer() {
    this.layerDrawerOpen = !this.layerDrawerOpen
    if (this.layerDrawerOpen) {
      this.refreshLayerStatistics()
    }
  }

  private refreshLayerStatistics() {
    this.layerStatistics = this.engine?.getLayerStatistics() ?? null
  }

  setViewMode(mode: WorldViewMode) {
    this.viewMode = mode
    this.engine?.setViewMode(mode)
  }

  toggleViewMode() {
    this.setViewMode(this.viewMode === 'globe' ? 'map' : 'globe')
  }

  setMapProjection(id: MapProjectionId) {
    this.mapProjection = id
    this.engine?.setMapProjection(id)
  }

  toggleMapProjection() {
    this.setMapProjection(
      this.mapProjection === 'mercator' ? 'equal-earth' : 'mercator',
    )
  }

  toggleOverlay(overlayId: string) {
    const isEnabled = this.params.appearance.overlays[overlayId] ?? false
    this.params.appearance.overlays[overlayId] = !isEnabled
    this.updateParam('appearance', 'overlays', this.params.appearance.overlays)
  }

  toggleLayer(layerKey: keyof WorldConfig['appearance']) {
    if (typeof this.params.appearance[layerKey] === 'boolean') {
      this.updateParam('appearance', layerKey, !this.params.appearance[layerKey] as WorldConfig['appearance'][typeof layerKey])
    }
  }

  async regenerateWorld(text = '正在构建球面拓扑网格…', updateAddressBar = false) {
    if (!this.engine)
      return
    if (this.updateDebounceTimer) {
      clearTimeout(this.updateDebounceTimer)
      this.updateDebounceTimer = null
    }
    const requestId = ++this.generationRequestId
    if (this.layerDrawerOpen)
      this.layerStatistics = null
    this.setGenerating(true, text)
    await this.waitForLoadingPaint()
    if (requestId !== this.generationRequestId)
      return
    this.engine.updateParams(this.params)

    this.lastGeneratedParamsString = JSON.stringify({
      core: $state.snapshot(this.params.core),
      terrain: $state.snapshot(this.params.terrain),
      geology: $state.snapshot(this.params.geology),
      climate: $state.snapshot(this.params.climate),
      civilization: $state.snapshot(this.params.civilization),
    })

    try {
      const generated = await this.engine.generateWorld()
      if (generated) {
        if (updateAddressBar)
          this.syncShareUrlToAddressBar()
        if (this.layerDrawerOpen)
          this.refreshLayerStatistics()
      }
    }
    catch (error) {
      console.error('World generation failed', error)
      if (this.layerDrawerOpen)
        this.refreshLayerStatistics()
    }
    finally {
      if (requestId === this.generationRequestId) {
        setTimeout(() => {
          if (requestId === this.generationRequestId)
            this.setGenerating(false)
        }, 150)
      }
    }
  }

  resetCamera() {
    if (this.engine)
      this.engine.resetCamera()
  }

  randomizeSeed() {
    const newSeed = Math.floor(Math.random() * 9000) + 1000
    this.params.core.seed = newSeed
    this.regenerateWorld(`正在根据新种子 #${newSeed} 构建世界…`)
  }

  private async waitForLoadingPaint(): Promise<void> {
    await tick()
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve())
      })
    })
  }
}

export const appState = new AppState()
