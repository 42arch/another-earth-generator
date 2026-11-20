import { describe, expect, it } from 'vitest'
import { generatePopulationSettlements, SETTLEMENT_SUPPORT_AREA_KM2, validatePopulationSettlementsArtifact } from './population-settlements'

type Input = Parameters<typeof generatePopulationSettlements>

function fixture(cellsPerArea: number): Input {
  const groups = 12
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
    { meshId, downstreamRegion: new Int32Array(n).fill(-1), riverIndex: new Int32Array(n).fill(-1), accumulatedAnnualFlowM3s: new Float32Array(n) },
    { meshId, lakeIndex: new Int32Array(n).fill(-1) },
    { meshId, agriculturalPotential: new Float32Array(n).fill(0.8), fisheryPotential: new Float32Array(n), mineralPotential: new Float32Array(n) },
    { meshId, habitability: new Float32Array(n).fill(0.8), carryingCapacityPerKm2: new Float32Array(n).fill(10), coastalMask: new Uint8Array(n), lakeShoreMask: new Uint8Array(n) },
    { enabled: true, populationScale: 1, settlementDensity: 1 },
    'physical-scale-seed',
  ]
}

describe('population and settlement physical scale', () => {
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
})
