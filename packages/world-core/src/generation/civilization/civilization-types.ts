import type { DenseField } from '#world/fields'
import type { ContentId } from '@another-earth/world-data'

export interface WorldEntity {
  readonly id: string
  readonly name: string
  /** Simulation years relative to world epoch; may precede year zero. */
  readonly foundedAtYear: number
}
export interface Species extends WorldEntity {}
export interface Culture extends WorldEntity {
  readonly archetypeId: ContentId
  readonly speciesId: string
}
export interface Religion extends WorldEntity {
  readonly archetypeId: ContentId
}
export interface Polity extends WorldEntity {
  readonly governmentArchetypeId: ContentId
  readonly cultureId: string
  readonly capitalSettlementId: string | null
}
export interface Settlement extends WorldEntity {
  /** Bound to CivilizationState.meshId. */
  readonly regionId: number
  readonly polityId: string | null
  readonly cultureId: string
  /** Residents are a subset of region population, never added to it. */
  readonly population: number
}
export interface PopulationGroup {
  readonly regionId: number
  readonly speciesId: string
  readonly cultureId: string
  /** null means unaffiliated. */
  readonly religionId: string | null
  readonly polityId: string | null
  readonly population: number
}
export interface CivilizationState {
  readonly meshId: string
  readonly species: readonly Species[]
  readonly cultures: readonly Culture[]
  readonly religions: readonly Religion[]
  readonly polities: readonly Polity[]
  readonly settlements: readonly Settlement[]
  /** Authoritative people per region, length N; finite, nonnegative, fractional aggregates allowed. */
  readonly population: DenseField<Float64Array>
  /** Sparse joint composition; sums per region match population within max(1e-6, total*1e-9). */
  readonly populationGroups: readonly PopulationGroup[]
}
