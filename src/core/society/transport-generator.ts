import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import type { SocietyData, TransportData, TransportRoute } from '@/core/society/society-data'
import { HYDROLOGY_RADIUS_M } from '@/core/hydrology/hydrology-units'
import { clamp } from '@/core/math/math'
import { IndexPriorityQueue } from '@/core/math/priority-queue'
import { landTravelCost } from '@/core/society/travel-cost'

const RADIUS_KM = HYDROLOGY_RADIUS_M / 1000
const MAX_SEA_COST_KM = 1800
const MAX_PORT_LAND_STEPS = 2
const SEA_LOADING_COST_KM = 120
const COASTAL_ROUTE_COST_RATIO = 0.85

interface Source {
  region: number
  settlement: number
  costKm?: number
}

interface PortSource extends Source {
  costKm: number
  /** Adjacent region path from the settlement centre to the first ocean cell. */
  path: number[]
}

interface Spread {
  owner: Int32Array
  cost: Float32Array
  parent: Int32Array
  root: Int32Array
}

interface Candidate {
  from: number
  to: number
  boundaryFrom: number
  boundaryTo: number
  costKm: number
  directSeaRegion?: number
}

/** Builds a sparse route network from weighted settlement catchments. */
export class TransportGenerator {
  generate(mesh: SphericalMesh, data: WorldSimulationState, config: WorldConfig): TransportData {
    const society = data.society
    if (!society)
      throw new Error('Transport generation requires population and settlements')

    const count = mesh.numRegions
    const roadRegionMask = new Uint8Array(count)
    const routeByRegion = new Int32Array(count).fill(-1)
    const portSettlementIds = new Uint8Array(society.settlements.length)
    const landSources = society.settlements.map(settlement => ({ region: settlement.region, settlement: settlement.id }))
    const land = this.spread(mesh, data, config, landSources, false)
    const candidates = this.findCandidates(mesh, data, config, land, false)
    const routes: TransportRoute[] = []
    const component = new Int32Array(society.settlements.length)
    const degree = new Uint16Array(society.settlements.length)
    for (let id = 0; id < component.length; id++)
      component[id] = id

    const selected = new Set<number>()
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index]
      if (!this.union(component, candidate.from, candidate.to))
        continue
      selected.add(index)
      this.appendRoute(mesh, society, candidate, land.parent, 'road', routes, routeByRegion, roadRegionMask)
      degree[candidate.from]++
      degree[candidate.to]++
    }

    let extra = Math.round(routes.length * config.society.roadConnectivity * 0.5)
    for (let index = 0; index < candidates.length && extra > 0; index++) {
      if (selected.has(index))
        continue
      const candidate = candidates[index]
      if (degree[candidate.from] >= 4 || degree[candidate.to] >= 4)
        continue
      const directKm = mesh.distanceBetweenRegions(
        society.settlements[candidate.from].region,
        society.settlements[candidate.to].region,
      ) * RADIUS_KM
      if (candidate.costKm > directKm * (1.8 + config.society.terrainResistance * 0.3))
        continue
      this.appendRoute(mesh, society, candidate, land.parent, 'road', routes, routeByRegion, roadRegionMask)
      degree[candidate.from]++
      degree[candidate.to]++
      extra--
    }

    const portSources = this.findPortSources(mesh, data, config, society)
    const seaSources = [...portSources.values()]
    if (seaSources.length > 1) {
      const sea = this.spread(mesh, data, config, seaSources, true)
      const seaCandidates = [
        ...this.findCandidates(mesh, data, config, sea, true),
        ...this.sharedCoastCandidates(seaSources),
      ].sort((a, b) => a.costKm - b.costKm || a.from - b.from || a.to - b.to)
      const selectedSeaPairs = new Set<number>()
      const seaDegree = new Uint8Array(society.settlements.length)
      const portCount = new Set(seaSources.map(source => source.settlement)).size
      for (const candidate of seaCandidates) {
        if (candidate.costKm + SEA_LOADING_COST_KM > MAX_SEA_COST_KM
          || !this.union(component, candidate.from, candidate.to)) {
          continue
        }
        this.appendRoute(mesh, society, candidate, sea.parent, 'sea', routes, routeByRegion, undefined, portSources, sea.root)
        selectedSeaPairs.add(candidate.from * society.settlements.length + candidate.to)
        seaDegree[candidate.from]++
        seaDegree[candidate.to]++
        portSettlementIds[candidate.from] = 1
        portSettlementIds[candidate.to] = 1
      }

      // Add useful coastal shortcuts after the cross-island backbone is connected.
      const roadGraph = this.buildRoadGraph(society.settlements.length, routes)
      const roadCostCache = new Map<number, Float32Array>()
      let coastalBudget = Math.round(portCount * 0.5)
      for (const candidate of seaCandidates) {
        if (coastalBudget <= 0)
          break
        const pair = candidate.from * society.settlements.length + candidate.to
        const seaCost = candidate.costKm + SEA_LOADING_COST_KM
        if (seaCost > MAX_SEA_COST_KM || selectedSeaPairs.has(pair)
          || seaDegree[candidate.from] >= 3 || seaDegree[candidate.to] >= 3) {
          continue
        }
        let roadCosts = roadCostCache.get(candidate.from)
        if (!roadCosts) {
          roadCosts = this.shortestRoadCosts(candidate.from, roadGraph)
          roadCostCache.set(candidate.from, roadCosts)
        }
        if (!Number.isFinite(roadCosts[candidate.to])
          || seaCost >= roadCosts[candidate.to] * COASTAL_ROUTE_COST_RATIO) {
          continue
        }
        this.appendRoute(mesh, society, candidate, sea.parent, 'sea', routes, routeByRegion, undefined, portSources, sea.root)
        selectedSeaPairs.add(pair)
        seaDegree[candidate.from]++
        seaDegree[candidate.to]++
        portSettlementIds[candidate.from] = 1
        portSettlementIds[candidate.to] = 1
        coastalBudget--
      }
    }

    const market = this.spread(mesh, data, config, landSources, false, roadRegionMask)
    const marketAccess = new Float32Array(count)
    for (let region = 0; region < count; region++) {
      const id = market.owner[region]
      if (id < 0)
        continue
      const marketSize = clamp(Math.log1p(society.settlements[id].hinterlandPopulation) / Math.log1p(8_000_000), 0, 1)
      marketAccess[region] = marketSize * Math.exp(-market.cost[region] / 650)
    }
    return {
      routes,
      nearestMarket: market.owner,
      marketCostKm: market.cost,
      marketAccess,
      routeByRegion,
      portSettlementIds,
      roadRegionMask,
    }
  }

  private spread(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    config: WorldConfig,
    sources: Source[],
    sea: boolean,
    roadMask?: Uint8Array,
  ): Spread {
    const owner = new Int32Array(mesh.numRegions).fill(-1)
    const cost = new Float32Array(mesh.numRegions).fill(Infinity)
    const parent = new Int32Array(mesh.numRegions).fill(-1)
    const root = new Int32Array(mesh.numRegions).fill(-1)
    const settled = new Uint8Array(mesh.numRegions)
    const queue = new IndexPriorityQueue(Math.max(64, sources.length))
    const landMask = data.geography.landMask
    for (const source of sources) {
      if ((source.costKm ?? 0) >= cost[source.region])
        continue
      owner[source.region] = source.settlement
      cost[source.region] = source.costKm ?? 0
      root[source.region] = source.region
      queue.push(source.region, cost[source.region])
    }
    while (queue.size > 0) {
      const current = queue.pop()
      if (settled[current])
        continue
      settled[current] = 1
      if (sea && cost[current] > MAX_SEA_COST_KM)
        continue
      for (let edge = mesh.neighborOffsets[current]; edge < mesh.neighborOffsets[current + 1]; edge++) {
        const next = mesh.neighbors[edge]
        if (settled[next] || Boolean(landMask[next]) === sea)
          continue
        const nextCost = cost[current] + this.edgeCost(mesh, data, config, current, next, edge, sea, roadMask)
        if (nextCost >= cost[next] || (sea && nextCost > MAX_SEA_COST_KM))
          continue
        cost[next] = nextCost
        owner[next] = owner[current]
        parent[next] = current
        root[next] = root[current]
        queue.push(next, nextCost)
      }
    }
    return { owner, cost, parent, root }
  }

  private edgeCost(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    config: WorldConfig,
    from: number,
    to: number,
    edge: number,
    sea: boolean,
    roadMask?: Uint8Array,
  ): number {
    if (sea)
      return mesh.neighborDistances[edge] * RADIUS_KM
    return landTravelCost(mesh, data, config, from, to, edge, roadMask)
  }

  private findPortSources(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    config: WorldConfig,
    society: SocietyData,
  ): Map<number, PortSource> {
    const sources = new Map<number, PortSource>()
    const landMask = data.geography.landMask
    for (const settlement of society.settlements) {
      if (!landMask[settlement.region])
        continue
      let frontier = [{ region: settlement.region, costKm: 0, path: [settlement.region] }]
      for (let depth = 0; depth <= MAX_PORT_LAND_STEPS; depth++) {
        const nextFrontier = new Map<number, typeof frontier[number]>()
        for (const entry of frontier) {
          for (let edge = mesh.neighborOffsets[entry.region]; edge < mesh.neighborOffsets[entry.region + 1]; edge++) {
            const neighbor = mesh.neighbors[edge]
            if (!landMask[neighbor]) {
              const key = settlement.id * mesh.numRegions + neighbor
              const costKm = entry.costKm + mesh.neighborDistances[edge] * RADIUS_KM
              const previous = sources.get(key)
              if (!previous || costKm < previous.costKm) {
                sources.set(key, {
                  region: neighbor,
                  settlement: settlement.id,
                  costKm,
                  path: [...entry.path, neighbor],
                })
              }
            }
            else if (depth < MAX_PORT_LAND_STEPS && !entry.path.includes(neighbor)) {
              const costKm = entry.costKm + this.edgeCost(mesh, data, config, entry.region, neighbor, edge, false)
              const previous = nextFrontier.get(neighbor)
              if (!previous || costKm < previous.costKm)
                nextFrontier.set(neighbor, { region: neighbor, costKm, path: [...entry.path, neighbor] })
            }
          }
        }
        frontier = [...nextFrontier.values()]
      }
    }
    return sources
  }

  private findCandidates(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    config: WorldConfig,
    spread: Spread,
    sea: boolean,
  ): Candidate[] {
    const best = new Map<number, Candidate>()
    const settlementCount = data.society!.settlements.length
    for (let region = 0; region < mesh.numRegions; region++) {
      if (spread.owner[region] < 0)
        continue
      for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
        const neighbor = mesh.neighbors[edge]
        const neighborOwner = spread.owner[neighbor]
        if (neighborOwner < 0 || neighborOwner === spread.owner[region])
          continue
        const from = Math.min(spread.owner[region], neighborOwner)
        const to = Math.max(spread.owner[region], neighborOwner)
        const costKm = spread.cost[region] + spread.cost[neighbor]
          + this.edgeCost(mesh, data, config, region, neighbor, edge, sea)
        const key = from * settlementCount + to
        const previous = best.get(key)
        if (!previous || costKm < previous.costKm) {
          best.set(key, {
            from,
            to,
            boundaryFrom: spread.owner[region] === from ? region : neighbor,
            boundaryTo: spread.owner[region] === from ? neighbor : region,
            costKm,
          })
        }
      }
    }
    return [...best.values()].sort((a, b) => a.costKm - b.costKm || a.from - b.from || a.to - b.to)
  }

  private sharedCoastCandidates(sources: PortSource[]): Candidate[] {
    const portsByOcean = new Map<number, PortSource[]>()
    for (const source of sources) {
      const ports = portsByOcean.get(source.region) ?? []
      ports.push(source)
      portsByOcean.set(source.region, ports)
    }
    const candidates: Candidate[] = []
    for (const [oceanRegion, ports] of portsByOcean) {
      for (let first = 0; first < ports.length; first++) {
        for (let second = first + 1; second < ports.length; second++) {
          const from = Math.min(ports[first].settlement, ports[second].settlement)
          const to = Math.max(ports[first].settlement, ports[second].settlement)
          const costKm = ports[first].costKm + ports[second].costKm
          candidates.push({ from, to, boundaryFrom: oceanRegion, boundaryTo: oceanRegion, directSeaRegion: oceanRegion, costKm })
        }
      }
    }
    return candidates
  }

  private buildRoadGraph(settlementCount: number, routes: TransportRoute[]): { to: number, costKm: number }[][] {
    const graph = Array.from({ length: settlementCount }, () => [] as { to: number, costKm: number }[])
    for (const route of routes) {
      if (route.kind !== 'road')
        continue
      graph[route.fromSettlement].push({ to: route.toSettlement, costKm: route.costKm })
      graph[route.toSettlement].push({ to: route.fromSettlement, costKm: route.costKm })
    }
    return graph
  }

  private shortestRoadCosts(source: number, graph: { to: number, costKm: number }[][]): Float32Array {
    const cost = new Float32Array(graph.length).fill(Infinity)
    const settled = new Uint8Array(graph.length)
    const queue = new IndexPriorityQueue(Math.max(64, graph.length))
    cost[source] = 0
    queue.push(source, 0)
    while (queue.size > 0) {
      const current = queue.pop()
      if (settled[current])
        continue
      settled[current] = 1
      for (const edge of graph[current]) {
        const nextCost = cost[current] + edge.costKm
        if (nextCost >= cost[edge.to])
          continue
        cost[edge.to] = nextCost
        queue.push(edge.to, nextCost)
      }
    }
    return cost
  }

  private appendRoute(
    mesh: SphericalMesh,
    _society: SocietyData,
    candidate: Candidate,
    parent: Int32Array,
    kind: 'road' | 'sea',
    routes: TransportRoute[],
    routeByRegion: Int32Array,
    roadMask?: Uint8Array,
    portSources?: Map<number, PortSource>,
    seaRoots?: Int32Array,
  ): void {
    const fromBranch = this.trace(candidate.boundaryFrom, parent).reverse()
    const toBranch = this.trace(candidate.boundaryTo, parent)
    let path: number[]
    if (kind === 'sea') {
      const fromRoot = candidate.directSeaRegion ?? seaRoots![candidate.boundaryFrom]
      const toRoot = candidate.directSeaRegion ?? seaRoots![candidate.boundaryTo]
      const fromAccess = portSources!.get(candidate.from * mesh.numRegions + fromRoot)
      const toAccess = portSources!.get(candidate.to * mesh.numRegions + toRoot)
      if (!fromAccess || !toAccess)
        throw new Error('Sea route has no adjacent land access path')
      const seaPath = candidate.directSeaRegion !== undefined
        ? [candidate.directSeaRegion]
        : [...fromBranch, ...toBranch]
      path = [...fromAccess.path, ...seaPath.slice(1), ...toAccess.path.slice(0, -1).reverse()]
    }
    else {
      path = [...fromBranch, ...toBranch]
    }
    if (path.length < 2)
      return
    let distanceKm = 0
    for (let index = 1; index < path.length; index++)
      distanceKm += mesh.distanceBetweenRegions(path[index - 1], path[index]) * RADIUS_KM
    const id = routes.length
    const route: TransportRoute = {
      id,
      kind,
      fromSettlement: candidate.from,
      toSettlement: candidate.to,
      regions: new Uint32Array(path),
      distanceKm,
      costKm: candidate.costKm + (kind === 'sea' ? SEA_LOADING_COST_KM : 0),
    }
    routes.push(route)
    for (const region of path) {
      if (routeByRegion[region] < 0)
        routeByRegion[region] = id
      if (roadMask)
        roadMask[region] = 1
    }
  }

  private trace(start: number, parent: Int32Array): number[] {
    const branch = [start]
    for (let current = start; parent[current] >= 0; current = parent[current])
      branch.push(parent[current])
    return branch
  }

  private find(component: Int32Array, id: number): number {
    let root = id
    while (component[root] !== root)
      root = component[root]
    while (component[id] !== id) {
      const next = component[id]
      component[id] = root
      id = next
    }
    return root
  }

  private union(component: Int32Array, a: number, b: number): boolean {
    const rootA = this.find(component, a)
    const rootB = this.find(component, b)
    if (rootA === rootB)
      return false
    component[rootB] = rootA
    return true
  }
}
