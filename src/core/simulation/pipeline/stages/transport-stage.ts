import type { ISimulationStage, SimulationContext } from '@/core/simulation/pipeline/types'
import { TransportGenerator } from '@/core/simulation/civilization/transport-generator'

export class TransportStage implements ISimulationStage {
  name = 'TransportAndMarkets'

  private readonly generator = new TransportGenerator()

  execute(context: SimulationContext): void {
    const { mesh, data } = context
    if (!mesh || !data?.civilization)
      throw new Error('TransportAndMarkets requires population and settlements')
    data.civilization.transport = this.generator.generate(mesh, data, context.config)
  }
}
