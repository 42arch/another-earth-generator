export type SettlementRank = 'village' | 'town' | 'city' | 'metropolis'

export interface Settlement {
  id: number
  region: number
  name: string
  rank: SettlementRank
  /** Residents in the centre region after concentration; already included in population. */
  population: number
  /** Total population served by this settlement before urban concentration. */
  hinterlandPopulation: number
  reasons: string[]
}

export interface SocietyData {
  /** Dimensionless suitability score in [0, 1] on the final output mesh. */
  habitability: Float32Array
  /** Authoritative residents per region, including urban concentration. */
  population: Float32Array
  /** Residents per physical km² of each final output region. */
  populationDensity: Float32Array
  /** Settlement ID at its center region; -1 elsewhere. */
  settlementByRegion: Int32Array
  settlements: Settlement[]
  totalPopulation: number
  /** Transport corridors and market access, populated by the transport stage. */
  transport?: TransportData
  /** Resident ethnic composition and language use, populated after transport. */
  ethnicity?: EthnicityData
  /** Territorial governance and first-level administration. */
  polities?: PolityData
  /** Exclusive primary belief affiliation, generated after polities. */
  religions?: ReligionData
}

export interface Religion {
  id: number
  name: string
  originSettlementId: number
  /** -1 for an independent tradition; otherwise a modeled branch. */
  parentReligionId: number
  originEthnicGroupId: number
  sacredSiteIds: number[]
}

export interface SacredSite {
  id: number
  religionId: number
  settlementId: number
  region: number
  name: string
}

export interface ReligionData {
  religions: Religion[]
  sacredSites: SacredSite[]
  /** CSR offsets indexed by final output region. */
  regionOffsets: Uint32Array
  /** Religion ID, or -1 for residents without a primary affiliation. */
  affiliationIds: Int32Array
  /** Resident counts allocated from SocietyData.population. */
  residents: Float64Array
  /** -2 for ocean/uninhabited land, -1 for an unaffiliated plurality. */
  dominantAffiliation: Int32Array
  dominantShare: Float32Array
}

export interface Polity {
  id: number
  name: string
  capitalSettlementId: number
  governingForm: 'city-state' | 'kingdom' | 'republic' | 'league'
  officialLanguageId: number
  governanceBudgetKm: number
  /** A supported tradition, if one arose in this polity; distinct from residents' affiliations. */
  patronReligionId?: number
  population: number
  areaKm2: number
}

export interface AdministrativeDistrict {
  id: number
  polityId: number
  /** -1 for a frontier district without a settlement centre. */
  centerSettlementId: number
  name: string
  population: number
  areaKm2: number
}

export interface PolityData {
  polities: Polity[]
  districts: AdministrativeDistrict[]
  /** -1 for sea and land beyond effective governance. */
  polityByRegion: Int32Array
  /** Governance reach, 0 outside polity territory. */
  controlStrength: Float32Array
  districtByRegion: Int32Array
  unassignedPopulation: number
  unassignedAreaKm2: number
}

export interface EthnicGroup {
  id: number
  name: string
  originRegion: number
  languageId: number
  /** Groups using a language in the same modeled family; not a historical parentage claim. */
  relatedGroupIds: number[]
}

export interface LanguageFamily {
  id: number
  name: string
  originRegion: number
}

export interface Language {
  id: number
  name: string
  originRegion: number
  familyId: number
  ethnicGroupIds: number[]
}

export interface EthnicityData {
  groups: EthnicGroup[]
  languages: Language[]
  languageFamilies: LanguageFamily[]
  /** CSR offsets into groupIds and residents, indexed by final output region. */
  regionOffsets: Uint32Array
  groupIds: Uint32Array
  /** Resident counts allocated from SocietyData.population, never additional people. */
  residents: Float64Array
  /** Display caches; -1 on ocean and uninhabited land. */
  dominantGroup: Int32Array
  dominantGroupShare: Float32Array
  dominantLanguage: Int32Array
  dominantLanguageShare: Float32Array
}

export interface TransportRoute {
  id: number
  kind: 'road' | 'sea'
  fromSettlement: number
  toSettlement: number
  /** Ordered final-mesh region path, including both settlement centres. */
  regions: Uint32Array
  distanceKm: number
  /** Distance-equivalent travel cost; not elapsed time or trade volume. */
  costKm: number
}

export interface TransportData {
  routes: TransportRoute[]
  /** Nearest land market by weighted travel cost; -1 where no market is reachable. */
  nearestMarket: Int32Array
  /** Distance-equivalent access cost on land, Infinity where unreachable. */
  marketCostKm: Float32Array
  /** Relative market-access score in [0, 1]. */
  marketAccess: Float32Array
  /** Route ID passing through this region; -1 outside the selected network. */
  routeByRegion: Int32Array
  /** One for settlements selected as endpoints of sea routes. */
  portSettlementIds: Uint8Array
  /** One for regions on a selected road. */
  roadRegionMask: Uint8Array
}

export const SETTLEMENT_RANK_LABELS: Record<SettlementRank, string> = {
  village: '村落',
  town: '城镇',
  city: '城市',
  metropolis: '都会',
}
