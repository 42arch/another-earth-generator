import { describe, expect, it } from 'vitest'
import { generatePopulationSettlements, SETTLEMENT_SUPPORT_AREA_KM2, validatePopulationSettlementsArtifact } from './population-settlements'

type Input = Parameters<typeof generatePopulationSettlements>

function fixture(cellsPerArea: number, groups = 12): Input {
  const n = groups * cellsPerArea
  const meshId = `physical-scale:${cellsPerArea}`
  const centers = new Float64Array(n * 3)
  const adjacency: number[][] = Array.from({ length: n }, () => [])
  for (let g = 0; g < groups; g++) {
    for (let c = 0; c < cellsPerArea; c++) {
      const r = g * cellsPerArea + c
      const angle = g * 0.5 + c * 0.001
      centers[3 * r] = Math.sin(angle)
      centers[3 * r + 2] = Math.cos(angle)
      if (c > 0) {
        adjacency[r]!.push(r - 1)
        adjacency[r - 1]!.push(r)
      }
    }
  }
  const neighborOffsets = new Uint32Array(n + 1)
  for (let r = 0; r < n; r++)
    neighborOffsets[r + 1] = neighborOffsets[r]! + adjacency[r]!.length
  return [
    { meshId, regionCount: n, centers, areaKm2: new Float64Array(n).fill(SETTLEMENT_SUPPORT_AREA_KM2 / cellsPerArea), neighborOffsets, neighbors: Uint32Array.from(adjacency.flat()), physicalRadiusKm: 6371 },
    { meshId, landMask: new Uint8Array(n).fill(1), slopeRadians: new Float32Array(n) },
    { meshId, downstreamRegion: new Int32Array(n).fill(-1), riverIndex: new Int32Array(n).fill(-1), accumulatedAnnualFlowM3s: new Float64Array(n) },
    { meshId, lakeIndex: new Int32Array(n).fill(-1) },
    { meshId, agriculturalPotential: new Float32Array(n).fill(0.8), fisheryPotential: new Float32Array(n), mineralPotential: new Float32Array(n) },
    { meshId, habitability: new Float32Array(n).fill(0.8), carryingCapacityPerKm2: new Float32Array(n).fill(10), coastalMask: new Uint8Array(n), lakeShoreMask: new Uint8Array(n), portPotential: new Float32Array(n) },
    { enabled: true, populationScale: 1, settlementDensity: 1, urbanConcentration: 0.5 },
    'physical-scale-seed',
  ]
}

describe('population and settlement physical scale', () => {
  it('changes urban concentration while conserving population and retaining donor residents', () => {
    const input = fixture(8, 12)
    input[6] = { ...input[6], urbanConcentration: 0 }
    const dispersed = generatePopulationSettlements(...input)
    input[6] = { ...input[6], urbanConcentration: 1 }
    const concentrated = generatePopulationSettlements(...input)
    expect(concentrated.settlementSites.map(site => site.regionId)).toEqual(dispersed.settlementSites.map(site => site.regionId))
    const total = (values: Float64Array) => values.reduce((sum, population) => sum + population, 0)
    expect(total(concentrated.population)).toBeCloseTo(total(dispersed.population), 6)
    const urban = (output: typeof dispersed) => output.settlementSites.reduce((sum, site) => sum + site.population, 0)
    expect(urban(concentrated)).toBeGreaterThan(urban(dispersed))
    const retainedFloor = (SETTLEMENT_SUPPORT_AREA_KM2 / 8) * 10 * 0.88 * 0.44
    expect(Math.min(...concentrated.population)).toBeGreaterThan(retainedFloor - 1)
    validatePopulationSettlementsArtifact(concentrated)
    expect(generatePopulationSettlements(...input)).toEqual(concentrated)
  })

  it('conserves the same total population across different settlement layouts', () => {
    const input = fixture(4, 48)
    input[6] = { ...input[6], settlementDensity: 0.25 }
    const sparse = generatePopulationSettlements(...input)
    const denseInput: Input = [...input]
    denseInput[6] = { ...input[6], settlementDensity: 4 }
    const dense = generatePopulationSettlements(...denseInput)
    expect(dense.settlementSites.length).toBeGreaterThan(sparse.settlementSites.length)
    const total = (values: Float64Array) => values.reduce((sum, population) => sum + population, 0)
    expect(total(dense.population)).toBeCloseTo(total(sparse.population), 6)
    validatePopulationSettlementsArtifact(sparse)
    validatePopulationSettlementsArtifact(dense)
  })

  it('keeps settlement count and city population scale when subdividing the same inhabited area', () => {
    const coarse = generatePopulationSettlements(...fixture(1))
    const fine = generatePopulationSettlements(...fixture(4))
    validatePopulationSettlementsArtifact(coarse)
    validatePopulationSettlementsArtifact(fine)

    expect(coarse.settlementSites).toHaveLength(2)
    expect(fine.settlementSites).toHaveLength(2)
    const coarseUrban = coarse.settlementSites.map(site => site.population).sort((a, b) => b - a)
    const fineUrban = fine.settlementSites.map(site => site.population).sort((a, b) => b - a)
    for (let i = 0; i < 2; i++) {
      expect(fineUrban[i]! / coarseUrban[i]!).toBeGreaterThan(0.7)
      expect(fineUrban[i]! / coarseUrban[i]!).toBeLessThan(1.3)
    }
    const expectedPopulation = 12 * SETTLEMENT_SUPPORT_AREA_KM2 * 10
    for (const result of [coarse, fine]) {
      const total = result.population.reduce((sum, value) => sum + value, 0)
      expect(total / expectedPopulation).toBeGreaterThan(0.88)
      expect(total / expectedPopulation).toBeLessThan(1.12)
      for (const site of result.settlementSites)
        expect(site.population).toBeLessThanOrEqual(result.population[site.regionId]!)
    }
    expect(generatePopulationSettlements(...fixture(4))).toEqual(fine)
  })

  it('recruits along the landward side of a coast without emptying any cell', () => {
    const input = fixture(4)
    const [mesh, terrain, hydrology, lakes, resources, habitability, params] = input
    const n = mesh.regionCount
    const sea = new Uint8Array(n)
    const coastal = new Uint8Array(n)
    // Groups sit on a line. Treat the first cell of every group as sea, so
    // each inhabited cell has land only on one side of the support disc.
    for (let group = 0; group < 12; group++) {
      const shore = group * 4
      sea[shore] = 1
      coastal[shore + 1] = 1
    }
    const coastalResult = generatePopulationSettlements(
      mesh,
      { ...terrain, landMask: Uint8Array.from(terrain.landMask, (land, region) => sea[region] ? 0 : land) },
      hydrology,
      lakes,
      resources,
      { ...habitability, coastalMask: coastal },
      params,
      'physical-scale-seed',
    )
    validatePopulationSettlementsArtifact(coastalResult)

    const inland = generatePopulationSettlements(...input)
    expect(coastalResult.settlementSites.length).toBeGreaterThan(0)
    const coastalUrban = [...coastalResult.settlementSites].sort((a, b) => b.population - a.population)
    const inlandUrban = [...inland.settlementSites].sort((a, b) => b.population - a.population)
    expect(coastalUrban[0]!.population / inlandUrban[0]!.population).toBeGreaterThan(0.7)

    // A donor keeps at least 44% of the residents it was assigned. The assigned
    // population is at least the floor of the noise range, so no land cell can
    // fall below this, and sea cells are never assigned anyone.
    const areaKm2 = SETTLEMENT_SUPPORT_AREA_KM2 / 4
    const retainedFloor = Math.round(areaKm2 * 10 * 0.88) * 0.44
    for (let region = 0; region < n; region++) {
      if (sea[region])
        expect(coastalResult.population[region]).toBe(0)
      else
        expect(coastalResult.population[region]).toBeGreaterThan(retainedFloor - 1)
    }
  })
})
