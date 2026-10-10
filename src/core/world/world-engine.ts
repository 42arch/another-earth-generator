import type { MapProjectionId } from '@/core/projections/map-projection'
import type { WorldViewMode } from '@/core/rendering/view-mode'
import type { WorldConfig } from '@/core/simulation/config'
import type { GeneratedSphericalWorld } from '@/core/simulation/pipeline/types'
import type { LayerStatistics } from '@/core/world/layer-statistics'
import type { SelectedRegionInfo, WorldSummaryInfo } from '@/core/world/world-info'
import { cloneWorldConfig, DEFAULT_WORLD_CONFIG } from '@/core/simulation/config'
import { prepareClimateDisplayFields } from '@/core/world/climate-display-fields'
import { buildLayerStatistics, hasLayerStatistics } from '@/core/world/layer-statistics'
import { RegionSelectionInfoBuilder } from '@/core/world/region-selection-info'
import { buildWorldSummary } from '@/core/world/world-summary'
import { RendererCore } from './renderer-core'
import { GenerationAbortedError, SimulationCore } from './simulation-core'

export interface WorldEngineCallbacks {
  onRegionSelected?: (info: SelectedRegionInfo | null) => void
  onWorldSummary?: (summary: WorldSummaryInfo) => void
  onPipelineStageStart?: (stageName: string) => void
}

export default class WorldEngine {
  private readonly simulation: SimulationCore
  private readonly renderer: RendererCore
  private params: WorldConfig
  private callbacks?: WorldEngineCallbacks
  private selectedRegion = -1
  private selectedSettlementId: number | undefined
  private selectedRouteId: number | undefined
  private readonly regionSelectionInfoBuilder = new RegionSelectionInfoBuilder()
  private generatedSeed: number | null = null
  private readonly layerStatisticsCache = new Map<string, LayerStatistics>()

  constructor(
    canvas: HTMLCanvasElement,
    params: WorldConfig = DEFAULT_WORLD_CONFIG,
    callbacks?: WorldEngineCallbacks,
  ) {
    this.params = cloneWorldConfig(params)
    this.callbacks = callbacks
    this.simulation = new SimulationCore(this.params)
    this.renderer = new RendererCore(canvas, this.params, this.handleRegionSelected)

    this.simulation.addMiddleware({
      onStageStart: stageName => this.callbacks?.onPipelineStageStart?.(stageName),
    })
  }

  setCallbacks(callbacks: WorldEngineCallbacks): void {
    this.callbacks = callbacks
  }

  async generateWorld(): Promise<boolean> {
    const generationStart = performance.now()
    const generationSeed = this.params.core.seed
    let generated: GeneratedSphericalWorld
    try {
      generated = await this.simulation.generate(this.params)
    }
    catch (error) {
      if (error instanceof GenerationAbortedError)
        return false
      throw error
    }
    this.selectedRegion = -1
    this.selectedSettlementId = undefined
    this.selectedRouteId = undefined
    this.generatedSeed = generationSeed
    this.regionSelectionInfoBuilder.reset()
    this.layerStatisticsCache.clear()
    this.callbacks?.onRegionSelected?.(null)
    prepareClimateDisplayFields(this.simulation.state, this.params)
    const renderStart = performance.now()
    this.renderer.setWorld(generated.mesh, generated.data, this.params)
    // eslint-disable-next-line no-console
    console.info('Generation timing (ms)', {
      renderSetup: Math.round(performance.now() - renderStart),
      total: Math.round(performance.now() - generationStart),
    })
    this.callbacks?.onWorldSummary?.(buildWorldSummary(generated))
    return true
  }

  updateParams(params: WorldConfig): void {
    this.params = cloneWorldConfig(params)
  }

  updateAppearance(): void {
    prepareClimateDisplayFields(this.simulation.state, this.params)
    this.renderer.updateAppearance(this.params)
    if (this.selectedRegion >= 0)
      this.handleRegionSelected(this.selectedRegion, this.selectedSettlementId, this.selectedRouteId)
  }

  getLayerStatistics(): LayerStatistics | null {
    if (!hasLayerStatistics(this.params.appearance.baseMap))
      return null
    const state = this.simulation.state
    if (!state)
      return null
    const mode = this.params.appearance.baseMap
    const month = this.params.appearance.climateMonth
    const key = mode === 'temperature' || mode === 'precipitation' || mode === 'wind' || mode === 'ocean-current'
      ? `${mode}:${month}`
      : mode
    const cached = this.layerStatisticsCache.get(key)
    if (cached)
      return cached
    prepareClimateDisplayFields(state, this.params)
    const result = buildLayerStatistics(state.data, mode, month, this.params.geology.primaryPlateCount)
    if (result) {
      result.seed = this.generatedSeed ?? undefined
      this.layerStatisticsCache.set(key, result)
    }
    return result
  }

  setViewMode(mode: WorldViewMode): void {
    this.renderer.setViewMode(mode)
  }

  setMapProjection(id: MapProjectionId): void {
    this.renderer.setMapProjection(id)
  }

  resetCamera(): void {
    this.renderer.resetCamera()
  }

  destroy(): void {
    this.regionSelectionInfoBuilder.reset()
    this.renderer.destroy()
  }

  private handleRegionSelected = (region: number, settlementId?: number, routeId?: number) => {
    const world = this.simulation.state
    if (!world)
      return

    this.selectedRegion = region
    this.selectedSettlementId = settlementId
    this.selectedRouteId = routeId
    this.renderer.selectRegion(region)
    this.callbacks?.onRegionSelected?.(
      this.regionSelectionInfoBuilder.build(world, this.params, region, settlementId, routeId),
    )
  }

  setRegionPickingEnabled(enabled: boolean): void {
    this.renderer.enableRegionPicking = enabled
    if (!enabled) {
      this.selectedRegion = -1
      this.selectedSettlementId = undefined
      this.selectedRouteId = undefined
      this.renderer.selectRegion(-1)
      this.callbacks?.onRegionSelected?.(null)
    }
  }
}
