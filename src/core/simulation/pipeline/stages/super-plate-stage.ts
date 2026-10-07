import type { ISimulationStage, SimulationContext } from '../types'
import { PlatePhysicsProcessor } from '@/core/geology/plate-physics'

export class SuperPlateStage implements ISimulationStage {
  name = 'PlateDynamics'

  private readonly platePhysics = new PlatePhysicsProcessor()

  execute(context: SimulationContext): void {
    if (!context.referenceMesh || !context.referencePlates || !context.referenceSuperPlates) {
      throw new Error('Missing dependencies in SuperPlateStage')
    }

    const config = context.config
    const referenceMesh = context.referenceMesh

    const referenceSuperPlates = context.referenceSuperPlates

    referenceSuperPlates.plateAngularVelocity = this.platePhysics.apply(
      referenceMesh,
      referenceSuperPlates.regionPlate,
      referenceSuperPlates.plateAngularVelocity,
      referenceSuperPlates.crust,
      config.core.seed,
      1.6,
    )
    const fineVelocities = new Float32Array(context.referencePlates.plateSeeds.length * 3)
    for (let plate = 0; plate < context.referencePlates.plateSeeds.length; plate++) {
      const source = referenceSuperPlates.plateToSuper[plate] * 3
      fineVelocities.set(referenceSuperPlates.plateAngularVelocity.subarray(source, source + 3), plate * 3)
    }
    context.referencePlates = {
      ...context.referencePlates,
      plateAngularVelocity: fineVelocities,
    }
    context.plateAngularVelocity = fineVelocities

    // The mantle field follows the final moving plates, not the reference subdivisions.
    const referenceMantleFlow = this.platePhysics.mantleFlow
      ?? new Float32Array(referenceMesh.numRegions)

    context.referenceMantleFlow = referenceMantleFlow
  }
}
