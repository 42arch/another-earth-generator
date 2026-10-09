import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldSimulationState } from '@/core/simulation/state'
import type { SocietyData, TransportRoute } from '@/core/society/society-data'
import { expect, it } from 'vitest'
import { cloneWorldConfig, DEFAULT_WORLD_CONFIG } from '@/core/simulation/config'
import { EthnicityGenerator } from '@/core/society/ethnicity-generator'
import { buildLayerStatistics } from '@/core/world/layer-statistics'

function fixture(
  land: number[],
  edges: Array<readonly [number, number]>,
  centres: number[],
  population: number[],
  routes: TransportRoute[] = [],
): { mesh: SphericalMesh, data: WorldSimulationState } {
  const adjacency = Array.from({ length: land.length }, () => [] as number[])
  for (const [from, to] of edges) {
    adjacency[from].push(to)
    adjacency[to].push(from)
  }
  const offsets = new Uint32Array(land.length + 1)
  const neighbors: number[] = []
  for (let region = 0; region < land.length; region++) {
    offsets[region] = neighbors.length
    neighbors.push(...adjacency[region])
  }
  offsets[land.length] = neighbors.length
  const mesh = {
    numRegions: land.length,
    neighborOffsets: offsets,
    neighbors: new Uint32Array(neighbors),
    neighborDistances: new Float64Array(neighbors.length).fill(0.08),
    distanceBetweenRegions: (from: number, to: number) => from === to ? 0 : 0.12,
  } as unknown as SphericalMesh
  const society: SocietyData = {
    habitability: new Float32Array(land.length),
    population: new Float32Array(population),
    populationDensity: new Float32Array(land.length),
    settlementByRegion: new Int32Array(land.length).fill(-1),
    settlements: centres.map((region, id) => ({
      id,
      region,
      name: `聚落${id}`,
      rank: 'city' as const,
      population: population[region],
      hinterlandPopulation: population[region],
      reasons: [],
    })),
    totalPopulation: population.reduce((sum, value) => sum + value, 0),
    transport: {
      routes,
      nearestMarket: new Int32Array(land.length).fill(-1),
      marketCostKm: new Float32Array(land.length),
      marketAccess: new Float32Array(land.length),
      routeByRegion: new Int32Array(land.length).fill(-1),
      portSettlementIds: new Uint8Array(centres.length),
      roadRegionMask: new Uint8Array(land.length),
    },
  }
  return {
    mesh,
    data: {
      geography: { landMask: new Uint8Array(land), elevation: new Float32Array(land.length) },
      society,
    } as unknown as WorldSimulationState,
  }
}

it('conserves residents and permits a three-way mixed region without a majority', () => {
  const { mesh, data } = fixture(
    [1, 1, 1, 1],
    [[0, 1], [0, 2], [0, 3]],
    [1, 2, 3],
    [1_000_000, 8_000_000, 8_000_000, 8_000_000],
  )
  const config = cloneWorldConfig(DEFAULT_WORLD_CONFIG)
  const generated = new EthnicityGenerator().generate(mesh, data, config)
  const repeated = new EthnicityGenerator().generate(mesh, data, config)
  expect(generated).toEqual(repeated)
  expect(generated.groups).toHaveLength(3)
  expect(generated.regionOffsets[1] - generated.regionOffsets[0]).toBe(3)
  expect(generated.dominantGroupShare[0]).toBeLessThan(0.5)
  for (let region = 0; region < mesh.numRegions; region++) {
    let allocated = 0
    for (let index = generated.regionOffsets[region]; index < generated.regionOffsets[region + 1]; index++)
      allocated += generated.residents[index]
    expect(allocated).toBeCloseTo(data.society!.population[region], 5)
  }
  data.society!.ethnicity = generated
  const ethnicStatistics = buildLayerStatistics(data, 'ethnicity', 0)
  const languageStatistics = buildLayerStatistics(data, 'languages', 0)
  expect(ethnicStatistics?.rows.reduce((sum, row) => sum + row.count, 0)).toBeCloseTo(data.society!.totalPopulation, 5)
  expect(languageStatistics?.rows.reduce((sum, row) => sum + row.count, 0)).toBeCloseTo(data.society!.totalPopulation, 5)
})

it('allows contact across water only through a selected sea route', () => {
  const route: TransportRoute = {
    id: 0,
    kind: 'sea',
    fromSettlement: 0,
    toSettlement: 1,
    regions: new Uint32Array([0, 1, 2]),
    distanceKm: 120,
    costKm: 120,
  }
  const { mesh, data } = fixture([1, 0, 1], [[0, 1], [1, 2]], [0, 2], [1000, 0, 1000])
  const config = cloneWorldConfig(DEFAULT_WORLD_CONFIG)
  const isolated = new EthnicityGenerator().generate(mesh, data, config)
  expect(isolated.regionOffsets[1] - isolated.regionOffsets[0]).toBe(1)
  expect(isolated.regionOffsets[2] - isolated.regionOffsets[1]).toBe(0)
  expect(isolated.languages).toHaveLength(2)
  data.society!.transport!.routes.push(route)
  const connected = new EthnicityGenerator().generate(mesh, data, config)
  expect(connected.regionOffsets[1] - connected.regionOffsets[0]).toBe(2)
  expect(connected.regionOffsets[2] - connected.regionOffsets[1]).toBe(0)
  expect(connected.languages).toHaveLength(1)
  expect(connected.groups.every(group => data.geography.landMask[group.originRegion] === 1)).toBe(true)
})
