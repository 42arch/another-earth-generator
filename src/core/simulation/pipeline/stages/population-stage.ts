import type { ISimulationStage, SimulationContext } from '@/core/simulation/pipeline/types'
import { PopulationGenerator } from '@/core/simulation/civilization/population-generator'

export class PopulationStage implements ISimulationStage {
  name = 'PopulationAndSettlements'

  private readonly generator = new PopulationGenerator()

  execute(context: SimulationContext): void {
    const { mesh, data } = context
    if (!mesh || !data?.biome || !data.hydrology)
      throw new Error('PopulationAndSettlements requires finalized biome and hydrology data')
    data.civilization = this.generator.generate(mesh, data, context.config)
  }
}
