import type { MapProjectionId } from '@/core/projections/map-projection'
import type { WorldViewMode } from '@/core/rendering/view-mode'
import type { WorldConfig } from '@/core/simulation/config'
import type { GeneratedSphericalWorld } from '@/core/simulation/pipeline/types'
import type { LayerStatistics } from '@/core/world/layer-statistics'
import { createOutputClimateRegionSampler, getOutputClimateMonth } from '@/core/climate/climate-output-projector'
import { koppenLabel } from '@/core/climate/koppen-climate-classifier'
import { projectMonthlyVectorField } from '@/core/climate/monthly-vector-projector'
import { biomeLabel } from '@/core/ecology/biome-data'
import { cloneWorldConfig, DEFAULT_WORLD_CONFIG } from '@/core/simulation/config'
import { buildLayerStatistics, hasLayerStatistics } from '@/core/world/layer-statistics'
import { RendererCore } from './renderer-core'
import { GenerationAbortedError, SimulationCore } from './simulation-core'

export interface WorldEngineCallbacks {
  onRegionSelected?: (info: any) => void
  onWorldSummary?: (summary: any) => void
  onPipelineProgress?: (text: string) => void
}

export default class WorldEngine {
  private readonly simulation: SimulationCore
  private readonly renderer: RendererCore
  private params: WorldConfig
  private callbacks?: WorldEngineCallbacks
  private selectedRegion = -1
  private climateRegionSampler: ReturnType<typeof createOutputClimateRegionSampler> | null = null
  private generatedSeed: number | null = null
  private readonly layerStatisticsCache = new Map<string, LayerStatistics>()

  private readonly infoElement?: HTMLElement | null

  constructor(
    canvas: HTMLCanvasElement,
    infoElement?: HTMLElement | null,
    params: WorldConfig = DEFAULT_WORLD_CONFIG,
    callbacks?: WorldEngineCallbacks,
  ) {
    this.infoElement = infoElement
    this.params = cloneWorldConfig(params)
    this.callbacks = callbacks
    this.simulation = new SimulationCore(this.params)
    this.renderer = new RendererCore(canvas, this.params, this.handleRegionSelected)

    this.simulation.addMiddleware({
      onStageStart: (stageName) => {
        const descriptions: Record<string, string> = {
          MeshGeneration: '正在构建球面拓扑网格…',
          PlateTectonics: '正在生成构造细分、主要板块与小板块…',
          ContinentalCrust: '正在布置大陆地壳与候选海陆…',
          PlateDynamics: '正在计算板块运动与地幔流…',
          DataProjection: '正在向高精度网格投影地壳特征…',
          MantleAndTectonics: '正在构建动态地形与应力强化…',
          ElevationAndTerrain: '正在生成地形与冰川、水力整形…',
          SeasonalCirculation: '正在计算四季风场与洋流…',
          MonthlyClimate: '正在计算 12 个月的气温与降水…',
          ClimateOutputProjection: '正在将气候细化到最终地形…',
          KoppenClimate: '正在依据 12 个月气候划分 Köppen 类型…',
          Biome: '正在依据气候与地形划分生物群系…',
          SurfaceHydrology: '正在汇集年径流并生成河流网…',
        }
        const text = descriptions[stageName] || `正在执行: ${stageName}`
        this.callbacks?.onPipelineProgress?.(text)
      },
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
    this.generatedSeed = generationSeed
    this.climateRegionSampler = null
    this.layerStatisticsCache.clear()
    this.callbacks?.onRegionSelected?.(null)
    this.prepareClimateDisplayFields()
    const renderStart = performance.now()
    this.renderer.setWorld(generated.mesh, generated.data, this.params)
    // eslint-disable-next-line no-console
    console.info('Generation timing (ms)', {
      renderSetup: Math.round(performance.now() - renderStart),
      total: Math.round(performance.now() - generationStart),
    })
    this.showWorldSummary()
    return true
  }

  updateParams(params: WorldConfig): void {
    this.params = cloneWorldConfig(params)
  }

  updateAppearance(): void {
    this.prepareClimateDisplayFields()
    this.renderer.updateAppearance(this.params)
    if (this.selectedRegion >= 0)
      this.handleRegionSelected(this.selectedRegion)
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
    this.prepareClimateDisplayFields()
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
    this.climateRegionSampler = null
    this.renderer.destroy()
  }

  private prepareClimateDisplayFields(): void {
    const state = this.simulation.state
    const climate = state?.data.climate
    if (!state || !climate)
      return
    const mode = this.params.appearance.baseMap
    const month = this.params.appearance.climateMonth
    const climateMesh = state.mesh.numRegions <= state.referenceMesh.numRegions
      ? state.mesh
      : state.referenceMesh
    if (mode === 'wind' || mode === 'ocean-current') {
      if (climate.displayVector?.month !== month || climate.displayVector.kind !== mode) {
        climate.displayVector = projectMonthlyVectorField(
          state.mesh,
          climateMesh,
          state.data.geography,
          climate,
          month,
          this.params.climate.axialTiltDeg,
          mode,
        )
      }
    }
    else if (mode === 'temperature' || mode === 'precipitation') {
      if (climate.displayMonth?.month === month)
        return
      climate.displayMonth = {
        month,
        ...getOutputClimateMonth(
          state.mesh,
          climateMesh,
          state.data.geography,
          climate,
          month,
          this.params.climate.axialTiltDeg,
        ),
      }
    }
  }

  private showWorldSummary(): void {
    const state = this.simulation.state
    if (!state)
      return

    const plateCount = new Set(state.data.geology.regionSuperPlate).size
    this.callbacks?.onWorldSummary?.({
      regionCount: state.mesh.numRegions,
      triangleCount: state.mesh.numTriangles,
      plateCount,
    })

    if (this.infoElement) {
      this.infoElement.textContent = [
        '点击球面查看区域信息',
        `${state.mesh.numRegions} 个区域`,
        `${state.mesh.numTriangles} 个三角形`,
        `${plateCount} 个构造板块`,
      ].join(' · ')
    }
  }

  private handleRegionSelected = (region: number) => {
    const state = this.simulation.state
    if (!state)
      return

    this.selectedRegion = region
    this.renderer.selectRegion(region)
    const latitude = state.mesh.regionLatitude[region] * 180 / Math.PI
    const longitude = state.mesh.regionLongitude[region] * 180 / Math.PI
    const elevation = state.data.geography.elevation[region]
    const plate = state.data.geology.regionSuperPlate[region]
    const plateDetail = state.data.geology.regionPlate[region]
    const continent = state.data.geography.visibleContinentId[region]
    const climate = state.data.climate
    const displayVector = climate?.displayVector
    const vectorInfo = displayVector?.month === this.params.appearance.climateMonth
      && displayVector.kind === this.params.appearance.baseMap
      ? {
          vectorEast: displayVector.east[region],
          vectorNorth: displayVector.north[region],
          vectorKind: displayVector.kind,
          vectorWarmth: displayVector.warmth?.[region],
        }
      : {}
    let climateInfo = {}
    if (climate?.monthly && climate.koppen) {
      if (!this.climateRegionSampler) {
        const climateMesh = state.mesh.numRegions <= state.referenceMesh.numRegions
          ? state.mesh
          : state.referenceMesh
        this.climateRegionSampler = createOutputClimateRegionSampler(
          climate,
          state.data.geography,
          this.params.climate.axialTiltDeg,
          climateMesh,
        )
      }
      const monthlyTemperatureC: number[] = []
      const monthlyPrecipitationMm: number[] = []
      for (let month = 0; month < 12; month++) {
        const fields = this.climateRegionSampler(region, month)
        monthlyTemperatureC.push(fields.temperatureC)
        monthlyPrecipitationMm.push(fields.precipitationMm)
      }
      climateInfo = {
        isLand: Boolean(state.data.geography.landMask[region]),
        koppenLabel: koppenLabel(climate.koppen.climateClass[region]),
        biomeLabel: state.data.biome ? biomeLabel(state.data.biome.biomeClass[region]) : undefined,
        aridityIndex: state.data.biome?.aridityIndex[region],
        growingSeasonMonths: state.data.biome?.growingSeasonMonths[region],
        annualTemperatureC: climate.koppen.annualTemperatureC[region],
        annualPrecipitationMm: climate.koppen.annualPrecipitationMm[region],
        monthlyTemperatureC,
        monthlyPrecipitationMm,
      }
    }
    this.callbacks?.onRegionSelected?.({
      region,
      latitude,
      longitude,
      elevation,
      plate,
      plateDetail,
      continent,
      geometricFlowCount: state.data.geography.terrainErosion.flowAccumulation[region],
      ...climateInfo,
      ...vectorInfo,
    })

    if (this.infoElement) {
      this.infoElement.textContent = [
        `区域 ${region}`,
        `纬度 ${latitude.toFixed(2)}°，经度 ${longitude.toFixed(2)}°`,
        `高程 ${elevation.toFixed(2)} km`,
        `板块 ${plate}`,
        `构造细分 ${plateDetail}`,
      ].join(' · ')
    }
  }

  setRegionPickingEnabled(enabled: boolean): void {
    this.renderer.enableRegionPicking = enabled
    if (!enabled) {
      this.selectedRegion = -1
      this.renderer.selectRegion(-1)
      this.callbacks?.onRegionSelected?.(null)
    }
  }
}
