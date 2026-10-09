import type { ISimulationStage, SimulationContext } from '@/core/simulation/pipeline/types'
import { ReligionGenerator } from '@/core/society/religion-generator'

export class ReligionStage implements ISimulationStage {
  name = 'ReligionsAndBeliefs'

  private readonly generator = new ReligionGenerator()

  execute(context: SimulationContext): void {
    const { mesh, data } = context
    if (!mesh || !data?.society?.polities)
      throw new Error('ReligionsAndBeliefs requires polities and resident population')
    data.society.religions = this.generator.generate(mesh, data, context.config)
  }
}
