import type { ISimulationStage, SimulationContext } from '@/core/simulation/pipeline/types'
import { generateMonthlyClimate } from '@/core/climate/monthly-climate-generator'

export class MonthlyClimateStage implements ISimulationStage {
  name = 'MonthlyClimate'

  execute(context: SimulationContext): void {
    const { mesh, referenceMesh, data } = context
    if (!mesh || !referenceMesh || !data?.climate)
      throw new Error('Missing dependencies in MonthlyClimateStage')
    const climateMesh = mesh.numRegions <= referenceMesh.numRegions ? mesh : referenceMesh
    data.climate.monthly = generateMonthlyClimate(
      climateMesh,
      data.climate,
      context.config.climate,
    )
  }
}
