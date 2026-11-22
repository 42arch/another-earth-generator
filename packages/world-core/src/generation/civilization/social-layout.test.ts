import type { ContentId } from '#content/content-port'
import { describe, expect, it } from 'vitest'
import { civilizationContentSignature } from '#content/content-port'
import { extractCivilizationContent, testContentPack } from '#content/test-content'
import { resolveCivilizationParameters } from './civilization-parameters'
import { generatePeoplesCultures, validatePeoplesCulturesArtifact } from './peoples-cultures'
import { generatePolitiesReligions, validatePolitiesReligionsArtifact } from './polities-religions'
import { SETTLEMENT_SUPPORT_AREA_KM2 } from './population-settlements'

type PolityInput = Parameters<typeof generatePolitiesReligions>

function fixture(positionsKm: readonly number[], settlementRegions: readonly number[], cultureIndices = positionsKm.map(() => 0)): PolityInput {
  const n = positionsKm.length
  const meshId = 'social-layout'
  const adjacency: number[][] = Array.from({ length: n }, () => [])
  for (let r = 1; r < n; r++) {
    adjacency[r - 1]!.push(r)
    adjacency[r]!.push(r - 1)
  }
  const neighborOffsets = new Uint32Array(n + 1)
  for (let r = 0; r < n; r++)
    neighborOffsets[r + 1] = neighborOffsets[r]! + adjacency[r]!.length
  const bundle = extractCivilizationContent([testContentPack])
  const cultures = Array.from({ length: Math.max(...cultureIndices) + 1 }, (_, i) => ({
    id: `culture:${i}`,
    name: `Culture ${i}`,
    foundedAtYear: -1000,
    archetypeId: bundle.cultures[0]!.id as ContentId,
    peopleId: 'people:0',
    namingStyleId: bundle.cultures[0]!.namingStyleId,
  }))
  const namedSettlements = settlementRegions.map(regionId => ({
    id: `settlement:${regionId}`,
    name: `Town ${regionId}`,
    foundedAtYear: -500,
    regionId,
    cultureId: cultures[cultureIndices[regionId]!]!.id,
    population: 1000,
    tier: 'town' as const,
  }))
  return [
    bundle,
    civilizationContentSignature(bundle),
    { meshId, regionCount: n, centers: Float64Array.from(positionsKm.flatMap(km => [Math.sin(km / 1000), 0, Math.cos(km / 1000)])), areaKm2: new Float64Array(n).fill(SETTLEMENT_SUPPORT_AREA_KM2), neighborOffsets, neighbors: Uint32Array.from(adjacency.flat()), physicalRadiusKm: 1000 },
    { meshId, landMask: new Uint8Array(n).fill(1), elevationKm: new Float32Array(n).fill(0.1) },
    { meshId, lakeIndex: new Int32Array(n).fill(-1) },
    { meshId, agriculturalPotential: new Float32Array(n).fill(0.8) },
    { meshId, movementCost: new Float32Array(n).fill(1), coastalMask: new Uint8Array(n) },
    { meshId, enabled: true, population: new Float64Array(n).fill(1000) },
    { meshId, nodes: [], routes: [], nodeCentrality: [] },
    {
      meshId,
      peoples: [{ id: 'people:0', name: 'People', foundedAtYear: -2000, archetypeId: bundle.peoples[0]!.id as ContentId }],
      cultures,
      namedSettlements,
      regionCultures: cultureIndices.map(cultureIndex => [{ cultureIndex, share: 1 }]),
      dominantCultureIndex: Int32Array.from(cultureIndices),
      usedNames: [...cultures.map(c => c.name), 'People', ...namedSettlements.map(s => s.name)],
    },
    resolveCivilizationParameters({ polityCount: Math.min(2, settlementRegions.length) }),
    'social-layout-seed',
  ]
}

describe('independent society layout parameters', () => {
  it('changes polity count targets independently of administrative capacity', () => {
    const input = fixture([0, 700, 1400, 2100, 2800], [0, 1, 2, 3, 4])
    input[10] = resolveCivilizationParameters({ polityCount: 2 })
    const sparse = generatePolitiesReligions(...input)
    input[10] = resolveCivilizationParameters({ polityCount: 4 })
    const dense = generatePolitiesReligions(...input)
    expect(dense.polities.length).toBeGreaterThan(sparse.polities.length)
    expect(dense.polities.every(polity => polity.name.endsWith('共和国') && polity.name.length > '共和国'.length)).toBe(true)
    input[10] = resolveCivilizationParameters({ polityCount: 4, capabilities: { administrativeCapacity: 0 } })
    const local = generatePolitiesReligions(...input)
    expect(local.polities.map(p => p.capitalSettlementId)).toEqual(dense.polities.map(p => p.capitalSettlementId))
    expect(local.population).toEqual(dense.population)
    expect(dense.territoryPolityIndex.every(owner => owner >= 0)).toBe(true)
    validatePolitiesReligionsArtifact(dense)
  })

  it('keeps count and population independent of administrative capacity under area budgets', () => {
    const input = fixture([0, 900, 1300, 1600, 2100, 3000], [0, 5], [0, 1, 1, 1, 1, 1])
    input[10] = resolveCivilizationParameters({ polityCount: 2, politySizeVariation: 0, capabilities: { administrativeCapacity: 0 } })
    const local = generatePolitiesReligions(...input)
    input[10] = resolveCivilizationParameters({ polityCount: 2, politySizeVariation: 0, capabilities: { administrativeCapacity: 1 } })
    const integrated = generatePolitiesReligions(...input)
    expect(integrated.polities.map(p => p.capitalSettlementId)).toEqual(local.polities.map(p => p.capitalSettlementId))
    expect(local.polities).toHaveLength(2)
    expect(integrated.polities).toHaveLength(2)
    expect(integrated.population).toEqual(local.population)
    expect(integrated.territoryPolityIndex.every(owner => owner >= 0)).toBe(true)
    validatePolitiesReligionsArtifact(integrated)
    expect(generatePolitiesReligions(...input)).toEqual(integrated)
  })

  it('changes cultural origins with fixed settlements and retains population inputs', () => {
    const input = fixture(Array.from({ length: 9 }, (_, r) => r * 500), Array.from({ length: 9 }, (_, r) => r))
    const [bundle, signature, mesh, terrain, lakes, resources, habitability, population, transport, societies] = input
    const sites = societies.namedSettlements.map(s => ({ id: s.id, regionId: s.regionId, tier: 'town' as const, isPort: false, population: s.population, foundedAtYear: s.foundedAtYear, score: 1 }))
    const before = population.population.slice()
    const run = (diversity: number) => generatePeoplesCultures(
      bundle,
      signature,
      mesh,
      terrain,
      lakes,
      { ...resources, forestryPotential: new Float32Array(mesh.regionCount), fisheryPotential: new Float32Array(mesh.regionCount) },
      { ...habitability, habitability: new Float32Array(mesh.regionCount).fill(0.8) },
      { ...population, settlementSites: sites },
      { ...transport, enabled: true },
      'social-layout-seed',
      diversity,
    )
    const low = run(0.5)
    const high = run(2)
    expect(high.cultures.length).toBeGreaterThan(low.cultures.length)
    expect(high.namedSettlements.map(s => s.regionId)).toEqual(low.namedSettlements.map(s => s.regionId))
    expect(high.namedSettlements.map(s => s.population)).toEqual(low.namedSettlements.map(s => s.population))
    expect(population.population).toEqual(before)
    validatePeoplesCulturesArtifact(high)
    expect(run(2)).toEqual(high)
  })

  it('projects maritime claims by seafaring capability and grants indigenous polities to large isolated inhabited islands', () => {
    // 0: mainland port capital, 1-2: open ocean, 3: distant uninhabited islet,
    // 4-5: open ocean, 6-9: large isolated inhabited island (4 support-area cells + settlement at 7).
    const positionsKm = [0, 250, 500, 750, 1000, 1250, 1500, 1600, 1700, 1800]
    const input = fixture(positionsKm, [0, 7])
    const [bundle, signature, mesh, terrain, lakes, resources, habitability, pop, transport, societies] = input

    const landMask = Uint8Array.from([1, 0, 0, 1, 0, 0, 1, 1, 1, 1])
    const movementCost = Float32Array.from([1, 0.55, 1.35, 1, 1.35, 0.55, 1, 1, 1, 1])
    const coastalMask = Uint8Array.from([1, 0, 0, 1, 0, 0, 1, 0, 0, 0])
    const population = Float64Array.from([5000, 0, 0, 0, 0, 0, 300, 600, 300, 300])
    const namedSettlements = [
      { ...societies.namedSettlements[0]!, regionId: 0, population: 4000, isPort: true },
      { ...societies.namedSettlements[1]!, regionId: 7, population: 500, isPort: false },
    ]
    const regionCultures = Array.from(population, p => (p > 0 ? [{ cultureIndex: 0, share: 1 }] : []))
    const dominantCultureIndex = Int32Array.from(population.map(p => (p > 0 ? 0 : -1)))

    const runWith = (seafaringCapability: number) => generatePolitiesReligions(
      bundle,
      signature,
      mesh,
      { ...terrain, landMask },
      lakes,
      resources,
      { ...habitability, movementCost, coastalMask },
      { ...pop, population },
      transport,
      { ...societies, namedSettlements, regionCultures, dominantCultureIndex },
      // Restrict primary capitals to 1 so the isolated island must rely on indigenous island-polity fallback.
      resolveCivilizationParameters({ polityCount: 2, capabilities: { seafaringCapability, administrativeCapacity: 0.6 } }),
      'maritime-island-seed',
    )

    // Near-modern default (seafaring=1): large isolated island forms an indigenous polity,
    // and the distant uninhabited islet is claimed across open ocean.
    const modern = runWith(1)
    validatePolitiesReligionsArtifact(modern)
    expect(modern.polities.length).toBe(2)
    expect(modern.territoryPolityIndex[0]).toBe(0)
    expect(modern.territoryPolityIndex[3]).toBeGreaterThanOrEqual(0)
    expect(modern.territoryPolityIndex[6]).toBe(1)
    expect(modern.territoryPolityIndex[7]).toBe(1)
    expect(modern.territoryPolityIndex[8]).toBe(1)
    expect(modern.territoryPolityIndex[9]).toBe(1)
    expect(modern.territoryPolityIndex[1]).toBe(-1)
    expect(modern.territoryPolityIndex[2]).toBe(-1)
    expect(modern.territoryPolityIndex[4]).toBe(-1)
    expect(modern.territoryPolityIndex[5]).toBe(-1)
    expect(runWith(1)).toEqual(modern)

    // Zero seafaring: distant uninhabited islet remains unowned, while the large isolated inhabited island still forms its own polity.
    const noSea = runWith(0)
    validatePolitiesReligionsArtifact(noSea)
    expect(noSea.polities.length).toBe(2)
    expect(noSea.territoryPolityIndex[0]).toBe(0)
    expect(noSea.territoryPolityIndex[3]).toBe(-1)
    expect(noSea.territoryPolityIndex[7]).toBe(1)
    expect(noSea.territoryPolityIndex[9]).toBe(1)

    // Low seafaring (agrarian 0.15): cannot reach the distant open-ocean islet either.
    const agrarian = runWith(0.15)
    validatePolitiesReligionsArtifact(agrarian)
    expect(agrarian.territoryPolityIndex[3]).toBe(-1)
    expect(agrarian.territoryPolityIndex[7]).toBe(1)
  })
})
