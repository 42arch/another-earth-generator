import type { ISimulationStage, SimulationContext } from '@/core/simulation/pipeline/types'
import { CandidateLandGenerator } from '@/core/geography/candidate-land-generator'
import { PlatePropertiesGenerator } from '@/core/geology/plate-properties-generator'
import { SuperPlateGenerator } from '@/core/geology/super-plate-generator'

export class ContinentalCrustStage implements ISimulationStage {
  name = 'ContinentalCrust'

  private readonly candidateLandGenerator = new CandidateLandGenerator()
  private readonly platePropertiesGenerator = new PlatePropertiesGenerator()
  private readonly superPlateGenerator = new SuperPlateGenerator()

  execute(context: SimulationContext): void {
    const { referenceMesh, referencePlates, referencePlateTopology, config } = context
    if (!referenceMesh || !referencePlates || !referencePlateTopology)
      throw new Error('Missing plate topology in ContinentalCrustStage')

    const referenceLand = this.candidateLandGenerator.generate(
      referenceMesh,
      referencePlates.regionPlate,
      referencePlates.plateSeeds,
      config.geology.continentCount,
      config.geology.landCoverage,
      config.geology.continentSizeVariety,
      config.core.seed,
      referencePlateTopology.plateToSuper,
    )
    const referenceCrust = this.platePropertiesGenerator.generate(
      referenceMesh,
      referencePlates.regionPlate,
      referencePlates.plateSeeds,
      referenceLand.candidateLandMask,
      config.core.seed,
    )

    context.referenceLand = referenceLand
    context.referenceCrust = referenceCrust
    context.referenceSuperPlates = this.superPlateGenerator.attachCrust(
      referenceMesh,
      referencePlates,
      referencePlateTopology,
      referenceCrust,
    )
  }
}
