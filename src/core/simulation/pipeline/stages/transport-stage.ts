import type { ISimulationStage, SimulationContext } from '@/core/simulation/pipeline/types'
import { TransportGenerator } from '@/core/society/transport-generator'

export class TransportStage implements ISimulationStage {
  name = 'TransportAndMarkets'

  private readonly generator = new TransportGenerator()

  execute(context: SimulationContext): void {
    const { mesh, data } = context
    if (!mesh || !data?.society)
      throw new Error('TransportAndMarkets requires population and settlements')
    data.society.transport = this.generator.generate(mesh, data, context.config)
  }
}
