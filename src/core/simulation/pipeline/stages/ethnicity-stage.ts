import type { ISimulationStage, SimulationContext } from '@/core/simulation/pipeline/types'
import { EthnicityGenerator } from '@/core/simulation/civilization/ethnicity-generator'

export class EthnicityStage implements ISimulationStage {
  name = 'EthnicityAndLanguages'

  private readonly generator = new EthnicityGenerator()

  execute(context: SimulationContext): void {
    const { mesh, data } = context
    if (!mesh || !data?.civilization?.transport)
      throw new Error('EthnicityAndLanguages requires population and transport data')
    data.civilization.ethnicity = this.generator.generate(mesh, data, context.config)
  }
}
