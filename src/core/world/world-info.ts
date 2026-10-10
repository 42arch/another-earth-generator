import type { Settlement, TransportRoute } from '@/core/society/society-data'

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
  habitability?: number
  population?: number
  populationDensity?: number
  ethnicComposition?: Array<{ name: string, population: number, share: number, originRegion: number, languageName: string }>
  languageComposition?: Array<{ name: string, population: number, share: number, familyName: string }>
  religiousComposition?: Array<{ name: string, population: number, share: number, originName?: string, parentName?: string }>
  sacredSiteNames?: string[]
  polityName?: string
  polityForm?: string
  capitalName?: string
  officialLanguageName?: string
  controlStrength?: number
  districtName?: string
  patronReligionName?: string
  settlement?: Settlement
  route?: TransportRoute
  routeFromName?: string
  routeToName?: string
  nearestMarketName?: string
  marketCostKm?: number
  marketAccess?: number
  isPort?: boolean
}

export interface WorldSummaryInfo {
  regionCount: number
  triangleCount: number
  plateCount: number
  totalPopulation: number
  settlementCount: number
  roadCount: number
  seaRouteCount: number
  ethnicGroupCount: number
  languageCount: number
  polityCount: number
  districtCount: number
  religionCount: number
  sacredSiteCount: number
}
