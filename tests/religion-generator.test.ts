import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldSimulationState } from '@/core/simulation/state'
import type { SocietyData, TransportRoute } from '@/core/society/society-data'
import { expect, it } from 'vitest'
import { cloneWorldConfig, DEFAULT_WORLD_CONFIG } from '@/core/simulation/config'
import { ReligionGenerator } from '@/core/society/religion-generator'
import { buildLayerStatistics } from '@/core/world/layer-statistics'

function fixture(routes: TransportRoute[] = []): { mesh: SphericalMesh, data: WorldSimulationState } {
  const land = [1, 1, 0, 1, 1, 1]
  const adjacency = [[1], [0, 2], [1, 3], [2, 4], [3], []]
  const offsets = new Uint32Array([0, 1, 3, 5, 7, 8, 8])
  const mesh = {
    numRegions: land.length,
    neighborOffsets: offsets,
    neighbors: Uint32Array.from(adjacency.flat()),
    neighborDistances: new Float64Array(8).fill(0.02),
    * forEachNeighborOfRegion(region: number) { yield* adjacency[region] },
    distanceBetweenRegions: (a: number, b: number) => Math.abs(a - b) * 0.04,
  } as unknown as SphericalMesh
  const population = new Float32Array([1200, 500, 0, 500, 1000, 200])
  const settlements = [0, 4, 5].map((region, id) => ({
    id,
    region,
    name: `聚落${id}`,
    rank: 'city' as const,
    population: population[region],
    hinterlandPopulation: [300_000, 200_000, 50_000][id],
    reasons: [],
  }))
  const society: SocietyData = {
    habitability: new Float32Array(land.length),
    population,
    populationDensity: new Float32Array(land.length),
    settlementByRegion: new Int32Array([0, -1, -1, -1, 1, 2]),
    settlements,
    totalPopulation: population.reduce((sum, value) => sum + value, 0),
    transport: {
      routes,
      nearestMarket: new Int32Array(land.length).fill(-1),
      marketCostKm: new Float32Array(land.length),
      marketAccess: new Float32Array(land.length),
      routeByRegion: new Int32Array(land.length).fill(-1),
      portSettlementIds: new Uint8Array(settlements.length),
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
      dominantLanguage: new Int32Array(land.length).fill(-1),
      dominantLanguageShare: new Float32Array(land.length),
    },
    polities: {
      polities: settlements.map(settlement => ({
        id: settlement.id,
        name: `邦${settlement.id}`,
        capitalSettlementId: settlement.id,
        governingForm: 'city-state' as const,
        officialLanguageId: -1,
        governanceBudgetKm: 1500,
        population: 0,
        areaKm2: 0,
      })),
      districts: [],
      polityByRegion: new Int32Array([0, 0, -1, 1, 1, 2]),
      controlStrength: new Float32Array(land.length),
      districtByRegion: new Int32Array(land.length).fill(-1),
      unassignedPopulation: 0,
      unassignedAreaKm2: 0,
    },
  }
  return {
    mesh,
    data: {
      geography: { landMask: Uint8Array.from(land), elevation: new Float32Array(land.length) },
      society,
    } as unknown as WorldSimulationState,
  }
}

it('conserves resident population, includes unaffiliated people, and keeps ocean empty', () => {
  const { mesh, data } = fixture()
  const result = new ReligionGenerator().generate(mesh, data, cloneWorldConfig(DEFAULT_WORLD_CONFIG))
  const repeated = fixture()
  expect(new ReligionGenerator().generate(repeated.mesh, repeated.data, cloneWorldConfig(DEFAULT_WORLD_CONFIG))).toEqual(result)
  expect(result.religions).toHaveLength(3)
  expect(result.sacredSites).toHaveLength(3)
  expect(result.regionOffsets[3] - result.regionOffsets[2]).toBe(0)
  expect(result.dominantAffiliation[2]).toBe(-2)
  for (let region = 0; region < mesh.numRegions; region++) {
    let allocated = 0
    for (let index = result.regionOffsets[region]; index < result.regionOffsets[region + 1]; index++)
      allocated += result.residents[index]
    expect(allocated).toBeCloseTo(data.society!.population[region], 5)
  }
  expect([...result.affiliationIds]).toContain(-1)
  data.society!.religions = result
  const statistics = buildLayerStatistics(data, 'religions', 0)
  expect(statistics?.rows.reduce((sum, row) => sum + row.count, 0)).toBeCloseTo(data.society!.totalPopulation, 5)
})

it('spreads a belief across water only along a selected sea route', () => {
  const route: TransportRoute = {
    id: 0,
    kind: 'sea',
    fromSettlement: 0,
    toSettlement: 1,
    regions: new Uint32Array([0, 1, 2, 3, 4]),
    distanceKm: 450,
    costKm: 450,
  }
  const config = cloneWorldConfig(DEFAULT_WORLD_CONFIG)
  const isolated = fixture()
  const withoutRoute = new ReligionGenerator().generate(isolated.mesh, isolated.data, config)
  const connected = fixture([route])
  const withRoute = new ReligionGenerator().generate(connected.mesh, connected.data, config)
  const originReligion = withoutRoute.religions.find(religion => religion.originSettlementId === 0)!.id
  const idsAt = (result: typeof withoutRoute, region: number) =>
    [...result.affiliationIds.slice(result.regionOffsets[region], result.regionOffsets[region + 1])]
  expect(idsAt(withoutRoute, 4)).not.toContain(originReligion)
  expect(idsAt(withRoute, 4)).toContain(originReligion)
})

it('records nearby branches on the same connected land without equating them to polities', () => {
  const { mesh, data } = fixture()
  data.geography.landMask[2] = 1
  const result = new ReligionGenerator().generate(mesh, data, cloneWorldConfig(DEFAULT_WORLD_CONFIG))
  const first = result.religions.find(religion => religion.originSettlementId === 0)!
  const branch = result.religions.find(religion => religion.originSettlementId === 1)!
  expect(branch.parentReligionId === first.id || first.parentReligionId === branch.id).toBe(true)
  expect(result.religions.find(religion => religion.originSettlementId === 2)?.parentReligionId).toBe(-1)
})

it('allocates all residents to the explicit unaffiliated category when no origin exists', () => {
  const { mesh, data } = fixture()
  data.society!.settlements = []
  const result = new ReligionGenerator().generate(mesh, data, cloneWorldConfig(DEFAULT_WORLD_CONFIG))
  expect(result.religions).toHaveLength(0)
  expect([...result.affiliationIds].every(id => id === -1)).toBe(true)
  expect(result.residents.reduce((sum, value) => sum + value, 0)).toBeCloseTo(data.society!.totalPopulation)
})
