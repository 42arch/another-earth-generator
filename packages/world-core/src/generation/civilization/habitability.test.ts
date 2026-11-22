import { describe, expect, it } from 'vitest'
import { generateHabitability, validateHabitabilityArtifact } from './habitability'
import { generatePopulationSettlements, SETTLEMENT_SUPPORT_AREA_KM2, validatePopulationSettlementsArtifact } from './population-settlements'

type Input = Parameters<typeof generateHabitability>

function fixture(options: {
  positionsKm?: readonly number[]
  edges?: readonly (readonly [number, number])[]
  seaRegions?: readonly number[]
  deposits?: Input[6]['deposits']
} = {}): Input {
  const positions = options.positionsKm ?? [0]
  const n = positions.length
  const meshId = 'industrial-habitability'
  const adjacency: number[][] = Array.from({ length: n }, () => [])
  for (const [a, b] of options.edges ?? []) {
    adjacency[a]!.push(b)
    adjacency[b]!.push(a)
  }
  const neighborOffsets = new Uint32Array(n + 1)
  for (let r = 0; r < n; r++)
    neighborOffsets[r + 1] = neighborOffsets[r]! + adjacency[r]!.length
  const landMask = new Uint8Array(n).fill(1)
  for (const r of options.seaRegions ?? [])
    landMask[r] = 0
  return [
    { meshId, regionCount: n, centers: Float64Array.from(positions.flatMap(km => [Math.sin(km / 1000), 0, Math.cos(km / 1000)])), neighborOffsets, neighbors: Uint32Array.from(adjacency.flat()), physicalRadiusKm: 1000 },
    { meshId, landMask, elevationKm: new Float32Array(n).fill(0.1), slopeRadians: new Float32Array(n) },
    { meshId, annualMeanTemperatureC: new Float32Array(n).fill(18), annualPrecipitationMm: new Float32Array(n).fill(1000) },
    { meshId, riverIndex: new Int32Array(n).fill(-1), accumulatedAnnualFlowM3s: new Float64Array(n) },
    { meshId, lakeIndex: new Int32Array(n).fill(-1) },
    { meshId, potentialBiomeIds: ['test:biome/TemperateGrassland'], landCoverIds: ['test:cover/Grassland'], potentialBiomeIndex: new Uint16Array(n), landCoverIndex: new Uint16Array(n), aridityIndex: new Float32Array(n).fill(1), growingSeasonMonths: new Uint8Array(n).fill(8) },
    { meshId, agriculturalPotential: new Float32Array(n).fill(0.8), forestryPotential: new Float32Array(n), fisheryPotential: new Float32Array(n), deposits: options.deposits ?? [] },
  ]
}

const mineral: Input[6]['deposits'][number] = { id: 'ore', resourceId: 'test:resource/iron', regionId: 0, category: 'mineral', richness: 1, primaryFactor: 'orogen' }
const fuel: Input[6]['deposits'][number] = { id: 'fuel', resourceId: 'test:resource/coal', regionId: 0, category: 'energy', richness: 1, primaryFactor: 'sedimentary-basin' }

describe('industrial-period settlement suitability', () => {
  it('keeps the circa-1900 rural reference density within the calibrated envelope', () => {
    const input = fixture()
    const output = generateHabitability(...input)
    // A well-watered, level agricultural reference cell is a coarse rural
    // average, not the built-up density of a city. Guards against the old
    // uncalibrated >100 people/km² baseline without fixing an exact float.
    expect(output.carryingCapacityPerKm2[0]).toBeGreaterThan(10)
    expect(output.carryingCapacityPerKm2[0]).toBeLessThan(30)
  })

  it('scales agricultural carrying capacity without changing environmental or natural fields', () => {
    const input = fixture()
    const before = input[6].agriculturalPotential.slice()
    const baseline = generateHabitability(...input)
    input[7] = { agriculturalProductivity: 2 }
    const productive = generateHabitability(...input)
    expect(productive.carryingCapacityPerKm2[0]).toBeGreaterThan(baseline.carryingCapacityPerKm2[0]!)
    expect(productive.environmentalSuitability).toEqual(baseline.environmentalSuitability)
    expect(input[6].agriculturalPotential).toEqual(before)
    validateHabitabilityArtifact(productive)
  })

  it('retains ordinary mining at zero industrial capability and strengthens supplied industry', () => {
    const input = fixture({ deposits: [mineral, fuel] })
    const baseline = generateHabitability(...fixture())
    input[7] = { industrialCapability: 0 }
    const mining = generateHabitability(...input)
    expect(mining.economicOpportunity[0]).toBeGreaterThan(baseline.economicOpportunity[0]!)
    input[7] = { industrialCapability: 1 }
    const industrial = generateHabitability(...input)
    expect(industrial.economicOpportunity[0]).toBeGreaterThan(mining.economicOpportunity[0]!)
    expect(industrial.carryingCapacityPerKm2[0]).toBeGreaterThan(mining.carryingCapacityPerKm2[0]!)
    input[2].annualPrecipitationMm[0] = 0
    input[5].aridityIndex[0] = 0
    input[7] = { agriculturalProductivity: 2, industrialCapability: 2 }
    expect(generateHabitability(...input).carryingCapacityPerKm2[0]).toBe(0)
  })

  it('changes reachable land supply when transport capability changes', () => {
    const input = fixture({ positionsKm: [0, 100], edges: [[0, 1]], deposits: [mineral, fuel] })
    input[6].agriculturalPotential[0] = 0
    input[7] = { landTransportCapability: 0.25 }
    const isolated = generateHabitability(...input)
    input[7] = { landTransportCapability: 2 }
    const supplied = generateHabitability(...input)
    expect(isolated.economicOpportunity[0]).toBe(0)
    expect(supplied.economicOpportunity[0]).toBeGreaterThan(0)
    expect(supplied.carryingCapacityPerKm2[0]).toBeGreaterThan(isolated.carryingCapacityPerKm2[0]!)
  })

  it('does not reward an exposed coast when food and freshwater are unchanged', () => {
    const coastal = generateHabitability(...fixture({ positionsKm: [0, 40], edges: [[0, 1]], seaRegions: [1] }))
    const inland = generateHabitability(...fixture())
    expect(coastal.environmentalSuitability[0]).toBe(inland.environmentalSuitability[0])
    expect(coastal.habitability[0]).toBe(inland.habitability[0])
    expect(coastal.carryingCapacityPerKm2[0]).toBe(inland.carryingCapacityPerKm2[0])
    expect(coastal.portPotential[0]).toBe(0)
    expect(coastal.habitability[1]).toBe(0)
    expect(coastal.carryingCapacityPerKm2[1]).toBe(0)
  })

  it('allows rain-fed inland habitation without requiring a marked river', () => {
    const input = fixture()
    const result = generateHabitability(...input)
    expect(input[3].riverIndex[0]).toBe(-1)
    expect(result.habitability[0]).toBeGreaterThan(0.5)
    expect(result.carryingCapacityPerKm2[0]).toBeGreaterThan(0)
    validateHabitabilityArtifact(result)
  })

  it('does not let rich deposits compensate for no freshwater or extreme temperature', () => {
    const input = fixture({ deposits: [mineral, fuel] })
    input[2].annualPrecipitationMm.fill(0)
    input[5].aridityIndex.fill(0)
    let result = generateHabitability(...input)
    expect(result.habitability[0]).toBe(0)
    expect(result.carryingCapacityPerKm2[0]).toBe(0)
    input[3].riverIndex[0] = 0
    input[3].accumulatedAnnualFlowM3s[0] = 100_000
    result = generateHabitability(...input)
    expect(result.habitability[0]).toBeGreaterThan(0)
    input[2].annualMeanTemperatureC[0] = -20
    result = generateHabitability(...input)
    expect(result.habitability[0]).toBe(0)
    expect(result.carryingCapacityPerKm2[0]).toBe(0)
  })

  it('supports inland industry more strongly with both minerals and fuel', () => {
    const baseline = generateHabitability(...fixture())
    const mining = generateHabitability(...fixture({ deposits: [mineral] }))
    const industry = generateHabitability(...fixture({ deposits: [mineral, fuel] }))
    expect(mining.environmentalSuitability).toEqual(baseline.environmentalSuitability)
    expect(mining.habitability[0]).toBeGreaterThan(baseline.habitability[0]!)
    expect(industry.economicOpportunity[0]).toBeGreaterThan(mining.economicOpportunity[0]!)
    expect(industry.carryingCapacityPerKm2[0]).toBeGreaterThan(mining.carryingCapacityPerKm2[0]!)
  })

  it('requires reachable food for a mine and attenuates access with land resistance', () => {
    const input = fixture({ positionsKm: [0, 50], edges: [[0, 1]], deposits: [mineral, fuel] })
    input[6].agriculturalPotential[0] = 0
    const accessible = generateHabitability(...input)
    expect(accessible.economicOpportunity[0]).toBeGreaterThan(0)
    expect(accessible.carryingCapacityPerKm2[0]).toBeGreaterThan(0)
    input[1].slopeRadians[1] = 0.3
    const obstructed = generateHabitability(...input)
    expect(obstructed.economicOpportunity[0]).toBeLessThan(accessible.economicOpportunity[0]!)
    input[6].agriculturalPotential[1] = 0
    const isolated = generateHabitability(...input)
    expect(isolated.economicOpportunity[0]).toBe(0)
    expect(isolated.carryingCapacityPerKm2[0]).toBe(0)
  })

  it('does not transfer a food hinterland across sea or assign lake residents', () => {
    const input = fixture({ positionsKm: [0, 20, 40], edges: [[0, 1], [1, 2]], seaRegions: [1], deposits: [mineral, fuel] })
    input[6].agriculturalPotential[0] = 0
    let result = generateHabitability(...input)
    expect(result.economicOpportunity[0]).toBe(0)
    expect(result.carryingCapacityPerKm2[0]).toBe(0)
    input[4].lakeIndex[0] = 0
    result = generateHabitability(...input)
    expect(result.habitability[0]).toBe(0)
    expect(result.carryingCapacityPerKm2[0]).toBe(0)
  })

  it('requires shelter, freshwater and gentle terrain for a port proxy', () => {
    const input = fixture({ positionsKm: [0, 10, 20, 30], edges: [[0, 1], [0, 2], [0, 3]], seaRegions: [1] })
    expect(generateHabitability(...input).portPotential[0]).toBeGreaterThan(0.5)
    input[1].slopeRadians[0] = 0.3
    expect(generateHabitability(...input).portPotential[0]).toBe(0)
    input[1].slopeRadians[0] = 0
    input[2].annualPrecipitationMm[0] = 0
    input[5].aridityIndex[0] = 0
    expect(generateHabitability(...input).portPotential[0]).toBe(0)
  })

  it('validates the new bounded opportunity fields and environmental limit', () => {
    const result = generateHabitability(...fixture({ deposits: [mineral, fuel] }))
    result.portPotential[0] = Number.NaN
    expect(() => validateHabitabilityArtifact(result)).toThrow()
    result.portPotential[0] = 0
    result.environmentalSuitability[0] = 0
    expect(() => validateHabitabilityArtifact(result)).toThrow()
  })

  it('selects a supplied inland industrial site without losing population conservation', () => {
    const input = fixture({ positionsKm: [0, 1500, 3000, 10], edges: [[0, 3]], seaRegions: [3], deposits: [{ ...mineral, regionId: 1 }, { ...fuel, regionId: 1 }] })
    const before = input.map(value => structuredClone(value))
    const habitability = generateHabitability(...input)
    const [mesh, terrain, , hydrology, lakes, , resources] = input
    const n = mesh.regionCount
    const run = () => generatePopulationSettlements(
      { ...mesh, areaKm2: new Float64Array(n).fill(SETTLEMENT_SUPPORT_AREA_KM2) },
      terrain,
      { ...hydrology, downstreamRegion: new Int32Array(n).fill(-1) },
      lakes,
      { meshId: mesh.meshId, agriculturalPotential: resources.agriculturalPotential, fisheryPotential: resources.fisheryPotential, mineralPotential: new Float32Array(n) },
      habitability,
      { enabled: true, populationScale: 1, settlementDensity: 1, urbanConcentration: 0.5 },
      'industrial-settlements-seed',
    )
    const result = run()
    expect(result.settlementSites[0]!.regionId).toBe(1)
    expect(result.settlementSites[0]!.isPort).toBe(false)
    validatePopulationSettlementsArtifact(result)
    const baselinePopulation = habitability.carryingCapacityPerKm2.reduce((sum, density) => sum + density * SETTLEMENT_SUPPORT_AREA_KM2, 0)
    const actualPopulation = result.population.reduce((sum, population) => sum + population, 0)
    expect(actualPopulation / baselinePopulation).toBeGreaterThan(0.88)
    expect(actualPopulation / baselinePopulation).toBeLessThan(1.12)
    expect(run()).toEqual(result)
    expect(generateHabitability(...input)).toEqual(habitability)
    expect(input).toEqual(before)
  })
})
