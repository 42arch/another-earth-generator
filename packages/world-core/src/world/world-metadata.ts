import type { PlanetParameters } from './planet-parameters'

export interface WorldMetadata {
  readonly worldId: string
  readonly name: string
  /** ISO 8601 UTC, supplied by the caller, never used as a random seed. */
  readonly createdAt: string
  readonly seed: string
  readonly generatorVersion: string
  readonly contentSignature: string
  readonly contentPacks: readonly { readonly id: string, readonly version: string, readonly contentHash: string }[]
  /** Snapshot-local generation inputs; M1 stages extend this versioned contract. */
  readonly generationConfig: {
    readonly planet: PlanetParameters
    readonly mesh: {
      readonly subdivisionLevel: number
      readonly irregularity: number
      readonly seed?: string | number
    }
    readonly regionCount: number
    readonly civilizationEnabled: boolean
  }
  readonly provenance: {
    readonly stageVersions: Readonly<Record<string, string>>
    readonly artifactSignatures: Readonly<Record<string, string>>
    readonly configSignature: string
  }
}
