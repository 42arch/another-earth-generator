import type { TerrainArtifact } from '#generation/nature/geography'
import type { HydrologyArtifact } from '#generation/nature/hydrology/hydrology'
import type { StaticLakeArtifact } from '#generation/nature/hydrology/lakes'
import type { SphericalMesh } from '#mesh/spherical-mesh'
import type { TransportLink, TransportLinkMode, TransportNode } from './civilization-types'
import type { HabitabilityArtifact } from './habitability'
import type { PopulationSettlementsArtifact } from './population-settlements'
import { IndexPriorityQueue } from '#generation/nature/common/priority-queue'
import { greatCircleDistanceKm } from '#math/spherical'
import { REFERENCE_TRAVEL_KM_PER_DAY } from './population-settlements'

export const TRANSPORT_NETWORK_VERSION = 'transport-network-v3' as const

export interface TransportNetworkArtifact {
  readonly meshId: string
  readonly algorithmVersion: typeof TRANSPORT_NETWORK_VERSION
  readonly regionCount: number
  readonly enabled: boolean
  readonly nodes: readonly TransportNode[]
  readonly routes: readonly TransportLink[]
  readonly accessibility: Float32Array
  /** Normalized node centrality in [0, 1], indexed parallel to nodes. */
  readonly nodeCentrality: readonly number[]
}

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value
}

function edgeDistanceKm(
  mesh: Pick<SphericalMesh, 'centers' | 'physicalRadiusKm'>,
  a: number,
  b: number,
  vecA: { x: number, y: number, z: number },
  vecB: { x: number, y: number, z: number },
): number {
  vecA.x = mesh.centers[3 * a]
  vecA.y = mesh.centers[3 * a + 1]
  vecA.z = mesh.centers[3 * a + 2]
  vecB.x = mesh.centers[3 * b]
  vecB.y = mesh.centers[3 * b + 1]
  vecB.z = mesh.centers[3 * b + 2]
  return greatCircleDistanceKm(vecA, vecB, mesh.physicalRadiusKm)
}

function reconstructPath(parent: Int32Array, startRegion: number, endRegion: number): Uint32Array {
  const reversed: number[] = []
  let cur = endRegion
  while (cur !== -1) {
    reversed.push(cur)
    if (cur === startRegion)
      break
    cur = parent[cur]!
  }
  reversed.reverse()
  return Uint32Array.from(reversed)
}

export function generateTransportNetwork(
  mesh: Pick<SphericalMesh, 'meshId' | 'regionCount' | 'centers' | 'areaKm2' | 'neighborOffsets' | 'neighbors' | 'physicalRadiusKm'>,
  terrain: Pick<TerrainArtifact, 'meshId' | 'landMask'>,
  hydrology: Pick<HydrologyArtifact, 'meshId' | 'riverIndex' | 'downstreamRegion'>,
  lakes: Pick<StaticLakeArtifact, 'meshId' | 'lakeIndex'>,
  habitability: Pick<HabitabilityArtifact, 'meshId' | 'movementCost'>,
  settlements: Pick<PopulationSettlementsArtifact, 'meshId' | 'enabled' | 'population' | 'settlementSites'>,
  check?: (fraction: number) => void,
): TransportNetworkArtifact {
  const n = mesh.regionCount
  if (!n || terrain.meshId !== mesh.meshId || hydrology.meshId !== mesh.meshId || lakes.meshId !== mesh.meshId || habitability.meshId !== mesh.meshId || settlements.meshId !== mesh.meshId)
    throw new Error('Transport network stage received mismatched mesh artifacts')

  const accessibility = new Float32Array(n)
  if (!settlements.enabled || settlements.settlementSites.length === 0) {
    check?.(1)
    return {
      meshId: mesh.meshId,
      algorithmVersion: TRANSPORT_NETWORK_VERSION,
      regionCount: n,
      enabled: settlements.enabled,
      nodes: [],
      routes: [],
      accessibility,
      nodeCentrality: [],
    }
  }

  const sites = settlements.settlementSites
  const nodes: TransportNode[] = sites.map(site => ({
    id: `node:${site.regionId}`,
    regionId: site.regionId,
    settlementId: site.id,
    kind: site.isPort ? 'port' : 'settlement',
  }))

  const nodeByRegion = new Map<number, number>()
  for (let i = 0; i < nodes.length; i++)
    nodeByRegion.set(nodes[i]!.regionId, i)

  const kmPerDay = REFERENCE_TRAVEL_KM_PER_DAY
  const maxLandSearchCost = (mesh.physicalRadiusKm * 1.15) / kmPerDay
  const maxSeaSearchCost = (mesh.physicalRadiusKm * 1.8) / kmPerDay

  const stamp = new Int32Array(n)
  // Reuse per-search stamps: duplicate heap entries must not expand or count twice.
  const settled = new Int32Array(n)
  const dist = new Float32Array(n)
  const parent = new Int32Array(n)
  const queue = new IndexPriorityQueue(Math.min(n, 4096))
  let visitId = 0

  const vecA = { x: 0, y: 0, z: 0 }
  const vecB = { x: 0, y: 0, z: 0 }
  const routeKeys = new Set<string>()
  const routes: TransportLink[] = []
  const nodeDegree = new Float64Array(nodes.length)

  const addRoute = (fromIdx: number, toIdx: number, mode: TransportLinkMode, regions: Uint32Array, rawCost: number) => {
    if (fromIdx === toIdx || regions.length < 2)
      return
    const lo = Math.min(fromIdx, toIdx)
    const hi = Math.max(fromIdx, toIdx)
    const key = `${lo}:${hi}:${mode}`
    if (routeKeys.has(key))
      return
    routeKeys.add(key)

    const popA = sites[fromIdx]!.population
    const popB = sites[toIdx]!.population
    const cost = Math.max(0.1, rawCost)
    const trafficScore = Math.round(((Math.sqrt(popA * popB) / cost) * (mode === 'sea' ? 1.15 : mode === 'river' ? 1.2 : 1.0)) * 100) / 100
    routes.push({
      id: `route:${mode}:${nodes[fromIdx]!.regionId}-${nodes[toIdx]!.regionId}`,
      fromNodeId: nodes[fromIdx]!.id,
      toNodeId: nodes[toIdx]!.id,
      mode,
      regions,
      cost,
      trafficScore,
    })
    nodeDegree[fromIdx] += Math.max(1, trafficScore)
    nodeDegree[toIdx] += Math.max(1, trafficScore)
  }

  const maxLandTargets = 5
  const maxSeaTargets = 4

  for (let sIdx = 0; sIdx < nodes.length; sIdx++) {
    check?.((sIdx / nodes.length) * 0.72)
    const startRegion = nodes[sIdx]!.regionId

    // 1. Overland / river bounded Dijkstra
    visitId++
    queue.size = 0
    stamp[startRegion] = visitId
    dist[startRegion] = 0
    parent[startRegion] = -1
    queue.push(startRegion, 0)

    let foundLand = 0
    while (queue.size > 0 && foundLand < maxLandTargets) {
      const u = queue.pop()
      if (settled[u] === visitId)
        continue
      settled[u] = visitId
      const dU = dist[u]!
      if (dU > maxLandSearchCost)
        break
      const targetIdx = nodeByRegion.get(u)
      if (targetIdx !== undefined && targetIdx !== sIdx) {
        foundLand++
        const path = reconstructPath(parent, startRegion, u)
        if (path.length >= 2) {
          let riverSteps = 0
          for (let k = 0; k < path.length; k++) {
            if (hydrology.riverIndex[path[k]!] >= 0)
              riverSteps++
          }
          const mode: TransportLinkMode = riverSteps >= Math.max(2, Math.floor(path.length * 0.55)) ? 'river' : 'road'
          addRoute(sIdx, targetIdx, mode, path, dU)
        }
      }

      for (let e = mesh.neighborOffsets[u]; e < mesh.neighborOffsets[u + 1]; e++) {
        const v = mesh.neighbors[e]!
        // Overland allows land or static lakes, never open sea
        if (terrain.landMask[v] !== 1 || settled[v] === visitId)
          continue
        const stepKm = edgeDistanceKm(mesh, u, v, vecA, vecB)
        let avgResistance = 0.5 * (habitability.movementCost[u]! + habitability.movementCost[v]!)
        // Extra discount when following an actual river drainage link
        if (hydrology.riverIndex[u] >= 0 && hydrology.riverIndex[v] >= 0
          && (hydrology.downstreamRegion[u] === v || hydrology.downstreamRegion[v] === u)) {
          avgResistance *= 0.65
        }
        const nextCost = Math.fround(dU + (stepKm * avgResistance) / kmPerDay)
        if (nextCost > maxLandSearchCost)
          continue
        if (stamp[v] !== visitId || nextCost < dist[v]!) {
          stamp[v] = visitId
          dist[v] = nextCost
          parent[v] = u
          queue.push(v, nextCost)
        }
      }
    }

    // 2. Maritime bounded Dijkstra between port nodes
    if (!sites[sIdx]!.isPort)
      continue
    visitId++
    queue.size = 0
    stamp[startRegion] = visitId
    dist[startRegion] = 0
    parent[startRegion] = -1
    queue.push(startRegion, 0)

    let foundSea = 0
    while (queue.size > 0 && foundSea < maxSeaTargets) {
      const u = queue.pop()
      if (settled[u] === visitId)
        continue
      settled[u] = visitId
      const dU = dist[u]!
      if (dU > maxSeaSearchCost)
        break
      const targetIdx = nodeByRegion.get(u)
      if (targetIdx !== undefined && targetIdx !== sIdx && sites[targetIdx]!.isPort) {
        foundSea++
        const path = reconstructPath(parent, startRegion, u)
        // Ensure it actually entered sea at least once
        let touchedSea = false
        for (let k = 1; k < path.length - 1; k++) {
          if (terrain.landMask[path[k]!] === 0) {
            touchedSea = true
            break
          }
        }
        if (touchedSea && path.length >= 2)
          addRoute(sIdx, targetIdx, 'sea', path, dU)
        // Port doesn't continue overland through another settlement
        if (u !== startRegion)
          continue
      }

      for (let e = mesh.neighborOffsets[u]; e < mesh.neighborOffsets[u + 1]; e++) {
        const v = mesh.neighbors[e]!
        if (settled[v] === visitId)
          continue
        const vIsTargetPort = nodeByRegion.has(v) && sites[nodeByRegion.get(v)!]!.isPort
        if (terrain.landMask[v] === 1 && !vIsTargetPort)
          continue
        const stepKm = edgeDistanceKm(mesh, u, v, vecA, vecB)
        const seaFactor = terrain.landMask[v] === 0 ? habitability.movementCost[v]! : 0.7
        const nextCost = Math.fround(dU + (stepKm * seaFactor) / (kmPerDay * 1.65))
        if (nextCost > maxSeaSearchCost)
          continue
        if (stamp[v] !== visitId || nextCost < dist[v]!) {
          stamp[v] = visitId
          dist[v] = nextCost
          parent[v] = u
          queue.push(v, nextCost)
        }
      }
    }
  }

  // 3. Multi-source Dijkstra for regional land accessibility in [0, 1]
  check?.(0.75)
  visitId++
  queue.size = 0
  const maxAccessCost = Math.max(8, (mesh.physicalRadiusKm * 0.45) / kmPerDay)
  for (let i = 0; i < nodes.length; i++) {
    const r = nodes[i]!.regionId
    stamp[r] = visitId
    dist[r] = 0
    queue.push(r, 0)
  }
  while (queue.size > 0) {
    const u = queue.pop()
    if (settled[u] === visitId)
      continue
    settled[u] = visitId
    const dU = dist[u]!
    if (dU > maxAccessCost)
      break
    for (let e = mesh.neighborOffsets[u]; e < mesh.neighborOffsets[u + 1]; e++) {
      const v = mesh.neighbors[e]!
      if (terrain.landMask[v] !== 1 || lakes.lakeIndex[v] >= 0 || settled[v] === visitId)
        continue
      const stepKm = edgeDistanceKm(mesh, u, v, vecA, vecB)
      const avgResistance = 0.5 * (habitability.movementCost[u]! + habitability.movementCost[v]!)
      const nextCost = Math.fround(dU + (stepKm * avgResistance) / kmPerDay)
      if (nextCost > maxAccessCost)
        continue
      if (stamp[v] !== visitId || nextCost < dist[v]!) {
        stamp[v] = visitId
        dist[v] = nextCost
        queue.push(v, nextCost)
      }
    }
  }
  for (let r = 0; r < n; r++) {
    if (terrain.landMask[r] !== 1 || lakes.lakeIndex[r] >= 0)
      continue
    if (stamp[r] === visitId)
      accessibility[r] = clamp01(Math.exp(-dist[r]! / (maxAccessCost * 0.32)))
  }

  // Boost regions traversed by established land/river corridors
  for (const route of routes) {
    if (route.mode === 'sea')
      continue
    for (let k = 0; k < route.regions.length; k++) {
      const r = route.regions[k]!
      if (terrain.landMask[r] === 1 && lakes.lakeIndex[r] < 0)
        accessibility[r] = clamp01(Math.max(accessibility[r]!, 0.65))
    }
  }

  let maxDegree = 0
  for (let i = 0; i < nodeDegree.length; i++) {
    if (nodeDegree[i]! > maxDegree)
      maxDegree = nodeDegree[i]!
  }
  const nodeCentrality = nodes.map((_, i) => (maxDegree > 0 ? clamp01(nodeDegree[i]! / maxDegree) : 0))

  check?.(1)
  return {
    meshId: mesh.meshId,
    algorithmVersion: TRANSPORT_NETWORK_VERSION,
    regionCount: n,
    enabled: true,
    nodes,
    routes,
    accessibility,
    nodeCentrality,
  }
}

export function validateTransportNetworkArtifact(output: TransportNetworkArtifact): void {
  const n = output.regionCount
  if (!output.meshId || output.algorithmVersion !== TRANSPORT_NETWORK_VERSION || !Number.isInteger(n) || n < 1)
    throw new Error('Invalid transport network metadata')
  if (!(output.accessibility instanceof Float32Array) || output.accessibility.length !== n)
    throw new Error('Accessibility field dtype or length mismatch')
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(output.accessibility[i]) || output.accessibility[i] < 0 || output.accessibility[i] > 1)
      throw new Error(`Invalid accessibility value at ${i}`)
  }
  if (!output.enabled && (output.nodes.length > 0 || output.routes.length > 0))
    throw new Error('Disabled civilization must emit empty transport network')
  const nodeIds = new Set<string>()
  for (const node of output.nodes) {
    if (!node.id || nodeIds.has(node.id) || !Number.isSafeInteger(node.regionId) || node.regionId < 0 || node.regionId >= n)
      throw new Error('Invalid transport node')
    nodeIds.add(node.id)
  }
  const routeIds = new Set<string>()
  for (const route of output.routes) {
    if (!route.id || routeIds.has(route.id) || !nodeIds.has(route.fromNodeId) || !nodeIds.has(route.toNodeId) || route.fromNodeId === route.toNodeId)
      throw new Error('Invalid transport route endpoints')
    routeIds.add(route.id)
    if (!(route.regions instanceof Uint32Array) || route.regions.length < 2 || !Number.isFinite(route.cost) || route.cost <= 0 || !Number.isFinite(route.trafficScore) || route.trafficScore < 0)
      throw new Error('Invalid transport route geometry or cost')
  }
}
