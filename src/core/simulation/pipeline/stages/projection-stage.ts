import type { ISimulationStage, SimulationContext } from '../types'
import type { SphericalCrustData } from '@/core/geology/geology-data'
import { SphericalPlateBoundaryAnalyzer } from '@/core/geology/plate-boundary-analyzer'

export class ProjectionStage implements ISimulationStage {
  name = 'DataProjection'

  private readonly boundaryAnalyzer = new SphericalPlateBoundaryAnalyzer()

  execute(context: SimulationContext): void {
    const {
      mesh,
      outputToReference,
      referenceLand,
      referencePlates,
      referenceSuperPlates,
      referenceCrust,
      plateAngularVelocity,
    } = context

    if (!mesh || !outputToReference || !referenceLand || !referencePlates || !referenceCrust || !plateAngularVelocity) {
      throw new Error('Missing dependencies in ProjectionStage')
    }

    const candidateLandMask = new Uint8Array(mesh.numRegions)
    const continentId = new Int16Array(mesh.numRegions).fill(-1)
    const nearestContinentId = new Int16Array(mesh.numRegions).fill(-1)
    const regionPlate = new Int16Array(mesh.numRegions)
    const regionSuperPlate = new Int16Array(mesh.numRegions)

    for (let region = 0; region < mesh.numRegions; region++) {
      const referenceRegion = outputToReference[region]
      candidateLandMask[region] = referenceLand.candidateLandMask[referenceRegion]
      continentId[region] = referenceLand.continentId[referenceRegion]
      nearestContinentId[region] = referenceLand.nearestContinentId[referenceRegion]
      regionPlate[region] = referencePlates.regionPlate[referenceRegion]
      regionSuperPlate[region] = referenceSuperPlates
        ? referenceSuperPlates.regionPlate[referenceRegion]
        : regionPlate[region]
    }

    const crust = this.projectCrust(referenceCrust, outputToReference)

    const boundaryCrust = referenceSuperPlates
      ? this.projectCrust(referenceSuperPlates.crust, outputToReference)
      : crust
    const boundaries = this.boundaryAnalyzer.analyze(
      mesh,
      regionSuperPlate,
      referenceSuperPlates?.plateAngularVelocity ?? plateAngularVelocity,
      boundaryCrust,
    )

    context.candidateLandMask = candidateLandMask
    context.continentId = continentId
    context.nearestContinentId = nearestContinentId
    context.regionPlate = regionPlate
    context.regionSuperPlate = regionSuperPlate
    context.crust = crust
    context.boundaries = boundaries
  }

  private projectCrust(
    reference: SphericalCrustData,
    outputToReference: Uint32Array,
  ): SphericalCrustData {
    const regionCrustType = new Uint8Array(outputToReference.length)
    const regionDensity = new Float32Array(outputToReference.length)
    const regionBaseElevation = new Float32Array(outputToReference.length)
    const regionCrustThickness = new Float32Array(outputToReference.length)
    for (let region = 0; region < outputToReference.length; region++) {
      const source = outputToReference[region]
      regionCrustType[region] = reference.regionCrustType[source]
      regionDensity[region] = reference.regionDensity[source]
      regionBaseElevation[region] = reference.regionBaseElevation[source]
      regionCrustThickness[region] = reference.regionCrustThickness[source]
    }
    return {
      plateCrustType: reference.plateCrustType,
      plateContinentalFraction: reference.plateContinentalFraction,
      plateDensity: reference.plateDensity,
      plateBaseElevation: reference.plateBaseElevation,
      plateCrustThickness: reference.plateCrustThickness,
      regionCrustType,
      regionDensity,
      regionBaseElevation,
      regionCrustThickness,
    }
  }
}
