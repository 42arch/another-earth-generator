import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldSimulationState } from '@/core/simulation/state'
import type { SocietyData } from '@/core/society/society-data'
import { expect, it } from 'vitest'
import { cloneWorldConfig, DEFAULT_WORLD_CONFIG } from '@/core/simulation/config'
import { TransportGenerator } from '@/core/society/transport-generator'

function fixture(
  land: readonly number[],
  edges?: readonly (readonly [number, number])[],
  centres = [0, land.length - 1],
): { mesh: SphericalMesh, data: WorldSimulationState } {
  const count = land.length
  const adjacency = Array.from({ length: count }, () => [] as number[])
  const graphEdges = edges ?? Array.from({ length: count - 1 }, (_, region) => [region, region + 1] as const)
  for (const [from, to] of graphEdges) {
    adjacency[from].push(to)
    adjacency[to].push(from)
  }
  const neighbors: number[] = []
  const offsets = new Uint32Array(count + 1)
  for (let region = 0; region < count; region++) {
    offsets[region] = neighbors.length
    neighbors.push(...adjacency[region])
  }
  offsets[count] = neighbors.length
  const mesh = {
    numRegions: count,
    neighborOffsets: offsets,
    neighbors: new Uint32Array(neighbors),
    neighborDistances: new Float64Array(neighbors.length).fill(0.01),
    distanceBetweenRegions: (a: number, b: number) => adjacency[a].includes(b) ? 0.01 : Math.abs(a - b) * 0.01,
  } as unknown as SphericalMesh
  const society: SocietyData = {
    habitability: new Float32Array(count),
    population: new Float32Array(count),
    populationDensity: new Float32Array(count),
    settlementByRegion: new Int32Array(count).fill(-1),
    settlements: centres.map((region, id) => ({
      id,
      region,
      name: `聚落${id}`,
      rank: 'town' as const,
      population: 1000,
      hinterlandPopulation: 100_000,
      reasons: [],
    })),
    totalPopulation: 2000,
  }
  const data = {
    geography: { landMask: new Uint8Array(land), elevation: new Float32Array(count) },
    biome: { biomeClass: new Uint8Array(count) },
    hydrology: { riverMask: new Uint8Array(count) },
    society,
  } as unknown as WorldSimulationState
  return { mesh, data }
}

it('keeps land roads on land and connects neighbouring markets', () => {
  const { mesh, data } = fixture([1, 1, 1])
  const config = cloneWorldConfig(DEFAULT_WORLD_CONFIG)
  config.society.roadConnectivity = 0
  const result = new TransportGenerator().generate(mesh, data, config)
  expect(result.routes).toHaveLength(1)
  expect(result.routes[0].kind).toBe('road')
  expect([...result.routes[0].regions]).toEqual([0, 1, 2])
  expect(result.routes[0].regions.every(region => data.geography.landMask[region] === 1)).toBe(true)
  expect(result.nearestMarket[1]).toBeGreaterThanOrEqual(0)
  expect(result.marketAccess[1]).toBeGreaterThan(0)
})

it('crosses a one-cell strait only through a port-to-port sea route', () => {
  const { mesh, data } = fixture([1, 0, 1])
  const result = new TransportGenerator().generate(mesh, data, cloneWorldConfig(DEFAULT_WORLD_CONFIG))
  expect(result.routes).toHaveLength(1)
  expect(result.routes[0].kind).toBe('sea')
  expect([...result.routes[0].regions]).toEqual([0, 1, 2])
  expect([...result.portSettlementIds]).toEqual([1, 1])
  expect([...result.roadRegionMask]).toEqual([0, 0, 0])
  expect(result.nearestMarket[1]).toBe(-1)
})

it('adds a coastal shortcut between road-connected settlements one land cell inland', () => {
  const land = [...Array.from({ length: 11 }).fill(1), 0, 0]
  const edges = [
    ...Array.from({ length: 10 }, (_, region) => [region, region + 1] as const),
    [1, 11],
    [11, 12],
    [12, 9],
  ] as const
  const { mesh, data } = fixture(land, edges, [0, 10])
  const result = new TransportGenerator().generate(mesh, data, cloneWorldConfig(DEFAULT_WORLD_CONFIG))
  expect(result.routes.map(route => route.kind)).toEqual(['road', 'sea'])
  expect([...result.routes[1].regions]).toEqual([0, 1, 11, 12, 9, 10])
  expect([...result.portSettlementIds]).toEqual([1, 1])
  expect(result.routes[1].costKm).toBeLessThan(result.routes[0].costKm * 0.85)
  expect(result.routes[1].regions.slice(2, 4).every(region => data.geography.landMask[region] === 0)).toBe(true)
})

it('preserves the full two-step land access path into each port', () => {
  const land = [...Array.from({ length: 17 }).fill(1), 0, 0]
  const edges = [
    ...Array.from({ length: 16 }, (_, region) => [region, region + 1] as const),
    [2, 17],
    [17, 18],
    [18, 14],
  ] as const
  const { mesh, data } = fixture(land, edges, [0, 16])
  const result = new TransportGenerator().generate(mesh, data, cloneWorldConfig(DEFAULT_WORLD_CONFIG))
  expect(result.routes.map(route => route.kind)).toEqual(['road', 'sea'])
  expect([...result.routes[1].regions]).toEqual([0, 1, 2, 17, 18, 14, 15, 16])
})

it('does not add a coastal route when the road is shorter', () => {
  const { mesh, data } = fixture([1, 1, 0], [[0, 1], [0, 2], [1, 2]], [0, 1])
  const result = new TransportGenerator().generate(mesh, data, cloneWorldConfig(DEFAULT_WORLD_CONFIG))
  expect(result.routes.map(route => route.kind)).toEqual(['road'])
  expect([...result.portSettlementIds]).toEqual([0, 0])
})

it('keeps transport and market fields empty when there are no settlements', () => {
  const { mesh, data } = fixture([1, 1, 1])
  data.society!.settlements = []
  const result = new TransportGenerator().generate(mesh, data, cloneWorldConfig(DEFAULT_WORLD_CONFIG))
  expect(result.routes).toHaveLength(0)
  expect([...result.nearestMarket]).toEqual([-1, -1, -1])
  expect([...result.marketAccess]).toEqual([0, 0, 0])
})
