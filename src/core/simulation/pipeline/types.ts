import type { CandidateLandData } from '@/core/geography/candidate-land-generator'
import type { SphericalBoundaryData, SphericalCrustData, SphericalTectonicData } from '@/core/geology/geology-data'
import type { SphericalPlateData } from '@/core/geology/plate-generator'
import type { SuperPlateData, SuperPlateTopologyData } from '@/core/geology/super-plate-generator'
import type SphericalMesh from '@/core/mesh/mesh'
import type { ReferenceGridProjector } from '@/core/mesh/reference-grid-projector'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'

export interface GeneratedSphericalWorld {
  mesh: SphericalMesh
  referenceMesh: SphericalMesh
  /** Output region index → boundary-warped fixed-grid region index. */
  outputToReference: Uint32Array
  referencePlates: SphericalPlateData
  data: WorldSimulationState
}

/**
 * 包含了地貌生成过程中所有的中间状态的黑板 (Blackboard)。
 * 在 Pipeline 各个 Stage 之间流转，并最终生成 WorldSimulationState。
 */
export interface SimulationContext {
  config: WorldConfig

  // 1. Mesh Stage
  referenceMesh?: SphericalMesh
  projector?: ReferenceGridProjector
  mesh?: SphericalMesh
  outputToReference?: Uint32Array
  /** Geographic nearest climate cells, without tectonic boundary perturbation. */
  climateOutputToReference?: Uint32Array

  // 2. Reference plate topology and continental crust
  referencePlates?: SphericalPlateData
  referencePlateTopology?: SuperPlateTopologyData
  referenceLand?: CandidateLandData
  referenceCrust?: SphericalCrustData
  plateAngularVelocity?: Float32Array

  // 3. Plate dynamics
  referenceSuperPlates?: SuperPlateData | null
  referenceMantleFlow?: Float32Array

  // 4. Projection Stage (将 reference 投影到高精度网格)
  candidateLandMask?: Uint8Array
  continentId?: Int16Array
  nearestContinentId?: Int16Array
  regionPlate?: Int16Array
  regionSuperPlate?: Int16Array
  crust?: SphericalCrustData
  boundaries?: SphericalBoundaryData

  // 5. Mantle & Tectonics Stage
  rawTectonics?: SphericalTectonicData
  mantleFlow?: Float32Array
  mantle?: { elevationDelta: Float32Array, normalizedFlow: Float32Array }
  tectonics?: SphericalTectonicData

  // 6. Elevation & Terrain Stage
  elevationFields?: any // Replace with proper type later
  terrain?: any // Replace with proper type later
  landMask?: Uint8Array
  landArea?: number

  // Final Output
  data?: WorldSimulationState
}

export interface ISimulationStage {
  name: string
  execute: (context: SimulationContext) => void | Promise<void>
}
