import type { MapProjectionId } from '@/core/projections/map-projection'
import type { WorldViewMode } from '@/core/rendering/view-mode'
import type { GlobeDisplayMode, WorldConfig } from '@/core/simulation/config'
import type { LayerStatistics } from '@/core/world/layer-statistics'
import type WorldEngine from '@/core/world/world-engine'
import { tick } from 'svelte'
import { applyShareHash, createShareHash } from '@/core/sharing/share-link'
import { cloneWorldConfig, DEFAULT_WORLD_CONFIG } from '@/core/simulation/config'

export interface SelectedRegionInfo {
  region: number
  latitude: number
  longitude: number
  elevation: number
  plate: number
  plateDetail: number
  continent?: number
  geometricFlowCount?: number
  koppenLabel?: string
  biomeLabel?: string
  aridityIndex?: number
  growingSeasonMonths?: number
  isLand?: boolean
  annualTemperatureC?: number
  annualPrecipitationMm?: number
  monthlyTemperatureC?: number[]
  monthlyPrecipitationMm?: number[]
  vectorKind?: 'wind' | 'ocean-current'
  vectorEast?: number
  vectorNorth?: number
  vectorWarmth?: number
}

export interface WorldSummaryInfo {
  regionCount: number
  triangleCount: number
  plateCount: number
}

export class AppState {
  engine: WorldEngine | null = null
  params: WorldConfig = $state(cloneWorldConfig(DEFAULT_WORLD_CONFIG))
  selectedRegion = $state<SelectedRegionInfo | null>(null)
  worldSummary = $state<WorldSummaryInfo>({
    regionCount: 0,
    triangleCount: 0,
    plateCount: 0,
  })

  lastGeneratedParamsString = $state('')

  get hasUnappliedChanges(): boolean {
    if (!this.lastGeneratedParamsString)
return false
    const current = JSON.stringify({
      core: $state.snapshot(this.params.core),
      terrain: $state.snapshot(this.params.terrain),
      geology: $state.snapshot(this.params.geology),
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

  setDisplayMode(mode: GlobeDisplayMode) {
    this.updateParam('appearance', 'displayMode', mode)
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
