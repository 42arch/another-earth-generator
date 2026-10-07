import type { ISimulationStage, SimulationContext } from '../types'
import type { SphericalPlateData } from '@/core/geology/plate-generator'
import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'

import { SphericalPlateGenerator } from '@/core/geology/plate-generator'
import { SuperPlateGenerator } from '@/core/geology/super-plate-generator'
import { REFERENCE_PLATE_SUBDIVISION_COUNT } from '@/core/simulation/config'

export class PlateStage implements ISimulationStage {
  name = 'PlateTectonics'

  private readonly plateGenerator = new SphericalPlateGenerator()
  private readonly superPlateGenerator = new SuperPlateGenerator()

  private plateCacheKey = ''
  private referencePlates: SphericalPlateData | null = null

  execute(context: SimulationContext): void {
    if (!context.referenceMesh)
      throw new Error('Missing referenceMesh')

    const config = context.config
    const referenceMesh = context.referenceMesh

    const referencePlates = this.getReferencePlates(referenceMesh, config)

    const referencePlateTopology = this.superPlateGenerator.generateTopology(
      referenceMesh,
      referencePlates,
      referencePlates.plateAngularVelocity,
      config.geology.primaryPlateCount,
      config.geology.microPlateCount,
      config.geology.plateSizeVariety,
      config.core.seed,
    )
    if (!referencePlateTopology)
      throw new Error('At least two reference subdivisions are required')

    context.referencePlates = referencePlates
    context.referencePlateTopology = referencePlateTopology
    context.plateAngularVelocity = referencePlates.plateAngularVelocity
  }

  private getReferencePlates(
    referenceMesh: SphericalMesh,
    config: WorldConfig,
  ): SphericalPlateData {
    const cacheKey = `${config.core.seed}:${config.core.irregularity}:${REFERENCE_PLATE_SUBDIVISION_COUNT}`
    if (this.plateCacheKey !== cacheKey || !this.referencePlates) {
      this.referencePlates = this.plateGenerator.generate(
        referenceMesh,
        REFERENCE_PLATE_SUBDIVISION_COUNT,
        config.core.seed,
      )
      this.plateCacheKey = cacheKey
    }
    return this.referencePlates
  }
}
