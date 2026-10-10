import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldSimulationState } from '@/core/simulation/state'
import type { SocietyData } from '@/core/society/society-data'
import { expect, it } from 'vitest'
import { cloneWorldConfig, DEFAULT_WORLD_CONFIG } from '@/core/simulation/config'
import { PolityGenerator } from '@/core/society/polity-generator'
import { PHYSICAL_RADIUS_KM } from '@/core/society/travel-cost'
import { buildLayerStatistics } from '@/core/world/layer-statistics'

function fixture(): { mesh: SphericalMesh, data: WorldSimulationState } {
  const land = [1, 1, 1, 0, 1, 1, 1]
  const adjacency = [[1], [0, 2], [1, 3], [2, 4], [3, 5], [4], []]
  const offsets = new Uint32Array([0, 1, 3, 5, 7, 9, 10, 10])
  const mesh = {
    numRegions: land.length,
    neighborOffsets: offsets,
    neighbors: Uint32Array.from(adjacency.flat()),
    neighborDistances: new Float64Array(10).fill(0.02),
    regionArea: new Float32Array(land.length).fill(0.001),
    * forEachNeighborOfRegion(region: number) { yield* adjacency[region] },
    distanceBetweenRegions: (from: number, to: number) => Math.abs(from - to) * 0.02,
  } as unknown as SphericalMesh
  const population = new Float32Array([1000, 500, 100, 0, 300, 800, 0])
  const society: SocietyData = {
    habitability: new Float32Array(land.length),
    population,
    populationDensity: new Float32Array(land.length),
    settlementByRegion: new Int32Array([0, -1, -1, -1, -1, 1, -1]),
    settlements: [0, 5].map((region, id) => ({
      id,
      region,
      name: `聚落${id}`,
      rank: 'city' as const,
      population: population[region],
      hinterlandPopulation: 100_000,
      reasons: [],
    })),
    totalPopulation: population.reduce((sum, value) => sum + value, 0),
    transport: {
      routes: [],
      nearestMarket: new Int32Array(land.length).fill(-1),
      marketCostKm: new Float32Array(land.length),
      marketAccess: new Float32Array(land.length),
      routeByRegion: new Int32Array(land.length).fill(-1),
      portSettlementIds: new Uint8Array(2),
      roadRegionMask: new Uint8Array(land.length),
    },
    ethnicity: {
      groups: [],
      languages: [],
      languageFamilies: [],
      regionOffsets: new Uint32Array(land.length + 1),
      groupIds: new Uint32Array(),
      residents: new Float64Array(),
      dominantGroup: new Int32Array(land.length).fill(-1),
      dominantGroupShare: new Float32Array(land.length),
      dominantLanguage: new Int32Array([0, 0, 0, -1, 1, 1, -1]),
      dominantLanguageShare: new Float32Array(land.length),
    },
  }
  const data = {
    geography: { landMask: Uint8Array.from(land), elevation: new Float32Array(land.length) },
    society,
  } as unknown as WorldSimulationState
  return { mesh, data }
}

it('keeps capitals in their polities, leaves the sea unowned, and conserves residents and physical area', () => {
  const { mesh, data } = fixture()
  const config = cloneWorldConfig(DEFAULT_WORLD_CONFIG)
  const result = new PolityGenerator().generate(mesh, data, config)
  expect(new PolityGenerator().generate(mesh, data, config)).toEqual(result)
  expect(result.polities).toHaveLength(2)
  expect(result.polityByRegion[3]).toBe(-1)
  expect(result.districtByRegion[3]).toBe(-1)
  expect(result.polityByRegion[6]).toBe(-1)
  expect(result.districtByRegion[6]).toBe(-1)
  expect(result.polityByRegion[4]).toBe(result.polityByRegion[5])
  expect(result.polityByRegion[0]).not.toBe(result.polityByRegion[5])
  for (const polity of result.polities) {
    const capital = data.society!.settlements[polity.capitalSettlementId]
    expect(result.polityByRegion[capital.region]).toBe(polity.id)
  }
  for (let region = 0; region < mesh.numRegions; region++) {
    const districtId = result.districtByRegion[region]
    if (result.polityByRegion[region] >= 0)
      expect(result.districts[districtId].polityId).toBe(result.polityByRegion[region])
  }
  expect(result.polities.reduce((sum, polity) => sum + polity.population, result.unassignedPopulation))
    .toBeCloseTo(data.society!.totalPopulation)
  expect(result.polities.reduce((sum, polity) => sum + polity.areaKm2, result.unassignedAreaKm2))
    .toBeCloseTo(6 * mesh.regionArea[0] * PHYSICAL_RADIUS_KM ** 2)
  data.society!.polities = result
  const stats = buildLayerStatistics(data, 'polities', 0)
  expect(stats?.rows.reduce((sum, row) => sum + row.count, 0)).toBeCloseTo(data.society!.totalPopulation)
})

it('claims connected frontier beyond the effective-control budget while leaving isolated land unassigned', () => {
  const { mesh, data } = fixture()
  mesh.neighborDistances[2] = 1
  mesh.neighborDistances[3] = 1
  const result = new PolityGenerator().generate(mesh, data, cloneWorldConfig(DEFAULT_WORLD_CONFIG))
  expect(result.polityByRegion[2]).toBe(result.polityByRegion[0])
  expect(result.districtByRegion[2]).toBeGreaterThanOrEqual(0)
  expect(result.controlStrength[2]).toBeLessThan(result.controlStrength[1])
  expect(result.polityByRegion[6]).toBe(-1)
  expect(result.unassignedPopulation).toBe(0)
})
