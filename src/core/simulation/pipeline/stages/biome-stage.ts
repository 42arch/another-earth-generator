import type { ISimulationStage, SimulationContext } from '@/core/simulation/pipeline/types'
import { classifyOutputBiomes } from '@/core/ecology/biome-classifier'

export class BiomeStage implements ISimulationStage {
  name = 'Biome'

  execute(context: SimulationContext): void {
    const { mesh, referenceMesh, data } = context
    if (!mesh || !referenceMesh || !data?.climate?.monthly)
      throw new Error('Missing monthly climate in BiomeStage')
    const climateMesh = mesh.numRegions <= referenceMesh.numRegions ? mesh : referenceMesh
    data.biome = classifyOutputBiomes(
      mesh,
      climateMesh,
      data.geography,
      data.climate,
      context.config.climate.axialTiltDeg,
    )
  }
}
