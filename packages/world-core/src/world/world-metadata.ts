import type { PlanetParameters } from './planet-parameters'
import type { ClimateParameters } from '#generation/nature/climate/climate'
import type { HydrologyParameters } from '#generation/nature/hydrology/hydrology'
import type { GeologyParameters } from '#generation/stages/geology-stage'
import type { LandformParameters, TerrainParameters } from '#generation/stages/terrain-stage'

export interface WorldMetadata {
  readonly worldId: string
  readonly name: string
  /** ISO 8601 UTC, supplied by the caller, never used as a random seed. */
  readonly createdAt: string
  readonly seed: string
  readonly generatorVersion: string
  readonly contentSignature: string
  readonly contentPacks: readonly { readonly id: string, readonly version: string, readonly contentHash: string }[]
  /** Complete snapshot-local natural generation inputs. */
  readonly generationConfig: {
    readonly planet: PlanetParameters
    readonly mesh: {
      readonly subdivisionLevel: number
      readonly irregularity: number
      readonly seed?: string | number
    }
    readonly regionCount: number
    readonly civilizationEnabled: boolean
    readonly reference?: { readonly subdivisionLevel: number }
    readonly geology: GeologyParameters
    readonly landforms: LandformParameters
    readonly terrain: TerrainParameters
    readonly climate: ClimateParameters
    readonly hydrology: HydrologyParameters
  }
  readonly provenance: {
    readonly stageVersions: Readonly<Record<string, string>>
    readonly artifactSignatures: Readonly<Record<string, string>>
    readonly configSignature: string
  }
}
