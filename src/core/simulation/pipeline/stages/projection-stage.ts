import type { ISimulationStage, SimulationContext } from '../types'
import type { SphericalBoundaryData, SphericalCrustData } from '@/core/geology/geology-data'
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
    const regionPlate = new Int16Array(mesh.numRegions)
    const regionSuperPlate = new Int16Array(mesh.numRegions)

    for (let region = 0; region < mesh.numRegions; region++) {
      const referenceRegion = outputToReference[region]
      candidateLandMask[region] = referenceLand.candidateLandMask[referenceRegion]
      continentId[region] = referenceLand.continentId[referenceRegion]
      regionPlate[region] = referencePlates.regionPlate[referenceRegion]
      regionSuperPlate[region] = referenceSuperPlates
        ? referenceSuperPlates.regionPlate[referenceRegion]
        : regionPlate[region]
    }

    const crust = this.projectCrust(referenceCrust, outputToReference)

    const fineBoundaries = this.boundaryAnalyzer.analyze(
      mesh,
      regionPlate,
      plateAngularVelocity,
      crust,
    )

    let boundaries = fineBoundaries
    if (referenceSuperPlates) {
      const superCrust = this.projectCrust(referenceSuperPlates.crust, outputToReference)
      const superBoundaries = this.boundaryAnalyzer.analyze(
        mesh,
        regionSuperPlate,
        referenceSuperPlates.plateAngularVelocity,
        superCrust,
      )
      boundaries = this.combineBoundaryLayers(fineBoundaries, superBoundaries)
    }

    context.candidateLandMask = candidateLandMask
    context.continentId = continentId
    context.regionPlate = regionPlate
    context.regionSuperPlate = regionSuperPlate
    context.crust = crust
    context.fineBoundaries = fineBoundaries
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

  private combineBoundaryLayers(
    fine: SphericalBoundaryData,
    broad: SphericalBoundaryData,
  ): SphericalBoundaryData {
    const smallWeight = 0.58
    const superWeight = 0.88
    const edgeStress = new Float32Array(broad.edgeStress.length)
    const regionStress = new Float32Array(broad.regionStress.length)
    const regionCompression = new Float32Array(broad.regionCompression.length)
    const regionExtension = new Float32Array(broad.regionExtension.length)
    const regionShear = new Float32Array(broad.regionShear.length)
    const regionStressDirection = new Float32Array(broad.regionStressDirection.length)
    const regionSubductionFactor = new Float32Array(broad.regionSubductionFactor.length)
    for (let edge = 0; edge < edgeStress.length; edge++) {
      edgeStress[edge] = smallWeight * fine.edgeStress[edge]
        + superWeight * broad.edgeStress[edge]
    }
    for (let region = 0; region < regionStress.length; region++) {
      const fineStress = smallWeight * fine.regionStress[region]
      const broadStress = superWeight * broad.regionStress[region]
      regionStress[region] = fineStress + broadStress
      regionCompression[region] = smallWeight * fine.regionCompression[region]
        + superWeight * broad.regionCompression[region]
      regionExtension[region] = smallWeight * fine.regionExtension[region]
        + superWeight * broad.regionExtension[region]
      regionShear[region] = smallWeight * fine.regionShear[region]
        + superWeight * broad.regionShear[region]
      const index = region * 3
      let x = fine.regionStressDirection[index] * fineStress
        + broad.regionStressDirection[index] * broadStress
      let y = fine.regionStressDirection[index + 1] * fineStress
        + broad.regionStressDirection[index + 1] * broadStress
      let z = fine.regionStressDirection[index + 2] * fineStress
        + broad.regionStressDirection[index + 2] * broadStress
      const length = Math.hypot(x, y, z)
      if (length > 1e-10) {
        x /= length
        y /= length
        z /= length
      }
      regionStressDirection[index] = x
      regionStressDirection[index + 1] = y
      regionStressDirection[index + 2] = z
      regionSubductionFactor[region] = (
        fine.regionSubductionFactor[region] * smallWeight
        + broad.regionSubductionFactor[region] * superWeight
      ) / (smallWeight + superWeight)
    }
    return {
      edgeBoundaryType: broad.edgeBoundaryType,
      edgeNormalVelocity: broad.edgeNormalVelocity,
      edgeShearVelocity: broad.edgeShearVelocity,
      edgeStress,
      regionBoundaryType: broad.regionBoundaryType,
      regionStress,
      regionCompression,
      regionExtension,
      regionShear,
      regionStressDirection,
      edgeSubductingPlate: broad.edgeSubductingPlate,
      edgeOverridingPlate: broad.edgeOverridingPlate,
      regionSubductionRole: broad.regionSubductionRole,
      regionSubductionFactor,
    }
  }
}
