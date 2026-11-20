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

export interface Polity extends WorldEntity {
  readonly archetypeId: ContentId
  readonly cultureId: string
  readonly capitalSettlementId: string | null
  readonly sizeClass?: PolitySizeClass
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

export interface CivilizationParameters {
  readonly enabled: boolean
  /** Relative multiplier for initial population carrying capacity, in [0.1, 4]. */
  readonly populationScale: number
  /** Relative settlement seeding density multiplier, in [0.25, 4]. */
  readonly settlementDensity: number
  /** Polity territorial projection & consolidation tendency, in [0, 1]. */
  readonly polityCohesion: number
}

export const DEFAULT_CIVILIZATION_PARAMETERS: CivilizationParameters = {
  enabled: true,
  populationScale: 1,
  settlementDensity: 1,
  polityCohesion: 0.6,
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
  readonly transport: TransportNetworkState
}
