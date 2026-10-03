import type { ISimulationStage, SimulationContext } from '../types'
import { PlatePhysicsProcessor } from '@/core/geology/plate-physics'
import { SuperPlateGenerator } from '@/core/geology/super-plate-generator'

export class SuperPlateStage implements ISimulationStage {
  name = 'SuperPlates'

  private readonly superPlateGenerator = new SuperPlateGenerator()
  // 独立的物理处理器实例，或者重用一个
  private readonly platePhysics = new PlatePhysicsProcessor()

  execute(context: SimulationContext): void {
    if (!context.referenceMesh || !context.referencePlates || !context.plateAngularVelocity || !context.referenceCrust) {
      throw new Error('Missing dependencies in SuperPlateStage')
    }

    const config = context.config
    const referenceMesh = context.referenceMesh

    const referenceSuperPlates = this.superPlateGenerator.generate(
      referenceMesh,
      context.referencePlates,
      context.plateAngularVelocity,
      context.referenceCrust,
    )

    if (referenceSuperPlates) {
      referenceSuperPlates.plateAngularVelocity = this.platePhysics.apply(
        referenceMesh,
        referenceSuperPlates.regionPlate,
        referenceSuperPlates.plateAngularVelocity,
        referenceSuperPlates.crust,
        config.core.seed,
        1.6,
      )
    }

    // PlatePhysicsProcessor 记录了最后一次 apply 计算出的 mantleFlow
    const referenceMantleFlow = this.platePhysics.mantleFlow
      ?? new Float32Array(referenceMesh.numRegions)

    context.referenceSuperPlates = referenceSuperPlates || null
    context.referenceMantleFlow = referenceMantleFlow
  }
}
