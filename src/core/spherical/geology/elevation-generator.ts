import type { GlobeGenParams } from '@/core/spherical/config'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type { SphericalTectonicData } from '@/core/spherical/geology/geology-data'
import alea from 'alea'
import { createNoise3D } from 'simplex-noise'
import { SEA_LEVEL } from '@/constants'
import { PLATE_BOUNDARY } from '@/core/spherical/geology/plate-boundary'
import { MinPriorityQueue } from '@/core/spherical/algorithms/priority-queue'
import {
  computeSphericalDistanceField,
  referenceCellsToAngle,
} from '@/core/spherical/algorithms/distance-field'
import { SphericalGeomorphologyGenerator } from '@/core/spherical/geology/geomorphology-generator'
import { clamp, deterministicUnit } from '@/core/spherical/geometry/spherical-math'
import {
  EDGE_SUBDUCTION_POLARITY,
  SPHERICAL_CRUST_TYPE,
  SPHERICAL_ISLAND_TYPE,
} from '@/core/spherical/geology/geology-data'

const TERRAIN_NOISE_OFFSET = 6203
const BATHYMETRY_NOISE_OFFSET = 6607
const ELEVATION_TIE_BREAK_OFFSET = 6911
const LAND_EPSILON = 1e-4
const MAX_CLIMATE_ELEVATION_METERS = 6000
const MAX_LAND_ELEVATION_METERS = 9000
const MAX_OCEAN_DEPTH_METERS = 9000
const MOUNTAIN_HEIGHT_SCALE_METERS = 18000
const INLAND_SCALE_ANGLE = referenceCellsToAngle(18)
const OCEAN_BASIN_SCALE_ANGLE = referenceCellsToAngle(22)
const MOUNTAIN_WIDTH_ANGLE = referenceCellsToAngle(18)
const RIDGE_WIDTH_ANGLE = referenceCellsToAngle(5)
const TRENCH_WIDTH_ANGLE = referenceCellsToAngle(3)
const RIFT_WIDTH_ANGLE = referenceCellsToAngle(10)
const TRANSFORM_WIDTH_ANGLE = referenceCellsToAngle(6)
const BOUNDARY_DECAY_AT_WIDTH = 3.5
const MAX_INFLUENCE_COST = 14
const OCEAN_BOUNDARY_ONSET_STRESS = 0.08
const OCEAN_BOUNDARY_FULL_STRESS = 0.82
const OCEAN_BOUNDARY_STRESS_EXPONENT = 1.15
const YOUNG_OCEAN_CRUST_DEPTH_METERS = 1050
const OCEAN_THERMAL_SUBSIDENCE_RANGE_METERS = 2450
const RIDGE_AXIS_RELIEF_METERS = 360
const TRENCH_RELIEF_METERS = 2400
const NATURAL_RIDGE_RELIEF_METERS = 140
const NATURAL_TRENCH_RELIEF_METERS = 320

export interface SphericalElevationData {
  /** Authoritative bedrock elevation relative to the generated sea level. */
  physicalElevationMeters: Float32Array
  /** Scale-aware ocean relief used only by the natural terrain palette. */
  naturalBathymetryMeters: Float32Array
  /** Monotonic display and legacy hydrology mapping of physical elevation. */
  renderElevation: Float32Array
  /** Land elevation used by climate; derived from physical elevation. */
  climateElevationMeters: Float32Array
  continentality: Float32Array
  /** Area-balanced land mask derived from the physical terrain field. */
  landMask: Uint8Array
  /** Datum removed from the raw terrain field to place sea level at zero. */
  seaLevelMeters: number
}

interface InfluenceNode {
  region: number
  cost: number
}

interface LandSelection {
  landMask: Uint8Array
  seaLevelMeters: number
}

type BoundarySourceRole = 'both' | 'overriding' | 'subducting'

export class SphericalElevationGenerator {
  private readonly geomorphologyGenerator = new SphericalGeomorphologyGenerator()

  generate(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
    provisionalLandMask: Uint8Array,
    params: GlobeGenParams,
    regionIslandType: Uint8Array,
    regionIslandAge: Float32Array,
  ): SphericalElevationData {
    const provisionalCoastDistance = this.computeCoastDistance(mesh, provisionalLandMask)
    const mountains = this.computeBoundaryInfluence(
      mesh,
      tectonics,
      provisionalLandMask,
      PLATE_BOUNDARY.Convergent,
      true,
      MOUNTAIN_WIDTH_ANGLE,
      'overriding',
    )
    const ridges = this.computeBoundaryInfluence(
      mesh,
      tectonics,
      provisionalLandMask,
      PLATE_BOUNDARY.Divergent,
      false,
      RIDGE_WIDTH_ANGLE,
    )
    const trenches = this.computeBoundaryInfluence(
      mesh,
      tectonics,
      provisionalLandMask,
      PLATE_BOUNDARY.Convergent,
      false,
      TRENCH_WIDTH_ANGLE,
      'subducting',
    )
    const rifts = this.computeBoundaryInfluence(
      mesh,
      tectonics,
      provisionalLandMask,
      PLATE_BOUNDARY.Divergent,
      true,
      RIFT_WIDTH_ANGLE,
    )
    const transformFaults = this.computeBoundaryInfluence(
      mesh,
      tectonics,
      provisionalLandMask,
      PLATE_BOUNDARY.Transform,
      true,
      TRANSFORM_WIDTH_ANGLE,
    )
    const terrainNoise = createNoise3D(alea(params.seed + TERRAIN_NOISE_OFFSET))
    const bathymetryNoise = createNoise3D(alea(params.seed + BATHYMETRY_NOISE_OFFSET))
    const rawPhysicalElevation = new Float64Array(mesh.numRegions)
    const physicalOceanTectonicRelief = new Float32Array(mesh.numRegions)
    const naturalOceanTectonicRelief = new Float32Array(mesh.numRegions)

    for (let region = 0; region < mesh.numRegions; region++) {
      const index = region * 3
      const x = mesh.regionPosition[index]
      const y = mesh.regionPosition[index + 1]
      const z = mesh.regionPosition[index + 2]
      const noise = this.fractalNoise(terrainNoise, x, y, z, 1.75)

      if (provisionalLandMask[region] !== 0) {
        const inland = clamp(
          provisionalCoastDistance[region] / INLAND_SCALE_ANGLE,
          0,
          1,
        )
        const mountain = mountains[region] * params.mountainStrength * 0.3
        const islandType = regionIslandType[region]
        const islandAge = clamp(regionIslandAge[region], 0, 1)
        const islandRelief = this.getIslandRelief(islandType, islandAge, noise)
        const crustalLift = tectonics.regionCrustType[region]
          === SPHERICAL_CRUST_TYPE.Continental
          ? Math.max(0, tectonics.regionCrustThicknessKm[region] - 27) * 24
          : 0
        const islandSubsidence = this.getIslandSubsidence(islandType, islandAge)
        const riftDepression = rifts[region] * (620 + inland * 280)
        const transformRelief = transformFaults[region] * noise * 520
        const inlandElevation = 100 + inland ** 0.68 * 450
        const terrainVariation = noise * params.noiseStrength * (80 + inland * 120)
        rawPhysicalElevation[region] = inlandElevation
          + terrainVariation
          + mountain * MOUNTAIN_HEIGHT_SCALE_METERS
          + islandRelief * this.getIslandClimateReliefScale(islandType)
          + crustalLift
          - islandSubsidence
          - riftDepression
          + transformRelief
      }
      else {
        const deepness = clamp(
          provisionalCoastDistance[region] / OCEAN_BASIN_SCALE_ANGLE,
          0,
          1,
        )
        const basinNoise = this.fractalNoise(bathymetryNoise, x, y, z, 1.3)
        const boundaryVariation = clamp(
          0.82 + this.fractalNoise(bathymetryNoise, x, y, z, 3.2) * 0.42,
          0.58,
          1.06,
        )
        const crustAge = clamp(tectonics.regionCrustAge[region], 0, 1)
        // Young oceanic crust is already submerged. Keeping a base depth here
        // prevents crust age from turning an entire spreading system into one
        // oversized shallow ribbon while retaining basin-scale subsidence.
        const thermalSubsidence = YOUNG_OCEAN_CRUST_DEPTH_METERS
          + Math.sqrt(crustAge) * OCEAN_THERMAL_SUBSIDENCE_RANGE_METERS
        const shelfTransition = this.smoothstep(0.08, 0.62, deepness)
        // A steeper profile confines direct tectonic relief to the axis. The
        // coherent modulation breaks up uniform plate-edge ribbons without
        // adding another mesh traversal or non-deterministic randomness.
        const trenchRelief = trenches[region] ** 1.3
          * TRENCH_RELIEF_METERS
          * boundaryVariation
        const ridgeRelief = ridges[region] ** 1.2
          * RIDGE_AXIS_RELIEF_METERS
          * boundaryVariation
        const baseDepth = 90
          + shelfTransition * deepness ** 0.72 * 900
          + shelfTransition * thermalSubsidence
          + shelfTransition * basinNoise * params.noiseStrength * 460
            * (0.18 + deepness)
        const tectonicRelief = ridgeRelief - trenchRelief
        const naturalVariation = 0.9 + (boundaryVariation - 0.82) * 0.35
        const naturalTrenchRelief = trenches[region] ** 0.68
          * NATURAL_TRENCH_RELIEF_METERS
          * naturalVariation
        const naturalRidgeRelief = ridges[region] ** 0.72
          * NATURAL_RIDGE_RELIEF_METERS
          * naturalVariation
        physicalOceanTectonicRelief[region] = tectonicRelief
        naturalOceanTectonicRelief[region] = naturalRidgeRelief - naturalTrenchRelief
        rawPhysicalElevation[region] = -baseDepth + tectonicRelief
      }

      // Stable sub-centimetre perturbation prevents equal-height cells from
      // making the area-weighted sea-level selection depend on sort stability.
      rawPhysicalElevation[region] += (
        deterministicUnit(params.seed + ELEVATION_TIE_BREAK_OFFSET, region) - 0.5
      ) * 0.01
    }

    const evolvedPhysicalElevation = this.geomorphologyGenerator.evolve(
      mesh,
      rawPhysicalElevation,
      provisionalLandMask,
    )
    const selection = this.selectLandByArea(
      mesh,
      evolvedPhysicalElevation,
      params.landCoverage,
    )
    const finalCoastDistance = this.computeCoastDistance(mesh, selection.landMask)
    const physicalElevationMeters = new Float32Array(mesh.numRegions)
    const naturalBathymetryMeters = new Float32Array(mesh.numRegions)
    const renderElevation = new Float32Array(mesh.numRegions)
    const climateElevationMeters = new Float32Array(mesh.numRegions)
    const continentality = new Float32Array(mesh.numRegions)

    for (let region = 0; region < mesh.numRegions; region++) {
      const physicalElevation = evolvedPhysicalElevation[region]
        - selection.seaLevelMeters
      physicalElevationMeters[region] = physicalElevation
      naturalBathymetryMeters[region] = selection.landMask[region] === 0
        ? physicalElevation
          - physicalOceanTectonicRelief[region]
          + naturalOceanTectonicRelief[region]
        : physicalElevation
      renderElevation[region] = this.mapPhysicalElevationToRender(physicalElevation)
      if (selection.landMask[region] === 0)
        continue
      climateElevationMeters[region] = clamp(
        physicalElevation,
        0,
        MAX_CLIMATE_ELEVATION_METERS,
      )
      const inland = clamp(finalCoastDistance[region] / INLAND_SCALE_ANGLE, 0, 1)
      continentality[region] = this.smoothstep(0.08, 0.82, inland)
    }

    return {
      physicalElevationMeters,
      naturalBathymetryMeters,
      renderElevation,
      climateElevationMeters,
      continentality,
      landMask: selection.landMask,
      seaLevelMeters: selection.seaLevelMeters,
    }
  }

  private selectLandByArea(
    mesh: SphericalMesh,
    elevation: Float64Array,
    requestedCoverage: number,
  ): LandSelection {
    const order = Array.from({ length: mesh.numRegions }, (_, region) => region)
      .sort((a, b) => elevation[b] - elevation[a] || a - b)
    let totalArea = 0
    for (const area of mesh.regionArea)
      totalArea += area
    const targetArea = totalArea * clamp(requestedCoverage, 0.05, 0.85)
    let selectedArea = 0
    let selectedCount = 0

    while (selectedCount < order.length) {
      const nextArea = mesh.regionArea[order[selectedCount]]
      if (
        selectedCount > 0
        && Math.abs(selectedArea - targetArea)
        <= Math.abs(selectedArea + nextArea - targetArea)
      ) {
        break
      }
      selectedArea += nextArea
      selectedCount++
    }

    const landMask = new Uint8Array(mesh.numRegions)
    for (let index = 0; index < selectedCount; index++)
      landMask[order[index]] = 1

    const lowestLand = elevation[order[Math.max(0, selectedCount - 1)]]
    const highestOcean = selectedCount < order.length
      ? elevation[order[selectedCount]]
      : lowestLand - 1
    return {
      landMask,
      seaLevelMeters: (lowestLand + highestOcean) * 0.5,
    }
  }

  private mapPhysicalElevationToRender(physicalElevationMeters: number): number {
    if (physicalElevationMeters >= 0) {
      const normalized = clamp(
        physicalElevationMeters / MAX_LAND_ELEVATION_METERS,
        0,
        1,
      )
      return clamp(
        SEA_LEVEL + LAND_EPSILON
        + normalized ** 0.62 * (1 - SEA_LEVEL - LAND_EPSILON),
        SEA_LEVEL + LAND_EPSILON,
        1,
      )
    }
    const normalizedDepth = clamp(
      -physicalElevationMeters / MAX_OCEAN_DEPTH_METERS,
      0,
      1,
    )
    return clamp(
      SEA_LEVEL * (1 - normalizedDepth ** 0.72),
      0,
      SEA_LEVEL - LAND_EPSILON,
    )
  }

  private getIslandRelief(type: number, age: number, noise: number): number {
    switch (type) {
      case SPHERICAL_ISLAND_TYPE.VolcanicArc:
        return (0.055 + Math.max(0, noise) * 0.025) * (1 - age * 0.38)
      case SPHERICAL_ISLAND_TYPE.HotspotChain:
        return (0.07 + Math.max(0, noise) * 0.035) * (1 - age * 0.78)
      case SPHERICAL_ISLAND_TYPE.ContinentalFragment:
        return 0.018 + Math.max(0, noise) * 0.018
      case SPHERICAL_ISLAND_TYPE.Scattered:
        return 0.012 * (1 - age * 0.55)
      default:
        return 0
    }
  }

  private getIslandClimateReliefScale(type: number): number {
    if (
      type === SPHERICAL_ISLAND_TYPE.VolcanicArc
      || type === SPHERICAL_ISLAND_TYPE.HotspotChain
    ) {
      return 15000
    }
    if (type === SPHERICAL_ISLAND_TYPE.ContinentalFragment)
      return 9000
    return 6000
  }

  private getIslandSubsidence(type: number, age: number): number {
    if (type === SPHERICAL_ISLAND_TYPE.HotspotChain)
      return age ** 1.6 * 1250
    if (type === SPHERICAL_ISLAND_TYPE.VolcanicArc)
      return age ** 1.3 * 180
    if (type === SPHERICAL_ISLAND_TYPE.Scattered)
      return age * 320
    return 0
  }

  private fractalNoise(
    noise3D: (x: number, y: number, z: number) => number,
    x: number,
    y: number,
    z: number,
    frequency: number,
  ): number {
    return noise3D(x * frequency, y * frequency, z * frequency) * 0.58
      + noise3D(x * frequency * 2.15, y * frequency * 2.15, z * frequency * 2.15) * 0.28
      + noise3D(x * frequency * 4.6, y * frequency * 4.6, z * frequency * 4.6) * 0.14
  }

  private smoothstep(edge0: number, edge1: number, value: number): number {
    const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1)
    return amount * amount * (3 - 2 * amount)
  }

  private computeCoastDistance(
    mesh: SphericalMesh,
    landMask: Uint8Array,
  ): Float32Array {
    return computeSphericalDistanceField(
      mesh,
      region => {
        for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
          if (landMask[neighbor] !== landMask[region])
            return true
        }
        return false
      },
      (from, to) => landMask[from] === landMask[to],
    )
  }

  private computeBoundaryInfluence(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
    landMask: Uint8Array,
    boundaryType: number,
    onLand: boolean,
    widthAngle: number,
    sourceRole: BoundarySourceRole = 'both',
  ): Float32Array {
    const sourceStrength = new Float32Array(mesh.numRegions)
    for (let edge = 0; edge < tectonics.edgeBoundaryType.length; edge++) {
      if (tectonics.edgeBoundaryType[edge] !== boundaryType)
        continue
      const edgeIndex = edge * 2
      const regionA = mesh.voronoi.edgeRegions[edgeIndex]
      const regionB = mesh.voronoi.edgeRegions[edgeIndex + 1]
      const baseStrength = this.getBoundarySourceStrength(
        tectonics.edgeStress[edge],
        onLand,
      )
      // Ocean relief uses the coherent segment envelope as source amplitude.
      // In the logarithmic propagation below this also narrows weak sections,
      // without blurring the boundary axis or changing land mountain belts.
      const strength = baseStrength * (onLand
        ? 1
        : tectonics.edgeBoundaryActivity[edge] ** 1.15)
      if (strength <= 0)
        continue
      if (
        this.isBoundarySourceSide(tectonics, edge, true, sourceRole)
        && (landMask[regionA] !== 0) === onLand
      ) {
        sourceStrength[regionA] = Math.max(sourceStrength[regionA], strength)
      }
      if (
        this.isBoundarySourceSide(tectonics, edge, false, sourceRole)
        && (landMask[regionB] !== 0) === onLand
      ) {
        sourceStrength[regionB] = Math.max(sourceStrength[regionB], strength)
      }
    }

    const bestCost = new Float64Array(mesh.numRegions).fill(Infinity)
    const queue = new MinPriorityQueue<InfluenceNode>()
    for (let region = 0; region < mesh.numRegions; region++) {
      if (sourceStrength[region] <= 0)
        continue
      const cost = -Math.log(sourceStrength[region])
      bestCost[region] = cost
      queue.push({ region, cost })
    }

    while (queue.size > 0) {
      const current = queue.pop()
      if (current.cost !== bestCost[current.region] || current.cost >= MAX_INFLUENCE_COST)
        continue
      for (const neighbor of mesh.forEachNeighborOfRegion(current.region)) {
        if ((landMask[neighbor] !== 0) !== onLand)
          continue
        const nextCost = current.cost
          + mesh.distanceBetweenRegions(current.region, neighbor)
          / widthAngle
          * BOUNDARY_DECAY_AT_WIDTH
        if (nextCost >= bestCost[neighbor])
          continue
        bestCost[neighbor] = nextCost
        queue.push({ region: neighbor, cost: nextCost })
      }
    }

    const influence = new Float32Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      if (Number.isFinite(bestCost[region]))
        influence[region] = Math.exp(-bestCost[region])
    }
    return influence
  }

  private getBoundarySourceStrength(stress: number, onLand: boolean): number {
    if (onLand)
      return Math.max(0.2, stress)
    const normalizedStress = clamp(
      (stress - OCEAN_BOUNDARY_ONSET_STRESS)
      / (OCEAN_BOUNDARY_FULL_STRESS - OCEAN_BOUNDARY_ONSET_STRESS),
      0,
      1,
    )
    return normalizedStress ** OCEAN_BOUNDARY_STRESS_EXPONENT
  }

  private isBoundarySourceSide(
    tectonics: SphericalTectonicData,
    edge: number,
    regionA: boolean,
    role: BoundarySourceRole,
  ): boolean {
    if (role === 'both')
      return true
    const polarity = tectonics.edgeSubductionPolarity[edge]
    if (polarity === EDGE_SUBDUCTION_POLARITY.None)
      return role === 'overriding'
    const aSubducts = polarity === EDGE_SUBDUCTION_POLARITY.RegionAUnderB
    return role === 'subducting'
      ? regionA === aSubducts
      : regionA !== aSubducts
  }
}
