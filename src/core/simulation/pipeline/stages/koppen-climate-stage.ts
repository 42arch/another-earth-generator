import type { ISimulationStage, SimulationContext } from '@/core/simulation/pipeline/types'
import { classifyOutputKoppen } from '@/core/climate/koppen-climate-classifier'

export class KoppenClimateStage implements ISimulationStage {
  name = 'KoppenClimate'

  execute(context: SimulationContext): void {
    const { mesh, referenceMesh, data } = context
    if (!mesh || !referenceMesh || !data?.climate?.monthly)
      throw new Error('Missing monthly climate in KoppenClimateStage')
    const climateMesh = mesh.numRegions <= referenceMesh.numRegions ? mesh : referenceMesh
    data.climate.koppen = classifyOutputKoppen(
      mesh,
      climateMesh,
      data.geography,
      data.climate,
      context.config.climate.axialTiltDeg,
    )
  }
}
