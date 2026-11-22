import type { ContentId } from '#content/content-port'
import type { DenseField } from '#world/fields'

export interface WorldEntity {
  readonly id: string
  readonly name: string
  /** Simulation years relative to world epoch; may precede year zero. */
  readonly foundedAtYear: number
}

/** Historical or biological population lineage; concrete interpretation stays open for future packs. */
export interface People extends WorldEntity {
  readonly archetypeId: ContentId
}

export interface Culture extends WorldEntity {
  readonly archetypeId: ContentId
  readonly peopleId: string
  readonly namingStyleId: ContentId
}

export interface Religion extends WorldEntity {
  readonly archetypeId: ContentId
}

export type PolitySizeClass = 'city-state' | 'regional' | 'kingdom' | 'empire'

export const SETTLEMENT_FEATURE_IDS = [
  'agrarian',
  'pastoral',
  'industrial',
  'craft',
  'mining',
  'forestry',
  'fishery',
  'maritime-trade',
  'trade-hub',
  'cultural',
  'religious',
  'fortress',
] as const

export type SettlementFeatureId = (typeof SETTLEMENT_FEATURE_IDS)[number]

export const POLITY_TRAIT_IDS = [
  // Physical territory, derived after borders are finalized.
  'small-area',
  // Dimension 1: Power & territorial structure
  'centralized',
  'city-state-civic',
  'decentralized',
  'tribal-kinship',
  'nomadic-pastoral',
  // Dimension 2: Governance & legitimacy
  'theocratic',
  'democratic',
  'militaristic',
  'dynastic-aristocratic',
  'ancestral-ritual',
  // Dimension 3: Economic orientation
  'mercantile',
  'agrarian-realm',
  'industrial-power',
  'artisan-craft',
  'cultural-patron',
] as const

export type PolityTraitId = (typeof POLITY_TRAIT_IDS)[number]

export interface Polity extends WorldEntity {
  readonly archetypeId: ContentId
  readonly cultureId: string
  readonly capitalSettlementId: string | null
  readonly sizeClass?: PolitySizeClass
  readonly traits: readonly PolityTraitId[]
}

export type SettlementTier = 'capital' | 'city' | 'town' | 'village'

export interface Settlement extends WorldEntity {
  /** Bound to CivilizationState.meshId. */
  readonly regionId: number
  readonly polityId: string | null
  readonly cultureId: string
  readonly tier?: SettlementTier
  readonly isPort?: boolean
  /** Residents are a subset of region population, never added to it. */
  readonly population: number
  readonly features: readonly SettlementFeatureId[]
}

export interface PopulationGroup {
  readonly regionId: number
  readonly peopleId: string
  readonly cultureId: string
  /** null means unaffiliated. */
  readonly religionId: string | null
  readonly polityId: string | null
  readonly population: number
}

export type TransportLinkMode = 'road' | 'river' | 'sea'

export interface TransportNode {
  readonly id: string
  readonly regionId: number
  readonly settlementId: string | null
  readonly kind: 'settlement' | 'port' | 'junction'
}

export interface TransportLink {
  readonly id: string
  readonly fromNodeId: string
  readonly toNodeId: string
  readonly mode: TransportLinkMode
  /** Ordered sequence of mesh region IDs traversed by this link. */
  readonly regions: Uint32Array
  /** Effective travel cost in normalized dimensionless day-equivalents. */
  readonly cost: number
  readonly trafficScore: number
}

export interface TransportNetworkState {
  readonly nodes: readonly TransportNode[]
  readonly routes: readonly TransportLink[]
  /** Dimensionless regional accessibility in [0, 1], length N. */
  readonly accessibility: DenseField<Float32Array>
}

/** Production and transport capabilities relative to the current near-modern baseline. */
export interface CivilizationCapabilities {
  readonly agriculturalProductivity: number
  readonly industrialCapability: number
  readonly landTransportCapability: number
  readonly seafaringCapability: number
  /** Relative administrative integration, in [0, 1]. */
  readonly administrativeCapacity: number
}

export interface CivilizationParameters {
  readonly enabled: boolean
  /** Relative multiplier for initial population carrying capacity, in [0.1, 4]. */
  readonly populationScale: number
  /** Relative settlement seeding density multiplier, in [0.25, 4]. */
  readonly settlementDensity: number
  /** Strength of urban recruitment, in [0, 1]; not an exact urban population share. */
  readonly urbanConcentration: number
  /** Exact final polity count, an integer in [1, 200]. */
  readonly polityCount: number
  /** Desired territory-size dispersion, in [0, 1]; geography can constrain actual shares. */
  readonly politySizeVariation: number
  /** Relative target count of cultural hearths, in [0.5, 2]. */
  readonly culturalDiversity: number
  readonly capabilities: CivilizationCapabilities
}

export type CivilizationParametersInput = Partial<Omit<CivilizationParameters, 'capabilities'>> & {
  readonly capabilities?: Partial<CivilizationCapabilities>
}

export const DEFAULT_CIVILIZATION_CAPABILITIES: CivilizationCapabilities = Object.freeze({
  agriculturalProductivity: 1,
  industrialCapability: 1,
  landTransportCapability: 1,
  seafaringCapability: 1,
  administrativeCapacity: 0.75,
})

export const DEFAULT_CIVILIZATION_PARAMETERS: CivilizationParameters = {
  enabled: true,
  populationScale: 1,
  settlementDensity: 1,
  urbanConcentration: 0.65,
  polityCount: 60,
  politySizeVariation: 0.5,
  culturalDiversity: 1,
  capabilities: DEFAULT_CIVILIZATION_CAPABILITIES,
}

export interface CivilizationState {
  readonly meshId: string
  readonly peoples: readonly People[]
  readonly cultures: readonly Culture[]
  readonly religions: readonly Religion[]
  readonly polities: readonly Polity[]
  readonly settlements: readonly Settlement[]
  /** Authoritative people per region, length N; finite, nonnegative, fractional aggregates allowed. */
  readonly population: DenseField<Float64Array>
  /** Sparse joint composition; sums per region match population within max(1e-6, total*1e-9). */
  readonly populationGroups: readonly PopulationGroup[]
  /**
   * Land ownership, length N. `-1` is unowned. Ocean stays `-1`. Empty land and
   * lakes can belong to a polity, so this is not derived from population groups.
   */
  readonly territoryPolityIndex: DenseField<Int32Array>
  readonly transport: TransportNetworkState
}
