import type { SelectedRegionInfo, WorldSummaryInfo } from '@/core/world/world-view-data'
import type { GlobeGenParams } from '@/core/spherical/config'
import type { MapProjectionId } from '@/core/projections/map-projection'
import type { WorldViewMode } from '@/core/rendering/view-mode'
import type { SphericalWorldData } from '@/core/spherical/spherical-world-data'
import type { GenerationStage } from '@/core/world/generation-plan'
import { GlobeRenderer } from '@/core/rendering/globe/renderer'
import SphericalMesh from '@/core/spherical/spherical-mesh'
import { REGION_FEATURE } from '@/core/spherical/geography/region-feature'
import { cloneGlobeGenParams, DEFAULT_GLOBE_GEN_PARAMS } from '@/core/spherical/config'
import {
  CLIMATE_SEASON_COUNT,
  LAKE_ICE_STATE,
  SPHERICAL_BIOME_NAME,
  TRADE_GOOD_COUNT,
  TRADE_GOOD_NAME,
} from '@/core/spherical/spherical-world-data'
import { GenerationClient } from '@/core/world/generation-client'

const GENERATION_MESSAGES: Record<string, string> = {
  mesh: '正在构建球面网格…',
  tectonics: '正在推演板块与大陆…',
  elevation: '正在生成高程与地貌…',
  lakes: '正在求解湖泊水量平衡…',
  climate: '正在计算季节气候与降水…',
  rivers: '正在计算径流与河网…',
  human: '正在生成聚落…',
  transport: '正在规划道路与航线…',
  trade: '正在计算贸易网络…',
  cultures: '正在生成文化分布…',
  polities: '正在生成国家与疆界…',
  religions: '正在生成信仰与圣地…',
  naming: '正在生成语言与地名…',
  complete: '正在传输世界数据…',
}

export interface WorldEngineCallbacks {
  onRegionSelected?: (info: SelectedRegionInfo | null) => void
  onWorldSummary?: (summary: WorldSummaryInfo) => void
}

export default class WorldEngine {
  private readonly generator = new GenerationClient()
  private selectedRegion = -1
  private generationRequest = 0
  private destroyed = false
  lastGenerationTimings: Record<string, number> = {}
  private readonly renderer: GlobeRenderer
  private mesh: SphericalMesh | null = null
  private data: SphericalWorldData | null = null
  private params: GlobeGenParams
  private callbacks?: WorldEngineCallbacks

  constructor(
    canvas: HTMLCanvasElement,
    private readonly infoElement?: HTMLElement | null,
    params: GlobeGenParams = DEFAULT_GLOBE_GEN_PARAMS,
    callbacks?: WorldEngineCallbacks,
  ) {
    this.params = cloneGlobeGenParams(params)
    this.callbacks = callbacks
    this.renderer = new GlobeRenderer(canvas, params, this.handleRegionSelected)
  }

  setCallbacks(callbacks: WorldEngineCallbacks): void {
    this.callbacks = callbacks
  }

  async regenerate(stage: GenerationStage, progress: (message: string) => void = () => {}): Promise<void> {
    const request = ++this.generationRequest
    const result = await this.generator.generate(this.params, stage, phase => {
      progress(GENERATION_MESSAGES[phase] ?? '正在更新世界…')
    })
    if (!result || this.destroyed || request !== this.generationRequest)
      return
    const started = performance.now()
    const meshChanged = !!result.mesh
    if (result.mesh)
      this.mesh = new SphericalMesh(result.mesh, result.mesh.voronoi)
    if (!this.mesh)
      throw new Error('生成结果缺少球面网格，请重新生成。')
    this.data = result.data
    progress('正在更新地图图层…')
    if (meshChanged) {
      this.selectedRegion = -1
      this.callbacks?.onRegionSelected?.(null)
      this.renderer.setWorld(this.mesh, this.data, this.params)
    }
    else {
      this.renderer.updateWorldData(this.data, this.params, result.stage ?? 'world')
      if (this.selectedRegion >= 0)
        this.handleRegionSelected(this.selectedRegion)
    }
    this.lastGenerationTimings = { ...result.timings, presentation: performance.now() - started }
    this.showWorldSummary()
  }

  cancelGeneration(): void {
    this.generationRequest++
    this.generator.cancel()
  }

  generateWorld(): Promise<void> {
    return this.regenerate('world')
  }

  regenerateElevation(): Promise<void> {
    return this.regenerate('elevation')
  }

  regenerateRivers(): Promise<void> {
    return this.regenerate('rivers')
  }

  regenerateHuman(): Promise<void> {
    return this.regenerate('human')
  }

  regeneratePolities(): Promise<void> {
    return this.regenerate('polities')
  }

  regenerateCultures(): Promise<void> {
    return this.regenerate('cultures')
  }

  regenerateReligions(): Promise<void> {
    return this.regenerate('religions')
  }

  regenerateTransport(): Promise<void> {
    return this.regenerate('transport')
  }

  regenerateTrade(): Promise<void> {
    return this.regenerate('trade')
  }

  regenerateLakes(): Promise<void> {
    return this.regenerate('hydrology')
  }

  regenerateClimate(): Promise<void> {
    return this.regenerate('hydrology')
  }

  updateParams(params: GlobeGenParams): void {
    this.params = cloneGlobeGenParams(params)
  }

  updateAppearance(): void {
    this.renderer.updateAppearance(this.params)
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
    if (this.destroyed)
      return
    this.destroyed = true
    this.generationRequest++
    this.generator.destroy()
    this.renderer.destroy()
    this.mesh = null
    this.data = null
  }

  private showWorldSummary(): void {
    if (!this.data)
      return
    let endorheicCount = 0
    let seasonalLakeCount = 0
    let frozenCount = 0
    let subglacialCount = 0
    for (let lake = 0; lake < this.data.lakes.area.length; lake++) {
      endorheicCount += this.data.lakes.isEndorheic[lake]
      seasonalLakeCount += this.data.lakes.isSeasonal[lake]
      frozenCount += this.data.lakes.iceState[lake]
        === LAKE_ICE_STATE.SeasonallyFrozen
        ? 1
        : 0
      subglacialCount += this.data.lakes.iceState[lake]
        === LAKE_ICE_STATE.Subglacial
        ? 1
        : 0
    }
    let seasonalRiverSegmentCount = 0
    for (const region of this.data.rivers.segmentSource)
      seasonalRiverSegmentCount += this.data.rivers.seasonalRiverMask[region]

    this.callbacks?.onWorldSummary?.({
      lakeCount: this.data.lakes.area.length,
      endorheicCount,
      seasonalLakeCount,
      frozenLakeCount: frozenCount,
      subglacialLakeCount: subglacialCount,
      riverSourceCount: this.data.rivers.sourceRegions.length,
      riverSegmentCount: this.data.rivers.segmentSource.length,
      seasonalRiverSegmentCount,
      settlementCount: this.data.human.settlements.length,
    })

    if (this.infoElement) {
      this.infoElement.textContent = [
        '点击球面查看区域信息',
        `${this.data.lakes.area.length} 个湖泊`,
        `${endorheicCount} 个内流湖`,
        `${seasonalLakeCount} 个季节湖`,
        `${frozenCount} 个季节冻湖`,
        `${subglacialCount} 个冰下湖`,
        `${this.data.rivers.sourceRegions.length} 个河流源头`,
        `${this.data.rivers.segmentSource.length} 个河段`,
        `${seasonalRiverSegmentCount} 个季节河段`,
        `${this.data.human.settlements.length} 个聚落`,
      ].join(' · ')
    }
  }

  private handleRegionSelected = (region: number) => {
    if (!this.mesh || !this.data)
      return
    if (region < 0 || region >= this.mesh.numRegions)
      return
    this.selectedRegion = region
    this.renderer.selectRegion(region)
    const feature = this.data.regionFeature[region] === REGION_FEATURE.Ocean
      ? '海洋'
      : this.data.regionFeature[region] === REGION_FEATURE.Lake
        ? '湖泊'
        : '陆地'
    const latitude = this.mesh.regionLatitude[region] * 180 / Math.PI
    const longitude = this.mesh.regionLongitude[region] * 180 / Math.PI
    const lakeId = this.data.lakes.regionLakeId[region]
    const lakeIceState = lakeId >= 0
      ? this.data.lakes.iceState[lakeId] ?? LAKE_ICE_STATE.OpenWater
      : LAKE_ICE_STATE.OpenWater
    const biome = feature === '湖泊'
      ? lakeIceState === LAKE_ICE_STATE.Subglacial
        ? '冰原 / 冰下湖'
        : lakeIceState === LAKE_ICE_STATE.SeasonallyFrozen
          ? '季节性冻湖'
          : lakeId >= 0 && this.data.lakes.salinity[lakeId] >= 0.5
            ? '盐湖'
            : '淡水湖'
      : SPHERICAL_BIOME_NAME[this.data.climate.biome[region]] ?? '未知'
    const lakeBalanceRatio = lakeId >= 0
      ? this.data.lakes.inflow[lakeId]
      / Math.max(this.data.lakes.evaporation[lakeId], Number.EPSILON)
      : 0
    let minimumSeasonalLakeFill = 1
    if (lakeId >= 0) {
      const lakeCount = this.data.lakes.area.length
      for (let season = 0; season < CLIMATE_SEASON_COUNT; season++) {
        minimumSeasonalLakeFill = Math.min(
          minimumSeasonalLakeFill,
          this.data.lakes.seasonalFillRatio[season * lakeCount + lakeId],
        )
      }
    }
    const lakeInfo = lakeId >= 0
      ? [
          `湖泊 ${lakeId + 1}`,
          lakeIceState === LAKE_ICE_STATE.Subglacial
            ? '冰下湖'
            : lakeIceState === LAKE_ICE_STATE.SeasonallyFrozen
              ? '季节性冻结'
              : '开放水面',
          this.data.lakes.isEndorheic[lakeId] !== 0 ? '内流湖' : '外流湖',
          this.data.lakes.isSeasonal[lakeId] !== 0 ? '季节性湖泊' : '常年湖泊',
          `湖泊面积占陆地 ${(this.data.lakes.area[lakeId] / Math.max(this.data.landArea, Number.EPSILON) * 100).toFixed(2)}%`,
          `湖泊深度 ${(this.data.lakes.surfaceElevation[lakeId] - this.data.lakes.bottomElevation[lakeId]).toFixed(1)}m`,
          `湖泊填充率 ${(this.data.lakes.fillRatio[lakeId] * 100).toFixed(0)}%`,
          `枯水季填充率 ${(minimumSeasonalLakeFill * 100).toFixed(0)}%`,
          `入流 / 蒸发 ${this.data.lakes.evaporation[lakeId] > Number.EPSILON
            ? lakeBalanceRatio.toFixed(2)
            : '不适用'}`,
          `盐度 ${(this.data.lakes.salinity[lakeId] * 100).toFixed(0)}%`,
        ]
      : []
    const riverInfo = this.data.rivers.riverMask[region] !== 0
      ? [
          this.data.rivers.seasonalRiverMask[region] !== 0
            ? '季节性河道'
            : '常年河道',
          `河流季节性 ${(this.data.rivers.riverSeasonality[region] * 100).toFixed(0)}%`,
        ]
      : ['非河道']
    const settlementId = this.data.human.regionSettlementId[region]
    const settlement = settlementId >= 0
      ? this.data.human.settlements[settlementId]
      : null
    const settlementInfo = settlement
      ? [
          `聚落 ${settlement.name}`,
          ({ camp: '营地', village: '村落', town: '城镇', city: '城市' } as const)[settlement.type],
          `相对人口 ${settlement.population.toLocaleString()}`,
          `繁荣度 ${(settlement.prosperity * 100).toFixed(0)}%`,
          settlement.isPort ? '港口' : '内陆聚落',
        ]
      : []
    let dominantTradeGood = -1
    let dominantTradeSurplus = -Infinity
    if (settlementId >= 0) {
      for (let good = 0; good < TRADE_GOOD_COUNT; good++) {
        const index = settlementId * TRADE_GOOD_COUNT + good
        const surplus = this.data.human.trade.settlementProduction[index]
          - this.data.human.trade.settlementDemand[index]
        if (surplus > dominantTradeSurplus) {
          dominantTradeSurplus = surplus
          dominantTradeGood = good
        }
      }
    }
    const tradeInfo = [
      this.data.human.trade.regionTradeIntensity[region] > 0
        ? `贸易强度 ${(this.data.human.trade.regionTradeIntensity[region] * 100).toFixed(0)}%`
        : '',
      settlementId >= 0
        ? `市场可达性 ${(this.data.human.trade.settlementMarketAccess[settlementId] * 100).toFixed(0)}%`
        : '',
      settlementId >= 0
        ? `出口 ${this.data.human.trade.settlementExports[settlementId].toFixed(1)}`
        : '',
      settlementId >= 0
        ? `进口 ${this.data.human.trade.settlementImports[settlementId].toFixed(1)}`
        : '',
      dominantTradeGood >= 0 && dominantTradeSurplus > 0
        ? `优势产品 ${TRADE_GOOD_NAME[dominantTradeGood]}`
        : '',
    ].filter(Boolean)
    const transportInfo = [
      this.data.human.transport.roadIntensity[region] > 0
        ? `道路强度 ${(this.data.human.transport.roadIntensity[region] * 100).toFixed(0)}%`
        : '',
      this.data.human.transport.shippingIntensity[region] > 0
        ? `航线强度 ${(this.data.human.transport.shippingIntensity[region] * 100).toFixed(0)}%`
        : '',
    ].filter(Boolean)
    const cultureId = this.data.human.culture.regionCulture[region]
    const culture = cultureId >= 0
      ? this.data.human.culture.cultures[cultureId]
      : null
    const cultureInfo = culture
      ? [
          `文化 ${culture.name}`,
          region === culture.coreRegion ? '文化核心' : `文化核心区域 ${culture.coreRegion}`,
          `文化影响 ${(this.data.human.culture.cultureInfluence[region] * 100).toFixed(0)}%`,
        ]
      : []
    const language = culture
      ? this.data.human.naming.languages[culture.language]
      : null
    const religionId = this.data.human.religion.regionReligion[region]
    const religion = religionId >= 0
      ? this.data.human.religion.religions[religionId]
      : null
    const religionInfo = religion
      ? [
          `宗教 ${religion.name}`,
          region === religion.originRegion ? '圣地' : `圣地区域 ${religion.originRegion}`,
          `信仰影响 ${(this.data.human.religion.religionInfluence[region] * 100).toFixed(0)}%`,
          `传教能力 ${(religion.missionaryStrength * 100).toFixed(0)}%`,
          `宽容度 ${(religion.tolerance * 100).toFixed(0)}%`,
        ]
      : []
    const polityId = this.data.human.politics.regionPolity[region]
    const polity = polityId >= 0
      ? this.data.human.politics.polities[polityId]
      : null
    const polityInfo = polity
      ? [
          `国家 ${polity.name}`,
          region === polity.capitalRegion ? '首府' : `首府区域 ${polity.capitalRegion}`,
          `政治控制 ${(this.data.human.politics.politicalControl[region] * 100).toFixed(0)}%`,
          `国土占陆地 ${(polity.area / Math.max(this.data.landArea, Number.EPSILON) * 100).toFixed(1)}%`,
        ]
      : this.data.landMask[region] !== 0
        ? ['未归属领土']
        : []
    const seaSurfaceTemperatureAnomaly
      = this.data.climate.seaSurfaceTemperatureAnomaly[region]
    const oceanInfo = this.data.baseLandMask[region] === 0
      ? [
          `海表温度 ${this.data.climate.seaSurfaceTemperature[region].toFixed(1)}°C`,
          `海温异常 ${seaSurfaceTemperatureAnomaly >= 0 ? '+' : ''}${seaSurfaceTemperatureAnomaly.toFixed(1)}°C`,
          `洋流强度 ${(this.data.climate.oceanCurrentSpeed[region] * 100).toFixed(0)}%`,
        ]
      : []
    this.callbacks?.onRegionSelected?.({
      region,
      feature,
      latitude,
      longitude,
      elevation: this.data.elevation[region],
      climateElevationMeters: this.data.climateElevationMeters[region],
      temperature: this.data.climate.temperature[region],
      warmestMonthTemperature: this.data.climate.warmestMonthTemperature[region],
      coldestMonthTemperature: this.data.climate.coldestMonthTemperature[region],
      annualPrecipitationMm: this.data.climate.annualPrecipitationMm[region],
      precipitationSeasonality: this.data.climate.precipitationSeasonality[region],
      runoff: this.data.climate.runoff[region],
      biome,
      moisture: this.data.climate.moisture[region],
      continentality: this.data.continentality[region],
      habitability: this.data.human.habitability[region],
      accessibility: this.data.human.accessibility[region],
      plate: this.data.tectonics.regionPlate[region],
      flowRatio: this.data.rivers.totalRunoff > 0
        ? this.data.rivers.flowAccumulation[region] / this.data.rivers.totalRunoff
        : 0,
      isRiver: this.data.rivers.riverMask[region] !== 0,
      isSeasonalRiver: this.data.rivers.seasonalRiverMask[region] !== 0,
      riverSeasonality: this.data.rivers.riverSeasonality[region],
      settlement: settlement
        ? {
            id: settlementId,
            name: settlement.name,
            type: ({ camp: '营地', village: '村落', town: '城镇', city: '城市' } as const)[settlement.type],
            population: settlement.population,
            prosperity: settlement.prosperity,
            isPort: settlement.isPort,
          }
        : undefined,
      culture: culture
        ? {
            id: cultureId,
            name: culture.name,
            language: language?.name ?? culture.name,
            languageFamily: language
              ? this.data.human.naming.familyNames[language.family] ?? language.name
              : culture.name,
            influence: this.data.human.culture.cultureInfluence[region],
            isCore: region === culture.coreRegion,
          }
        : undefined,
      polity: polity
        ? {
            id: polityId,
            name: polity.name,
            control: this.data.human.politics.politicalControl[region],
            isCapital: region === polity.capitalRegion,
          }
        : undefined,
      religion: religion
        ? {
            id: religionId,
            name: religion.name,
            influence: this.data.human.religion.religionInfluence[region],
            isHolySite: region === religion.originRegion,
          }
        : undefined,
      lake: lakeId >= 0
        ? {
            id: lakeId,
            iceState: lakeIceState === LAKE_ICE_STATE.Subglacial
              ? '冰下湖'
              : lakeIceState === LAKE_ICE_STATE.SeasonallyFrozen
                ? '季节性冻结'
                : '开放水面',
            isEndorheic: this.data.lakes.isEndorheic[lakeId] !== 0,
            isSeasonal: this.data.lakes.isSeasonal[lakeId] !== 0,
            areaShare: this.data.lakes.area[lakeId] / Math.max(this.data.landArea, Number.EPSILON),
            depthMeters: this.data.lakes.surfaceElevation[lakeId] - this.data.lakes.bottomElevation[lakeId],
            fillRatio: this.data.lakes.fillRatio[lakeId],
            salinity: this.data.lakes.salinity[lakeId],
            inflowEvapRatio: lakeBalanceRatio,
          }
        : undefined,
      ocean: this.data.baseLandMask[region] === 0
        ? {
            sst: this.data.climate.seaSurfaceTemperature[region],
            sstAnomaly: seaSurfaceTemperatureAnomaly,
            currentSpeed: this.data.climate.oceanCurrentSpeed[region],
          }
        : undefined,
    })

    if (this.infoElement) {
      this.infoElement.textContent = [
        `区域 ${region}`,
        `纬度 ${latitude.toFixed(2)}°，经度 ${longitude.toFixed(2)}°`,
        `高程 ${this.data.elevation[region].toFixed(3)}`,
        `气候海拔 ${this.data.climateElevationMeters[region].toFixed(0)}m`,
        `年均温 ${this.data.climate.temperature[region].toFixed(1)}°C`,
        `最暖月均温 ${this.data.climate.warmestMonthTemperature[region].toFixed(1)}°C`,
        `最冷月均温 ${this.data.climate.coldestMonthTemperature[region].toFixed(1)}°C`,
        `年降水量 ${this.data.climate.annualPrecipitationMm[region].toFixed(0)}mm`,
        `夏季降水量 ${this.data.climate.summerPrecipitationMm[region].toFixed(0)}mm`,
        `冬季降水量 ${this.data.climate.winterPrecipitationMm[region].toFixed(0)}mm`,
        `降水季节性 ${(this.data.climate.precipitationSeasonality[region] * 100).toFixed(0)}%`,
        `径流 ${(this.data.climate.runoff[region] * 100).toFixed(1)}%`,
        `生态群落 ${biome}`,
        `大气水汽 ${this.data.climate.moisture[region].toFixed(3)}`,
        `大陆性 ${(this.data.continentality[region] * 100).toFixed(0)}%`,
        `宜居性 ${(this.data.human.habitability[region] * 100).toFixed(0)}%`,
        `可达性 ${(this.data.human.accessibility[region] * 100).toFixed(0)}%`,
        `板块 ${this.data.tectonics.regionPlate[region]}`,
        `汇流 ${this.data.rivers.totalRunoff > 0
          ? (this.data.rivers.flowAccumulation[region] / this.data.rivers.totalRunoff * 100).toFixed(2)
          : '0.00'}%`,
        ...riverInfo,
        ...settlementInfo,
        ...transportInfo,
        ...tradeInfo,
        ...cultureInfo,
        ...religionInfo,
        ...polityInfo,
        feature,
        ...oceanInfo,
        ...lakeInfo,
      ].join(' · ')
    }
  }
}
