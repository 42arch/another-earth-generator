import type SphericalMesh from '@/core/mesh/mesh'
import { IndexPriorityQueue } from '@/core/math/priority-queue'

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
  maxDistance = Infinity,
): Float32Array {
  const numRegions = mesh.numRegions
  const bestDistance = new Float32Array(numRegions).fill(Infinity)
  const queue = new IndexPriorityQueue(numRegions)
  const neighborOffsets = mesh.neighborOffsets
  const neighbors = mesh.neighbors
  const distances = mesh.neighborDistances

  for (let region = 0; region < numRegions; region++) {
    if (!isSource(region))
      continue
    bestDistance[region] = 0
    queue.push(region, 0)
  }

  while (queue.size > 0) {
    const current = queue.pop()
    const currentCost = bestDistance[current]
    if (currentCost >= maxDistance)
      continue
    const nStart = neighborOffsets[current]
    const nEnd = neighborOffsets[current + 1]
    for (let n = nStart; n < nEnd; n++) {
      const neighbor = neighbors[n]
      if (!canTraverse(current, neighbor))
        continue
      const nextCost = currentCost + distances[n]
      if (nextCost >= bestDistance[neighbor] || nextCost > maxDistance)
        continue
      bestDistance[neighbor] = nextCost
      queue.push(neighbor, nextCost)
    }
  }

  return bestDistance
}

/** Assigns every region the label of its nearest labeled source by graph-geodesic distance. */
export function computeSphericalNearestLabels(
  mesh: SphericalMesh,
  sourceLabels: Int16Array,
): Int16Array {
  if (sourceLabels.length !== mesh.numRegions)
    throw new Error('Source labels must match the spherical mesh')

  const numRegions = mesh.numRegions
  const labels = Int16Array.from(sourceLabels)
  const bestDistance = new Float32Array(numRegions).fill(Infinity)
  const queue = new IndexPriorityQueue(numRegions)
  const neighborOffsets = mesh.neighborOffsets
  const neighbors = mesh.neighbors
  const distances = mesh.neighborDistances

  for (let region = 0; region < numRegions; region++) {
    if (labels[region] < 0)
      continue
    bestDistance[region] = 0
    queue.push(region, 0)
  }

  while (queue.size > 0) {
    const current = queue.pop()
    const currentCost = bestDistance[current]
    const nStart = neighborOffsets[current]
    const nEnd = neighborOffsets[current + 1]
    for (let n = nStart; n < nEnd; n++) {
      const neighbor = neighbors[n]
      const nextCost = currentCost + distances[n]
      if (nextCost >= bestDistance[neighbor])
        continue
      bestDistance[neighbor] = nextCost
      labels[neighbor] = labels[current]
      queue.push(neighbor, nextCost)
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
  maxCost = 6.0,
): Float32Array {
  const safeDecay = Math.max(decayDistance, Number.EPSILON)
  const numRegions = mesh.numRegions
  const bestCost = new Float32Array(numRegions).fill(Infinity)
  const queue = new IndexPriorityQueue(numRegions)
  const neighborOffsets = mesh.neighborOffsets
  const neighbors = mesh.neighbors
  const distances = mesh.neighborDistances

  for (let region = 0; region < numRegions; region++) {
    const strength = sourceStrength(region)
    if (strength <= 0)
      continue
    const cost = -Math.log(Math.min(1, strength))
    if (cost >= maxCost)
      continue
    bestCost[region] = cost
    queue.push(region, cost)
  }

  while (queue.size > 0) {
    const current = queue.pop()
    const currentCost = bestCost[current]
    if (currentCost >= maxCost)
      continue
    const nStart = neighborOffsets[current]
    const nEnd = neighborOffsets[current + 1]
    for (let n = nStart; n < nEnd; n++) {
      const neighbor = neighbors[n]
      if (!canTraverse(current, neighbor))
        continue
      const nextCost = currentCost + distances[n] / safeDecay
      if (nextCost >= bestCost[neighbor] || nextCost >= maxCost)
        continue
      bestCost[neighbor] = nextCost
      queue.push(neighbor, nextCost)
    }
  }

  const result = new Float32Array(numRegions)
  for (let region = 0; region < numRegions; region++) {
    const cost = bestCost[region]
    if (cost < maxCost)
      result[region] = Math.exp(-cost)
  }
  return result
}
