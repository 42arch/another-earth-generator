import type SphericalMesh from '@/core/mesh/mesh'
import { clamp } from '@/core/math/math'
import { MinPriorityQueue } from '@/core/math/priority-queue'

interface InfluenceFrontier {
  region: number
  cost: number
}

export interface SphericalInfluenceRoute {
  sourceRegion: number
  targetRegion: number
  kind: 'shipping' | 'contact'
  baseCost: number
  reliability: number
  strength: number
  tradeStrength: number
}

export interface SphericalInfluenceSpreadOptions {
  landMask: Uint8Array
  seedRegions: number[]
  routes: SphericalInfluenceRoute[]
  blending: number
  edgeCost: (domain: number, from: number, to: number) => number
  routeCost: (domain: number, route: SphericalInfluenceRoute) => number
}

export interface SphericalInfluenceSpreadResult {
  regionOwner: Int16Array
  influence: Float32Array
}

export function spreadSphericalInfluence(
  mesh: SphericalMesh,
  options: SphericalInfluenceSpreadOptions,
): SphericalInfluenceSpreadResult {
  const regionOwner = new Int16Array(mesh.numRegions).fill(-1)
  const influence = new Float32Array(mesh.numRegions)
  if (options.seedRegions.length === 0)
    return { regionOwner, influence }

  const bestCost = new Float64Array(mesh.numRegions).fill(Infinity)
  const secondCost = new Float64Array(mesh.numRegions).fill(Infinity)
  const routesBySource = new Map<number, SphericalInfluenceRoute[]>()
  for (const route of options.routes) {
    const group = routesBySource.get(route.sourceRegion)
    if (group)
      group.push(route)
    else
      routesBySource.set(route.sourceRegion, [route])
  }

  for (let domain = 0; domain < options.seedRegions.length; domain++) {
    const seedRegion = options.seedRegions[domain]
    if (options.landMask[seedRegion] === 0)
      continue
    const domainCost = new Float64Array(mesh.numRegions).fill(Infinity)
    const queue = new MinPriorityQueue<InfluenceFrontier>()
    domainCost[seedRegion] = 0
    queue.push({ region: seedRegion, cost: 0 })
    while (queue.size > 0) {
      const current = queue.pop()
      if (current.cost !== domainCost[current.region])
        continue
      const nStart = mesh.neighborOffsets[current.region]
      const nEnd = mesh.neighborOffsets[current.region + 1]
      for (let n = nStart; n < nEnd; n++) {
        const neighbor = mesh.neighbors[n]
        if (options.landMask[neighbor] === 0)
          continue
        const nextCost = current.cost + options.edgeCost(domain, current.region, neighbor)
        if (!Number.isFinite(nextCost) || nextCost >= domainCost[neighbor])
          continue
        domainCost[neighbor] = nextCost
        queue.push({ region: neighbor, cost: nextCost })
      }
      for (const influenceRoute of routesBySource.get(current.region) ?? []) {
        const nextCost = current.cost + options.routeCost(domain, influenceRoute)
        if (!Number.isFinite(nextCost) || nextCost >= domainCost[influenceRoute.targetRegion])
          continue
        domainCost[influenceRoute.targetRegion] = nextCost
        queue.push({ region: influenceRoute.targetRegion, cost: nextCost })
      }
    }

    for (let region = 0; region < mesh.numRegions; region++) {
      const cost = domainCost[region]
      if (cost < bestCost[region]) {
        secondCost[region] = bestCost[region]
        bestCost[region] = cost
        regionOwner[region] = domain
      }
      else if (cost < secondCost[region]) {
        secondCost[region] = cost
      }
    }
  }

  const blendScale = 1 + clamp(options.blending, 0, 1) * 9
  for (let region = 0; region < mesh.numRegions; region++) {
    if (regionOwner[region] < 0)
      continue
    if (!Number.isFinite(secondCost[region])) {
      influence[region] = 1
      continue
    }
    const margin = Math.max(0, secondCost[region] - bestCost[region])
    influence[region] = clamp(0.28 + margin / blendScale, 0.28, 1)
  }
  return { regionOwner, influence }
}
