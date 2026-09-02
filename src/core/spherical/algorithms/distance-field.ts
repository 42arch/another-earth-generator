import type SphericalMesh from '@/core/spherical/spherical-mesh'
import { MinPriorityQueue } from '@/core/spherical/algorithms/priority-queue'

interface DistanceNode {
  region: number
  cost: number
}

/** Region count used by the original subdivision-6 tuning constants. */
const REFERENCE_REGION_COUNT = 40962

/** Approximate angular cell spacing at the original tuning resolution. */
export const REFERENCE_CELL_ANGLE = Math.sqrt(4 * Math.PI / REFERENCE_REGION_COUNT)

export function referenceCellsToAngle(cells: number): number {
  return cells * REFERENCE_CELL_ANGLE
}

/**
 * Computes an exact graph-geodesic distance field using spherical edge lengths.
 * Distances are expressed as central angles in radians and are independent of
 * the selected Icosphere subdivision level.
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
    for (const neighbor of mesh.forEachNeighborOfRegion(current.region)) {
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
