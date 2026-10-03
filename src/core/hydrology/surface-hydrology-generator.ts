import type SphericalMesh from '@/core/mesh/mesh'
import { drainageGeometry } from '@/core/hydrology/drainage-geometry'
import { RUNOFF_ACCUMULATION_TO_DISCHARGE } from '@/core/hydrology/hydrology-units'
import { MinPriorityQueue } from '@/core/math/priority-queue'

const FLOOD_EPSILON = 1e-5
const FLOOD_TIE_BREAK = 1e-9
// The accumulated field double-counts upstream contributions along each path;
// use a conservative fraction of the global total so high-resolution worlds
// still retain visible tributaries.
const RIVER_THRESHOLD_FRACTION = 0.00008
const MIN_RIVER_THRESHOLD = 0.02

export const SURFACE_HYDROLOGY_VERSION = 4

interface FloodNode {
  region: number
  cost: number
}

export interface SurfaceDrainageData {
  /** Depression-resolved surface used to build a monotonic drainage tree. */
  drainageElevation: Float32Array
  /** Downstream region; ocean cells and closed sinks use -1. */
  downstream: Int32Array
  /** Angular length of each selected downstream edge; zero at closed sinks and ocean cells. */
  downstreamDistance: Float64Array
  /** Accumulated mm/year × unit-sphere area; retained for river threshold compatibility. */
  flowAccumulation: Float32Array
  /** Physical annual mean discharge in m³/s. */
  discharge: Float32Array
  /** Land regions ordered upstream to downstream, including closed sinks. */
  topologicalOrder: Uint32Array
  outletMask: Uint8Array
}

export interface SurfaceHydrologyData extends SurfaceDrainageData {
  version: number
  riverMask: Uint8Array
  riverOrder: Uint8Array
  riverThreshold: number
}

/** First-pass spherical drainage and annual river extraction. */
export class SurfaceHydrologyGenerator {
  generate(
    mesh: SphericalMesh,
    elevation: Float32Array,
    oceanMask: Uint8Array,
    annualRunoff: Float32Array,
  ): SurfaceHydrologyData {
    const drainage = this.routeRunoff(mesh, elevation, oceanMask, annualRunoff)
    const { downstream, flowAccumulation } = drainage
    const riverThreshold = this.computeRiverThreshold(mesh, oceanMask, flowAccumulation)
    const riverMask = this.buildRiverMask(mesh, oceanMask, downstream, flowAccumulation, riverThreshold)
    const riverOrder = this.buildRiverOrder(mesh, oceanMask, downstream, riverMask)
    return { version: SURFACE_HYDROLOGY_VERSION, ...drainage, riverMask, riverOrder, riverThreshold }
  }

  /** Shared routing for erosion and final hydrology; filling affects routing only, never the terrain. */
  routeRunoff(
    mesh: SphericalMesh,
    elevation: Float32Array,
    oceanMask: Uint8Array,
    annualRunoff: Float32Array,
  ): SurfaceDrainageData {
    const drainage = this.buildDrainageSurface(mesh, elevation, oceanMask)
    const routing = this.buildDownstream(
      mesh,
      drainage.surface,
      drainage.parent,
      oceanMask,
    )
    const { flowAccumulation, topologicalOrder } = this.accumulateRunoff(
      mesh,
      oceanMask,
      routing.downstream,
      annualRunoff,
    )
    const discharge = new Float32Array(mesh.numRegions)
    for (let i = 0; i < mesh.numRegions; i++)
      discharge[i] = flowAccumulation[i] * RUNOFF_ACCUMULATION_TO_DISCHARGE

    return {
      drainageElevation: drainage.surface,
      downstream: routing.downstream,
      downstreamDistance: routing.downstreamDistance,
      flowAccumulation,
      discharge,
      topologicalOrder,
      outletMask: routing.outletMask,
    }
  }

  private buildDrainageSurface(
    mesh: SphericalMesh,
    elevation: Float32Array,
    oceanMask: Uint8Array,
  ): { surface: Float32Array, parent: Int32Array } {
    const surface = Float32Array.from(elevation)
    const parent = new Int32Array(mesh.numRegions).fill(-1)
    const visited = Uint8Array.from(oceanMask)
    const queue = new MinPriorityQueue<FloodNode>()

    for (let region = 0; region < mesh.numRegions; region++) {
      if (oceanMask[region] !== 0 || !this.hasOceanNeighbor(mesh, region, oceanMask))
        continue
      visited[region] = 1
      queue.push({
        region,
        cost: surface[region] + region * FLOOD_TIE_BREAK,
      })
    }

    this.floodLand(mesh, oceanMask, visited, surface, parent, queue)

    // A fully enclosed land component has no ocean boundary. Seed its lowest
    // cell as an internal sink until lake routing is added in the next pass.
    while (true) {
      let lowest = -1
      for (let region = 0; region < mesh.numRegions; region++) {
        if (oceanMask[region] !== 0 || visited[region] !== 0)
          continue
        if (lowest < 0 || elevation[region] < elevation[lowest])
          lowest = region
      }
      if (lowest < 0)
        break
      visited[lowest] = 1
      queue.push({
        region: lowest,
        cost: surface[lowest] + lowest * FLOOD_TIE_BREAK,
      })
      this.floodLand(mesh, oceanMask, visited, surface, parent, queue)
    }

    return { surface, parent }
  }

  private floodLand(
    mesh: SphericalMesh,
    oceanMask: Uint8Array,
    visited: Uint8Array,
    surface: Float32Array,
    parent: Int32Array,
    queue: MinPriorityQueue<FloodNode>,
  ): void {
    const { offsets, neighbors } = drainageGeometry(mesh)
    while (queue.size > 0) {
      const current = queue.pop()
      for (let entry = offsets[current.region]; entry < offsets[current.region + 1]; entry++) {
        const neighbor = neighbors[entry]
        if (oceanMask[neighbor] !== 0 || visited[neighbor] !== 0)
          continue
        visited[neighbor] = 1
        parent[neighbor] = current.region
        surface[neighbor] = Math.max(
          surface[neighbor],
          surface[current.region] + FLOOD_EPSILON,
        )
        queue.push({
          region: neighbor,
          cost: surface[neighbor] + neighbor * FLOOD_TIE_BREAK,
        })
      }
    }
  }

  private buildDownstream(
    mesh: SphericalMesh,
    drainageElevation: Float32Array,
    parent: Int32Array,
    oceanMask: Uint8Array,
  ): { downstream: Int32Array, downstreamDistance: Float64Array, outletMask: Uint8Array } {
    const downstream = new Int32Array(mesh.numRegions).fill(-1)
    const downstreamDistance = new Float64Array(mesh.numRegions)
    const outletMask = new Uint8Array(mesh.numRegions)
    const { offsets, neighbors, distance } = drainageGeometry(mesh)

    for (let region = 0; region < mesh.numRegions; region++) {
      if (oceanMask[region] !== 0)
        continue

      let bestNeighbor = -1
      let bestSlope = 0
      let oceanNeighbor = -1
      let bestDistance = 0
      let oceanDistance = 0
      let parentDistance = 0
      for (let entry = offsets[region]; entry < offsets[region + 1]; entry++) {
        const neighbor = neighbors[entry]
        if (neighbor === parent[region])
          parentDistance = distance[entry]
        if (oceanMask[neighbor] !== 0) {
          if (oceanNeighbor < 0 || neighbor < oceanNeighbor) {
            oceanNeighbor = neighbor
            oceanDistance = distance[entry]
          }
          continue
        }
        const drop = drainageElevation[region] - drainageElevation[neighbor]
        if (drop <= 0)
          continue
        const slope = drop / Math.max(1e-8, distance[entry])
        if (
          slope > bestSlope
          || (slope === bestSlope && neighbor < bestNeighbor)
        ) {
          bestSlope = slope
          bestNeighbor = neighbor
          bestDistance = distance[entry]
        }
      }

      if (bestNeighbor >= 0) {
        downstream[region] = bestNeighbor
        downstreamDistance[region] = bestDistance
      }
      else if (oceanNeighbor >= 0) {
        downstream[region] = oceanNeighbor
        downstreamDistance[region] = oceanDistance
        outletMask[region] = 1
      }
      else if (parent[region] >= 0) {
        downstream[region] = parent[region]
        downstreamDistance[region] = parentDistance
      }
    }

    return { downstream, downstreamDistance, outletMask }
  }

  private accumulateRunoff(
    mesh: SphericalMesh,
    oceanMask: Uint8Array,
    downstream: Int32Array,
    annualRunoff: Float32Array,
  ): { flowAccumulation: Float32Array, topologicalOrder: Uint32Array } {
    const flow = new Float32Array(mesh.numRegions)
    const inDegree = new Uint32Array(mesh.numRegions)
    const queue = new Uint32Array(mesh.numRegions)
    let queueEnd = 0
    let landCount = 0
    for (let region = 0; region < mesh.numRegions; region++) {
      if (oceanMask[region] !== 0)
        continue
      landCount++
      flow[region] = Math.max(0, annualRunoff[region]) * mesh.regionArea[region]
      const target = downstream[region]
      if (target >= 0 && oceanMask[target] === 0)
        inDegree[target]++
    }

    for (let region = 0; region < mesh.numRegions; region++) {
      if (oceanMask[region] === 0 && inDegree[region] === 0)
        queue[queueEnd++] = region
    }

    let queueStart = 0
    while (queueStart < queueEnd) {
      const region = queue[queueStart++]
      const target = downstream[region]
      if (target < 0)
        continue
      flow[target] += flow[region]
      if (oceanMask[target] !== 0)
        continue
      inDegree[target]--
      if (inDegree[target] === 0)
        queue[queueEnd++] = target
    }
    if (queueEnd !== landCount)
      throw new Error('Surface drainage contains a cycle')
    return { flowAccumulation: flow, topologicalOrder: queue.slice(0, queueEnd) }
  }

  private computeRiverThreshold(
    mesh: SphericalMesh,
    oceanMask: Uint8Array,
    flowAccumulation: Float32Array,
  ): number {
    let totalFlow = 0
    let maximumFlow = 0
    for (let region = 0; region < mesh.numRegions; region++) {
      if (oceanMask[region] !== 0)
        continue
      totalFlow += flowAccumulation[region]
      maximumFlow = Math.max(maximumFlow, flowAccumulation[region])
    }
    if (totalFlow <= 0 || maximumFlow <= 0)
      return Number.POSITIVE_INFINITY
    return Math.min(
      maximumFlow * 0.4,
      Math.max(MIN_RIVER_THRESHOLD, totalFlow * RIVER_THRESHOLD_FRACTION),
    )
  }

  private buildRiverMask(
    mesh: SphericalMesh,
    oceanMask: Uint8Array,
    downstream: Int32Array,
    flowAccumulation: Float32Array,
    threshold: number,
  ): Uint8Array {
    const riverMask = new Uint8Array(mesh.numRegions)
    if (!Number.isFinite(threshold))
      return riverMask
    for (let region = 0; region < mesh.numRegions; region++) {
      if (
        oceanMask[region] === 0
        && downstream[region] >= 0
        && flowAccumulation[region] >= threshold
      ) {
        riverMask[region] = 1
      }
    }

    // Filter out rivers with a length of less than 2 cells (isolated 1-cell rivers)
    const inDegree = new Uint8Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      if (riverMask[region] === 1) {
        const target = downstream[region]
        if (target >= 0 && target < mesh.numRegions && riverMask[target] === 1) {
          inDegree[target]++
        }
      }
    }
    for (let region = 0; region < mesh.numRegions; region++) {
      if (riverMask[region] === 1 && inDegree[region] === 0) {
        const target = downstream[region]
        if (target < 0 || target >= mesh.numRegions || riverMask[target] === 0) {
          riverMask[region] = 0
        }
      }
    }

    return riverMask
  }

  private buildRiverOrder(
    mesh: SphericalMesh,
    oceanMask: Uint8Array,
    downstream: Int32Array,
    riverMask: Uint8Array,
  ): Uint8Array {
    const riverOrder = new Uint8Array(mesh.numRegions)
    const maximumUpstreamOrder = new Uint8Array(mesh.numRegions)
    const sameOrderCount = new Uint8Array(mesh.numRegions)
    const inDegree = new Uint32Array(mesh.numRegions)
    const queue = new Uint32Array(mesh.numRegions)
    let queueEnd = 0
    for (let region = 0; region < mesh.numRegions; region++) {
      if (riverMask[region] === 0)
        continue
      const target = downstream[region]
      if (target >= 0 && target < mesh.numRegions && riverMask[target] !== 0)
        inDegree[target]++
    }

    for (let region = 0; region < mesh.numRegions; region++) {
      if (riverMask[region] !== 0 && inDegree[region] === 0)
        queue[queueEnd++] = region
    }

    let queueStart = 0
    while (queueStart < queueEnd) {
      const region = queue[queueStart++]
      const order = maximumUpstreamOrder[region] === 0
        ? 1
        : Math.min(
            15,
            maximumUpstreamOrder[region] + (sameOrderCount[region] >= 2 ? 1 : 0),
          )
      riverOrder[region] = order
      const target = downstream[region]
      if (
        target < 0
        || target >= mesh.numRegions
        || oceanMask[target] !== 0
        || riverMask[target] === 0
      ) {
        continue
      }
      if (order > maximumUpstreamOrder[target]) {
        maximumUpstreamOrder[target] = order
        sameOrderCount[target] = 1
      }
      else if (order === maximumUpstreamOrder[target]) {
        sameOrderCount[target] = Math.min(255, sameOrderCount[target] + 1)
      }
      inDegree[target]--
      if (inDegree[target] === 0)
        queue[queueEnd++] = target
    }
    return riverOrder
  }

  private hasOceanNeighbor(
    mesh: SphericalMesh,
    region: number,
    oceanMask: Uint8Array,
  ): boolean {
    const { offsets, neighbors } = drainageGeometry(mesh)
    for (let entry = offsets[region]; entry < offsets[region + 1]; entry++) {
      if (oceanMask[neighbors[entry]] !== 0)
        return true
    }
    return false
  }
}
