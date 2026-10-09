import type { ISimulationStage, SimulationContext } from '@/core/simulation/pipeline/types'
import { PolityGenerator } from '@/core/society/polity-generator'

export class PolityStage implements ISimulationStage {
  name = 'PolitiesAndAdministration'

  private readonly generator = new PolityGenerator()

  execute(context: SimulationContext): void {
    const { mesh, data } = context
    if (!mesh || !data?.society?.ethnicity)
      throw new Error('PolitiesAndAdministration requires ethnicity and transport')
    data.society.polities = this.generator.generate(mesh, data, context.config)
  }
}
