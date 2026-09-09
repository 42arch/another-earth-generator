import type { GenerationStage } from '@/core/world/generation-plan'
import type { SelectedRegionInfo, WorldSummaryInfo } from '@/core/world/world-view-data'
import type WorldEngine from '@/core/world/world-engine'
import type { MapProjectionId } from '@/core/projections/map-projection'
import type { WorldViewMode } from '@/core/rendering/view-mode'
import type { GlobeDisplayMode, GlobeGenParams } from '@/core/spherical/config'
import { cloneGlobeGenParams, DEFAULT_GLOBE_GEN_PARAMS } from '@/core/spherical/config'
import { PARAMETER_STAGE, planGeneration } from '@/core/world/generation-plan'
import type { AnalysisLayerKey, LayerKey, SettingsContext } from '@/ui/state/layer-settings'
import { ANALYSIS_LAYERS } from '@/ui/state/layer-settings'

export type { SelectedRegionInfo, WorldSummaryInfo } from '@/core/world/world-view-data'

export type { AnalysisLayerKey } from '@/ui/state/layer-settings'

export class UIState {
  engine: WorldEngine | null = null
  params: GlobeGenParams = $state(cloneGlobeGenParams(DEFAULT_GLOBE_GEN_PARAMS))
  appliedParams: GlobeGenParams = $state(cloneGlobeGenParams(DEFAULT_GLOBE_GEN_PARAMS))
  selectedRegion = $state<SelectedRegionInfo | null>(null)
  worldSummary = $state<WorldSummaryInfo>({
    lakeCount: 0,
    endorheicCount: 0,
    seasonalLakeCount: 0,
    frozenLakeCount: 0,
    subglacialLakeCount: 0,
    riverSourceCount: 0,
    riverSegmentCount: 0,
    seasonalRiverSegmentCount: 0,
    settlementCount: 0,
  })

  // 面板开关与生成状态
  generationError = $state<string | null>(null)
  private generationRequest = 0
  private hasGenerated = false
  isGenerating = $state(true)
  loadingStageText = $state('正在生成世界…')
  layerDrawerOpen = $state(false)
  inspectorOpen = $state(false)
  generalSettingsOpen = $state(false)
  settingsContext = $state<SettingsContext>({ kind: 'theme', key: 'terrain' })
  viewMode = $state<WorldViewMode>('globe')
  mapProjection = $state<MapProjectionId>('mercator')

  init(engine: WorldEngine) {
    this.engine = engine
    this.engine.setViewMode(this.viewMode)
    this.engine.setMapProjection(this.mapProjection)
  }

  get changedParamCount(): number {
    let count = 0
    for (const key of Object.keys(PARAMETER_STAGE) as (keyof GlobeGenParams)[]) {
      if (PARAMETER_STAGE[key] !== null && this.params[key] !== this.appliedParams[key])
        count++
    }
    return count
  }

  get hasPendingChanges(): boolean {
    return this.changedParamCount > 0
  }

  get appliedSeed(): number {
    return this.appliedParams.seed
  }

  get activeAnalysisLayer(): AnalysisLayerKey | null {
    return ANALYSIS_LAYERS.find(key => this.params[key]) ?? null
  }

  setGenerating(generating: boolean, text = '正在生成世界…') {
    this.isGenerating = generating
    if (text)
      this.loadingStageText = text
  }

  updateParam<K extends keyof GlobeGenParams>(key: K, value: GlobeGenParams[K], _immediate = true) {
    this.params[key] = value
    if (!this.engine)
      return

    const stage = PARAMETER_STAGE[key]
    if (stage === null) {
      this.engine.updateParams(this.runtimeParams())
      this.engine.updateAppearance()
    }
  }

  setDisplayMode(mode: GlobeDisplayMode) {
    this.updateParam('displayMode', mode)
    this.settingsContext = { kind: 'theme', key: mode }
    this.generalSettingsOpen = false
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

  toggleLayer(layerKey: LayerKey) {
    this.setLayerVisibility(layerKey, !this.params[layerKey])
  }

  selectLayer(layerKey: LayerKey) {
    this.setLayerVisibility(layerKey, true)
    this.settingsContext = { kind: 'layer', key: layerKey }
    this.generalSettingsOpen = false
  }

  setLayerVisibility(layerKey: LayerKey, visible: boolean) {
    if ((ANALYSIS_LAYERS as readonly LayerKey[]).includes(layerKey)) {
      if (visible)
        this.setAnalysisLayer(layerKey as AnalysisLayerKey)
      else if (this.activeAnalysisLayer === layerKey)
        this.setAnalysisLayer(null)
    }
    else {
      this.updateParam(layerKey, visible)
      if (visible) {
        this.settingsContext = { kind: 'layer', key: layerKey }
        this.generalSettingsOpen = false
      }
    }
  }

  setAnalysisLayer(layer: AnalysisLayerKey | null) {
    for (const key of ANALYSIS_LAYERS)
      this.params[key] = key === layer
    if (layer) {
      this.settingsContext = { kind: 'layer', key: layer }
      this.generalSettingsOpen = false
    }
    if (this.engine) {
      this.engine.updateParams(this.runtimeParams())
      this.engine.updateAppearance()
    }
  }

  openSettings() {
    this.layerDrawerOpen = true
  }

  toggleMapDisplay() {
    this.layerDrawerOpen = !this.layerDrawerOpen
  }

  closePanels() {
    this.layerDrawerOpen = false
    this.inspectorOpen = false
  }

  discardChanges() {
    for (const key of Object.keys(PARAMETER_STAGE) as (keyof GlobeGenParams)[]) {
      if (PARAMETER_STAGE[key] !== null)
        this.assignParam(key, this.appliedParams[key])
    }
  }

  resetWorldSettings() {
    for (const key of Object.keys(PARAMETER_STAGE) as (keyof GlobeGenParams)[]) {
      if (PARAMETER_STAGE[key] !== null)
        this.assignParam(key, DEFAULT_GLOBE_GEN_PARAMS[key])
    }
  }

  randomizeDraftSeed() {
    this.params.seed = Math.floor(Math.random() * 9000) + 1000
  }

  async applyChanges() {
    const stage = planGeneration(this.appliedParams, this.params)
    if (stage)
      await this.runGeneration(stage, '正在应用世界设置…')
  }

  async regenerateWorld(text = '正在重新生成世界…') {
    await this.runGeneration('world', text)
  }

  async retryGeneration() {
    if (!this.hasGenerated)
      await this.regenerateWorld()
    else if (this.hasPendingChanges)
      await this.applyChanges()
    else
      await this.regenerateWorld()
  }

  private async runGeneration(stage: GenerationStage, text = '正在更新世界…') {
    if (!this.engine)
      return
    const request = ++this.generationRequest
    const generationParams = cloneGlobeGenParams(this.params)
    this.generationError = null
    this.setGenerating(true, text)
    try {
      this.engine.updateParams(generationParams)
      await this.engine.regenerate(stage, (message) => {
        if (request === this.generationRequest)
          this.loadingStageText = message
      })
      if (request === this.generationRequest) {
        this.appliedParams = generationParams
        this.hasGenerated = true
        this.engine.updateParams(this.runtimeParams())
        this.engine.updateAppearance()
      }
    }
    catch (error) {
      if (request === this.generationRequest)
        this.generationError = error instanceof Error ? error.message : '世界生成失败，请重试。'
    }
    finally {
      if (request === this.generationRequest)
        this.isGenerating = false
    }
  }

  cancelGeneration() {
    this.generationRequest++
    this.engine?.cancelGeneration()
    this.isGenerating = false
  }

  destroy() {
    this.cancelGeneration()
    this.engine?.destroy()
    this.engine = null
  }

  resetCamera() {
    if (this.engine)
      this.engine.resetCamera()
  }

  createRandomWorld() {
    this.randomizeDraftSeed()
    void this.regenerateWorld(`正在生成世界 #${this.params.seed}…`)
  }

  private runtimeParams(): GlobeGenParams {
    const result = cloneGlobeGenParams(this.appliedParams)
    for (const key of Object.keys(PARAMETER_STAGE) as (keyof GlobeGenParams)[]) {
      if (PARAMETER_STAGE[key] === null)
        this.assignParamOn(result, key, this.params[key])
    }
    return result
  }

  private assignParam<K extends keyof GlobeGenParams>(key: K, value: GlobeGenParams[K]) {
    this.params[key] = value
  }

  private assignParamOn<K extends keyof GlobeGenParams>(target: GlobeGenParams, key: K, value: GlobeGenParams[K]) {
    target[key] = value
  }
}

export const uiState = new UIState()
