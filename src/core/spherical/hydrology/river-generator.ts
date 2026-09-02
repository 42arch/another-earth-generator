import type { GlobeGenParams } from '@/core/spherical/config'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type {
  SphericalLakeData,
  SphericalRiverData,
} from '@/core/spherical/hydrology/hydrology-data'
import { MinPriorityQueue } from '@/core/spherical/algorithms/priority-queue'
import { deterministicUnit } from '@/core/spherical/geometry/spherical-math'
import { CLIMATE_SEASON_COUNT } from '@/core/spherical/climate/climate-data'

const DRAINAGE_EPSILON = 1e-5
const DRAINAGE_TIE_SEED = 104729
const HEADWATER_FLOW_RATIO = 0.18
const SEASONAL_RIVER_DRY_FLOW_RATIO = 0.25

interface DrainageNode {
  region: number
  cost: number
}

export class SphericalRiverGenerator {
  generate(
    mesh: SphericalMesh,
    elevation: Float32Array,
    landMask: Uint8Array,
    runoff: Float32Array,
    seasonalRunoff: Float32Array,
    params: GlobeGenParams,
    lakes: SphericalLakeData,
  ): SphericalRiverData {
    const routingMask = this.buildRoutingMask(landMask, lakes)
    const { drainageElevation, floodParent } = this.resolveDepressions(
      mesh,
      elevation,
      routingMask,
    )
    const downstreamRegion = this.buildDownstreamRegions(
      mesh,
      routingMask,
      drainageElevation,
      floodParent,
      params.seed,
    )
    this.routeOverflowingLakes(
      mesh,
      lakes,
      drainageElevation,
      downstreamRegion,
    )
    const flowAccumulation = this.accumulateFlow(
      mesh,
      routingMask,
      landMask,
      runoff,
      downstreamRegion,
    )
    const lakeOutflowMask = this.buildLakeOutflowMask(
      landMask,
      lakes,
      downstreamRegion,
    )
    let totalRunoff = 0
    for (let region = 0; region < mesh.numRegions; region++) {
      if (landMask[region] !== 0)
        totalRunoff += mesh.regionArea[region] * Math.max(0, runoff[region])
    }
    const thresholdFlow = Math.max(0, totalRunoff * params.riverBasinThreshold)
    const {
      seasonalFlowAccumulation,
      seasonalTotalRunoff,
    } = this.accumulateSeasonalFlow(
      mesh,
      routingMask,
      landMask,
      seasonalRunoff,
      downstreamRegion,
    )
    const {
      riverMask,
      sourceRegions,
      segmentSource,
      segmentTarget,
    } = this.extractRiverNetwork(
      mesh,
      elevation,
      landMask,
      downstreamRegion,
      flowAccumulation,
      thresholdFlow,
      params.riverMinSourceElevation,
      params.riverMinLength,
      lakeOutflowMask,
    )
    const {
      seasonalRiverMask,
      riverSeasonality,
    } = this.classifyRiverSeasonality(
      mesh.numRegions,
      riverMask,
      seasonalFlowAccumulation,
    )

    return {
      drainageElevation,
      downstreamRegion,
      flowAccumulation,
      seasonalFlowAccumulation,
      riverMask,
      seasonalRiverMask,
      riverSeasonality,
      sourceRegions,
      segmentSource,
      segmentTarget,
      totalRunoff,
      seasonalTotalRunoff,
      thresholdFlow,
    }
  }

  calculateLakeInflow(
    landMask: Uint8Array,
    lakes: SphericalLakeData,
    rivers: SphericalRiverData,
  ): Float32Array {
    const inflow = new Float32Array(lakes.area.length)
    for (let region = 0; region < landMask.length; region++) {
      if (landMask[region] === 0)
        continue
      const downstream = rivers.downstreamRegion[region]
      const lakeId = downstream >= 0 ? lakes.regionLakeId[downstream] : -1
      if (lakeId >= 0)
        inflow[lakeId] += rivers.flowAccumulation[region]
    }
    return inflow
  }

  calculateSeasonalLakeInflow(
    landMask: Uint8Array,
    lakes: SphericalLakeData,
    rivers: SphericalRiverData,
  ): Float32Array {
    const lakeCount = lakes.area.length
    const inflow = new Float32Array(lakeCount * CLIMATE_SEASON_COUNT)
    for (let season = 0; season < CLIMATE_SEASON_COUNT; season++) {
      const regionOffset = season * landMask.length
      const lakeOffset = season * lakeCount
      for (let region = 0; region < landMask.length; region++) {
        if (landMask[region] === 0)
          continue
        const downstream = rivers.downstreamRegion[region]
        const lakeId = downstream >= 0 ? lakes.regionLakeId[downstream] : -1
        if (lakeId >= 0) {
          inflow[lakeOffset + lakeId]
            += rivers.seasonalFlowAccumulation[regionOffset + region]
        }
      }
    }
    return inflow
  }

  private buildRoutingMask(
    landMask: Uint8Array,
    lakes: SphericalLakeData,
  ): Uint8Array {
    const routingMask = new Uint8Array(landMask)
    for (let region = 0; region < routingMask.length; region++) {
      const lakeId = lakes.regionLakeId[region]
      if (lakeId >= 0 && lakes.isEndorheic[lakeId] === 0)
        routingMask[region] = 1
    }
    return routingMask
  }

  private buildLakeOutflowMask(
    landMask: Uint8Array,
    lakes: SphericalLakeData,
    downstreamRegion: Int32Array,
  ): Uint8Array {
    const outflowMask = new Uint8Array(landMask.length)
    for (let region = 0; region < landMask.length; region++) {
      const lakeId = lakes.regionLakeId[region]
      const downstream = downstreamRegion[region]
      if (
        lakeId >= 0
        && lakes.isEndorheic[lakeId] === 0
        && downstream >= 0
        && landMask[downstream] !== 0
      ) {
        outflowMask[downstream] = 1
      }
    }
    return outflowMask
  }

  private routeOverflowingLakes(
    mesh: SphericalMesh,
    lakes: SphericalLakeData,
    drainageElevation: Float32Array,
    downstreamRegion: Int32Array,
  ): void {
    const lakeRegions = Array.from(
      { length: lakes.area.length },
      () => [] as number[],
    )
    for (let region = 0; region < mesh.numRegions; region++) {
      const lakeId = lakes.regionLakeId[region]
      if (lakeId >= 0)
        lakeRegions[lakeId].push(region)
    }
    const visited = new Uint8Array(mesh.numRegions)
    for (let lakeId = 0; lakeId < lakes.area.length; lakeId++) {
      if (lakes.isEndorheic[lakeId] !== 0)
        continue
      let outlet = -1
      let target = -1
      for (const region of lakeRegions[lakeId]) {
        const downstream = downstreamRegion[region]
        if (
          downstream < 0
          || lakes.regionLakeId[downstream] === lakeId
          || this.pathReturnsToLake(
            downstream,
            lakeId,
            lakes.regionLakeId,
            downstreamRegion,
          )
        ) {
          continue
        }
        if (
          outlet < 0
          || drainageElevation[region] < drainageElevation[outlet]
          || (
            drainageElevation[region] === drainageElevation[outlet]
            && region < outlet
          )
        ) {
          outlet = region
          target = downstream
        }
      }
      if (outlet < 0 || target < 0)
        continue

      const queue = [outlet]
      visited[outlet] = 1
      downstreamRegion[outlet] = target
      lakes.outletRegion[lakeId] = outlet
      lakes.outletTarget[lakeId] = target
      for (let head = 0; head < queue.length; head++) {
        const region = queue[head]
        for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
          if (
            visited[neighbor] !== 0
            || lakes.regionLakeId[neighbor] !== lakeId
          ) {
            continue
          }
          visited[neighbor] = 1
          downstreamRegion[neighbor] = region
          queue.push(neighbor)
        }
      }
    }
  }

  private pathReturnsToLake(
    start: number,
    lakeId: number,
    regionLakeId: Int32Array,
    downstreamRegion: Int32Array,
  ): boolean {
    let current = start
    for (let guard = 0; guard < downstreamRegion.length; guard++) {
      if (regionLakeId[current] === lakeId)
        return true
      current = downstreamRegion[current]
      if (current < 0)
        return false
    }
    return true
  }

  private resolveDepressions(
    mesh: SphericalMesh,
    elevation: Float32Array,
    landMask: Uint8Array,
  ) {
    const drainageElevation = new Float32Array(elevation)
    const floodParent = new Int32Array(mesh.numRegions).fill(-1)
    const visited = new Uint8Array(mesh.numRegions)
    const queue = new MinPriorityQueue<DrainageNode>()

    for (let region = 0; region < mesh.numRegions; region++) {
      if (landMask[region] !== 0)
        continue
      visited[region] = 1
      queue.push({ region, cost: drainageElevation[region] })
    }

    while (queue.size > 0) {
      const current = queue.pop()
      for (const neighbor of mesh.forEachNeighborOfRegion(current.region)) {
        if (visited[neighbor] !== 0)
          continue
        visited[neighbor] = 1
        floodParent[neighbor] = current.region
        drainageElevation[neighbor] = Math.max(
          elevation[neighbor],
          current.cost + DRAINAGE_EPSILON,
        )
        queue.push({ region: neighbor, cost: drainageElevation[neighbor] })
      }
    }

    return { drainageElevation, floodParent }
  }

  private buildDownstreamRegions(
    mesh: SphericalMesh,
    landMask: Uint8Array,
    drainageElevation: Float32Array,
    floodParent: Int32Array,
    seed: number,
  ): Int32Array {
    const downstreamRegion = new Int32Array(mesh.numRegions).fill(-1)
    for (let region = 0; region < mesh.numRegions; region++) {
      if (landMask[region] === 0)
        continue

      let bestNeighbor = -1
      let bestSlope = -Infinity
      let bestTie = -Infinity
      for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
        const drop = drainageElevation[region] - drainageElevation[neighbor]
        if (drop <= 0)
          continue
        const distance = mesh.distanceBetweenRegions(region, neighbor)
        const slope = distance > 0 ? drop / distance : 0
        const tie = deterministicUnit(DRAINAGE_TIE_SEED, seed, region, neighbor)
        if (slope > bestSlope || (slope === bestSlope && tie > bestTie)) {
          bestNeighbor = neighbor
          bestSlope = slope
          bestTie = tie
        }
      }
      downstreamRegion[region] = bestNeighbor >= 0 ? bestNeighbor : floodParent[region]
    }
    return downstreamRegion
  }

  private accumulateFlow(
    mesh: SphericalMesh,
    routingMask: Uint8Array,
    landMask: Uint8Array,
    runoff: Float32Array,
    downstreamRegion: Int32Array,
  ): Float32Array {
    const flow = new Float32Array(mesh.numRegions)
    const incomingCount = new Uint16Array(mesh.numRegions)
    const queue = new Int32Array(mesh.numRegions)
    let tail = 0
    for (let region = 0; region < mesh.numRegions; region++) {
      if (routingMask[region] === 0)
        continue
      if (landMask[region] !== 0)
        flow[region] = mesh.regionArea[region] * Math.max(0, runoff[region])
      const downstream = downstreamRegion[region]
      if (downstream >= 0 && routingMask[downstream] !== 0)
        incomingCount[downstream]++
    }
    for (let region = 0; region < mesh.numRegions; region++) {
      if (routingMask[region] !== 0 && incomingCount[region] === 0)
        queue[tail++] = region
    }
    for (let head = 0; head < tail; head++) {
      const region = queue[head]
      const downstream = downstreamRegion[region]
      if (downstream < 0)
        continue
      flow[downstream] += flow[region]
      if (routingMask[downstream] === 0)
        continue
      incomingCount[downstream]--
      if (incomingCount[downstream] === 0)
        queue[tail++] = downstream
    }
    return flow
  }

  private accumulateSeasonalFlow(
    mesh: SphericalMesh,
    routingMask: Uint8Array,
    landMask: Uint8Array,
    seasonalRunoff: Float32Array,
    downstreamRegion: Int32Array,
  ) {
    const numRegions = mesh.numRegions
    const seasonalFlowAccumulation = new Float32Array(
      numRegions * CLIMATE_SEASON_COUNT,
    )
    const seasonalTotalRunoff = new Float32Array(CLIMATE_SEASON_COUNT)
    for (let season = 0; season < CLIMATE_SEASON_COUNT; season++) {
      const offset = season * numRegions
      const runoff = seasonalRunoff.subarray(offset, offset + numRegions)
      const flow = this.accumulateFlow(
        mesh,
        routingMask,
        landMask,
        runoff,
        downstreamRegion,
      )
      seasonalFlowAccumulation.set(flow, offset)
      let total = 0
      for (let region = 0; region < numRegions; region++) {
        if (landMask[region] !== 0)
          total += mesh.regionArea[region] * Math.max(0, runoff[region])
      }
      seasonalTotalRunoff[season] = total
    }

    return { seasonalFlowAccumulation, seasonalTotalRunoff }
  }

  private classifyRiverSeasonality(
    numRegions: number,
    riverMask: Uint8Array,
    seasonalFlowAccumulation: Float32Array,
  ) {
    const seasonalRiverMask = new Uint8Array(numRegions)
    const riverSeasonality = new Float32Array(numRegions)
    for (let region = 0; region < numRegions; region++) {
      if (riverMask[region] === 0)
        continue
      let minimumFlow = Number.POSITIVE_INFINITY
      let maximumFlow = 0
      for (let season = 0; season < CLIMATE_SEASON_COUNT; season++) {
        const flow = seasonalFlowAccumulation[season * numRegions + region]
        minimumFlow = Math.min(minimumFlow, flow)
        maximumFlow = Math.max(maximumFlow, flow)
      }
      if (maximumFlow <= Number.EPSILON)
        continue
      const dryFlowRatio = minimumFlow / maximumFlow
      riverSeasonality[region] = 1 - dryFlowRatio
      if (dryFlowRatio < SEASONAL_RIVER_DRY_FLOW_RATIO)
        seasonalRiverMask[region] = 1
    }
    return { seasonalRiverMask, riverSeasonality }
  }

  private extractRiverNetwork(
    mesh: SphericalMesh,
    elevation: Float32Array,
    landMask: Uint8Array,
    downstreamRegion: Int32Array,
    flow: Float32Array,
    thresholdFlow: number,
    minimumSourceElevation: number,
    minimumLength: number,
    lakeOutflowMask: Uint8Array,
  ) {
    const candidate = new Uint8Array(mesh.numRegions)
    const upstreamCount = new Uint8Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      if (
        landMask[region] !== 0
        && flow[region] > 0
        && flow[region] >= thresholdFlow
      ) {
        candidate[region] = 1
      }
    }
    for (let region = 0; region < mesh.numRegions; region++) {
      const downstream = downstreamRegion[region]
      if (
        candidate[region] !== 0
        && downstream >= 0
        && candidate[downstream] !== 0
      ) {
        upstreamCount[downstream]++
      }
    }

    const riverMask = new Uint8Array(mesh.numRegions)
    const acceptedSources: number[] = []
    const safeMinimumLength = Math.max(1, Math.floor(minimumLength))
    for (let channelSource = 0; channelSource < mesh.numRegions; channelSource++) {
      if (
        candidate[channelSource] === 0
        || upstreamCount[channelSource] !== 0
      ) {
        continue
      }

      const source = this.extendSourceUpstream(
        mesh,
        landMask,
        downstreamRegion,
        flow,
        channelSource,
        thresholdFlow * HEADWATER_FLOW_RATIO,
      )
      if (
        elevation[source] < minimumSourceElevation
        && lakeOutflowMask[source] === 0
      ) {
        continue
      }

      const path: number[] = []
      let current = source
      for (let guard = 0; guard < mesh.numRegions; guard++) {
        if (landMask[current] === 0)
          break
        const downstream = downstreamRegion[current]
        if (downstream < 0)
          break
        path.push(current)
        if (landMask[downstream] === 0)
          break
        current = downstream
      }
      if (path.length < safeMinimumLength)
        continue
      acceptedSources.push(source)
      for (const region of path)
        riverMask[region] = 1
    }

    const segmentSources: number[] = []
    const segmentTargets: number[] = []
    for (let region = 0; region < mesh.numRegions; region++) {
      if (riverMask[region] === 0)
        continue
      const downstream = downstreamRegion[region]
      if (downstream < 0)
        continue
      segmentSources.push(region)
      segmentTargets.push(downstream)
    }

    return {
      riverMask,
      sourceRegions: new Uint32Array(acceptedSources),
      segmentSource: new Uint32Array(segmentSources),
      segmentTarget: new Uint32Array(segmentTargets),
    }
  }

  private extendSourceUpstream(
    mesh: SphericalMesh,
    landMask: Uint8Array,
    downstreamRegion: Int32Array,
    flow: Float32Array,
    channelSource: number,
    minimumHeadwaterFlow: number,
  ): number {
    let current = channelSource
    for (let guard = 0; guard < mesh.numRegions; guard++) {
      let primaryUpstream = -1
      let primaryFlow = -Infinity
      for (const neighbor of mesh.forEachNeighborOfRegion(current)) {
        if (
          landMask[neighbor] === 0
          || downstreamRegion[neighbor] !== current
          || flow[neighbor] < minimumHeadwaterFlow
        ) {
          continue
        }
        if (
          flow[neighbor] > primaryFlow
          || (flow[neighbor] === primaryFlow && neighbor < primaryUpstream)
        ) {
          primaryUpstream = neighbor
          primaryFlow = flow[neighbor]
        }
      }
      if (primaryUpstream < 0)
        break
      current = primaryUpstream
    }
    return current
  }
}
