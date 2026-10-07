import type SphericalMesh from '@/core/mesh/mesh'
import { MinPriorityQueue } from '@/core/math/priority-queue'

interface DistanceNode {
  region: number
  cost: number
}

/** Region count matching the reference project's tuning base (10K regions). */
const REFERENCE_REGION_COUNT = 10000

/** Approximate angular cell spacing at the original tuning resolution. */
export const REFERENCE_CELL_ANGLE = Math.sqrt(4 * Math.PI / REFERENCE_REGION_COUNT)

export function referenceCellsToAngle(cells: number): number {
  return cells * REFERENCE_CELL_ANGLE
}

/**
 * Computes an exact graph-geodesic distance field using spherical edge lengths.
 * Distances are expressed as central angles in radians and are independent of
 * the selected Fibonacci site count.
 */
export function computeSphericalDistanceField(
  mesh: SphericalMesh,
  isSource: (region: number) => boolean,
  canTraverse: (from: number, to: number) => boolean = () => true,
): Float32Array {
  const bestDistance = new Float64Array(mesh.numRegions).fill(Infinity)
  const queue = new MinPriorityQueue<DistanceNode>()

  for (let region = 0; region < mesh.numRegions; region++) {
    if (!isSource(region))
      continue
    bestDistance[region] = 0
    queue.push({ region, cost: 0 })
  }

  while (queue.size > 0) {
    const current = queue.pop()
    if (current.cost !== bestDistance[current.region])
      continue
    const nStart = mesh.neighborOffsets[current.region]
    const nEnd = mesh.neighborOffsets[current.region + 1]
    for (let n = nStart; n < nEnd; n++) {
      const neighbor = mesh.neighbors[n]
      if (!canTraverse(current.region, neighbor))
        continue
      const nextCost = current.cost
        + mesh.distanceBetweenRegions(current.region, neighbor)
      if (nextCost >= bestDistance[neighbor])
        continue
      bestDistance[neighbor] = nextCost
      queue.push({ region: neighbor, cost: nextCost })
    }
  }

  return Float32Array.from(bestDistance)
}

/** Assigns every region the label of its nearest labeled source by graph-geodesic distance. */
export function computeSphericalNearestLabels(
  mesh: SphericalMesh,
  sourceLabels: Int16Array,
): Int16Array {
  if (sourceLabels.length !== mesh.numRegions)
    throw new Error('Source labels must match the spherical mesh')

  const labels = Int16Array.from(sourceLabels)
  const bestDistance = new Float64Array(mesh.numRegions).fill(Infinity)
  const queue = new MinPriorityQueue<DistanceNode>()
  for (let region = 0; region < mesh.numRegions; region++) {
    if (labels[region] < 0)
      continue
    bestDistance[region] = 0
    queue.push({ region, cost: 0 })
  }

  while (queue.size > 0) {
    const current = queue.pop()
    if (current.cost !== bestDistance[current.region])
      continue
    const nStart = mesh.neighborOffsets[current.region]
    const nEnd = mesh.neighborOffsets[current.region + 1]
    for (let n = nStart; n < nEnd; n++) {
      const neighbor = mesh.neighbors[n]
      const nextCost = current.cost
        + mesh.distanceBetweenRegions(current.region, neighbor)
      if (nextCost >= bestDistance[neighbor])
        continue
      bestDistance[neighbor] = nextCost
      labels[neighbor] = labels[current.region]
      queue.push({ region: neighbor, cost: nextCost })
    }
  }

  return labels
}

/**
 * Propagates the strongest source value with exponential geodesic decay.
 * A source strength of 1 decays to e^-1 after `decayDistance` radians.
 */
export function computeSphericalInfluenceField(
  mesh: SphericalMesh,
  sourceStrength: (region: number) => number,
  decayDistance: number,
  canTraverse: (from: number, to: number) => boolean = () => true,
): Float32Array {
  const safeDecay = Math.max(decayDistance, Number.EPSILON)
  const bestCost = new Float64Array(mesh.numRegions).fill(Infinity)
  const queue = new MinPriorityQueue<DistanceNode>()

  for (let region = 0; region < mesh.numRegions; region++) {
    const strength = sourceStrength(region)
    if (strength <= 0)
      continue
    const cost = -Math.log(Math.min(1, strength))
    bestCost[region] = cost
    queue.push({ region, cost })
  }

  while (queue.size > 0) {
    const current = queue.pop()
    if (current.cost !== bestCost[current.region])
      continue
    const nStart = mesh.neighborOffsets[current.region]
    const nEnd = mesh.neighborOffsets[current.region + 1]
    for (let n = nStart; n < nEnd; n++) {
      const neighbor = mesh.neighbors[n]
      if (!canTraverse(current.region, neighbor))
        continue
      const nextCost = current.cost
        + mesh.distanceBetweenRegions(current.region, neighbor) / safeDecay
      if (nextCost >= bestCost[neighbor])
        continue
      bestCost[neighbor] = nextCost
      queue.push({ region: neighbor, cost: nextCost })
    }
  }

  return Float32Array.from(bestCost, cost => (
    Number.isFinite(cost) ? Math.exp(-cost) : 0
  ))
}
