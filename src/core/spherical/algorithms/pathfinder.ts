import type SphericalMesh from '@/core/spherical/spherical-mesh'
import { MinPriorityQueue } from '@/core/spherical/algorithms/priority-queue'

interface PathNode {
  region: number
  travelCost: number
  cost: number
}

export interface SphericalPathOptions {
  isPassable: (region: number) => boolean
  edgeCost: (from: number, to: number) => number
  heuristicCost: (region: number, target: number) => number
}

export function findSphericalPath(
  mesh: SphericalMesh,
  start: number,
  target: number,
  options: SphericalPathOptions,
): Uint32Array {
  if (start === target)
    return new Uint32Array([start])
  if (!options.isPassable(start) || !options.isPassable(target))
    return new Uint32Array()

  const bestCost = new Float64Array(mesh.numRegions).fill(Infinity)
  const previous = new Int32Array(mesh.numRegions).fill(-1)
  const queue = new MinPriorityQueue<PathNode>()
  bestCost[start] = 0
  queue.push({
    region: start,
    travelCost: 0,
    cost: options.heuristicCost(start, target),
  })

  while (queue.size > 0) {
    const current = queue.pop()
    if (current.travelCost !== bestCost[current.region])
      continue
    if (current.region === target)
      return reconstructPath(previous, start, target)

    for (const neighbor of mesh.forEachNeighborOfRegion(current.region)) {
      if (!options.isPassable(neighbor))
        continue
      const edgeCost = options.edgeCost(current.region, neighbor)
      if (!Number.isFinite(edgeCost) || edgeCost < 0)
        continue
      const nextCost = current.travelCost + edgeCost
      if (nextCost >= bestCost[neighbor])
        continue
      bestCost[neighbor] = nextCost
      previous[neighbor] = current.region
      queue.push({
        region: neighbor,
        travelCost: nextCost,
        cost: nextCost + options.heuristicCost(neighbor, target),
      })
    }
  }
  return new Uint32Array()
}

function reconstructPath(
  previous: Int32Array,
  start: number,
  target: number,
): Uint32Array {
  const path: number[] = []
  let region = target
  while (region >= 0) {
    path.push(region)
    if (region === start)
      break
    region = previous[region]
  }
  if (path[path.length - 1] !== start)
    return new Uint32Array()
  path.reverse()
  return new Uint32Array(path)
}
