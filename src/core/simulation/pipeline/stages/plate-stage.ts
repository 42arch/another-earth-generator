import type { ISimulationStage, SimulationContext } from '../types'
import type { SphericalPlateData } from '@/core/geology/plate-generator'
import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'

import { CandidateLandGenerator } from '@/core/geography/candidate-land-generator'
import { SphericalPlateGenerator } from '@/core/geology/plate-generator'
import { PlatePhysicsProcessor } from '@/core/geology/plate-physics'
import { PlatePropertiesGenerator } from '@/core/geology/plate-properties-generator'

export class PlateStage implements ISimulationStage {
  name = 'PlateTectonics'

  private readonly plateGenerator = new SphericalPlateGenerator()
  private readonly candidateLandGenerator = new CandidateLandGenerator()
  private readonly platePropertiesGenerator = new PlatePropertiesGenerator()
  private readonly platePhysics = new PlatePhysicsProcessor()

  private plateCacheKey = ''
  private referencePlates: SphericalPlateData | null = null

  execute(context: SimulationContext): void {
    if (!context.referenceMesh)
      throw new Error('Missing referenceMesh')

    const config = context.config
    const referenceMesh = context.referenceMesh

    const referencePlates = this.getReferencePlates(referenceMesh, config)

    const referenceLand = this.candidateLandGenerator.generate(
      referenceMesh,
      referencePlates.regionPlate,
      referencePlates.plateSeeds,
      config.geology.continentCount,
      config.geology.landCoverage,
      config.geology.continentSizeVariety,
      config.core.seed,
    )

    const referenceCrust = this.platePropertiesGenerator.generate(
      referenceMesh,
      referencePlates.regionPlate,
      referencePlates.plateSeeds,
      referenceLand.candidateLandMask,
      config.core.seed,
    )

    const plateAngularVelocity = this.platePhysics.apply(
      referenceMesh,
      referencePlates.regionPlate,
      referencePlates.plateAngularVelocity,
      referenceCrust,
      config.core.seed,
    )

    const adjustedReferencePlates: SphericalPlateData = {
      ...referencePlates,
      plateAngularVelocity,
    }

    context.referencePlates = adjustedReferencePlates
    context.referenceLand = referenceLand
    context.referenceCrust = referenceCrust
    context.plateAngularVelocity = plateAngularVelocity
  }

  private getReferencePlates(
    referenceMesh: SphericalMesh,
    config: WorldConfig,
  ): SphericalPlateData {
    const cacheKey = `${config.core.seed}:${config.core.irregularity}:${Math.floor(config.geology.plateCount)}`
    if (this.plateCacheKey !== cacheKey || !this.referencePlates) {
      this.referencePlates = this.plateGenerator.generate(
        referenceMesh,
        config.geology.plateCount,
        config.core.seed,
      )
      this.plateCacheKey = cacheKey
    }
    return this.referencePlates
  }
}
