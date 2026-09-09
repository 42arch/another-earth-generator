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
    depthMeters: number
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

