import type { GlobeGenParams } from '@/core/spherical/config'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type { SphericalTectonicData } from '@/core/spherical/geology/geology-data'
import alea from 'alea'
import { createNoise3D } from 'simplex-noise'
import { PLATE_BOUNDARY } from '@/core/spherical/geology/plate-boundary'
import { MinPriorityQueue } from '@/core/spherical/algorithms/priority-queue'
import {
  computeSphericalDistanceField,
  referenceCellsToAngle,
} from '@/core/spherical/algorithms/distance-field'
import { clamp, deterministicUnit, dot3 } from '@/core/spherical/geometry/spherical-math'
import {
  EDGE_SUBDUCTION_POLARITY,
  SPHERICAL_CRUST_TYPE,
  SPHERICAL_ISLAND_TYPE,
} from '@/core/spherical/geology/geology-data'

const PLATE_SEED_OFFSET = 1103
const PLATE_SIZE_OFFSET = 1709
const PLATE_GROWTH_OFFSET = 2207
const PLATE_GROWTH_NOISE_OFFSET = 3301
const PLATE_MOTION_OFFSET = 5101
const CRUST_STRUCTURE_OFFSET = 5701
const BOUNDARY_ACTIVITY_OFFSET = 5903
const BOUNDARY_THRESHOLD = 0.08
const BOUNDARY_ENTER_THRESHOLD = 0.12
const BOUNDARY_EXIT_THRESHOLD = 0.05
const BOUNDARY_SMOOTHING_PASSES = 2
const MIN_BOUNDARY_RUN_ANGLE = referenceCellsToAngle(4)
const MAX_OCEAN_CRUST_AGE_ANGLE = 0.78
const CONTINENTAL_INTERIOR_SCALE_ANGLE = 0.34
const PLATE_GROWTH_NOISE_FREQUENCY = 2.4

interface PlateFrontierNode {
  region: number
  plate: number
  cost: number
}

interface BoundaryDistanceNode {
  edge: number
  cost: number
}

interface PlateGrowthProfile {
  growthRate: Float32Array
  anisotropy: Float32Array
  preferredPole: Float32Array
  noiseOffset: Float32Array
}

interface BoundaryTopology {
  edgePairSegment: Int32Array
  edgeNeighbors: Map<number, number[]>
  pairSegments: number[][]
}

export class SphericalPlateGenerator {
  generate(mesh: SphericalMesh, params: GlobeGenParams): SphericalTectonicData {
    const plateCount = Math.max(1, Math.min(Math.round(params.plateCount), mesh.numRegions))
    const sizeVariety = clamp(params.sizeVariety, 0, 1)
    const plateSeeds = this.pickSeeds(
      mesh,
      plateCount,
      alea(params.seed + PLATE_SEED_OFFSET),
      sizeVariety,
    )
    const growthProfile = this.createGrowthProfile(
      plateCount,
      sizeVariety,
      alea(params.seed + PLATE_SIZE_OFFSET),
    )
    const regionPlate = this.growPlates(
      mesh,
      plateSeeds,
      params.seed + PLATE_GROWTH_OFFSET,
      growthProfile,
    )
    const geometry = this.measurePlates(mesh, regionPlate, plateCount)
    const plateAngularVelocity = this.createPlateMotions(
      geometry.centroid,
      alea(params.seed + PLATE_MOTION_OFFSET),
    )
    const boundary = this.classifyBoundaries(
      mesh,
      regionPlate,
      plateAngularVelocity,
      params.seed,
    )

    return {
      regionPlate,
      plateSeeds,
      plateArea: geometry.area,
      plateCentroid: geometry.centroid,
      plateContinentalFraction: new Float32Array(plateCount),
      plateAngularVelocity,
      edgeBoundaryType: boundary.edgeType,
      edgeBoundarySegment: boundary.edgeSegment,
      edgeBoundaryActivity: boundary.edgeActivity,
      edgeNormalVelocity: boundary.edgeNormalVelocity,
      edgeShearVelocity: boundary.edgeShearVelocity,
      edgeStress: boundary.edgeStress,
      edgeSubductionPolarity: new Int8Array(boundary.edgeType.length),
      regionCrustType: new Uint8Array(mesh.numRegions),
      regionCrustAge: new Float32Array(mesh.numRegions),
      regionCrustThicknessKm: new Float32Array(mesh.numRegions),
      regionBoundaryType: boundary.regionType,
      regionStress: boundary.regionStress,
    }
  }

  enrichCrust(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
    continentalCrustMask: Uint8Array,
    seed: number,
  ): void {
    const ridgeSource = new Uint8Array(mesh.numRegions)
    for (let edge = 0; edge < tectonics.edgeBoundaryType.length; edge++) {
      if (tectonics.edgeBoundaryType[edge] !== PLATE_BOUNDARY.Divergent)
        continue
      const index = edge * 2
      const regionA = mesh.voronoi.edgeRegions[index]
      const regionB = mesh.voronoi.edgeRegions[index + 1]
      if (continentalCrustMask[regionA] === 0)
        ridgeSource[regionA] = 1
      if (continentalCrustMask[regionB] === 0)
        ridgeSource[regionB] = 1
    }
    const ridgeDistance = computeSphericalDistanceField(
      mesh,
      region => ridgeSource[region] !== 0,
      (_from, to) => continentalCrustMask[to] === 0,
    )
    const oceanDistance = computeSphericalDistanceField(
      mesh,
      region => continentalCrustMask[region] === 0,
      (_from, to) => continentalCrustMask[to] !== 0,
    )
    tectonics.plateContinentalFraction.fill(0)

    for (let region = 0; region < mesh.numRegions; region++) {
      const plate = tectonics.regionPlate[region]
      if (continentalCrustMask[region] !== 0) {
        tectonics.regionCrustType[region] = SPHERICAL_CRUST_TYPE.Continental
        const plateAge = deterministicUnit(
          seed + CRUST_STRUCTURE_OFFSET,
          plate,
        )
        tectonics.regionCrustAge[region] = clamp(
          0.58 + plateAge * 0.3
          + (deterministicUnit(seed + CRUST_STRUCTURE_OFFSET + 1, region) - 0.5) * 0.08,
          0,
          1,
        )
        const interior = clamp(
          oceanDistance[region] / CONTINENTAL_INTERIOR_SCALE_ANGLE,
          0,
          1,
        )
        tectonics.regionCrustThicknessKm[region] = 28
          + interior ** 0.7 * 13
          + (plateAge - 0.5) * 3
        tectonics.plateContinentalFraction[plate] += mesh.regionArea[region]
      }
      else {
        tectonics.regionCrustType[region] = SPHERICAL_CRUST_TYPE.Oceanic
        const age = Number.isFinite(ridgeDistance[region])
          ? clamp(ridgeDistance[region] / MAX_OCEAN_CRUST_AGE_ANGLE, 0, 1)
          : 0.72 + deterministicUnit(seed + CRUST_STRUCTURE_OFFSET + 2, plate) * 0.2
        tectonics.regionCrustAge[region] = age
        tectonics.regionCrustThicknessKm[region] = 6.2 + age * 1.4
      }
    }

    for (let plate = 0; plate < tectonics.plateArea.length; plate++) {
      tectonics.plateContinentalFraction[plate] /= Math.max(
        Number.EPSILON,
        tectonics.plateArea[plate],
      )
    }
    this.classifySubduction(mesh, tectonics)
  }

  promoteContinentalFragments(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
    regionIslandType: Uint8Array,
    regionIslandAge: Float32Array,
    seed: number,
  ): void {
    let changed = false
    for (let region = 0; region < mesh.numRegions; region++) {
      if (regionIslandType[region] !== SPHERICAL_ISLAND_TYPE.ContinentalFragment)
        continue
      changed = true
      const age = clamp(regionIslandAge[region], 0, 1)
      tectonics.regionCrustType[region] = SPHERICAL_CRUST_TYPE.Continental
      tectonics.regionCrustAge[region] = Math.max(0.45, age)
      tectonics.regionCrustThicknessKm[region] = 27.5
        + age * 7.5
        + deterministicUnit(seed + CRUST_STRUCTURE_OFFSET + 3, region) * 2.5
    }
    if (!changed)
      return

    tectonics.plateContinentalFraction.fill(0)
    for (let region = 0; region < mesh.numRegions; region++) {
      if (tectonics.regionCrustType[region] !== SPHERICAL_CRUST_TYPE.Continental)
        continue
      tectonics.plateContinentalFraction[tectonics.regionPlate[region]]
        += mesh.regionArea[region]
    }
    for (let plate = 0; plate < tectonics.plateArea.length; plate++) {
      tectonics.plateContinentalFraction[plate] /= Math.max(
        Number.EPSILON,
        tectonics.plateArea[plate],
      )
    }
    this.classifySubduction(mesh, tectonics)
  }

  private classifySubduction(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
  ): void {
    tectonics.edgeSubductionPolarity.fill(EDGE_SUBDUCTION_POLARITY.None)
    const segmentEdges = new Map<number, number[]>()
    for (let edge = 0; edge < tectonics.edgeBoundaryType.length; edge++) {
      if (tectonics.edgeBoundaryType[edge] !== PLATE_BOUNDARY.Convergent)
        continue
      const segment = tectonics.edgeBoundarySegment[edge]
      if (segment < 0)
        continue
      const edges = segmentEdges.get(segment)
      if (edges)
        edges.push(edge)
      else
        segmentEdges.set(segment, [edge])
    }

    for (const edges of segmentEdges.values()) {
      const subductingPlate = this.chooseSubductingPlate(mesh, tectonics, edges)
      if (subductingPlate < 0)
        continue
      for (const edge of edges) {
        const index = edge * 2
        const regionA = mesh.voronoi.edgeRegions[index]
        const regionB = mesh.voronoi.edgeRegions[index + 1]
        if (
          tectonics.regionPlate[regionA] === subductingPlate
          && tectonics.regionCrustType[regionA] === SPHERICAL_CRUST_TYPE.Oceanic
        ) {
          tectonics.edgeSubductionPolarity[edge]
            = EDGE_SUBDUCTION_POLARITY.RegionAUnderB
        }
        else if (
          tectonics.regionPlate[regionB] === subductingPlate
          && tectonics.regionCrustType[regionB] === SPHERICAL_CRUST_TYPE.Oceanic
        ) {
          tectonics.edgeSubductionPolarity[edge]
            = EDGE_SUBDUCTION_POLARITY.RegionBUnderA
        }
      }
    }
  }

  private chooseSubductingPlate(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
    edges: number[],
  ): number {
    const firstIndex = edges[0] * 2
    const firstRegionA = mesh.voronoi.edgeRegions[firstIndex]
    const firstRegionB = mesh.voronoi.edgeRegions[firstIndex + 1]
    const plateA = tectonics.regionPlate[firstRegionA]
    const plateB = tectonics.regionPlate[firstRegionB]
    let samplesA = 0
    let samplesB = 0
    let oceanSamplesA = 0
    let oceanSamplesB = 0
    let oceanAgeA = 0
    let oceanAgeB = 0

    for (const edge of edges) {
      const index = edge * 2
      const regions = [
        mesh.voronoi.edgeRegions[index],
        mesh.voronoi.edgeRegions[index + 1],
      ]
      for (const region of regions) {
        const plate = tectonics.regionPlate[region]
        const isOceanic
          = tectonics.regionCrustType[region] === SPHERICAL_CRUST_TYPE.Oceanic
        if (plate === plateA) {
          samplesA++
          if (isOceanic) {
            oceanSamplesA++
            oceanAgeA += tectonics.regionCrustAge[region]
          }
        }
        else if (plate === plateB) {
          samplesB++
          if (isOceanic) {
            oceanSamplesB++
            oceanAgeB += tectonics.regionCrustAge[region]
          }
        }
      }
    }

    const oceanFractionA = oceanSamplesA / Math.max(1, samplesA)
    const oceanFractionB = oceanSamplesB / Math.max(1, samplesB)
    if (Math.max(oceanFractionA, oceanFractionB) < 0.35)
      return -1
    if (Math.abs(oceanFractionA - oceanFractionB) > 0.18)
      return oceanFractionA > oceanFractionB ? plateA : plateB

    if (oceanSamplesA > 0 && oceanSamplesB > 0) {
      const meanAgeA = oceanAgeA / oceanSamplesA
      const meanAgeB = oceanAgeB / oceanSamplesB
      if (Math.abs(meanAgeA - meanAgeB) > 0.015)
        return meanAgeA > meanAgeB ? plateA : plateB
    }
    else if (oceanSamplesA !== oceanSamplesB) {
      return oceanSamplesA > 0 ? plateA : plateB
    }

    const continentalA = tectonics.plateContinentalFraction[plateA]
    const continentalB = tectonics.plateContinentalFraction[plateB]
    if (Math.abs(continentalA - continentalB) > 0.01)
      return continentalA < continentalB ? plateA : plateB
    return Math.min(plateA, plateB)
  }

  private pickSeeds(
    mesh: SphericalMesh,
    count: number,
    random: () => number,
    sizeVariety: number,
  ): Int32Array {
    const seeds = new Int32Array(count)
    const selected = new Uint8Array(mesh.numRegions)
    const nearestDot = new Float64Array(mesh.numRegions).fill(-Infinity)
    seeds[0] = Math.floor(random() * mesh.numRegions)
    selected[seeds[0]] = 1
    const majorPlateCount = Math.max(
      1,
      Math.min(
        count,
        Math.round(count * (0.25 + (1 - sizeVariety) * 0.25)),
      ),
    )

    for (let seedIndex = 1; seedIndex < count; seedIndex++) {
      const previousSeed = seeds[seedIndex - 1]
      for (let region = 0; region < mesh.numRegions; region++) {
        nearestDot[region] = Math.max(nearestDot[region], mesh.dotBetweenRegions(region, previousSeed))
      }
      const seed = sizeVariety <= 1e-6 || seedIndex < majorPlateCount
        ? this.pickFarthestSeed(nearestDot, selected, random)
        : this.pickHierarchicalSeed(
            nearestDot,
            selected,
            random,
            seedIndex,
            majorPlateCount,
            count,
            sizeVariety,
          )
      seeds[seedIndex] = seed
      selected[seed] = 1
    }
    return seeds
  }

  private pickFarthestSeed(
    nearestDot: Float64Array,
    selected: Uint8Array,
    random: () => number,
  ): number {
    const candidates: Array<{ region: number, dot: number }> = []
    for (let region = 0; region < nearestDot.length; region++) {
      if (selected[region] !== 0)
        continue
      const candidate = { region, dot: nearestDot[region] }
      let insertAt = candidates.findIndex(item => candidate.dot < item.dot)
      if (insertAt === -1)
        insertAt = candidates.length
      candidates.splice(insertAt, 0, candidate)
      if (candidates.length > 5)
        candidates.pop()
    }
    const candidateIndex = Math.min(
      candidates.length - 1,
      Math.floor(random() * candidates.length),
    )
    return candidates[candidateIndex].region
  }

  private pickHierarchicalSeed(
    nearestDot: Float64Array,
    selected: Uint8Array,
    random: () => number,
    seedIndex: number,
    majorPlateCount: number,
    plateCount: number,
    sizeVariety: number,
  ): number {
    const hierarchyProgress = clamp(
      (seedIndex - majorPlateCount)
      / Math.max(1, plateCount - majorPlateCount - 1),
      0,
      1,
    )
    const distanceExponent = 2.4
      - hierarchyProgress * (0.8 + sizeVariety * 0.9)
    let totalWeight = 0
    for (let region = 0; region < nearestDot.length; region++) {
      if (selected[region] !== 0)
        continue
      totalWeight += Math.max(1e-6, 1 - nearestDot[region]) ** distanceExponent
    }
    let targetWeight = random() * totalWeight
    let fallback = 0
    for (let region = 0; region < nearestDot.length; region++) {
      if (selected[region] !== 0)
        continue
      fallback = region
      targetWeight -= Math.max(1e-6, 1 - nearestDot[region]) ** distanceExponent
      if (targetWeight <= 0)
        return region
    }
    return fallback
  }

  private createGrowthProfile(
    plateCount: number,
    sizeVariety: number,
    random: () => number,
  ): PlateGrowthProfile {
    const rawGrowthRate = new Float64Array(plateCount)
    const growthRate = new Float32Array(plateCount)
    const anisotropy = new Float32Array(plateCount)
    const preferredPole = new Float32Array(plateCount * 3)
    const noiseOffset = new Float32Array(plateCount * 3)
    let meanGrowthRate = 0

    for (let plate = 0; plate < plateCount; plate++) {
      const rank = plateCount <= 1 ? 0.5 : plate / (plateCount - 1)
      const jitter = random() + random() + random() + random() - 2
      const logGrowthRate = sizeVariety
        * ((0.5 - rank) * 1.7 + jitter * 0.25)
      rawGrowthRate[plate] = Math.exp(logGrowthRate)
      meanGrowthRate += rawGrowthRate[plate]
      anisotropy[plate] = 0.06
        + sizeVariety * (0.12 + random() * 0.26)

      const index = plate * 3
      let x = random() * 2 - 1
      let y = random() * 2 - 1
      let z = random() * 2 - 1
      const length = Math.hypot(x, y, z) || 1
      x /= length
      y /= length
      z /= length
      preferredPole[index] = x
      preferredPole[index + 1] = y
      preferredPole[index + 2] = z
      noiseOffset[index] = random() * 18 - 9
      noiseOffset[index + 1] = random() * 18 - 9
      noiseOffset[index + 2] = random() * 18 - 9
    }

    meanGrowthRate /= Math.max(1, plateCount)
    for (let plate = 0; plate < plateCount; plate++) {
      growthRate[plate] = clamp(
        rawGrowthRate[plate] / Math.max(Number.EPSILON, meanGrowthRate),
        0.5,
        1.8,
      )
    }
    return { growthRate, anisotropy, preferredPole, noiseOffset }
  }

  private growPlates(
    mesh: SphericalMesh,
    seeds: Int32Array,
    seed: number,
    profile: PlateGrowthProfile,
  ): Int32Array {
    const bestCost = new Float64Array(mesh.numRegions).fill(Infinity)
    const regionPlate = new Int32Array(mesh.numRegions).fill(-1)
    const candidatePlate = new Int32Array(mesh.numRegions).fill(-1)
    const settled = new Uint8Array(mesh.numRegions)
    const queue = new MinPriorityQueue<PlateFrontierNode>()
    const growthNoise = createNoise3D(alea(seed + PLATE_GROWTH_NOISE_OFFSET))

    for (let plate = 0; plate < seeds.length; plate++) {
      const region = seeds[plate]
      bestCost[region] = 0
      candidatePlate[region] = plate
      queue.push({ region, plate, cost: 0 })
    }

    while (queue.size > 0) {
      const current = queue.pop()
      if (
        settled[current.region] !== 0
        || current.cost !== bestCost[current.region]
        || current.plate !== candidatePlate[current.region]
      )
        continue
      settled[current.region] = 1
      regionPlate[current.region] = current.plate

      for (const neighbor of mesh.forEachNeighborOfRegion(current.region)) {
        if (settled[neighbor] !== 0)
          continue
        const low = Math.min(current.region, neighbor)
        const high = Math.max(current.region, neighbor)
        const regionIndex = current.region * 3
        const neighborIndex = neighbor * 3
        const plateIndex = current.plate * 3
        let mx = mesh.regionPosition[regionIndex] + mesh.regionPosition[neighborIndex]
        let my = mesh.regionPosition[regionIndex + 1] + mesh.regionPosition[neighborIndex + 1]
        let mz = mesh.regionPosition[regionIndex + 2] + mesh.regionPosition[neighborIndex + 2]
        const midpointLength = Math.hypot(mx, my, mz) || 1
        mx /= midpointLength
        my /= midpointLength
        mz /= midpointLength
        const coherentVariation = growthNoise(
          (mx + profile.noiseOffset[plateIndex]) * PLATE_GROWTH_NOISE_FREQUENCY,
          (my + profile.noiseOffset[plateIndex + 1]) * PLATE_GROWTH_NOISE_FREQUENCY,
          (mz + profile.noiseOffset[plateIndex + 2]) * PLATE_GROWTH_NOISE_FREQUENCY,
        ) * 0.24
        const fineVariation = (
          deterministicUnit(seed, low, high, current.plate) - 0.5
        ) * 0.12
        const resistance = clamp(
          1 + coherentVariation + fineVariation,
          0.68,
          1.34,
        )
        const directionalCost = this.getDirectionalGrowthCost(
          mesh,
          current.region,
          neighbor,
          current.plate,
          profile,
        )
        const edgeLength = mesh.distanceBetweenRegions(current.region, neighbor)
        const nextCost = current.cost
          + edgeLength * resistance * directionalCost
          / profile.growthRate[current.plate]
        if (nextCost >= bestCost[neighbor])
          continue
        bestCost[neighbor] = nextCost
        candidatePlate[neighbor] = current.plate
        queue.push({ region: neighbor, plate: current.plate, cost: nextCost })
      }
    }
    return regionPlate
  }

  private getDirectionalGrowthCost(
    mesh: SphericalMesh,
    region: number,
    neighbor: number,
    plate: number,
    profile: PlateGrowthProfile,
  ): number {
    const regionIndex = region * 3
    const neighborIndex = neighbor * 3
    const plateIndex = plate * 3
    const px = mesh.regionPosition[regionIndex]
    const py = mesh.regionPosition[regionIndex + 1]
    const pz = mesh.regionPosition[regionIndex + 2]
    let ex = mesh.regionPosition[neighborIndex] - px
    let ey = mesh.regionPosition[neighborIndex + 1] - py
    let ez = mesh.regionPosition[neighborIndex + 2] - pz
    const radialProjection = ex * px + ey * py + ez * pz
    ex -= px * radialProjection
    ey -= py * radialProjection
    ez -= pz * radialProjection
    const edgeLength = Math.hypot(ex, ey, ez) || 1
    ex /= edgeLength
    ey /= edgeLength
    ez /= edgeLength

    const poleX = profile.preferredPole[plateIndex]
    const poleY = profile.preferredPole[plateIndex + 1]
    const poleZ = profile.preferredPole[plateIndex + 2]
    let tx = py * poleZ - pz * poleY
    let ty = pz * poleX - px * poleZ
    let tz = px * poleY - py * poleX
    const tangentLength = Math.hypot(tx, ty, tz)
    if (tangentLength <= 1e-6)
      return 1
    tx /= tangentLength
    ty /= tangentLength
    tz /= tangentLength
    const alignment = Math.abs(ex * tx + ey * ty + ez * tz)
    return 1 + profile.anisotropy[plate] * (0.55 - alignment)
  }

  private measurePlates(mesh: SphericalMesh, regionPlate: Int32Array, count: number) {
    const area = new Float32Array(count)
    const centroid = new Float32Array(count * 3)
    for (let region = 0; region < mesh.numRegions; region++) {
      const plate = regionPlate[region]
      const regionIndex = region * 3
      const plateIndex = plate * 3
      const weight = mesh.regionArea[region]
      area[plate] += weight
      centroid[plateIndex] += mesh.regionPosition[regionIndex] * weight
      centroid[plateIndex + 1] += mesh.regionPosition[regionIndex + 1] * weight
      centroid[plateIndex + 2] += mesh.regionPosition[regionIndex + 2] * weight
    }
    for (let plate = 0; plate < count; plate++) {
      const index = plate * 3
      const length = Math.hypot(centroid[index], centroid[index + 1], centroid[index + 2]) || 1
      centroid[index] /= length
      centroid[index + 1] /= length
      centroid[index + 2] /= length
    }
    return { area, centroid }
  }

  private createPlateMotions(centroid: Float32Array, random: () => number) {
    const angularVelocity = new Float32Array(centroid.length)
    for (let index = 0; index < centroid.length; index += 3) {
      let x = random() * 2 - 1
      let y = random() * 2 - 1
      let z = random() * 2 - 1
      const projection = dot3(x, y, z, centroid[index], centroid[index + 1], centroid[index + 2])
      x -= centroid[index] * projection
      y -= centroid[index + 1] * projection
      z -= centroid[index + 2] * projection
      let length = Math.hypot(x, y, z)
      if (length < 1e-6) {
        x = -centroid[index + 1]
        y = centroid[index]
        z = 0
        length = Math.hypot(x, y) || 1
      }
      const speed = 0.45 + random() * 0.55
      const vx = x / length * speed
      const vy = y / length * speed
      const vz = z / length * speed

      // Given a desired tangent velocity v at centroid c, c x v is an Euler
      // angular velocity whose local rigid velocity is (c x v) x c = v.
      // A spin component along c keeps that centroid velocity unchanged while
      // avoiding an artificial constraint that every Euler pole is 90° away.
      const spin = (random() * 2 - 1) * speed * 0.65
      const cx = centroid[index]
      const cy = centroid[index + 1]
      const cz = centroid[index + 2]
      angularVelocity[index] = cy * vz - cz * vy + cx * spin
      angularVelocity[index + 1] = cz * vx - cx * vz + cy * spin
      angularVelocity[index + 2] = cx * vy - cy * vx + cz * spin
    }
    return angularVelocity
  }

  private classifyBoundaries(
    mesh: SphericalMesh,
    regionPlate: Int32Array,
    angularVelocity: Float32Array,
    seed: number,
  ) {
    const edgeCount = mesh.voronoi.edgeRegions.length / 2
    const rawNormalVelocity = new Float32Array(edgeCount)
    const rawShearVelocity = new Float32Array(edgeCount)

    for (let edge = 0; edge < edgeCount; edge++) {
      const edgeIndex = edge * 2
      const region = mesh.voronoi.edgeRegions[edgeIndex]
      const neighbor = mesh.voronoi.edgeRegions[edgeIndex + 1]
      if (regionPlate[neighbor] === regionPlate[region])
        continue
      const regionIndex = region * 3
      const neighborIndex = neighbor * 3
      let mx = mesh.regionPosition[regionIndex] + mesh.regionPosition[neighborIndex]
      let my = mesh.regionPosition[regionIndex + 1] + mesh.regionPosition[neighborIndex + 1]
      let mz = mesh.regionPosition[regionIndex + 2] + mesh.regionPosition[neighborIndex + 2]
      const midpointLength = Math.hypot(mx, my, mz) || 1
      mx /= midpointLength
      my /= midpointLength
      mz /= midpointLength

      let nx = mesh.regionPosition[neighborIndex] - mesh.regionPosition[regionIndex]
      let ny = mesh.regionPosition[neighborIndex + 1] - mesh.regionPosition[regionIndex + 1]
      let nz = mesh.regionPosition[neighborIndex + 2] - mesh.regionPosition[regionIndex + 2]
      const normalProjection = dot3(nx, ny, nz, mx, my, mz)
      nx -= mx * normalProjection
      ny -= my * normalProjection
      nz -= mz * normalProjection
      const normalLength = Math.hypot(nx, ny, nz) || 1
      nx /= normalLength
      ny /= normalLength
      nz /= normalLength

      const aIndex = regionPlate[region] * 3
      const bIndex = regionPlate[neighbor] * 3
      const avx = angularVelocity[aIndex + 1] * mz - angularVelocity[aIndex + 2] * my
      const avy = angularVelocity[aIndex + 2] * mx - angularVelocity[aIndex] * mz
      const avz = angularVelocity[aIndex] * my - angularVelocity[aIndex + 1] * mx
      const bvx = angularVelocity[bIndex + 1] * mz - angularVelocity[bIndex + 2] * my
      const bvy = angularVelocity[bIndex + 2] * mx - angularVelocity[bIndex] * mz
      const bvz = angularVelocity[bIndex] * my - angularVelocity[bIndex + 1] * mx
      const rvx = bvx - avx
      const rvy = bvy - avy
      const rvz = bvz - avz
      const normalSpeed = dot3(rvx, rvy, rvz, nx, ny, nz)
      const tangentSpeed = Math.sqrt(Math.max(0, rvx * rvx + rvy * rvy + rvz * rvz - normalSpeed * normalSpeed))

      rawNormalVelocity[edge] = normalSpeed
      rawShearVelocity[edge] = tangentSpeed
    }

    const topology = this.buildBoundaryTopology(mesh, regionPlate)
    const edgeNormalVelocity = this.smoothBoundaryField(
      rawNormalVelocity,
      topology,
      BOUNDARY_SMOOTHING_PASSES,
    )
    const edgeShearVelocity = this.smoothBoundaryField(
      rawShearVelocity,
      topology,
      BOUNDARY_SMOOTHING_PASSES,
    )
    const edgeType = this.classifyBoundarySegments(edgeNormalVelocity, topology)
    this.removeShortBoundaryRuns(mesh, edgeType, topology)
    const edgeSegment = this.buildClassifiedBoundarySegments(edgeType, topology)
    const edgeActivity = this.createBoundaryActivity(
      mesh,
      edgeType,
      edgeSegment,
      topology,
      seed,
    )
    const edgeStress = new Float32Array(edgeCount)
    const regionType = new Uint8Array(mesh.numRegions)
    const regionStress = new Float32Array(mesh.numRegions)

    for (let edge = 0; edge < edgeCount; edge++) {
      const boundaryType = edgeType[edge]
      if (boundaryType === PLATE_BOUNDARY.None)
        continue
      const boundaryStress = boundaryType === PLATE_BOUNDARY.Transform
        ? clamp(edgeShearVelocity[edge], 0, 1)
        : clamp(Math.abs(edgeNormalVelocity[edge]), 0, 1)
      edgeStress[edge] = boundaryStress
      const index = edge * 2
      const regionA = mesh.voronoi.edgeRegions[index]
      const regionB = mesh.voronoi.edgeRegions[index + 1]
      this.assignBoundary(regionA, boundaryType, boundaryStress, regionType, regionStress)
      this.assignBoundary(regionB, boundaryType, boundaryStress, regionType, regionStress)
    }
    return {
      edgeType,
      edgeSegment,
      edgeActivity,
      edgeNormalVelocity,
      edgeShearVelocity,
      edgeStress,
      regionType,
      regionStress,
    }
  }

  private buildBoundaryTopology(
    mesh: SphericalMesh,
    regionPlate: Int32Array,
  ): BoundaryTopology {
    const edgeCount = mesh.voronoi.edgeRegions.length / 2
    const edgePairSegment = new Int32Array(edgeCount).fill(-1)
    const edgesByPlatePair = new Map<string, number[]>()
    const edgeNeighbors = new Map<number, number[]>()

    for (let edge = 0; edge < edgeCount; edge++) {
      const index = edge * 2
      const plateA = regionPlate[mesh.voronoi.edgeRegions[index]]
      const plateB = regionPlate[mesh.voronoi.edgeRegions[index + 1]]
      if (plateA === plateB)
        continue
      const low = Math.min(plateA, plateB)
      const high = Math.max(plateA, plateB)
      const key = `${low}:${high}`
      const edges = edgesByPlatePair.get(key)
      if (edges)
        edges.push(edge)
      else
        edgesByPlatePair.set(key, [edge])
      edgeNeighbors.set(edge, [])
    }

    const pairSegments: number[][] = []
    for (const pairEdges of edgesByPlatePair.values()) {
      const cornerEdges = new Map<number, number[]>()
      for (const edge of pairEdges) {
        const index = edge * 2
        const cornerA = mesh.voronoi.edgeCorners[index]
        const cornerB = mesh.voronoi.edgeCorners[index + 1]
        const atA = cornerEdges.get(cornerA)
        if (atA)
          atA.push(edge)
        else
          cornerEdges.set(cornerA, [edge])
        const atB = cornerEdges.get(cornerB)
        if (atB)
          atB.push(edge)
        else
          cornerEdges.set(cornerB, [edge])
      }

      for (const edgesAtCorner of cornerEdges.values()) {
        for (let a = 0; a < edgesAtCorner.length; a++) {
          for (let b = a + 1; b < edgesAtCorner.length; b++) {
            const edgeA = edgesAtCorner[a]
            const edgeB = edgesAtCorner[b]
            const neighborsA = edgeNeighbors.get(edgeA)!
            const neighborsB = edgeNeighbors.get(edgeB)!
            if (!neighborsA.includes(edgeB))
              neighborsA.push(edgeB)
            if (!neighborsB.includes(edgeA))
              neighborsB.push(edgeA)
          }
        }
      }

      const visited = new Set<number>()
      for (const start of pairEdges) {
        if (visited.has(start))
          continue
        const segmentId = pairSegments.length
        const segment: number[] = []
        const queue = [start]
        visited.add(start)
        while (queue.length > 0) {
          const edge = queue.pop()!
          segment.push(edge)
          edgePairSegment[edge] = segmentId
          for (const neighbor of edgeNeighbors.get(edge)!) {
            if (visited.has(neighbor))
              continue
            visited.add(neighbor)
            queue.push(neighbor)
          }
        }
        pairSegments.push(segment)
      }
    }

    return { edgePairSegment, edgeNeighbors, pairSegments }
  }

  private smoothBoundaryField(
    values: Float32Array,
    topology: BoundaryTopology,
    passes: number,
  ): Float32Array {
    let current = Float32Array.from(values)
    for (let pass = 0; pass < passes; pass++) {
      const next = Float32Array.from(current)
      for (const segment of topology.pairSegments) {
        for (const edge of segment) {
          let weightedValue = current[edge] * 2
          let totalWeight = 2
          for (const neighbor of topology.edgeNeighbors.get(edge)!) {
            weightedValue += current[neighbor]
            totalWeight++
          }
          next[edge] = weightedValue / totalWeight
        }
      }
      current = next
    }
    return current
  }

  private classifyBoundarySegments(
    normalVelocity: Float32Array,
    topology: BoundaryTopology,
  ): Uint8Array {
    const edgeType = new Uint8Array(normalVelocity.length)
    for (const segment of topology.pairSegments) {
      for (const edge of segment)
        edgeType[edge] = PLATE_BOUNDARY.Transform
      this.propagateBoundaryType(
        segment,
        normalVelocity,
        topology,
        edgeType,
        PLATE_BOUNDARY.Convergent,
      )
      this.propagateBoundaryType(
        segment,
        normalVelocity,
        topology,
        edgeType,
        PLATE_BOUNDARY.Divergent,
      )
    }
    return edgeType
  }

  private propagateBoundaryType(
    segment: number[],
    normalVelocity: Float32Array,
    topology: BoundaryTopology,
    edgeType: Uint8Array,
    boundaryType: number,
  ): void {
    const isConvergent = boundaryType === PLATE_BOUNDARY.Convergent
    const seeds = segment.filter(edge => isConvergent
      ? normalVelocity[edge] < -BOUNDARY_ENTER_THRESHOLD
      : normalVelocity[edge] > BOUNDARY_ENTER_THRESHOLD)

    if (seeds.length === 0) {
      let candidate = -1
      let candidateSpeed = isConvergent ? Infinity : -Infinity
      for (const edge of segment) {
        const speed = normalVelocity[edge]
        if (
          (isConvergent && speed < candidateSpeed)
          || (!isConvergent && speed > candidateSpeed)
        ) {
          candidate = edge
          candidateSpeed = speed
        }
      }
      if (
        candidate >= 0
        && (isConvergent
          ? candidateSpeed < -BOUNDARY_THRESHOLD
          : candidateSpeed > BOUNDARY_THRESHOLD)
      ) {
        seeds.push(candidate)
      }
    }

    let cursor = 0
    for (const edge of seeds)
      edgeType[edge] = boundaryType
    while (cursor < seeds.length) {
      const edge = seeds[cursor++]
      for (const neighbor of topology.edgeNeighbors.get(edge)!) {
        if (edgeType[neighbor] !== PLATE_BOUNDARY.Transform)
          continue
        const continues = isConvergent
          ? normalVelocity[neighbor] < -BOUNDARY_EXIT_THRESHOLD
          : normalVelocity[neighbor] > BOUNDARY_EXIT_THRESHOLD
        if (!continues)
          continue
        edgeType[neighbor] = boundaryType
        seeds.push(neighbor)
      }
    }
  }

  private removeShortBoundaryRuns(
    mesh: SphericalMesh,
    edgeType: Uint8Array,
    topology: BoundaryTopology,
  ): void {
    const visited = new Uint8Array(edgeType.length)
    for (const segment of topology.pairSegments) {
      for (const start of segment) {
        if (visited[start] !== 0)
          continue
        visited[start] = 1
        const boundaryType = edgeType[start]
        if (
          boundaryType !== PLATE_BOUNDARY.Convergent
          && boundaryType !== PLATE_BOUNDARY.Divergent
        ) {
          continue
        }

        const run: number[] = []
        const queue = [start]
        let totalLength = 0
        while (queue.length > 0) {
          const edge = queue.pop()!
          run.push(edge)
          totalLength += this.getVoronoiEdgeLength(mesh, edge)
          for (const neighbor of topology.edgeNeighbors.get(edge)!) {
            if (visited[neighbor] !== 0 || edgeType[neighbor] !== boundaryType)
              continue
            visited[neighbor] = 1
            queue.push(neighbor)
          }
        }
        if (run.length >= 2 && totalLength >= MIN_BOUNDARY_RUN_ANGLE)
          continue
        for (const edge of run)
          edgeType[edge] = PLATE_BOUNDARY.Transform
      }
    }
  }

  private getVoronoiEdgeLength(mesh: SphericalMesh, edge: number): number {
    const index = edge * 2
    const cornerA = mesh.voronoi.edgeCorners[index] * 3
    const cornerB = mesh.voronoi.edgeCorners[index + 1] * 3
    return Math.acos(clamp(dot3(
      mesh.voronoi.cornerPosition[cornerA],
      mesh.voronoi.cornerPosition[cornerA + 1],
      mesh.voronoi.cornerPosition[cornerA + 2],
      mesh.voronoi.cornerPosition[cornerB],
      mesh.voronoi.cornerPosition[cornerB + 1],
      mesh.voronoi.cornerPosition[cornerB + 2],
    ), -1, 1))
  }

  private buildClassifiedBoundarySegments(
    edgeType: Uint8Array,
    topology: BoundaryTopology,
  ): Int32Array {
    const edgeSegment = new Int32Array(edgeType.length).fill(-1)
    let segmentId = 0
    for (const pairSegment of topology.pairSegments) {
      for (const start of pairSegment) {
        if (edgeSegment[start] >= 0)
          continue
        const boundaryType = edgeType[start]
        const pairSegmentId = topology.edgePairSegment[start]
        const queue = [start]
        edgeSegment[start] = segmentId
        while (queue.length > 0) {
          const edge = queue.pop()!
          for (const neighbor of topology.edgeNeighbors.get(edge)!) {
            if (
              edgeSegment[neighbor] >= 0
              || topology.edgePairSegment[neighbor] !== pairSegmentId
              || edgeType[neighbor] !== boundaryType
            ) {
              continue
            }
            edgeSegment[neighbor] = segmentId
            queue.push(neighbor)
          }
        }
        segmentId++
      }
    }
    return edgeSegment
  }

  private createBoundaryActivity(
    mesh: SphericalMesh,
    edgeType: Uint8Array,
    edgeSegment: Int32Array,
    topology: BoundaryTopology,
    seed: number,
  ): Float32Array {
    const edgeActivity = new Float32Array(edgeType.length)
    const edgesBySegment = new Map<number, number[]>()
    for (const pairSegment of topology.pairSegments) {
      for (const edge of pairSegment) {
        const segment = edgeSegment[edge]
        const edges = edgesBySegment.get(segment)
        if (edges)
          edges.push(edge)
        else
          edgesBySegment.set(segment, [edge])
      }
    }

    const activityNoise = createNoise3D(alea(seed + BOUNDARY_ACTIVITY_OFFSET))
    for (const [segment, edges] of edgesBySegment) {
      const endpointDistance = this.computeBoundaryEndpointDistance(
        mesh,
        edges,
        edgeSegment,
        topology,
        segment,
      )
      const offsetX = deterministicUnit(
        seed + BOUNDARY_ACTIVITY_OFFSET,
        segment,
        0,
      ) * 14 - 7
      const offsetY = deterministicUnit(
        seed + BOUNDARY_ACTIVITY_OFFSET,
        segment,
        1,
      ) * 14 - 7
      const offsetZ = deterministicUnit(
        seed + BOUNDARY_ACTIVITY_OFFSET,
        segment,
        2,
      ) * 14 - 7
      const segmentStrength = 0.78 + deterministicUnit(
        seed + BOUNDARY_ACTIVITY_OFFSET,
        segment,
        3,
      ) * 0.22
      const boundaryType = edgeType[edges[0]]
      const minimumActivity = boundaryType === PLATE_BOUNDARY.Divergent
        ? 0.34
        : boundaryType === PLATE_BOUNDARY.Convergent
          ? 0.2
          : 0.42

      for (const edge of edges) {
        const index = edge * 2
        const regionA = mesh.voronoi.edgeRegions[index] * 3
        const regionB = mesh.voronoi.edgeRegions[index + 1] * 3
        let mx = mesh.regionPosition[regionA] + mesh.regionPosition[regionB]
        let my = mesh.regionPosition[regionA + 1] + mesh.regionPosition[regionB + 1]
        let mz = mesh.regionPosition[regionA + 2] + mesh.regionPosition[regionB + 2]
        const midpointLength = Math.hypot(mx, my, mz) || 1
        mx /= midpointLength
        my /= midpointLength
        mz /= midpointLength
        const longWave = activityNoise(
          (mx + offsetX) * 2.15,
          (my + offsetY) * 2.15,
          (mz + offsetZ) * 2.15,
        )
        const shortWave = activityNoise(
          (mx + offsetZ * 0.37) * 6.4,
          (my + offsetX * 0.37) * 6.4,
          (mz + offsetY * 0.37) * 6.4,
        )
        const rawEnvelope = clamp(
          0.5 + (longWave * 0.72 + shortWave * 0.28) * 0.62,
          0,
          1,
        )
        const smoothEnvelope = rawEnvelope * rawEnvelope
          * (3 - 2 * rawEnvelope)
        const endpointDistanceAngle = endpointDistance.get(edge)
        let endpointFactor = 1
        if (endpointDistanceAngle !== undefined) {
          const endpointProgress = clamp(
            endpointDistanceAngle / referenceCellsToAngle(4),
            0,
            1,
          )
          const smoothProgress = endpointProgress * endpointProgress
            * (3 - 2 * endpointProgress)
          endpointFactor = 0.55 + smoothProgress * 0.45
        }
        edgeActivity[edge] = clamp(
          segmentStrength
          * (minimumActivity + (1 - minimumActivity) * smoothEnvelope)
          * endpointFactor,
          0.12,
          1,
        )
      }
    }
    return edgeActivity
  }

  private computeBoundaryEndpointDistance(
    mesh: SphericalMesh,
    edges: number[],
    edgeSegment: Int32Array,
    topology: BoundaryTopology,
    segment: number,
  ): Map<number, number> {
    const distance = new Map<number, number>()
    const edgeLength = new Map<number, number>()
    const queue = new MinPriorityQueue<BoundaryDistanceNode>()
    for (const edge of edges) {
      edgeLength.set(edge, this.getVoronoiEdgeLength(mesh, edge))
      let degree = 0
      for (const neighbor of topology.edgeNeighbors.get(edge)!) {
        if (edgeSegment[neighbor] === segment)
          degree++
      }
      if (degree > 1)
        continue
      distance.set(edge, 0)
      queue.push({ edge, cost: 0 })
    }

    while (queue.size > 0) {
      const current = queue.pop()
      if (current.cost !== distance.get(current.edge))
        continue
      for (const neighbor of topology.edgeNeighbors.get(current.edge)!) {
        if (edgeSegment[neighbor] !== segment)
          continue
        const nextDistance = current.cost
          + ((edgeLength.get(current.edge) ?? 0)
            + (edgeLength.get(neighbor) ?? 0)) * 0.5
        if (nextDistance >= (distance.get(neighbor) ?? Infinity))
          continue
        distance.set(neighbor, nextDistance)
        queue.push({ edge: neighbor, cost: nextDistance })
      }
    }
    return distance
  }

  private assignBoundary(
    region: number,
    boundaryType: number,
    boundaryStress: number,
    type: Uint8Array,
    stress: Float32Array,
  ): void {
    if (boundaryStress <= stress[region])
      return
    type[region] = boundaryType
    stress[region] = boundaryStress
  }
}
