import type { SphericalTectonicData } from '@/core/geology/geology-data'
import type SphericalMesh from '@/core/mesh/mesh'
import {
  CRUST_TYPE,
  PLATE_BOUNDARY,
  SUBDUCTION_ROLE,
} from '@/core/geology/geology-data'
import {
  computeSphericalDistanceField,
  computeSphericalInfluenceField,
  referenceCellsToAngle,
} from '@/core/math/distance-field'

export interface TectonicSpatialFields {
  coastDistance: Float32Array
  convergentDistance: Float32Array
  divergentDistance: Float32Array
  /** Continental rifts, constrained to a single broad continental plate. */
  riftDistance: Float32Array
  /** Oceanic spreading ridges, constrained to oceanic crust. */
  ridgeDistance: Float32Array
  /** Oceanic transform fracture zones, constrained to oceanic crust. */
  fractureDistance: Float32Array
  overridingDistance: Float32Array
  subductingDistance: Float32Array
  /** Back-arc basins on the overriding side of oceanic subduction. */
  backArcDistance: Float32Array
  /** Ocean distance to an active convergent continental margin. */
  activeMarginDistance: Float32Array
  /** Reference-style seed distances used by the harmonic terrain base. */
  terrainMountainDistance: Float32Array
  terrainOceanDistance: Float32Array
  terrainCoastlineDistance: Float32Array
  convergentInfluence: Float32Array
  divergentInfluence: Float32Array
  transformInfluence: Float32Array
  overridingInfluence: Float32Array
  subductingInfluence: Float32Array
  /** Fine/super-plate blended polarity after same-plate propagation. */
  subductionFactor: Float32Array
}

const CONVERGENT_DECAY = referenceCellsToAngle(4)
const DIVERGENT_DECAY = referenceCellsToAngle(2.5)
const TRANSFORM_DECAY = referenceCellsToAngle(1.5)
const OVERRIDING_DECAY = referenceCellsToAngle(4.5)
const SUBDUCTING_DECAY = referenceCellsToAngle(1.8)

/** Builds the read-only geodesic fields consumed by elevation stages. */
export class TectonicSpatialFieldGenerator {
  generate(
    mesh: SphericalMesh,
    candidateLandMask: Uint8Array,
    tectonics: SphericalTectonicData,
  ): TectonicSpatialFields {
    const distanceToLand = computeSphericalDistanceField(
      mesh,
      region => candidateLandMask[region] === 1,
    )
    const distanceToOcean = computeSphericalDistanceField(
      mesh,
      region => candidateLandMask[region] === 0,
    )
    const coastDistance = new Float32Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      coastDistance[region] = candidateLandMask[region] === 1
        ? distanceToOcean[region]
        : distanceToLand[region]
    }

    const convergentDistance = computeSphericalDistanceField(
      mesh,
      region => tectonics.regionBoundaryType[region] === PLATE_BOUNDARY.Convergent,
    )
    const divergentDistance = computeSphericalDistanceField(
      mesh,
      region => tectonics.regionBoundaryType[region] === PLATE_BOUNDARY.Divergent,
      () => true,
      referenceCellsToAngle(12),
    )
    const samePlate = (from: number, to: number) => (
      tectonics.regionPrimaryPlate[from] === tectonics.regionPrimaryPlate[to]
    )
    const isOcean = (region: number) => candidateLandMask[region] === 0
    const hasNeighbor = (region: number, predicate: (neighbor: number) => boolean) => {
      const nStart = mesh.neighborOffsets[region]
      const nEnd = mesh.neighborOffsets[region + 1]
      for (let n = nStart; n < nEnd; n++) {
        const neighbor = mesh.neighbors[n]
        if (predicate(neighbor))
          return true
      }
      return false
    }
    const isContinentalRift = (region: number) => (
      tectonics.regionBoundaryType[region] === PLATE_BOUNDARY.Divergent
      && !isOcean(region)
      && !hasNeighbor(region, isOcean)
    )
    const isOceanicRidge = (region: number) => (
      tectonics.regionBoundaryType[region] === PLATE_BOUNDARY.Divergent
      && isOcean(region)
      && hasNeighbor(region, neighbor => (
        isOcean(neighbor)
        && tectonics.regionBoundaryType[neighbor] === PLATE_BOUNDARY.Divergent
      ))
    )
    const isOceanicTransform = (region: number) => (
      tectonics.regionBoundaryType[region] === PLATE_BOUNDARY.Transform
      && isOcean(region)
      && hasNeighbor(region, neighbor => (
        isOcean(neighbor)
        && tectonics.regionBoundaryType[neighbor] === PLATE_BOUNDARY.Transform
      ))
    )
    const isBackArcSource = (region: number) => (
      tectonics.regionBoundaryType[region] === PLATE_BOUNDARY.Convergent
      && tectonics.regionSubductionRole[region] === SUBDUCTION_ROLE.Overriding
      && hasNeighbor(region, isOcean)
    )
    const isActiveMarginSource = (region: number) => (
      isOcean(region)
      && hasNeighbor(region, neighbor => (
        !isOcean(neighbor)
        && tectonics.regionBoundaryType[neighbor] === PLATE_BOUNDARY.Convergent
      ))
    )
    const samePrimaryLand = (from: number, to: number) => (
      samePlate(from, to) && !isOcean(to)
    )
    const samePrimaryOcean = (from: number, to: number) => (
      samePlate(from, to) && isOcean(to)
    )
    const overridingDistance = computeSphericalDistanceField(
      mesh,
      region => tectonics.regionSubductionRole[region] === SUBDUCTION_ROLE.Overriding,
      samePlate,
      referenceCellsToAngle(10),
    )
    const riftDistance = computeSphericalDistanceField(
      mesh,
      isContinentalRift,
      samePrimaryLand,
      referenceCellsToAngle(6.5),
    )
    const ridgeDistance = computeSphericalDistanceField(
      mesh,
      isOceanicRidge,
      samePrimaryOcean,
      referenceCellsToAngle(3.5),
    )
    const fractureDistance = computeSphericalDistanceField(
      mesh,
      isOceanicTransform,
      samePrimaryOcean,
      referenceCellsToAngle(3),
    )
    const backArcDistance = computeSphericalDistanceField(
      mesh,
      isBackArcSource,
      samePrimaryLand,
      referenceCellsToAngle(13),
    )
    const activeMarginDistance = computeSphericalDistanceField(
      mesh,
      isActiveMarginSource,
      (_, to) => isOcean(to),
      referenceCellsToAngle(6),
    )
    const subductingDistance = computeSphericalDistanceField(
      mesh,
      region => tectonics.regionSubductionRole[region] === SUBDUCTION_ROLE.Subducting,
      samePlate,
      referenceCellsToAngle(10),
    )
    const isTerrainMountainSource = (region: number) => (
      tectonics.regionBoundaryType[region] === PLATE_BOUNDARY.Convergent
      && tectonics.regionSubductionRole[region] !== SUBDUCTION_ROLE.Subducting
    )
    const isTerrainOceanSource = (region: number) => (
      tectonics.regionBoundaryType[region] === PLATE_BOUNDARY.Divergent
      && tectonics.regionCrustType[region] === CRUST_TYPE.Oceanic
    )
    const isTerrainCoastlineSource = (region: number) => (
      tectonics.regionBoundaryType[region] !== PLATE_BOUNDARY.None
      && !isTerrainMountainSource(region)
      && !isTerrainOceanSource(region)
    )
    const terrainMountainDistance = computeSphericalDistanceField(
      mesh,
      isTerrainMountainSource,
    )
    const terrainOceanDistance = computeSphericalDistanceField(
      mesh,
      isTerrainOceanSource,
    )
    const terrainCoastlineDistance = computeSphericalDistanceField(
      mesh,
      isTerrainCoastlineSource,
    )

    const maximumCompression = this.maximum(tectonics.regionCompression)
    const maximumExtension = this.maximum(tectonics.regionExtension)
    const maximumShear = this.maximum(tectonics.regionShear)
    const compression = (region: number) => maximumCompression > 0
      ? tectonics.regionCompression[region] / maximumCompression
      : 0
    const extension = (region: number) => maximumExtension > 0
      ? tectonics.regionExtension[region] / maximumExtension
      : 0
    const shear = (region: number) => maximumShear > 0
      ? tectonics.regionShear[region] / maximumShear
      : 0

    const convergentInfluence = computeSphericalInfluenceField(
      mesh,
      region => tectonics.regionBoundaryType[region] === PLATE_BOUNDARY.Convergent
        ? compression(region)
        : 0,
      CONVERGENT_DECAY,
    )
    const divergentInfluence = computeSphericalInfluenceField(
      mesh,
      region => tectonics.regionBoundaryType[region] === PLATE_BOUNDARY.Divergent
        ? extension(region)
        : 0,
      DIVERGENT_DECAY,
    )
    const transformInfluence = computeSphericalInfluenceField(
      mesh,
      region => tectonics.regionBoundaryType[region] === PLATE_BOUNDARY.Transform
        ? shear(region)
        : 0,
      TRANSFORM_DECAY,
    )
    const overridingInfluence = computeSphericalInfluenceField(
      mesh,
      region => tectonics.regionSubductionRole[region] === SUBDUCTION_ROLE.Overriding
        ? compression(region)
        : 0,
      OVERRIDING_DECAY,
      samePlate,
    )
    const subductingInfluence = computeSphericalInfluenceField(
      mesh,
      region => tectonics.regionSubductionRole[region] === SUBDUCTION_ROLE.Subducting
        ? compression(region)
        : 0,
      SUBDUCTING_DECAY,
      samePlate,
    )
    const subductionFactor = new Float32Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      const propagated = subductingInfluence[region] >= overridingInfluence[region]
        ? 0.5 + subductingInfluence[region] * 0.5
        : 0.5 - overridingInfluence[region] * 0.5
      const localPolarity = Math.abs(tectonics.regionSubductionFactor[region] - 0.5) * 2
      const localWeight = Math.max(
        subductingInfluence[region],
        overridingInfluence[region],
        localPolarity,
      )
      subductionFactor[region] = propagated * (1 - localWeight)
        + tectonics.regionSubductionFactor[region] * localWeight
    }

    return {
      coastDistance,
      convergentDistance,
      divergentDistance,
      riftDistance,
      ridgeDistance,
      fractureDistance,
      overridingDistance,
      subductingDistance,
      backArcDistance,
      activeMarginDistance,
      terrainMountainDistance,
      terrainOceanDistance,
      terrainCoastlineDistance,
      convergentInfluence,
      divergentInfluence,
      transformInfluence,
      overridingInfluence,
      subductingInfluence,
      subductionFactor,
    }
  }

  private maximum(values: Float32Array): number {
    let maximum = 0
    for (const value of values)
      maximum = Math.max(maximum, value)
    return maximum
  }
}
