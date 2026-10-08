import type { ISimulationStage, SimulationContext } from '../types'
import { IcosphereBuilder, nearestIcosphereLevel } from '@/core/mesh/icosphere-builder'
import SphericalMesh from '@/core/mesh/mesh'
import {
  REFERENCE_REGION_LEVEL,
  ReferenceGridProjector,
} from '@/core/mesh/reference-grid-projector'
import { REFERENCE_PLATE_SUBDIVISION_COUNT } from '@/core/simulation/config'

export class MeshStage implements ISimulationStage {
  name = 'MeshGeneration'

  private readonly meshBuilder = new IcosphereBuilder()

  // Cache state
  private referenceKey = ''
  private referenceMesh: SphericalMesh | null = null
  private referenceProjector: ReferenceGridProjector | null = null

  execute(context: SimulationContext): void {
    const config = context.config

    // Find nearest valid icosphere level based on detail parameter
    const level = nearestIcosphereLevel(config.core.detail)

    const { referenceMesh, projector } = this.getReferenceGrid(
      config.core.seed,
      config.core.irregularity,
    )

    const mesh = level === REFERENCE_REGION_LEVEL
      ? referenceMesh
      : new SphericalMesh(this.meshBuilder.build(
          level,
          config.core.seed,
          config.core.irregularity,
        ))

    const outputToReference = projector.projectPerturbed(
      mesh.regionPosition,
      config.core.seed,
      REFERENCE_PLATE_SUBDIVISION_COUNT,
    )

    context.referenceMesh = referenceMesh
    context.projector = projector
    context.mesh = mesh
    context.outputToReference = outputToReference
  }

  private getReferenceGrid(seed: number, irregularity: number): {
    referenceMesh: SphericalMesh
    projector: ReferenceGridProjector
  } {
    const referenceKey = `${seed}:${irregularity}`
    if (this.referenceKey !== referenceKey || !this.referenceMesh || !this.referenceProjector) {
      this.referenceMesh = new SphericalMesh(
        this.meshBuilder.build(REFERENCE_REGION_LEVEL, seed, irregularity),
      )
      this.referenceProjector = new ReferenceGridProjector(this.referenceMesh.regionPosition)
      this.referenceKey = referenceKey
    }
    return {
      referenceMesh: this.referenceMesh,
      projector: this.referenceProjector,
    }
  }
}
