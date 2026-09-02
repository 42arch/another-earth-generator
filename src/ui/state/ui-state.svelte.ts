import type WorldEngine from '@/core/world/world-engine'
import type { MapProjectionId } from '@/core/projections/map-projection'
import type { WorldViewMode } from '@/core/rendering/view-mode'
import type { GlobeDisplayMode, GlobeGenParams } from '@/core/spherical/config'
import { tick } from 'svelte'
import { cloneGlobeGenParams, DEFAULT_GLOBE_GEN_PARAMS } from '@/core/spherical/config'

export interface SelectedRegionInfo {
  region: number
  feature: '海洋' | '湖泊' | '陆地'
  latitude: number
  longitude: number
  elevation: number
  climateElevationMeters: number
  temperature: number
  warmestMonthTemperature: number
  coldestMonthTemperature: number
  annualPrecipitationMm: number
  precipitationSeasonality: number
  runoff: number
  biome: string
  moisture: number
  continentality: number
  habitability: number
  accessibility: number
  plate: number
  flowRatio: number
  // 河流
  isRiver: boolean
  isSeasonalRiver: boolean
  riverSeasonality: number
  // 聚落
  settlement?: {
    id: number
    name: string
    type: '营地' | '村落' | '城镇' | '城市'
    population: number
    prosperity: number
    isPort: boolean
  }
  // 文化语言与政治信仰
  culture?: {
    id: number
    name: string
    language: string
    languageFamily: string
    influence: number
    isCore: boolean
  }
  polity?: {
    id: number
    name: string
    control: number
    isCapital: boolean
  }
  religion?: {
    id: number
    name: string
    influence: number
    isHolySite: boolean
  }
  // 湖泊
  lake?: {
    id: number
    iceState: string
    isEndorheic: boolean
    isSeasonal: boolean
    areaShare: number
    depth: number
    fillRatio: number
    salinity: number
    inflowEvapRatio: number
  }
  // 海洋
  ocean?: {
    sst: number
    sstAnomaly: number
    currentSpeed: number
  }
}

export interface WorldSummaryInfo {
  lakeCount: number
  endorheicCount: number
  seasonalLakeCount: number
  frozenLakeCount: number
  subglacialLakeCount: number
  riverSourceCount: number
  riverSegmentCount: number
  seasonalRiverSegmentCount: number
  settlementCount: number
}

export class UIState {
  engine: WorldEngine | null = null
  params: GlobeGenParams = $state(cloneGlobeGenParams(DEFAULT_GLOBE_GEN_PARAMS))
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
  isGenerating = $state(true)
  loadingStageText = $state('正在推演大陆板块与创世水系…')
  codexDrawerOpen = $state(false)
  layerDrawerOpen = $state(false)
  inspectorOpen = $state(false)
  activeTab = $state<'tectonics' | 'land' | 'climate' | 'hydrology' | 'human'>('tectonics')
  viewMode = $state<WorldViewMode>('globe')
  mapProjection = $state<MapProjectionId>('mercator')

  init(engine: WorldEngine) {
    this.engine = engine
    this.engine.setViewMode(this.viewMode)
    this.engine.setMapProjection(this.mapProjection)
  }

  setGenerating(generating: boolean, text = '正在铸就新世界…') {
    this.isGenerating = generating
    if (text)
      this.loadingStageText = text
  }

  private updateDebounceTimer: ReturnType<typeof setTimeout> | null = null

  updateParam<K extends keyof GlobeGenParams>(key: K, value: GlobeGenParams[K], immediate = true) {
    this.params[key] = value
    if (!this.engine)
      return

    // 1. 瞬时外观/显示层切换（无计算开销，立即响应 0ms）
    const isAppearanceParam = [
      'displayMode',
      'showGraticule',
      'showRivers',
      'showSettlements',
      'showMapLabels',
      'showRoads',
      'showShippingRoutes',
      'showCultureBoundaries',
      'showReligionBoundaries',
      'showHolySites',
      'showPoliticalBoundaries',
      'showTemperature',
      'showMoisture',
      'showWind',
      'showOceanCurrents',
      'showSeaSurfaceTemperature',
      'showPrecipitation',
      'showFlux',
      'showCoastlines',
      'showPlateBoundaries',
      'wireframe',
      'autoRotate',
    ].includes(key)

    if (isAppearanceParam) {
      this.engine.updateParams(this.params)
      this.engine.updateAppearance()
      return
    }

    if (this.updateDebounceTimer) {
      clearTimeout(this.updateDebounceTimer)
      this.updateDebounceTimer = null
    }

    const executeRecalculation = () => {
      if (!this.engine)
        return
      this.engine.updateParams(this.params)

      // 分级智能增量重算
      switch (key) {
        case 'seed':
        case 'subdivision':
        case 'plateCount':
        case 'continentCount':
        case 'landCoverage':
        case 'sizeVariety':
        case 'spread':
        case 'compactness':
        case 'elongation':
        case 'coastlineRoughness':
        case 'islandCount':
        case 'islandLandShare':
        case 'islandClustering':
        case 'islandTectonicBias':
          this.engine.generateWorld()
          break
        case 'mountainStrength':
        case 'noiseStrength':
          this.engine.regenerateElevation()
          break
        case 'equatorTemperature':
        case 'poleTemperature':
        case 'latitudeTemperatureExponent':
        case 'axialTilt':
        case 'elevationLapseRate':
        case 'temperatureNoiseStrength':
        case 'windPerturbation':
        case 'oceanCurrentStrength':
        case 'oceanHeatTransport':
        case 'oceanEvaporation':
        case 'landEvaporation':
        case 'moistureIterations':
        case 'moistureRetention':
        case 'basePrecipitation':
        case 'equatorialRainStrength':
        case 'subtropicalDryness':
        case 'midlatitudeRainStrength':
        case 'orographicStrength':
        case 'evapotranspirationStrength':
        case 'infiltration':
          this.engine.regenerateClimate()
          break
        case 'lakeDensity':
        case 'lakeMinDepth':
        case 'lakeMinRegionCount':
        case 'lakeMinCoastDistance':
        case 'lakeMaxLandCoverage':
        case 'lakeEvaporationStrength':
        case 'lakeOverflowThreshold':
        case 'lakeMinFillRatio':
          this.engine.regenerateLakes()
          break
        case 'riverBasinThreshold':
        case 'riverMinSourceElevation':
        case 'riverMinLength':
          this.engine.regenerateRivers()
          break
        case 'settlementDensity':
          this.engine.regenerateHuman()
          break
        case 'roadDensity':
        case 'shippingRouteDensity':
        case 'shippingMaxRange':
        case 'shippingCurrentInfluence':
        case 'shippingWindInfluence':
        case 'shippingOpenOceanRisk':
          this.engine.regenerateTransport()
          break
        case 'tradeActivity':
        case 'tradeSpecialization':
          this.engine.regenerateTrade()
          break
        case 'cultureCount':
        case 'culturalBlending':
          this.engine.regenerateCultures()
          break
        case 'polityCount':
        case 'politicalCohesion':
        case 'overseasExpansion':
          this.engine.regeneratePolities()
          break
        case 'religionCount':
        case 'religiousProselytism':
          this.engine.regenerateReligions()
          break
      }
    }

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
    this.updateParam('displayMode', mode)
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

  toggleLayer(layerKey: keyof GlobeGenParams) {
    if (typeof this.params[layerKey] === 'boolean')
      this.updateParam(layerKey, !this.params[layerKey] as GlobeGenParams[typeof layerKey])
  }

  async regenerateWorld(text = '正在推演大陆板块与创世水系…') {
    if (!this.engine)
      return
    if (this.updateDebounceTimer) {
      clearTimeout(this.updateDebounceTimer)
      this.updateDebounceTimer = null
    }
    this.setGenerating(true, text)
    await this.waitForLoadingPaint()
    this.engine.updateParams(this.params)
    this.engine.generateWorld()
    setTimeout(() => {
      this.setGenerating(false)
    }, 150)
  }

  resetCamera() {
    if (this.engine)
      this.engine.resetCamera()
  }

  randomizeSeed() {
    const newSeed = Math.floor(Math.random() * 9000) + 1000
    this.params.seed = newSeed
    this.regenerateWorld(`正在根据新种子 #${newSeed} 铸就世界…`)
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

export const uiState = new UIState()
