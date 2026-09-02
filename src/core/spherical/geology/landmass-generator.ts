import type { GlobeGenParams } from '@/core/spherical/config'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type {
  SphericalIslandTypeCode,
  SphericalTectonicData,
} from '@/core/spherical/geology/geology-data'
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
  SPHERICAL_ISLAND_TYPE,
} from '@/core/spherical/geology/geology-data'

const MAINLAND_SEED_OFFSET = 3203
const MAINLAND_SHAPE_OFFSET = 3461
const MAINLAND_GROWTH_OFFSET = 3701
const ISLAND_SEED_OFFSET = 4109
const ISLAND_GROWTH_OFFSET = 4513

interface ContinentGrowthState {
  seed: number
  frontier: number[]
  queued: Uint8Array
  eastX: number
  eastY: number
  eastZ: number
  northX: number
  northY: number
  northZ: number
  axisX: number
  axisY: number
  aspectRatio: number
  expectedRadius: number
  targetArea: number
  actualArea: number
}

interface IslandFrontierNode {
  region: number
  cost: number
}

interface IslandGroupPlan {
  id: number
  type: SphericalIslandTypeCode
  center: number
  memberCount: number
  axisAngle: number
}

interface IslandSitePlan {
  seed: number
  continent: number
  group: number
  type: SphericalIslandTypeCode
  targetArea: number
  axisAngle: number
  aspectRatio: number
  age: number
}

interface TangentFrame {
  eastX: number
  eastY: number
  eastZ: number
  northX: number
  northY: number
  northZ: number
}

export interface SphericalLandmassData {
  landMask: Uint8Array
  regionContinent: Int16Array
  regionIslandType: Uint8Array
  regionIslandGroup: Int16Array
  regionIslandAge: Float32Array
}

export class SphericalLandmassGenerator {
  generate(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
    params: GlobeGenParams,
    prepareIslandTectonics: (continentalCrustMask: Uint8Array) => void,
  ): SphericalLandmassData {
    const landMask = new Uint8Array(mesh.numRegions)
    const regionContinent = new Int16Array(mesh.numRegions).fill(-1)
    const regionIslandType = new Uint8Array(mesh.numRegions)
    const regionIslandGroup = new Int16Array(mesh.numRegions).fill(-1)
    const regionIslandAge = new Float32Array(mesh.numRegions)
    const totalArea = this.sumArea(mesh.regionArea)
    const targetArea = totalArea * clamp(params.landCoverage, 0.05, 0.85)
    const islandShare = clamp(params.islandLandShare, 0, 0.3)
    const mainlandTarget = targetArea * (1 - islandShare)
    const mainlandCount = Math.max(1, Math.min(Math.round(params.continentCount), mesh.numRegions))
    const random = alea(params.seed + MAINLAND_SEED_OFFSET)
    const targetAreas = this.allocateAreas(
      mainlandCount,
      mainlandTarget,
      params.sizeVariety,
      random,
    )
    const mainlandSeeds = this.pickMainlandSeeds(
      mesh,
      tectonics,
      targetAreas,
      params.spread,
      random,
    )
    const plateAttractor = this.assignPlateAttractors(mesh, tectonics, mainlandSeeds)
    const coastNoise = this.createCoastNoise(mesh, params)
    const landArea = this.growMainlands(
      mesh,
      tectonics,
      mainlandSeeds,
      targetAreas,
      plateAttractor,
      coastNoise,
      params,
      alea(params.seed + MAINLAND_GROWTH_OFFSET),
      landMask,
      regionContinent,
    )
    prepareIslandTectonics(landMask)

    const islandCount = Math.max(0, Math.min(Math.round(params.islandCount), mesh.numRegions))
    if (islandCount > 0 && landArea < targetArea) {
      const islandSites = this.planIslandSites(
        mesh,
        tectonics,
        landMask,
        islandCount,
        targetArea - landArea,
        mainlandCount,
        params,
      )
      this.growIslands(
        mesh,
        tectonics,
        islandSites,
        params.seed + ISLAND_GROWTH_OFFSET,
        landMask,
        regionContinent,
        regionIslandType,
        regionIslandGroup,
        regionIslandAge,
        params,
      )
    }

    return {
      landMask,
      regionContinent,
      regionIslandType,
      regionIslandGroup,
      regionIslandAge,
    }
  }

  reconcileLandMask(
    mesh: SphericalMesh,
    provisional: SphericalLandmassData,
    finalLandMask: Uint8Array,
  ): SphericalLandmassData {
    const landMask = new Uint8Array(finalLandMask)
    const regionContinent = new Int16Array(provisional.regionContinent)
    const regionIslandType = new Uint8Array(provisional.regionIslandType)
    const regionIslandGroup = new Int16Array(provisional.regionIslandGroup)
    const regionIslandAge = new Float32Array(provisional.regionIslandAge)
    const assigned = new Uint8Array(mesh.numRegions)
    const queue = new Int32Array(mesh.numRegions)
    let tail = 0
    let maximumContinent = -1
    let maximumGroup = -1

    for (let region = 0; region < mesh.numRegions; region++) {
      if (provisional.regionContinent[region] > maximumContinent)
        maximumContinent = provisional.regionContinent[region]
      if (provisional.regionIslandGroup[region] > maximumGroup)
        maximumGroup = provisional.regionIslandGroup[region]
      if (landMask[region] === 0) {
        regionContinent[region] = -1
        regionIslandType[region] = SPHERICAL_ISLAND_TYPE.None
        regionIslandGroup[region] = -1
        regionIslandAge[region] = 0
        continue
      }
      if (
        provisional.landMask[region] !== 0
        && regionContinent[region] >= 0
      ) {
        assigned[region] = 1
        queue[tail++] = region
      }
    }

    // Newly exposed coastal cells inherit geological metadata only through
    // connected final land, so ownership never jumps across an ocean basin.
    for (let head = 0; head < tail; head++) {
      const region = queue[head]
      for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
        if (landMask[neighbor] === 0 || assigned[neighbor] !== 0)
          continue
        assigned[neighbor] = 1
        regionContinent[neighbor] = regionContinent[region]
        regionIslandType[neighbor] = regionIslandType[region]
        regionIslandGroup[neighbor] = regionIslandGroup[region]
        regionIslandAge[neighbor] = regionIslandAge[region]
        queue[tail++] = neighbor
      }
    }

    // A completely new emergent component has no surviving provisional seed.
    // Preserve it as a separate scattered island group rather than attaching
    // it to a continent across open water.
    for (let start = 0; start < mesh.numRegions; start++) {
      if (landMask[start] === 0 || assigned[start] !== 0)
        continue
      const continent = ++maximumContinent
      const group = ++maximumGroup
      let head = tail
      assigned[start] = 1
      queue[tail++] = start
      while (head < tail) {
        const region = queue[head++]
        regionContinent[region] = continent
        regionIslandType[region] = SPHERICAL_ISLAND_TYPE.Scattered
        regionIslandGroup[region] = group
        regionIslandAge[region] = 0
        for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
          if (landMask[neighbor] === 0 || assigned[neighbor] !== 0)
            continue
          assigned[neighbor] = 1
          queue[tail++] = neighbor
        }
      }
    }

    return {
      landMask,
      regionContinent,
      regionIslandType,
      regionIslandGroup,
      regionIslandAge,
    }
  }

  private allocateAreas(
    count: number,
    totalArea: number,
    variety: number,
    random: () => number,
  ): Float64Array {
    const weights = Array.from({ length: count }, (_, index) => (
      Math.exp(-index * clamp(variety, 0, 1) * 0.72)
    ))
    for (let index = weights.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(random() * (index + 1))
      const temporary = weights[index]
      weights[index] = weights[swapIndex]
      weights[swapIndex] = temporary
    }
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
    return new Float64Array(weights.map(weight => totalArea * weight / weightSum))
  }

  private pickMainlandSeeds(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
    targetAreas: Float64Array,
    spread: number,
    random: () => number,
  ): Int32Array {
    const count = targetAreas.length
    const seeds = new Int32Array(count).fill(-1)
    const selected = new Uint8Array(mesh.numRegions)
    const usedPlate = new Uint8Array(tectonics.plateSeeds.length)
    const placementOrder = Array.from({ length: count }, (_, index) => index)
      .sort((a, b) => targetAreas[b] - targetAreas[a])

    for (let placementIndex = 0; placementIndex < count; placementIndex++) {
      const continent = placementOrder[placementIndex]
      let bestRegion = -1
      let bestScore = -Infinity
      for (let region = 0; region < mesh.numRegions; region++) {
        if (selected[region] !== 0)
          continue
        let nearestAngle = Math.PI
        for (let previous = 0; previous < placementIndex; previous++) {
          const existingSeed = seeds[placementOrder[previous]]
          nearestAngle = Math.min(nearestAngle, mesh.distanceBetweenRegions(region, existingSeed))
        }
        const plate = tectonics.regionPlate[region]
        const normalizedSpread = clamp(spread, 0, 1)
        const distanceScore = placementIndex === 0 ? 0 : nearestAngle / Math.PI
        const score = distanceScore * normalizedSpread * 1.5
          + random() * (1 - normalizedSpread) * 0.55
          + (usedPlate[plate] === 0 ? 0.3 : 0)
          - tectonics.regionStress[region] * 0.12
        if (score > bestScore) {
          bestScore = score
          bestRegion = region
        }
      }
      seeds[continent] = bestRegion
      selected[bestRegion] = 1
      usedPlate[tectonics.regionPlate[bestRegion]] = 1
    }
    return seeds
  }

  private growMainlands(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
    seeds: Int32Array,
    targetAreas: Float64Array,
    plateAttractor: Int16Array,
    coastNoise: Float32Array,
    params: GlobeGenParams,
    random: () => number,
    landMask: Uint8Array,
    regionContinent: Int16Array,
  ): number {
    const states: ContinentGrowthState[] = []
    let totalArea = 0
    const totalTarget = this.sumArea(targetAreas)

    for (let continent = 0; continent < seeds.length; continent++) {
      const seed = seeds[continent]
      const frame = this.createTangentFrame(mesh, seed)
      const angle = this.getPlateMotionAngle(
        mesh,
        tectonics,
        seed,
        frame,
        random() * Math.PI * 2,
      ) + (random() - 0.5) * 0.55
      const aspectRatio = 1 + clamp(params.elongation, 0, 1) * (0.55 + random() * 2.25)
      const state: ContinentGrowthState = {
        seed,
        frontier: [],
        queued: new Uint8Array(mesh.numRegions),
        ...frame,
        axisX: Math.cos(angle),
        axisY: Math.sin(angle),
        aspectRatio,
        expectedRadius: this.radiusForArea(targetAreas[continent]),
        targetArea: targetAreas[continent],
        actualArea: mesh.regionArea[seed],
      }
      states.push(state)
      landMask[seed] = 1
      regionContinent[seed] = continent
      totalArea += mesh.regionArea[seed]
      this.enqueueNeighbors(mesh, seed, state, regionContinent)
    }

    while (totalArea < totalTarget) {
      let madeProgress = false
      for (let continent = 0; continent < states.length; continent++) {
        const state = states[continent]
        if (state.actualArea >= state.targetArea)
          continue
        const added = this.growOneMainland(
          mesh,
          tectonics,
          continent,
          state,
          plateAttractor,
          coastNoise,
          params,
          random,
          landMask,
          regionContinent,
        )
        if (added > 0) {
          state.actualArea += added
          totalArea += added
          madeProgress = true
        }
      }
      if (madeProgress)
        continue

      for (let continent = 0; continent < states.length; continent++) {
        const state = states[continent]
        const added = this.growOneMainland(
          mesh,
          tectonics,
          continent,
          state,
          plateAttractor,
          coastNoise,
          params,
          random,
          landMask,
          regionContinent,
        )
        if (added > 0) {
          state.actualArea += added
          totalArea += added
          madeProgress = true
          if (totalArea >= totalTarget)
            break
        }
      }
      if (!madeProgress)
        break
    }
    return totalArea
  }

  private growOneMainland(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
    continent: number,
    state: ContinentGrowthState,
    plateAttractor: Int16Array,
    coastNoise: Float32Array,
    params: GlobeGenParams,
    random: () => number,
    landMask: Uint8Array,
    regionContinent: Int16Array,
  ): number {
    while (state.frontier.length > 0) {
      let bestIndex = -1
      let bestScore = -Infinity
      const samples = Math.min(20, state.frontier.length)
      for (let sample = 0; sample < samples; sample++) {
        const index = Math.floor(random() * state.frontier.length)
        const score = this.scoreMainlandCandidate(
          mesh,
          tectonics,
          continent,
          state,
          state.frontier[index],
          plateAttractor,
          coastNoise,
          params,
          regionContinent,
        )
        if (score !== null && score > bestScore) {
          bestScore = score
          bestIndex = index
        }
      }
      if (bestIndex === -1) {
        for (let index = 0; index < state.frontier.length; index++) {
          const score = this.scoreMainlandCandidate(
            mesh,
            tectonics,
            continent,
            state,
            state.frontier[index],
            plateAttractor,
            coastNoise,
            params,
            regionContinent,
          )
          if (score !== null && score > bestScore) {
            bestScore = score
            bestIndex = index
          }
        }
      }
      if (bestIndex === -1) {
        state.frontier.pop()
        continue
      }

      const region = state.frontier[bestIndex]
      state.frontier[bestIndex] = state.frontier[state.frontier.length - 1]
      state.frontier.pop()
      if (regionContinent[region] !== -1)
        continue
      regionContinent[region] = continent
      landMask[region] = 1
      this.enqueueNeighbors(mesh, region, state, regionContinent)
      return mesh.regionArea[region]
    }
    return 0
  }

  private scoreMainlandCandidate(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
    continent: number,
    state: ContinentGrowthState,
    region: number,
    plateAttractor: Int16Array,
    coastNoise: Float32Array,
    params: GlobeGenParams,
    regionContinent: Int16Array,
  ): number | null {
    if (regionContinent[region] !== -1)
      return null

    let sameNeighbors = 0
    let foreignNeighbors = 0
    let degree = 0
    for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
      const owner = regionContinent[neighbor]
      if (owner !== -1 && owner !== continent)
        foreignNeighbors++
      if (owner === continent)
        sameNeighbors++
      degree++
    }

    const local = this.projectToFrame(mesh, state.seed, state, region)
    const major = (local.x * state.axisX + local.y * state.axisY) / state.aspectRatio
    const minor = (-local.x * state.axisY + local.y * state.axisX) * state.aspectRatio
    const radialDistance = Math.hypot(major, minor) / Math.max(1e-4, state.expectedRadius)
    const sameRatio = sameNeighbors / Math.max(1, degree)
    const foreignRatio = foreignNeighbors / Math.max(1, degree)
    const plate = tectonics.regionPlate[region]
    const plateAffinity = plateAttractor[plate] === continent ? 0.72 : -0.22
    const stableVariation = deterministicUnit(params.seed + MAINLAND_GROWTH_OFFSET, region, continent) - 0.5

    return sameRatio * (0.5 + clamp(params.compactness, 0, 1) * 1.25)
      - radialDistance * (0.28 + clamp(params.compactness, 0, 1) * 0.58)
      + coastNoise[region] * clamp(params.coastlineRoughness, 0, 1) * 1.05
      + plateAffinity
      + foreignRatio * (0.16 + (1 - clamp(params.compactness, 0, 1)) * 0.22)
      - tectonics.regionStress[region] * 0.08
      + stableVariation * 0.12
  }

  private createTangentFrame(mesh: SphericalMesh, region: number) {
    const index = region * 3
    const sx = mesh.regionPosition[index]
    const sy = mesh.regionPosition[index + 1]
    const sz = mesh.regionPosition[index + 2]
    const referenceX = Math.abs(sy) < 0.9 ? 0 : 1
    const referenceY = Math.abs(sy) < 0.9 ? 1 : 0
    let eastX = referenceY * sz
    let eastY = -referenceX * sz
    let eastZ = referenceX * sy - referenceY * sx
    const eastLength = Math.hypot(eastX, eastY, eastZ) || 1
    eastX /= eastLength
    eastY /= eastLength
    eastZ /= eastLength
    const northX = sy * eastZ - sz * eastY
    const northY = sz * eastX - sx * eastZ
    const northZ = sx * eastY - sy * eastX
    return { eastX, eastY, eastZ, northX, northY, northZ }
  }

  private getPlateMotionAngle(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
    region: number,
    frame: TangentFrame,
    fallbackAngle: number,
  ): number {
    const regionIndex = region * 3
    const plateIndex = tectonics.regionPlate[region] * 3
    const x = mesh.regionPosition[regionIndex]
    const y = mesh.regionPosition[regionIndex + 1]
    const z = mesh.regionPosition[regionIndex + 2]
    const omegaX = tectonics.plateAngularVelocity[plateIndex]
    const omegaY = tectonics.plateAngularVelocity[plateIndex + 1]
    const omegaZ = tectonics.plateAngularVelocity[plateIndex + 2]
    const velocityX = omegaY * z - omegaZ * y
    const velocityY = omegaZ * x - omegaX * z
    const velocityZ = omegaX * y - omegaY * x
    const east = dot3(
      velocityX,
      velocityY,
      velocityZ,
      frame.eastX,
      frame.eastY,
      frame.eastZ,
    )
    const north = dot3(
      velocityX,
      velocityY,
      velocityZ,
      frame.northX,
      frame.northY,
      frame.northZ,
    )
    return Math.hypot(east, north) > 1e-6
      ? Math.atan2(north, east)
      : fallbackAngle
  }

  private radiusForArea(area: number): number {
    return Math.acos(clamp(1 - area / (2 * Math.PI), -1, 1))
  }

  private assignPlateAttractors(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
    seeds: Int32Array,
  ): Int16Array {
    const plateCount = tectonics.plateSeeds.length
    const adjacency = Array.from({ length: plateCount }, () => new Set<number>())
    for (let region = 0; region < mesh.numRegions; region++) {
      const plate = tectonics.regionPlate[region]
      for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
        const neighborPlate = tectonics.regionPlate[neighbor]
        if (neighborPlate !== plate)
          adjacency[plate].add(neighborPlate)
      }
    }

    const owner = new Int16Array(plateCount).fill(-1)
    const queue: number[] = []
    for (let continent = 0; continent < seeds.length; continent++) {
      const plate = tectonics.regionPlate[seeds[continent]]
      if (owner[plate] === -1) {
        owner[plate] = continent
        queue.push(plate)
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const plate = queue[head]
      for (const neighbor of adjacency[plate]) {
        if (owner[neighbor] !== -1)
          continue
        owner[neighbor] = owner[plate]
        queue.push(neighbor)
      }
    }
    return owner
  }

  private createCoastNoise(mesh: SphericalMesh, params: GlobeGenParams): Float32Array {
    const noise3D = createNoise3D(alea(params.seed + MAINLAND_SHAPE_OFFSET))
    const values = new Float32Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      const index = region * 3
      const x = mesh.regionPosition[index]
      const y = mesh.regionPosition[index + 1]
      const z = mesh.regionPosition[index + 2]
      values[region] = noise3D(x * 2.25, y * 2.25, z * 2.25) * 0.68
        + noise3D(x * 5.4 + 17.3, y * 5.4 - 9.1, z * 5.4 + 4.7) * 0.32
    }
    return values
  }

  private enqueueNeighbors(
    mesh: SphericalMesh,
    region: number,
    state: ContinentGrowthState,
    regionContinent: Int16Array,
  ): void {
    for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
      if (regionContinent[neighbor] !== -1 || state.queued[neighbor] !== 0)
        continue
      state.queued[neighbor] = 1
      state.frontier.push(neighbor)
    }
  }

  private planIslandSites(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
    landMask: Uint8Array,
    requestedCount: number,
    targetArea: number,
    continentOffset: number,
    params: GlobeGenParams,
  ): IslandSitePlan[] {
    const candidates: number[] = []
    for (let region = 0; region < mesh.numRegions; region++) {
      if (landMask[region] !== 0)
        continue
      let touchesLand = false
      for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
        if (landMask[neighbor] !== 0) {
          touchesLand = true
          break
        }
      }
      if (!touchesLand)
        candidates.push(region)
    }
    if (candidates.length === 0)
      return []

    const count = Math.min(requestedCount, candidates.length)
    const random = alea(params.seed + ISLAND_SEED_OFFSET)
    const clustering = clamp(params.islandClustering, 0, 1)
    const groupCount = Math.max(1, Math.min(
      count,
      Math.round(count * (1 - clustering * 0.78)),
    ))
    const memberCounts = this.allocateIslandGroupMembers(groupCount, count, random)
    const mainlandDistance = computeSphericalDistanceField(mesh, region => landMask[region] !== 0)
    const overridingBoundary = this.buildOverridingBoundaryMask(mesh, tectonics)
    const convergentDistance = computeSphericalDistanceField(
      mesh,
      region => overridingBoundary[region] !== 0,
    )
    const divergentDistance = computeSphericalDistanceField(
      mesh,
      region => tectonics.regionBoundaryType[region] === PLATE_BOUNDARY.Divergent,
    )
    const groups: IslandGroupPlan[] = []
    const usedSeeds = new Set<number>()
    const nearestGroupDistance = new Float32Array(mesh.numRegions).fill(Math.PI)

    for (let group = 0; group < groupCount; group++) {
      const type = this.pickIslandGroupType(random, params.islandTectonicBias)
      const center = this.pickIslandGroupCenter(
        mesh,
        tectonics,
        candidates,
        nearestGroupDistance,
        usedSeeds,
        mainlandDistance,
        convergentDistance,
        divergentDistance,
        type,
        params,
        group,
      )
      if (center === -1)
        continue
      usedSeeds.add(center)
      for (const region of candidates) {
        nearestGroupDistance[region] = Math.min(
          nearestGroupDistance[region],
          mesh.distanceBetweenRegions(region, center),
        )
      }
      groups.push({
        id: group,
        type,
        center,
        memberCount: memberCounts[group],
        axisAngle: this.getIslandGroupAxisAngle(
          mesh,
          tectonics,
          type,
          center,
          random() * Math.PI * 2,
        ),
      })
    }

    const sites: IslandSitePlan[] = []
    const cellAngle = Math.sqrt(4 * Math.PI / mesh.numRegions)
    for (const group of groups) {
      const frame = this.createTangentFrame(mesh, group.center)
      for (let member = 0; member < group.memberCount; member++) {
        const desired = this.getIslandMemberOffset(
          group.type,
          member,
          group.memberCount,
          cellAngle,
          group.axisAngle,
          random,
        )
        const seed = member === 0
          ? group.center
          : this.pickIslandMemberSeed(
              mesh,
              tectonics,
              candidates,
              usedSeeds,
              group,
              frame,
              desired.x,
              desired.y,
              cellAngle,
              convergentDistance,
            )
        if (seed === -1)
          continue
        usedSeeds.add(seed)
        const age = this.getIslandAge(group.type, member, group.memberCount, random)
        const baseAspect = group.type === SPHERICAL_ISLAND_TYPE.ContinentalFragment
          ? 1.25 + random() * 1.35
          : 1.05 + random() * (0.35 + params.elongation * 0.7)
        sites.push({
          seed,
          continent: continentOffset + sites.length,
          group: group.id,
          type: group.type,
          targetArea: this.getIslandAreaWeight(group.type, member, age, params, random),
          axisAngle: group.axisAngle + (random() - 0.5) * 0.7,
          aspectRatio: baseAspect,
          age,
        })
      }
    }

    let weightSum = 0
    for (const site of sites)
      weightSum += site.targetArea
    if (weightSum > 0) {
      for (const site of sites)
        site.targetArea = targetArea * site.targetArea / weightSum
    }
    return sites
  }

  private allocateIslandGroupMembers(
    groupCount: number,
    islandCount: number,
    random: () => number,
  ): Int16Array {
    const counts = new Int16Array(groupCount).fill(1)
    const attraction = Array.from(
      { length: groupCount },
      () => Math.exp((random() - 0.5) * 2.4),
    )
    for (let remaining = groupCount; remaining < islandCount; remaining++) {
      let total = 0
      for (let group = 0; group < groupCount; group++)
        total += attraction[group] / (1 + counts[group] * 0.28)
      let choice = random() * total
      let selected = groupCount - 1
      for (let group = 0; group < groupCount; group++) {
        choice -= attraction[group] / (1 + counts[group] * 0.28)
        if (choice <= 0) {
          selected = group
          break
        }
      }
      counts[selected]++
    }
    return counts
  }

  private pickIslandGroupType(
    random: () => number,
    tectonicBias: number,
  ): SphericalIslandTypeCode {
    const bias = clamp(tectonicBias, 0, 1)
    const volcanicWeight = 0.2 + bias * 0.22
    const hotspotWeight = 0.2
    const fragmentWeight = 0.25
    const value = random()
    if (value < volcanicWeight)
      return SPHERICAL_ISLAND_TYPE.VolcanicArc
    if (value < volcanicWeight + hotspotWeight)
      return SPHERICAL_ISLAND_TYPE.HotspotChain
    if (value < volcanicWeight + hotspotWeight + fragmentWeight)
      return SPHERICAL_ISLAND_TYPE.ContinentalFragment
    return SPHERICAL_ISLAND_TYPE.Scattered
  }

  private pickIslandGroupCenter(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
    candidates: number[],
    nearestGroupDistance: Float32Array,
    usedSeeds: Set<number>,
    mainlandDistance: Float32Array,
    convergentDistance: Float32Array,
    divergentDistance: Float32Array,
    type: SphericalIslandTypeCode,
    params: GlobeGenParams,
    groupIndex: number,
  ): number {
    let bestRegion = -1
    let bestScore = -Infinity
    const clustering = clamp(params.islandClustering, 0, 1)
    const tectonicBias = clamp(params.islandTectonicBias, 0, 1)
    const missingDistance = referenceCellsToAngle(32)

    for (const region of candidates) {
      if (usedSeeds.has(region))
        continue
      const spacing = groupIndex === 0 ? 0.5 : nearestGroupDistance[region]
      const convergent = Number.isFinite(convergentDistance[region])
        ? convergentDistance[region]
        : missingDistance
      const divergent = Number.isFinite(divergentDistance[region])
        ? divergentDistance[region]
        : missingDistance
      const boundaryDistance = Math.min(convergent, divergent)
      const coastDistance = Number.isFinite(mainlandDistance[region])
        ? mainlandDistance[region]
        : missingDistance
      let suitability = 0
      switch (type) {
        case SPHERICAL_ISLAND_TYPE.VolcanicArc:
          suitability = (1 - clamp(convergent / referenceCellsToAngle(10), 0, 1))
            * (0.8 + tectonicBias * 1.8)
            + tectonics.regionStress[region] * tectonicBias * 0.5
          break
        case SPHERICAL_ISLAND_TYPE.HotspotChain:
          suitability = clamp(boundaryDistance / referenceCellsToAngle(10), 0, 1)
            * (0.45 + tectonicBias * 0.55)
            + (1 - tectonics.regionStress[region]) * 0.25
          break
        case SPHERICAL_ISLAND_TYPE.ContinentalFragment:
          suitability = (
            1 - clamp(
              Math.abs(coastDistance - referenceCellsToAngle(4))
              / referenceCellsToAngle(7),
              0,
              1,
            )
          ) * 1.35
            + (1 - clamp(divergent / referenceCellsToAngle(10), 0, 1)) * 0.45
          break
        default:
          suitability = clamp(coastDistance / referenceCellsToAngle(12), 0, 1) * 0.45
          break
      }
      const stableVariation = deterministicUnit(
        params.seed + ISLAND_SEED_OFFSET,
        region,
        groupIndex,
        type,
      )
      const score = spacing / Math.PI * (0.38 + (1 - clustering) * 1.45)
        + suitability
        + stableVariation * 0.72
      if (score > bestScore) {
        bestScore = score
        bestRegion = region
      }
    }
    return bestRegion
  }

  private getIslandMemberOffset(
    type: SphericalIslandTypeCode,
    member: number,
    memberCount: number,
    cellAngle: number,
    axisAngle: number,
    random: () => number,
  ): { x: number, y: number } {
    if (member === 0)
      return { x: 0, y: 0 }
    const spacing = cellAngle * 2.65
    let along = 0
    let across = 0
    if (type === SPHERICAL_ISLAND_TYPE.VolcanicArc) {
      const rank = Math.ceil(member / 2)
      const sign = member % 2 === 0 ? 1 : -1
      along = sign * rank * spacing
      across = rank * rank * spacing * 0.14
    }
    else if (type === SPHERICAL_ISLAND_TYPE.HotspotChain) {
      along = member * spacing * 1.1
      across = (random() - 0.5) * spacing * 0.42
    }
    else {
      const angle = random() * Math.PI * 2
      const radius = spacing * (
        type === SPHERICAL_ISLAND_TYPE.ContinentalFragment
          ? 0.72 + Math.sqrt(member) * 0.65
          : 0.95 + Math.sqrt(member) * 0.9
      )
      along = Math.cos(angle) * radius
      across = Math.sin(angle) * radius
    }
    const cosine = Math.cos(axisAngle)
    const sine = Math.sin(axisAngle)
    const groupScale = 0.92 + Math.min(1, memberCount / 6) * 0.18
    return {
      x: (along * cosine - across * sine) * groupScale,
      y: (along * sine + across * cosine) * groupScale,
    }
  }

  private pickIslandMemberSeed(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
    candidates: number[],
    usedSeeds: Set<number>,
    group: IslandGroupPlan,
    frame: TangentFrame,
    targetX: number,
    targetY: number,
    cellAngle: number,
    convergentDistance: Float32Array,
  ): number {
    let bestRegion = -1
    let bestScore = Infinity
    const maximumRadius = Math.max(
      cellAngle * 5,
      Math.hypot(targetX, targetY) + cellAngle * 3.5,
    )
    for (const region of candidates) {
      if (usedSeeds.has(region))
        continue
      if (
        group.type === SPHERICAL_ISLAND_TYPE.HotspotChain
        && tectonics.regionPlate[region] !== tectonics.regionPlate[group.center]
      ) {
        continue
      }
      const centerDistance = mesh.distanceBetweenRegions(group.center, region)
      if (centerDistance > maximumRadius)
        continue
      let nearestSeed = Infinity
      for (const seed of usedSeeds)
        nearestSeed = Math.min(nearestSeed, mesh.distanceBetweenRegions(region, seed))
      if (nearestSeed < cellAngle * 1.45)
        continue
      const local = this.projectToFrame(mesh, group.center, frame, region)
      const dx = (local.x - targetX) / cellAngle
      const dy = (local.y - targetY) / cellAngle
      let score = dx * dx + dy * dy
      if (group.type === SPHERICAL_ISLAND_TYPE.VolcanicArc) {
        const distance = Number.isFinite(convergentDistance[region])
          ? convergentDistance[region]
          : referenceCellsToAngle(16)
        score += clamp(distance / referenceCellsToAngle(8), 0, 1) * 2.4
        score -= tectonics.regionStress[region] * 0.2
      }
      if (score < bestScore) {
        bestScore = score
        bestRegion = region
      }
    }
    return bestRegion
  }

  private getIslandAge(
    type: SphericalIslandTypeCode,
    member: number,
    memberCount: number,
    random: () => number,
  ): number {
    if (type === SPHERICAL_ISLAND_TYPE.HotspotChain)
      return clamp(member / Math.max(1, memberCount - 1) * 0.88 + random() * 0.08, 0, 1)
    if (type === SPHERICAL_ISLAND_TYPE.VolcanicArc)
      return 0.05 + random() * 0.38
    if (type === SPHERICAL_ISLAND_TYPE.ContinentalFragment)
      return 0.42 + random() * 0.5
    return 0.2 + random() * 0.78
  }

  private buildOverridingBoundaryMask(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
  ): Uint8Array {
    const mask = new Uint8Array(mesh.numRegions)
    for (let edge = 0; edge < tectonics.edgeBoundaryType.length; edge++) {
      if (tectonics.edgeBoundaryType[edge] !== PLATE_BOUNDARY.Convergent)
        continue
      const edgeIndex = edge * 2
      if (
        tectonics.edgeSubductionPolarity[edge]
        === EDGE_SUBDUCTION_POLARITY.RegionAUnderB
      ) {
        mask[mesh.voronoi.edgeRegions[edgeIndex + 1]] = 1
      }
      else if (
        tectonics.edgeSubductionPolarity[edge]
        === EDGE_SUBDUCTION_POLARITY.RegionBUnderA
      ) {
        mask[mesh.voronoi.edgeRegions[edgeIndex]] = 1
      }
    }
    return mask
  }

  private getIslandGroupAxisAngle(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
    type: SphericalIslandTypeCode,
    center: number,
    fallbackAngle: number,
  ): number {
    const frame = this.createTangentFrame(mesh, center)
    if (type === SPHERICAL_ISLAND_TYPE.HotspotChain) {
      return this.getPlateMotionAngle(
        mesh,
        tectonics,
        center,
        frame,
        fallbackAngle,
      )
    }
    if (type !== SPHERICAL_ISLAND_TYPE.VolcanicArc)
      return fallbackAngle

    const centerIndex = center * 3
    const centerX = mesh.regionPosition[centerIndex]
    const centerY = mesh.regionPosition[centerIndex + 1]
    const centerZ = mesh.regionPosition[centerIndex + 2]
    let bestEdge = -1
    let bestDot = -Infinity
    for (let edge = 0; edge < tectonics.edgeBoundaryType.length; edge++) {
      if (
        tectonics.edgeBoundaryType[edge] !== PLATE_BOUNDARY.Convergent
        || tectonics.edgeSubductionPolarity[edge] === EDGE_SUBDUCTION_POLARITY.None
      ) {
        continue
      }
      const edgeIndex = edge * 2
      const regionAIndex = mesh.voronoi.edgeRegions[edgeIndex] * 3
      const regionBIndex = mesh.voronoi.edgeRegions[edgeIndex + 1] * 3
      let midpointX = mesh.regionPosition[regionAIndex]
        + mesh.regionPosition[regionBIndex]
      let midpointY = mesh.regionPosition[regionAIndex + 1]
        + mesh.regionPosition[regionBIndex + 1]
      let midpointZ = mesh.regionPosition[regionAIndex + 2]
        + mesh.regionPosition[regionBIndex + 2]
      const midpointLength = Math.hypot(midpointX, midpointY, midpointZ) || 1
      midpointX /= midpointLength
      midpointY /= midpointLength
      midpointZ /= midpointLength
      const proximity = dot3(
        centerX,
        centerY,
        centerZ,
        midpointX,
        midpointY,
        midpointZ,
      )
      if (proximity > bestDot) {
        bestDot = proximity
        bestEdge = edge
      }
    }
    if (bestEdge === -1)
      return fallbackAngle

    const edgeIndex = bestEdge * 2
    const regionAIndex = mesh.voronoi.edgeRegions[edgeIndex] * 3
    const regionBIndex = mesh.voronoi.edgeRegions[edgeIndex + 1] * 3
    const normalX = mesh.regionPosition[regionBIndex]
      - mesh.regionPosition[regionAIndex]
    const normalY = mesh.regionPosition[regionBIndex + 1]
      - mesh.regionPosition[regionAIndex + 1]
    const normalZ = mesh.regionPosition[regionBIndex + 2]
      - mesh.regionPosition[regionAIndex + 2]
    const tangentX = centerY * normalZ - centerZ * normalY
    const tangentY = centerZ * normalX - centerX * normalZ
    const tangentZ = centerX * normalY - centerY * normalX
    const east = dot3(
      tangentX,
      tangentY,
      tangentZ,
      frame.eastX,
      frame.eastY,
      frame.eastZ,
    )
    const north = dot3(
      tangentX,
      tangentY,
      tangentZ,
      frame.northX,
      frame.northY,
      frame.northZ,
    )
    return Math.hypot(east, north) > 1e-6
      ? Math.atan2(north, east)
      : fallbackAngle
  }

  private getIslandAreaWeight(
    type: SphericalIslandTypeCode,
    member: number,
    age: number,
    params: GlobeGenParams,
    random: () => number,
  ): number {
    const variety = clamp(params.sizeVariety, 0, 1)
    const randomScale = Math.exp((random() - 0.5) * (0.9 + variety * 2.8))
    const mainIslandScale = member === 0
      ? type === SPHERICAL_ISLAND_TYPE.ContinentalFragment ? 3.6 : 2.25
      : 1
    const typeScale = type === SPHERICAL_ISLAND_TYPE.ContinentalFragment
      ? 1.45
      : type === SPHERICAL_ISLAND_TYPE.Scattered ? 0.72 : 1
    const erosionScale = type === SPHERICAL_ISLAND_TYPE.HotspotChain
      ? 0.35 + (1 - age) * 0.9
      : 1
    return Math.max(0.08, randomScale * mainIslandScale * typeScale * erosionScale)
  }

  private projectToFrame(
    mesh: SphericalMesh,
    origin: number,
    frame: TangentFrame,
    region: number,
  ): { x: number, y: number } {
    const originIndex = origin * 3
    const regionIndex = region * 3
    const sx = mesh.regionPosition[originIndex]
    const sy = mesh.regionPosition[originIndex + 1]
    const sz = mesh.regionPosition[originIndex + 2]
    const px = mesh.regionPosition[regionIndex]
    const py = mesh.regionPosition[regionIndex + 1]
    const pz = mesh.regionPosition[regionIndex + 2]
    const cosine = clamp(dot3(sx, sy, sz, px, py, pz), -1, 1)
    const angle = Math.acos(cosine)
    const sine = Math.sin(angle)
    if (sine < 1e-6)
      return { x: 0, y: 0 }
    const tx = (px - sx * cosine) / sine
    const ty = (py - sy * cosine) / sine
    const tz = (pz - sz * cosine) / sine
    return {
      x: angle * dot3(tx, ty, tz, frame.eastX, frame.eastY, frame.eastZ),
      y: angle * dot3(tx, ty, tz, frame.northX, frame.northY, frame.northZ),
    }
  }

  private growIslands(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
    sites: IslandSitePlan[],
    randomSeed: number,
    landMask: Uint8Array,
    regionContinent: Int16Array,
    regionIslandType: Uint8Array,
    regionIslandGroup: Int16Array,
    regionIslandAge: Float32Array,
    params: GlobeGenParams,
  ): number {
    if (sites.length === 0)
      return 0

    const reservedSeed = new Int32Array(mesh.numRegions).fill(-1)
    for (const site of sites)
      reservedSeed[site.seed] = site.continent
    let addedArea = 0
    for (const site of sites) {
      addedArea += this.growIsland(
        mesh,
        tectonics,
        site,
        randomSeed,
        landMask,
        regionContinent,
        regionIslandType,
        regionIslandGroup,
        regionIslandAge,
        reservedSeed,
        params,
      )
    }
    return addedArea
  }

  private growIsland(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
    site: IslandSitePlan,
    randomSeed: number,
    landMask: Uint8Array,
    regionContinent: Int16Array,
    regionIslandType: Uint8Array,
    regionIslandGroup: Int16Array,
    regionIslandAge: Float32Array,
    reservedSeed: Int32Array,
    params: GlobeGenParams,
  ): number {
    if (landMask[site.seed] !== 0)
      return 0
    const bestCost = new Float64Array(mesh.numRegions).fill(Infinity)
    const queue = new MinPriorityQueue<IslandFrontierNode>()
    const frame = this.createTangentFrame(mesh, site.seed)
    bestCost[site.seed] = 0
    queue.push({ region: site.seed, cost: 0 })
    let addedArea = 0

    while (queue.size > 0 && addedArea < site.targetArea) {
      const current = queue.pop()
      if (
        current.cost !== bestCost[current.region]
        || landMask[current.region] !== 0
      ) {
        continue
      }
      if (
        current.region !== site.seed
        && (
          this.touchesForeignLand(mesh, current.region, site.continent, regionContinent)
          || this.touchesForeignReservation(
            mesh,
            current.region,
            site.continent,
            reservedSeed,
          )
        )
      ) {
        continue
      }

      landMask[current.region] = 1
      regionContinent[current.region] = site.continent
      regionIslandType[current.region] = site.type
      regionIslandGroup[current.region] = site.group
      regionIslandAge[current.region] = site.age
      addedArea += mesh.regionArea[current.region]
      for (const neighbor of mesh.forEachNeighborOfRegion(current.region)) {
        if (landMask[neighbor] !== 0)
          continue
        if (
          site.type === SPHERICAL_ISLAND_TYPE.HotspotChain
          && tectonics.regionPlate[neighbor] !== tectonics.regionPlate[site.seed]
        ) {
          continue
        }
        const reservation = reservedSeed[neighbor]
        if (reservation !== -1 && reservation !== site.continent)
          continue
        const platePenalty = tectonics.regionPlate[current.region] === tectonics.regionPlate[neighbor]
          ? 1
          : site.type === SPHERICAL_ISLAND_TYPE.VolcanicArc ? 1.08 : 1.35
        const low = Math.min(current.region, neighbor)
        const high = Math.max(current.region, neighbor)
        const roughnessAmount = clamp(params.coastlineRoughness, 0, 1)
        const roughness = 0.82 - roughnessAmount * 0.28
          + deterministicUnit(randomSeed, low, high, site.continent)
          * (0.3 + roughnessAmount * 0.72)
        const local = this.projectToFrame(mesh, site.seed, frame, neighbor)
        const cosine = Math.cos(site.axisAngle)
        const sine = Math.sin(site.axisAngle)
        const major = local.x * cosine + local.y * sine
        const minor = -local.x * sine + local.y * cosine
        const radial = Math.max(1e-6, Math.hypot(local.x, local.y))
        const elliptical = Math.hypot(
          major / site.aspectRatio,
          minor * site.aspectRatio,
        )
        const directionalPenalty = 0.62 + elliptical / radial * 0.48
        const nextCost = current.cost
          + mesh.distanceBetweenRegions(current.region, neighbor)
          * platePenalty
          * roughness
          * directionalPenalty
        if (nextCost >= bestCost[neighbor])
          continue
        bestCost[neighbor] = nextCost
        queue.push({ region: neighbor, cost: nextCost })
      }
    }
    return addedArea
  }

  private touchesForeignLand(
    mesh: SphericalMesh,
    region: number,
    continent: number,
    regionContinent: Int16Array,
  ): boolean {
    for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
      const owner = regionContinent[neighbor]
      if (owner !== -1 && owner !== continent)
        return true
    }
    return false
  }

  private touchesForeignReservation(
    mesh: SphericalMesh,
    region: number,
    continent: number,
    reservedSeed: Int32Array,
  ): boolean {
    for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
      const reservation = reservedSeed[neighbor]
      if (reservation !== -1 && reservation !== continent)
        return true
    }
    return false
  }

  private sumArea(area: Float32Array | Float64Array): number {
    let total = 0
    for (const value of area)
      total += value
    return total
  }
}
