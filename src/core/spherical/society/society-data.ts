export type SphericalSettlementType = 'camp' | 'village' | 'town' | 'city'

export const TRADE_GOOD = {
  Food: 0,
  Timber: 1,
  Livestock: 2,
  Minerals: 3,
  Fisheries: 4,
} as const

export const TRADE_GOOD_COUNT = 5
export const TRADE_GOOD_NAME = ['粮食', '木材', '畜产', '矿物', '渔业'] as const

export interface SphericalSettlement {
  name: string
  region: number
  type: SphericalSettlementType
  /** Relative population estimate, intended for settlement ranking rather than census accuracy. */
  population: number
  /** Natural prosperity before trade-network effects are applied. */
  baseProsperity: number
  prosperity: number
  isPort: boolean
}

export interface SphericalPolity {
  name: string
  adjective: string
  capitalSettlement: number
  capitalRegion: number
  color: [number, number, number]
  area: number
  population: number
}

export interface SphericalPoliticalData {
  /** Political owner per region, or -1 for unclaimed land and all water. */
  regionPolity: Int16Array
  /** Administrative control strength, normalized from 0 to 1. */
  politicalControl: Float32Array
  polities: SphericalPolity[]
}

export interface SphericalCulture {
  name: string
  language: number
  coreSettlement: number
  coreRegion: number
  parentCulture: number
  color: [number, number, number]
  area: number
  population: number
}

export interface SphericalCulturalData {
  /** Dominant culture per land region, or -1 when culturally unassigned. */
  regionCulture: Int16Array
  /** Confidence of the dominant culture, reduced in cultural transition zones. */
  cultureInfluence: Float32Array
  cultures: SphericalCulture[]
}

export type ReligionTerrainAffinity = 'universal' | 'mountain' | 'maritime' | 'desert' | 'forest'

export interface SphericalReligion {
  name: string
  holySettlement: number
  originRegion: number
  originCulture: number
  originPolity: number
  color: [number, number, number]
  missionaryStrength: number
  tolerance: number
  stateSupport: number
  terrainAffinity: ReligionTerrainAffinity
  area: number
  followers: number
}

export interface SphericalReligiousData {
  /** Dominant religion per land region, or -1 when no religion has reached the region. */
  regionReligion: Int16Array
  religionInfluence: Float32Array
  holySiteMask: Uint8Array
  religions: SphericalReligion[]
}

export interface SphericalLanguage {
  name: string
  culture: number
  family: number
  consonants: string[]
  vowels: string[]
  syllablePatterns: string[]
}

export interface SphericalNamingData {
  /** Languages are aligned with cultures in the MVP. */
  languages: SphericalLanguage[]
  familyNames: string[]
}

export type HumanRouteMode = 'road' | 'shipping'

export interface HumanRoute {
  mode: HumanRouteMode
  sourceSettlement: number
  targetSettlement: number
  regions: Uint32Array
  distance: number
  baseCost: number
  /** January, April, July and October representative travel costs. */
  seasonalCost: Float32Array
  reliability: number
  capacity: number
}

export interface SphericalTransportData {
  routes: HumanRoute[]
  roadMask: Uint8Array
  roadIntensity: Float32Array
  shippingIntensity: Float32Array
}

export interface SphericalMaritimeContact {
  sourceSettlement: number
  targetSettlement: number
  sourceRegion: number
  targetRegion: number
  distance: number
  baseCost: number
  reliability: number
  /** Migration, exchange and missionary contact strength, normalized from 0 to 1. */
  strength: number
}

export interface SphericalTradeData {
  /** Settlement-major production by trade good. */
  settlementProduction: Float32Array
  /** Settlement-major demand by trade good. */
  settlementDemand: Float32Array
  settlementExports: Float32Array
  settlementImports: Float32Array
  settlementMarketAccess: Float32Array
  /** Trade volume aligned with `transport.routes`. */
  routeVolume: Float32Array
  regionTradeIntensity: Float32Array
  totalVolume: number
}

export interface SphericalHumanData {
  /** Long-term population carrying capacity, normalized from 0 to 1. */
  habitability: Float32Array
  /** Local travel and exchange convenience, normalized from 0 to 1. */
  accessibility: Float32Array
  /** Settlement index for each region, or -1 when the region has no settlement. */
  regionSettlementId: Int32Array
  settlements: SphericalSettlement[]
  /** Latent maritime links that may exist before formal shipping or trade routes. */
  maritimeContacts: SphericalMaritimeContact[]
  transport: SphericalTransportData
  trade: SphericalTradeData
  culture: SphericalCulturalData
  religion: SphericalReligiousData
  politics: SphericalPoliticalData
  naming: SphericalNamingData
}
