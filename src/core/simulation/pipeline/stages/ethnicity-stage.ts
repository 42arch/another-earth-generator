import type { ISimulationStage, SimulationContext } from '@/core/simulation/pipeline/types'
import { EthnicityGenerator } from '@/core/society/ethnicity-generator'

export class EthnicityStage implements ISimulationStage {
  name = 'EthnicityAndLanguages'

  private readonly generator = new EthnicityGenerator()

  execute(context: SimulationContext): void {
    const { mesh, data } = context
    if (!mesh || !data?.society?.transport)
      throw new Error('EthnicityAndLanguages requires population and transport data')
    data.society.ethnicity = this.generator.generate(mesh, data, context.config)
  }
}
