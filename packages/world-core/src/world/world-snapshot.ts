import type { CivilizationState } from '#generation/civilization/civilization-types'
import type { MeshTopology } from '#mesh/mesh-types'
import type { NatureState } from '#generation/nature/nature-types'
import type { PlanetParameters } from './planet-parameters'
import type { WorldMetadata } from './world-metadata'

export const WORLD_SCHEMA_VERSION = 2 as const
/** Complete owned state, never a stage artifact or UI view. See docs/WORLD_DATA_CONTRACTS.md. */
export interface WorldSnapshot {
  readonly schemaVersion: typeof WORLD_SCHEMA_VERSION
  readonly snapshotId: string
  readonly revision: number
  /** Simulation years from the world's epoch, not wall-clock time. */
  readonly time: { readonly year: number }
  readonly metadata: WorldMetadata
  readonly planet: PlanetParameters
  readonly mesh: MeshTopology
  readonly nature: NatureState
  readonly civilization: CivilizationState
}
