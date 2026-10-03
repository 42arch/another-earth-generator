import type { SphericalCrustData } from '@/core/geology/geology-data'
import type SphericalMesh from '@/core/mesh/mesh'
import alea from 'alea'
import { CRUST_TYPE } from '@/core/geology/geology-data'

const CONTINENTAL_PLATE_THRESHOLD = 0.35

/**
 * Derives deterministic plate-scale material properties while preserving the
 * candidate-continent mask as the cell-scale crust classification.
 */
export class PlatePropertiesGenerator {
  generate(
    mesh: SphericalMesh,
    regionPlate: Int16Array,
    plateSeeds: Uint32Array,
    candidateLandMask: Uint8Array,
    seed: number,
  ): SphericalCrustData {
    const plateCount = plateSeeds.length
    const plateArea = new Float64Array(plateCount)
    const continentalArea = new Float64Array(plateCount)

    for (let region = 0; region < mesh.numRegions; region++) {
      const plate = regionPlate[region]
      if (plate < 0 || plate >= plateCount)
        continue
      const area = mesh.regionArea[region]
      plateArea[plate] += area
      if (candidateLandMask[region] === 1)
        continentalArea[plate] += area
    }

    const plateCrustType = new Uint8Array(plateCount)
    const plateContinentalFraction = new Float32Array(plateCount)
    const plateDensity = new Float32Array(plateCount)
    const plateBaseElevation = new Float32Array(plateCount)
    const plateCrustThickness = new Float32Array(plateCount)
    const continentalDensity = new Float32Array(plateCount)
    const oceanicDensity = new Float32Array(plateCount)
    const continentalBase = new Float32Array(plateCount)
    const oceanicBase = new Float32Array(plateCount)
    const continentalThickness = new Float32Array(plateCount)
    const oceanicThickness = new Float32Array(plateCount)

    for (let plate = 0; plate < plateCount; plate++) {
      const random = alea(seed + plateSeeds[plate] + 777)
      const fraction = plateArea[plate] > 0
        ? continentalArea[plate] / plateArea[plate]
        : 0
      const type = fraction >= CONTINENTAL_PLATE_THRESHOLD
        ? CRUST_TYPE.Continental
        : CRUST_TYPE.Oceanic

      oceanicDensity[plate] = 3 + random() * 0.5
      continentalDensity[plate] = 2.4 + random() * 0.5
      oceanicBase[plate] = -0.34 + random() * 0.06
      continentalBase[plate] = 0.18 + random() * 0.08
      oceanicThickness[plate] = 7 + random() * 4
      continentalThickness[plate] = 28 + random() * 17

      plateCrustType[plate] = type
      plateContinentalFraction[plate] = fraction
      plateDensity[plate] = type === CRUST_TYPE.Continental
        ? continentalDensity[plate]
        : oceanicDensity[plate]
      plateBaseElevation[plate] = type === CRUST_TYPE.Continental
        ? continentalBase[plate]
        : oceanicBase[plate]
      plateCrustThickness[plate] = type === CRUST_TYPE.Continental
        ? continentalThickness[plate]
        : oceanicThickness[plate]
    }

    const regionCrustType = new Uint8Array(mesh.numRegions)
    const regionDensity = new Float32Array(mesh.numRegions)
    const regionBaseElevation = new Float32Array(mesh.numRegions)
    const regionCrustThickness = new Float32Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      const plate = regionPlate[region]
      const continental = candidateLandMask[region] === 1
      regionCrustType[region] = continental
        ? CRUST_TYPE.Continental
        : CRUST_TYPE.Oceanic
      regionDensity[region] = continental
        ? continentalDensity[plate]
        : oceanicDensity[plate]
      regionBaseElevation[region] = continental
        ? continentalBase[plate]
        : oceanicBase[plate]
      regionCrustThickness[region] = continental
        ? continentalThickness[plate]
        : oceanicThickness[plate]
    }

    return {
      plateCrustType,
      plateContinentalFraction,
      plateDensity,
      plateBaseElevation,
      plateCrustThickness,
      regionCrustType,
      regionDensity,
      regionBaseElevation,
      regionCrustThickness,
    }
  }
}
