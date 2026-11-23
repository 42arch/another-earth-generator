import type { SphericalMesh } from '#mesh/spherical-mesh'
import { IndexPriorityQueue } from '#generation/nature/common/priority-queue'
import { InvalidStageInputError } from '#generation/pipeline/errors'
import { greatCircleDistanceKm } from '#math/spherical'

export interface TerritoryShortcut {
  readonly toRegion: number
  readonly cost: number
  readonly isSea: boolean
}

type LayoutMesh = Pick<SphericalMesh, 'regionCount' | 'centers' | 'areaKm2' | 'neighborOffsets' | 'neighbors' | 'physicalRadiusKm'>

export interface TerritoryComponents {
  readonly index: Int32Array
  /** Physical land area, excluding lake surfaces. */
  readonly areaKm2: readonly number[]
  readonly population: readonly number[]
}

/** Connected by land or an existing usable transport route; no implicit overseas reach. */
export function buildTerritoryComponents(
  mesh: LayoutMesh,
  landMask: Uint8Array,
  lakeIndex: Int32Array,
  population: Float64Array,
  shortcuts: ReadonlyMap<number, readonly TerritoryShortcut[]>,
  check?: () => void,
): TerritoryComponents {
  const index = new Int32Array(mesh.regionCount).fill(-1)
  const areaKm2: number[] = []
  const inhabitants: number[] = []
  const queue: number[] = []
  for (let r = 0; r < mesh.regionCount; r++) {
    if ((r & 4095) === 0)
      check?.()
    if (landMask[r] !== 1 || index[r]! >= 0)
      continue
    const group = areaKm2.length
    areaKm2.push(0)
    inhabitants.push(0)
    queue.length = 0
    queue.push(r)
    index[r] = group
    const visit = (v: number) => {
      if (landMask[v] === 1 && index[v] === -1) {
        index[v] = group
        queue.push(v)
      }
    }
    for (let head = 0; head < queue.length; head++) {
      if ((head & 4095) === 0)
        check?.()
      const u = queue[head]!
      if (lakeIndex[u]! < 0)
        areaKm2[group]! += mesh.areaKm2[u]!
      inhabitants[group]! += population[u]!
      for (let e = mesh.neighborOffsets[u]; e < mesh.neighborOffsets[u + 1]; e++)
        visit(mesh.neighbors[e]!)
      for (const edge of shortcuts.get(u) ?? [])
        visit(edge.toRegion)
    }
  }
  return { index, areaKm2, population: inhabitants }
}

export function checkPolityCountBudget(count: number, availableSites: number): void {
  if (availableSites < count)
    throw new InvalidStageInputError('polities-religions', `Requested ${count} polities, but only ${availableSites} distinct land settlements are available (feasible count: ${availableSites ? `1-${Math.min(200, availableSites)}` : '0'})`)
}

/** One total budget, including isolated islands. Farthest-point fill has no hard spacing veto. */
export function selectPolityCapitals<T extends { readonly id: string, readonly regionId: number }>(
  sites: readonly T[],
  count: number,
  mesh: LayoutMesh,
  components: TerritoryComponents,
  siteScore: (site: T) => number,
  check?: () => void,
): readonly T[] {
  const bestByComponent = new Map<number, number>()
  for (let i = 0; i < sites.length; i++) {
    const group = components.index[sites[i]!.regionId]!
    if (!bestByComponent.has(group))
      bestByComponent.set(group, i)
  }
  const selected: T[] = []
  const used = new Uint8Array(sites.length)
  const nearest = new Float64Array(sites.length).fill(Infinity)
  const maxScore = sites.reduce((largest, site) => Math.max(largest, siteScore(site)), 1)
  const choose = (i: number) => {
    const site = sites[i]!
    selected.push(site)
    used[i] = 1
    const u = site.regionId
    for (let j = 0; j < sites.length; j++) {
      const v = sites[j]!.regionId
      const distance = greatCircleDistanceKm(
        { x: mesh.centers[3 * u], y: mesh.centers[3 * u + 1], z: mesh.centers[3 * u + 2] },
        { x: mesh.centers[3 * v], y: mesh.centers[3 * v + 1], z: mesh.centers[3 * v + 2] },
        mesh.physicalRadiusKm,
      )
      nearest[j] = Math.min(nearest[j]!, distance)
    }
  }
  const groups = [...bestByComponent.keys()].sort((a, b) =>
    components.population[b]! - components.population[a]!
    || components.areaKm2[b]! - components.areaKm2[a]!
    || a - b)
  for (const group of groups) {
    if (selected.length >= count)
      break
    choose(bestByComponent.get(group)!)
  }
  while (selected.length < count) {
    check?.()
    let best = -1
    let bestScore = -1
    for (let i = 0; i < sites.length; i++) {
      if (used[i])
        continue
      const score = nearest[i]! * Math.sqrt(Math.max(0, siteScore(sites[i]!)) / maxScore)
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    }
    if (best < 0)
      throw new Error('Polity capital budget exceeds unique settlement candidates')
    choose(best)
  }
  return selected
}

/** Rank-power shares: variation 0 gives equal targets; 1 uses inverse-square rank weights. */
export function createPolityAreaTargets(
  mesh: LayoutMesh,
  capitalRegions: readonly number[],
  components: TerritoryComponents,
  variation: number,
  rankScores: readonly number[],
): Float64Array {
  const byGroup = new Map<number, number[]>()
  for (let p = 0; p < capitalRegions.length; p++) {
    const group = components.index[capitalRegions[p]!]!
    let indices = byGroup.get(group)
    if (!indices) {
      indices = []
      byGroup.set(group, indices)
    }
    indices.push(p)
  }
  const targets = new Float64Array(capitalRegions.length)
  for (const [group, indices] of byGroup) {
    indices.sort((a, b) => rankScores[b]! - rankScores[a]! || a - b)
    const weights = indices.map((_, rank) => (rank + 1) ** (-2 * variation))
    const totalWeight = weights.reduce((sum, value) => sum + value, 0)
    const reserved = indices.reduce((sum, p) => sum + mesh.areaKm2[capitalRegions[p]!]!, 0)
    const remaining = Math.max(0, components.areaKm2[group]! - reserved)
    for (let rank = 0; rank < indices.length; rank++) {
      const p = indices[rank]!
      targets[p] = mesh.areaKm2[capitalRegions[p]!]! + remaining * weights[rank]! / totalWeight
    }
  }
  return targets
}

export interface TerritoryGrowthContext {
  readonly mesh: LayoutMesh
  readonly landMask: Uint8Array
  readonly lakeIndex: Int32Array
  readonly capitalRegions: readonly number[]
  readonly targetAreasKm2: Float64Array
  readonly shortcuts: ReadonlyMap<number, readonly TerritoryShortcut[]>
  readonly landStepCost: (polity: number, from: number, to: number) => number
  readonly shortcutCost: (polity: number, from: number, edge: TerritoryShortcut) => number
  readonly check?: () => void
}

/**
 * Expands the least-filled reachable polity first, with a separate cost frontier per polity.
 * Every accepted cell keeps one owner. Countries cannot pass through another country's land;
 * explicit transport routes can connect separate territories. Blocked targets remain advisory.
 */
export function growPolityTerritories(ctx: TerritoryGrowthContext): Int32Array {
  const { mesh, landMask, lakeIndex, capitalRegions, targetAreasKm2, shortcuts } = ctx
  const owners = new Int32Array(mesh.regionCount).fill(-1)
  const claimedArea = new Float64Array(capitalRegions.length)
  const distance = new Float32Array(mesh.regionCount)
  const frontiers = capitalRegions.map(() => new IndexPriorityQueue(64))
  const pending = capitalRegions.map(() => new Map<number, number>())
  const schedule = new IndexPriorityQueue(Math.max(1, capitalRegions.length))
  for (let p = 0; p < capitalRegions.length; p++) {
    owners[capitalRegions[p]!] = p
    claimedArea[p] = mesh.areaKm2[capitalRegions[p]!]!
  }
  const offer = (p: number, u: number, v: number, step: number) => {
    if (landMask[v] !== 1 || owners[v]! >= 0)
      return
    const cost = Math.fround(distance[u]! + step)
    if (!Number.isFinite(cost) || cost < 0)
      throw new Error('Invalid polity expansion cost')
    if (cost < (pending[p]!.get(v) ?? Infinity)) {
      pending[p]!.set(v, cost)
      frontiers[p]!.push(v, cost)
    }
  }
  const extend = (p: number, u: number) => {
    for (let e = mesh.neighborOffsets[u]; e < mesh.neighborOffsets[u + 1]; e++) {
      const v = mesh.neighbors[e]!
      if (landMask[v] === 1 && owners[v] === -1)
        offer(p, u, v, ctx.landStepCost(p, u, v))
    }
    for (const edge of shortcuts.get(u) ?? []) {
      if (owners[edge.toRegion] === -1)
        offer(p, u, edge.toRegion, ctx.shortcutCost(p, u, edge))
    }
  }
  for (let p = 0; p < capitalRegions.length; p++) {
    extend(p, capitalRegions[p]!)
    if (frontiers[p]!.size)
      schedule.push(p, claimedArea[p]! / targetAreasKm2[p]!)
  }
  let iterations = 0
  while (schedule.size) {
    if ((iterations++ & 4095) === 0)
      ctx.check?.()
    const p = schedule.pop()
    const frontier = frontiers[p]!
    while (frontier.size) {
      const v = frontier.pop()
      const cost = pending[p]!.get(v)
      pending[p]!.delete(v)
      if (owners[v]! >= 0 || cost === undefined)
        continue
      owners[v] = p
      distance[v] = cost
      if (lakeIndex[v]! < 0)
        claimedArea[p]! += mesh.areaKm2[v]!
      extend(p, v)
      break
    }
    if (frontier.size)
      schedule.push(p, claimedArea[p]! / targetAreasKm2[p]!)
  }
  return owners
}
