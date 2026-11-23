import type { ContentId } from '#content/content-port'
import type { PolityPowerDiagnostic, PolityTraitContext, SettlementFeatureScores } from './civilization-traits'
import type { PolityTraitId } from './civilization-types'
import { describe, expect, it } from 'vitest'
import { civilizationContentSignature } from '#content/content-port'
import { extractCivilizationContent, testContentPack } from '#content/test-content'
import { DeterministicRandom } from '#math/random'
import { resolveCivilizationParameters } from './civilization-parameters'
import {
  applyPolityTraitArchetypeWeight,
  computePolityExpansionModifiers,
  emergePolityTraitsForCapitals,
  evaluateSettlementFeatures,
} from './civilization-traits'
import { SETTLEMENT_FEATURE_IDS } from './civilization-types'
import { generatePolitiesReligions, validatePolitiesReligionsArtifact } from './polities-religions'
import { SETTLEMENT_SUPPORT_AREA_KM2 } from './population-settlements'

const DIM1_TRAITS = new Set<PolityTraitId>(['centralized', 'city-state-civic', 'decentralized', 'tribal-kinship', 'nomadic-pastoral'])
const DIM2_TRAITS = new Set<PolityTraitId>(['theocratic', 'democratic', 'militaristic', 'dynastic-aristocratic', 'ancestral-ritual'])
const DIM3_TRAITS = new Set<PolityTraitId>(['mercantile', 'agrarian-realm', 'industrial-power', 'artisan-craft', 'cultural-patron'])

function linearMesh(positionsKm: readonly number[]) {
  const n = positionsKm.length
  const adjacency: number[][] = Array.from({ length: n }, () => [])
  for (let r = 1; r < n; r++) {
    adjacency[r - 1]!.push(r)
    adjacency[r]!.push(r - 1)
  }
  const neighborOffsets = new Uint32Array(n + 1)
  for (let r = 0; r < n; r++)
    neighborOffsets[r + 1] = neighborOffsets[r]! + adjacency[r]!.length
  return {
    meshId: 'traits-mesh',
    regionCount: n,
    centers: Float64Array.from(positionsKm.flatMap(km => [Math.sin(km / 1000), 0, Math.cos(km / 1000)])),
    areaKm2: new Float64Array(n).fill(SETTLEMENT_SUPPORT_AREA_KM2),
    neighborOffsets,
    neighbors: Uint32Array.from(adjacency.flat()),
    physicalRadiusKm: 1000,
  }
}

describe('settlement features and polity traits', () => {
  it('matches injected trait constraints and compound affinities without depending on political form', () => {
    const arch = {
      ...testContentPack.polities[0]!,
      requiredTraits: ['theocratic'],
      traitAffinities: [
        { traits: ['centralized'], sizeClasses: ['kingdom' as const], weight: 2 },
        { traits: ['centralized', 'theocratic'], excludedTraits: ['mercantile'], weight: 3 },
      ],
    }
    expect(applyPolityTraitArchetypeWeight(5, arch, ['centralized', 'agrarian-realm'], 'kingdom')).toBe(0)
    expect(applyPolityTraitArchetypeWeight(5, arch, ['centralized', 'theocratic', 'agrarian-realm'], 'kingdom')).toBe(30)
    expect(applyPolityTraitArchetypeWeight(5, arch, ['centralized', 'theocratic', 'mercantile'], 'kingdom')).toBe(10)
    expect(applyPolityTraitArchetypeWeight(5, arch, ['centralized', 'theocratic', 'agrarian-realm'], 'regional')).toBe(15)
    expect(applyPolityTraitArchetypeWeight(5, testContentPack.polities[0]!, ['centralized', 'agrarian-realm'], 'kingdom')).toBe(5)
    expect(() => applyPolityTraitArchetypeWeight(5, { ...arch, traitAffinities: [{ traits: ['centralized'], weight: Number.MAX_VALUE }] }, ['centralized', 'theocratic', 'agrarian-realm'], 'kingdom')).toThrow('Nonfinite polity affinity weight')
  })

  it('excludes disallowed territory sizes even when every affinity strongly favors the candidate', () => {
    const arch = { ...testContentPack.polities[0]!, allowedSizeClasses: ['city-state' as const], traitAffinities: [{ traits: ['decentralized'], weight: 1000 }] }
    expect(applyPolityTraitArchetypeWeight(5, arch, ['decentralized', 'agrarian-realm'], 'city-state')).toBe(5000)
    for (const size of ['regional', 'kingdom', 'empire'] as const)
      expect(applyPolityTraitArchetypeWeight(5, arch, ['decentralized', 'agrarian-realm'], size)).toBe(0)
  })

  it('includes trait definitions, requirements and affinities in civilization cache identity', () => {
    const bundle = extractCivilizationContent([testContentPack])
    const signature = civilizationContentSignature(bundle)
    expect(civilizationContentSignature({ ...bundle, polities: [{ ...bundle.polities[0]!, allowedSizeClasses: ['city-state'] }] })).not.toBe(signature)
    const withDefinition = { ...bundle, polityTraits: [{ id: 'centralized', dimension: 'power' as const, displayNameKey: 'trait.name', descriptionKey: 'trait.description' }] }
    expect(civilizationContentSignature(withDefinition)).not.toBe(signature)
    const withSize = { ...bundle, polityTraits: [{ id: 'small-area', dimension: 'territory' as const, sizeClasses: ['city-state' as const], displayNameKey: 'small-area', descriptionKey: 'small-area.description' }] }
    expect(civilizationContentSignature(withSize)).not.toBe(civilizationContentSignature({ ...withSize, polityTraits: [{ ...withSize.polityTraits[0]!, sizeClasses: ['regional'] }] }))
    expect(civilizationContentSignature({ ...withDefinition, polityTraits: [{ ...withDefinition.polityTraits[0]!, dimension: 'economy' }] })).not.toBe(civilizationContentSignature(withDefinition))
    expect(civilizationContentSignature({ ...bundle, polities: [{ ...bundle.polities[0]!, requiredTraits: ['theocratic'] }] })).not.toBe(signature)
    expect(civilizationContentSignature({ ...bundle, polities: [{ ...bundle.polities[0]!, traitAffinities: [{ traits: ['centralized'], weight: 2 }] }] })).not.toBe(signature)
  })

  it('distinguishes integrated cores, civic ports and fragmented or multicenter cores under identical modern capabilities', () => {
    const mesh = linearMesh([0, 100, 200, 2000])
    const cap = { id: 'core', name: 'Core', foundedAtYear: -100, regionId: 0, cultureId: 'culture:0', population: 1000, tier: 'city' as const }
    const towns = [1, 2].map(regionId => ({ ...cap, id: `town:${regionId}`, regionId, population: 4000, tier: 'town' as const }))
    const remote = { ...cap, id: 'remote', regionId: 3, population: 20000 }
    const sites = [cap, ...towns, remote]
    const profile = (overrides: Partial<SettlementFeatureScores>) => ({
      scores: Object.fromEntries(SETTLEMENT_FEATURE_IDS.map(id => [id, overrides[id] ?? 0])) as SettlementFeatureScores,
      features: [] as const,
    })
    const base: PolityTraitContext = {
      mesh,
      terrain: { elevationKm: new Float32Array(4).fill(0.1), slopeRadians: new Float32Array(4) },
      habitability: { coastalMask: new Uint8Array(4), movementCost: new Float32Array(4).fill(1) },
      capabilities: { industrialCapability: 1, seafaringCapability: 1, administrativeCapacity: 0.75 },
      urbanConcentration: 0.65,

      namedSettlements: [cap, remote],
      settlementProfiles: new Map(sites.map(site => [site.id, profile({ agrarian: 0.9, industrial: 0.9 })])),
      regionCultures: Array.from({ length: 4 }, () => [{ cultureIndex: 0, share: 1 }]),
      dominantReligionIndex: new Int32Array(4).fill(-1),
      religionArchetypes: [],
    }
    const civic: PolityTraitContext = {
      ...base,
      habitability: { ...base.habitability, coastalMask: Uint8Array.from([1, 0, 0, 0]) },
      settlementProfiles: new Map(base.settlementProfiles).set(cap.id, profile({ 'agrarian': 0.1, 'maritime-trade': 1, 'trade-hub': 1, 'cultural': 0.8 })),
    }
    const fragmented: PolityTraitContext = {
      ...base,
      terrain: { ...base.terrain, slopeRadians: Float32Array.from([0.22, 0, 0, 0]) },
      habitability: { ...base.habitability, movementCost: Float32Array.from([2.2, 1, 1, 1]) },
      regionCultures: [[{ cultureIndex: 0, share: 0.5 }, { cultureIndex: 1, share: 0.5 }], ...base.regionCultures.slice(1)],
    }
    const multicenter: PolityTraitContext = { ...base, namedSettlements: sites }
    // Affinity responds to local evidence; seeded institution choice can retain plausible alternatives.
    for (let seed = 0; seed < 12; seed++) {
      const evaluate = (ctx: PolityTraitContext, capitals = [cap, remote]) => {
        let diagnostic: PolityPowerDiagnostic | undefined
        const traits = emergePolityTraitsForCapitals(capitals, { ...ctx, onPowerEvaluated(value) {
          if (value.capitalSettlementId === cap.id)
            diagnostic = value
        } }, new DeterministicRandom(`local-power:${seed}`), 300)[0]!
        return { traits, diagnostic: diagnostic! }
      }
      expect(evaluate(base).diagnostic.scores[0]!.id).toBe('centralized')
      const culturalHearth = { ...base, settlementProfiles: new Map(base.settlementProfiles).set(cap.id, profile({ agrarian: 0.9, cultural: 1 })) }
      expect(evaluate(culturalHearth).diagnostic.scores[0]!.id).toBe('centralized')
      expect(evaluate(culturalHearth).traits).not.toContain('city-state-civic')
      expect(evaluate(civic).diagnostic.scores[0]!.id).toBe('city-state-civic')
      expect(evaluate(fragmented).diagnostic.scores[0]!.id).toBe('decentralized')
      expect(evaluate(multicenter).diagnostic.scores[0]!.id).toBe('decentralized')
      // An unrelated metropolis cannot change the founding core's power structure through global population ranking.
      const giant = { ...remote, population: 1_000_000_000 }
      expect(evaluate({ ...base, namedSettlements: [cap, giant] }, [cap, giant])).toEqual(evaluate(base))
    }
  })

  it('does not equate a large hinterland with decentralization or saturate civic affinity near equal production scores', () => {
    const mesh = linearMesh([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    const cap = { id: 'cap', name: 'Capital', foundedAtYear: -100, regionId: 0, cultureId: 'culture:0', population: 1000, tier: 'city' as const }
    const towns = Array.from({ length: 10 }, (_, i) => ({ ...cap, id: `s:${i}`, regionId: i + 1, population: 100 }))
    const sites = [cap, ...towns]
    const profile = { scores: Object.fromEntries(SETTLEMENT_FEATURE_IDS.map(id => [id, id === 'agrarian' ? 0.65 : id === 'trade-hub' ? 0.66 : 0])) as SettlementFeatureScores, features: [] as const }
    const choices = new Set<PolityTraitId>()
    let diagnostic: PolityPowerDiagnostic | undefined
    const ctx: PolityTraitContext = {
      mesh,
      terrain: { elevationKm: new Float32Array(11) },
      habitability: { coastalMask: new Uint8Array(11) },
      capabilities: { industrialCapability: 1, seafaringCapability: 1, administrativeCapacity: 0.75 },
      urbanConcentration: 0.65,
      namedSettlements: sites,
      settlementProfiles: new Map(sites.map(site => [site.id, profile])),
      regionCultures: Array.from({ length: 11 }, () => [{ cultureIndex: 0, share: 1 }]),
      dominantReligionIndex: new Int32Array(11).fill(-1),
      religionArchetypes: [],
      onPowerEvaluated(value) { diagnostic = value },
    }
    for (let seed = 0; seed < 128; seed++)
      choices.add(emergePolityTraitsForCapitals([cap], ctx, new DeterministicRandom(`institution:${seed}`), 1000)[0]![0]!)
    expect(diagnostic!.signals.distributedCenters).toBeLessThan(0.11)
    expect(diagnostic!.signals.civicSpecialization).toBeLessThan(0.05)
    expect(choices).toEqual(new Set(['centralized', 'decentralized', 'city-state-civic']))
    expect(Object.isFrozen(diagnostic!.signals)).toBe(true)
    expect(Object.isFrozen(diagnostic!.scores)).toBe(true)
  })

  it('gates industrial and maritime-trade features by society capabilities and transitions craft to industrial', () => {
    const mesh = linearMesh([0, 60, 120, 180, 240, 300, 360])
    const namedSettlements = [
      { id: 's:port', name: 'Port', foundedAtYear: -300, regionId: 0, cultureId: 'culture:0', population: 2000, tier: 'city' as const, isPort: true },
      { id: 's:mine', name: 'Forge', foundedAtYear: -300, regionId: 2, cultureId: 'culture:0', population: 1500, tier: 'town' as const, isPort: false },
      { id: 's:steppe', name: 'Steppe', foundedAtYear: -300, regionId: 4, cultureId: 'culture:0', population: 600, tier: 'town' as const, isPort: false },
      { id: 's:holy', name: 'Sanctuary', foundedAtYear: -300, regionId: 6, cultureId: 'culture:0', population: 900, tier: 'town' as const, isPort: false },
    ]
    const baseCtx = {
      mesh,
      terrain: {
        landMask: Uint8Array.from([1, 1, 1, 1, 1, 1, 1]),
        elevationKm: Float32Array.from([0.05, 0.1, 0.4, 0.2, 1.3, 0.2, 0.2]),
        slopeRadians: Float32Array.from([0.02, 0.02, 0.08, 0.03, 0.06, 0.03, 0.03]),
      },
      ecology: {
        landCoverIds: ['core:cover/forest', 'core:cover/grassland'],
        landCoverIndex: Uint16Array.from([0, 0, 0, 0, 1, 0, 0]),
      },
      resources: {
        agriculturalPotential: Float32Array.from([0.25, 0.1, 0.2, 0.1, 0.08, 0.1, 0.5]),
        forestryPotential: Float32Array.from([0.2, 0.2, 0.75, 0.2, 0.05, 0.1, 0.2]),
        fisheryPotential: Float32Array.from([0.85, 0, 0, 0, 0, 0, 0]),
        deposits: [
          { id: 'd:iron', resourceId: 'core:resource/iron' as ContentId, regionId: 2, category: 'mineral' as const, richness: 0.9, primaryFactor: 'orogen' },
          { id: 'd:coal', resourceId: 'core:resource/coal' as ContentId, regionId: 2, category: 'energy' as const, richness: 0.9, primaryFactor: 'basin' },
        ],
      },
      habitability: {
        coastalMask: Uint8Array.from([1, 0, 0, 0, 0, 0, 0]),
        economicOpportunity: Float32Array.from([0.6, 0.1, 0.95, 0.1, 0.1, 0.1, 0.3]),
        portPotential: Float32Array.from([0.92, 0, 0, 0, 0, 0, 0]),
      },
      transport: {
        nodes: [
          { id: 'n:0', regionId: 0, settlementId: 's:port', kind: 'settlement' as const },
          { id: 'n:1', regionId: 2, settlementId: 's:mine', kind: 'settlement' as const },
        ],
        routes: [
          { id: 'r:sea', fromNodeId: 'n:0', toNodeId: 'n:1', mode: 'sea' as const, regions: new Uint32Array([0, 1, 2]), cost: 1, trafficScore: 100 },
          { id: 'r:road', fromNodeId: 'n:0', toNodeId: 'n:1', mode: 'road' as const, regions: new Uint32Array([0, 1, 2]), cost: 1, trafficScore: 80 },
        ],
        nodeCentrality: [0.85, 0.85],
      },
      namedSettlements,
      regionCultures: Array.from({ length: 7 }, () => [{ cultureIndex: 0, share: 1 }]),
      hearthRegions: [6],
      religionOriginRegions: new Set([6]),
      dominantReligionIndex: Int32Array.from([0, 0, 0, 0, 0, 0, 0]),
      religionCosts: [Float32Array.from([40, 35, 25, 20, 15, 10, 0])],
      religionArchetypes: [extractCivilizationContent([testContentPack]).religions[0]!],
    }

    // Agrarian preset capabilities: no industrial, no maritime-trade; craft + mining active, port falls back to fishery.
    const agrarian = evaluateSettlementFeatures({
      ...baseCtx,
      urbanConcentration: 0.18,
      capabilities: {
        industrialCapability: 0,
        landTransportCapability: 0.12,
        seafaringCapability: 0.05,
        administrativeCapacity: 0.25,
      },
    })
    for (const profile of agrarian.values()) {
      expect(profile.features).not.toContain('industrial')
      expect(profile.features).not.toContain('maritime-trade')
      expect(profile.features.length).toBeGreaterThanOrEqual(1)
    }
    expect(agrarian.get('s:port')!.features).toContain('fishery')
    expect(agrarian.get('s:mine')!.scores.craft).toBeGreaterThan(0.5)
    expect(agrarian.get('s:mine')!.scores.industrial).toBe(0)
    expect(agrarian.get('s:steppe')!.features).toContain('pastoral')
    expect(agrarian.get('s:holy')!.features).toContain('religious')

    // Modern industrial preset capabilities: industrial replaces craft, maritime-trade unlocks on port.
    const modern = evaluateSettlementFeatures({
      ...baseCtx,
      urbanConcentration: 0.65,
      capabilities: {
        industrialCapability: 1,
        landTransportCapability: 1,
        seafaringCapability: 1,
        administrativeCapacity: 0.75,
      },
    })
    expect(modern.get('s:port')!.features).toContain('maritime-trade')
    expect(modern.get('s:mine')!.features).toContain('industrial')
    expect(modern.get('s:mine')!.scores.craft).toBe(0)
    expect(modern.get('s:holy')!.features).toContain('religious')
  })

  it('enforces 3 orthogonal polity trait dimensions and retires pre-modern traits in modern societies', () => {
    const mesh = linearMesh([0, 500, 1000])
    const namedSettlements = [
      { id: 's:0', name: 'Capital A', foundedAtYear: -300, regionId: 0, cultureId: 'culture:0', population: 3000, tier: 'city' as const, isPort: true },
      { id: 's:1', name: 'Town B', foundedAtYear: -300, regionId: 1, cultureId: 'culture:0', population: 1200, tier: 'town' as const, isPort: false },
      { id: 's:2', name: 'Capital C', foundedAtYear: -300, regionId: 2, cultureId: 'culture:0', population: 2500, tier: 'city' as const, isPort: false },
    ]
    const bundle = extractCivilizationContent([testContentPack])
    const common = {
      mesh,
      terrain: { landMask: Uint8Array.from([1, 1, 1]), elevationKm: Float32Array.from([0.1, 0.2, 0.3]) },
      resources: { agriculturalPotential: Float32Array.from([0.85, 0.4, 0.3]), forestryPotential: Float32Array.from([0.2, 0.7, 0.2]), fisheryPotential: Float32Array.from([0.6, 0, 0]) },
      habitability: { coastalMask: Uint8Array.from([1, 0, 0]), economicOpportunity: Float32Array.from([0.9, 0.85, 0.85]), portPotential: Float32Array.from([0.9, 0, 0]) },
      transport: { nodes: [], routes: [], nodeCentrality: [] },
      namedSettlements,
      regionCultures: Array.from({ length: 3 }, () => [{ cultureIndex: 0, share: 1 }]),
      religionOriginRegions: new Set<number>(),
      dominantReligionIndex: Int32Array.from([0, 0, 0]),
      religionCosts: [Float32Array.from([30, 30, 30])],
      religionArchetypes: [bundle.religions[0]!],
    }

    const checkOrthogonal = (traits: readonly PolityTraitId[]) => {
      const d1 = traits.filter(t => DIM1_TRAITS.has(t))
      const d2 = traits.filter(t => DIM2_TRAITS.has(t))
      const d3 = traits.filter(t => DIM3_TRAITS.has(t))
      expect(d1.length).toBe(1)
      expect(d2.length).toBeLessThanOrEqual(1)
      expect(d3.length).toBe(1)
      expect(new Set(traits).size).toBe(traits.length)
    }

    // Agrarian society: tribal-kinship / ancestral-ritual / artisan-craft are permitted; centralized / industrial-power / mercantile are gated off.
    const agrarianCaps = { industrialCapability: 0, landTransportCapability: 0.12, seafaringCapability: 0.05, administrativeCapacity: 0.25 }
    const agrarianProfiles = evaluateSettlementFeatures({ ...common, urbanConcentration: 0.18, capabilities: agrarianCaps })
    const agrarianTraits = emergePolityTraitsForCapitals(
      [namedSettlements[0]!, namedSettlements[2]!],
      {
        mesh,
        terrain: common.terrain,
        habitability: common.habitability,
        capabilities: agrarianCaps,
        urbanConcentration: 0.18,

        namedSettlements,
        settlementProfiles: agrarianProfiles,
        regionCultures: common.regionCultures,
        dominantReligionIndex: common.dominantReligionIndex,
        religionArchetypes: common.religionArchetypes,
      },
      new DeterministicRandom('agrarian-polity-traits'),
      600,
    )
    for (const traits of agrarianTraits) {
      checkOrthogonal(traits)
      expect(traits).not.toContain('centralized')
      expect(traits).not.toContain('industrial-power')
      expect(traits).not.toContain('mercantile')
      expect(traits).not.toContain('democratic')
    }

    // Modern society: tribal-kinship, ancestral-ritual, and artisan-craft retire.
    const modernCaps = { industrialCapability: 1, landTransportCapability: 1, seafaringCapability: 1, administrativeCapacity: 0.75 }
    const modernProfiles = evaluateSettlementFeatures({ ...common, urbanConcentration: 0.65, capabilities: modernCaps })
    const modernTraits = emergePolityTraitsForCapitals(
      [namedSettlements[0]!, namedSettlements[2]!],
      {
        mesh,
        terrain: common.terrain,
        habitability: common.habitability,
        capabilities: modernCaps,
        urbanConcentration: 0.65,

        namedSettlements,
        settlementProfiles: modernProfiles,
        regionCultures: common.regionCultures,
        dominantReligionIndex: common.dominantReligionIndex,
        religionArchetypes: common.religionArchetypes,
      },
      new DeterministicRandom('modern-polity-traits'),
      600,
    )
    for (const traits of modernTraits) {
      checkOrthogonal(traits)
      expect(traits).not.toContain('tribal-kinship')
      expect(traits).not.toContain('ancestral-ritual')
      expect(traits).not.toContain('artisan-craft')
    }
  })

  it('produces expansion modifiers and reproducible unequal territories within an exact count budget', () => {
    const empireMods = computePolityExpansionModifiers(['centralized', 'militaristic', 'industrial-power'])
    const cityStateMods = computePolityExpansionModifiers(['city-state-civic', 'democratic', 'mercantile'])
    const theocracyMods = computePolityExpansionModifiers(['centralized', 'theocratic', 'agrarian-realm'])

    expect(empireMods.baseRate).toBeGreaterThan(1.4)
    expect(cityStateMods.baseRate).toBeLessThan(0.55)
    expect(cityStateMods.oceanProjectionFactor).toBeLessThan(0.65)
    expect(theocracyMods.sameReligionFactor).toBeLessThan(0.8)
    expect(theocracyMods.diffReligionFactor).toBeGreaterThan(1.2)

    // End-to-end deterministic run with asymmetric capitals:
    // Capital 0 is a huge centralized agrarian/industrial center; Capital 1 is a small coastal port.
    const positions = [0, 300, 600, 900, 1200, 1500, 1800]
    const mesh = linearMesh(positions)
    const n = mesh.regionCount
    const bundle = extractCivilizationContent([testContentPack])
    const cultures = [{
      id: 'culture:0',
      name: 'Core Culture',
      foundedAtYear: -1000,
      archetypeId: bundle.cultures[0]!.id as ContentId,
      peopleId: 'people:0',
      namingStyleId: bundle.cultures[0]!.namingStyleId,
    }]
    const namedSettlements = [
      { id: 'settlement:0', name: 'Imperial', foundedAtYear: -500, regionId: 0, cultureId: 'culture:0', population: 12000, tier: 'city' as const, isPort: false },
      { id: 'settlement:6', name: 'Freeport', foundedAtYear: -500, regionId: 6, cultureId: 'culture:0', population: 1200, tier: 'town' as const, isPort: true },
    ]
    const run = (content = bundle, sites = namedSettlements, polityCount = 2) => generatePolitiesReligions(
      content,
      civilizationContentSignature(content),
      mesh,
      { meshId: mesh.meshId, landMask: new Uint8Array(n).fill(1), elevationKm: new Float32Array(n).fill(0.1), slopeRadians: new Float32Array(n).fill(0.02) },
      { meshId: mesh.meshId, lakeIndex: new Int32Array(n).fill(-1) },
      { meshId: mesh.meshId, agriculturalPotential: Float32Array.from([0.9, 0.8, 0.8, 0.8, 0.7, 0.4, 0.2]), forestryPotential: new Float32Array(n).fill(0.2), fisheryPotential: Float32Array.from([0, 0, 0, 0, 0, 0, 0.8]), deposits: [] },
      { meshId: mesh.meshId, movementCost: new Float32Array(n).fill(1), coastalMask: Uint8Array.from([0, 0, 0, 0, 0, 0, 1]), economicOpportunity: Float32Array.from([0.9, 0.7, 0.6, 0.5, 0.4, 0.3, 0.5]), portPotential: Float32Array.from([0, 0, 0, 0, 0, 0, 0.95]) },
      { meshId: mesh.meshId, enabled: true, population: Float64Array.from([14000, 1000, 1000, 1000, 1000, 1000, 1500]) },
      {
        meshId: mesh.meshId,
        nodes: [
          { id: 'n:0', regionId: 0, settlementId: 'settlement:0', kind: 'settlement' },
          { id: 'n:6', regionId: 6, settlementId: 'settlement:6', kind: 'settlement' },
        ],
        routes: [
          { id: 'r:sea', fromNodeId: 'n:6', toNodeId: 'n:0', mode: 'sea', regions: new Uint32Array([6, 0]), cost: 25, trafficScore: 90 },
        ],
        nodeCentrality: [0.5, 0.9],
      },
      {
        meshId: mesh.meshId,
        peoples: [{ id: 'people:0', name: 'People', foundedAtYear: -2000, archetypeId: bundle.peoples[0]!.id as ContentId }],
        cultures,
        namedSettlements: sites,
        hearthRegions: [0],
        regionCultures: Array.from({ length: n }, () => [{ cultureIndex: 0, share: 1 }]),
        dominantCultureIndex: new Int32Array(n),
        usedNames: ['Core Culture', 'People', 'Imperial', 'Freeport'],
      },
      resolveCivilizationParameters({ polityCount, politySizeVariation: 0.8, urbanConcentration: 0.65, capabilities: { administrativeCapacity: 0.75, industrialCapability: 1, seafaringCapability: 1, landTransportCapability: 1 } }),
      'traits-expansion-seed',
    )

    // A single settlement in seven reference cells is regional, never a city-state.
    const sparse = run(bundle, namedSettlements.slice(0, 1), 1)
    expect(sparse.polities[0]!.sizeClass).toBe('regional')
    expect(() => run({ ...bundle, polities: bundle.polities.map(arch => ({ ...arch, allowedSizeClasses: ['city-state'] })) }, namedSettlements.slice(0, 1), 1)).toThrow('territory size')
    const output = run()
    const sizeContent = { ...bundle, polityTraits: [{ id: 'small-area', dimension: 'territory' as const, sizeClasses: ['city-state' as const], displayNameKey: 'small-area.name', descriptionKey: 'small-area.description' }] }
    const sized = run(sizeContent)
    expect(sized.polities.some(polity => polity.sizeClass === 'city-state')).toBe(true)
    for (const polity of sized.polities)
      expect(polity.traits.includes('small-area')).toBe(polity.sizeClass === 'city-state')
    validatePolitiesReligionsArtifact(sized)
    const requiredSize = { ...sizeContent, polities: sizeContent.polities.map(arch => ({ ...arch, requiredTraits: ['small-area'] })) }
    expect(() => run(requiredSize, namedSettlements.slice(0, 1), 1)).toThrow('No polity archetype matches traits')
    expect(run()).toEqual(output)
    expect(() => run({ ...bundle, polities: bundle.polities.map(arch => ({ ...arch, requiredTraits: ['tribal-kinship'] })) })).toThrow('No polity archetype matches traits')
    validatePolitiesReligionsArtifact(output)
    expect(output.polities.length).toBe(2)
    for (const polity of output.polities)
      expect(polity.traits.length).toBeGreaterThanOrEqual(2)
    for (const settlement of output.settlements)
      expect(settlement.features.length).toBeGreaterThanOrEqual(1)

    const cells0 = output.territoryPolityIndex.filter(p => p === 0).length
    const cells1 = output.territoryPolityIndex.filter(p => p === 1).length
    expect(cells0 + cells1).toBe(n)
    expect(Math.abs(cells0 - cells1)).toBeGreaterThan(1)
  })

  it('diversifies polity traits across geographic niches under default modern industrial capabilities', () => {
    // 5 capitals under default modern preset:
    // 0: big industrial & mining heartland
    // 1: smaller coastal maritime-trade port
    // 2: multi-cultural mountain fortress/forest federation
    // 3: sacred religious origin city
    // 4: fertile flatland agrarian heartland
    const mesh = linearMesh([0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400])
    const namedSettlements = [
      { id: 'c:0', name: 'Steelburg', foundedAtYear: -300, regionId: 0, cultureId: 'culture:0', population: 12000, tier: 'city' as const, isPort: false },
      { id: 'c:1', name: 'Freeport', foundedAtYear: -300, regionId: 2, cultureId: 'culture:0', population: 2200, tier: 'town' as const, isPort: true },
      { id: 'c:2', name: 'Highpass', foundedAtYear: -300, regionId: 4, cultureId: 'culture:0', population: 4200, tier: 'town' as const, isPort: false },
      { id: 'c:3', name: 'Holyseat', foundedAtYear: -300, regionId: 6, cultureId: 'culture:0', population: 5000, tier: 'city' as const, isPort: false },
      { id: 'c:4', name: 'Breadvale', foundedAtYear: -300, regionId: 8, cultureId: 'culture:0', population: 9500, tier: 'city' as const, isPort: false },
    ]
    const bundle = extractCivilizationContent([testContentPack])
    const modernCaps = { industrialCapability: 1, landTransportCapability: 1, seafaringCapability: 1, administrativeCapacity: 0.75 }
    const common = {
      mesh,
      terrain: {
        landMask: Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1, 1]),
        elevationKm: Float32Array.from([0.25, 0.1, 0.05, 0.2, 1.35, 0.2, 0.3, 0.2, 0.08]),
        slopeRadians: Float32Array.from([0.04, 0.03, 0.02, 0.03, 0.16, 0.03, 0.04, 0.03, 0.01]),
      },
      resources: {
        agriculturalPotential: Float32Array.from([0.5, 0.3, 0.4, 0.3, 0.25, 0.3, 0.55, 0.5, 0.92]),
        forestryPotential: Float32Array.from([0.3, 0.2, 0.2, 0.2, 0.85, 0.2, 0.2, 0.2, 0.15]),
        fisheryPotential: Float32Array.from([0, 0, 0.8, 0, 0, 0, 0, 0, 0]),
        deposits: [
          { id: 'd:0', resourceId: 'core:resource/iron' as ContentId, regionId: 0, category: 'mineral' as const, richness: 0.9, primaryFactor: 'orogen' },
          { id: 'd:1', resourceId: 'core:resource/coal' as ContentId, regionId: 0, category: 'energy' as const, richness: 0.9, primaryFactor: 'basin' },
          { id: 'd:2', resourceId: 'core:resource/iron' as ContentId, regionId: 4, category: 'mineral' as const, richness: 0.75, primaryFactor: 'orogen' },
        ],
      },
      habitability: {
        coastalMask: Uint8Array.from([0, 0, 1, 0, 0, 0, 0, 0, 0]),
        economicOpportunity: Float32Array.from([0.55, 0.1, 0.25, 0.1, 0.2, 0.1, 0.15, 0.1, 0.08]),
        portPotential: Float32Array.from([0, 0, 0.9, 0, 0, 0, 0, 0, 0]),
      },
      transport: {
        nodes: [
          { id: 'n:0', regionId: 0, settlementId: 'c:0', kind: 'settlement' as const },
          { id: 'n:1', regionId: 2, settlementId: 'c:1', kind: 'settlement' as const },
          { id: 'n:2', regionId: 4, settlementId: 'c:2', kind: 'settlement' as const },
        ],
        routes: [
          { id: 'r:sea', fromNodeId: 'n:1', toNodeId: 'n:0', mode: 'sea' as const, regions: new Uint32Array([1, 0]), cost: 1, trafficScore: 100 },
          { id: 'r:road1', fromNodeId: 'n:0', toNodeId: 'n:2', mode: 'road' as const, regions: new Uint32Array([0, 2]), cost: 1, trafficScore: 80 },
          { id: 'r:road2', fromNodeId: 'n:1', toNodeId: 'n:2', mode: 'road' as const, regions: new Uint32Array([1, 2]), cost: 1, trafficScore: 60 },
        ],
        nodeCentrality: [0.8, 0.85, 0.7],
      },
      namedSettlements,
      regionCultures: [
        [{ cultureIndex: 0, share: 1 }],
        [{ cultureIndex: 0, share: 1 }],
        [{ cultureIndex: 0, share: 0.7 }, { cultureIndex: 1, share: 0.3 }],
        [{ cultureIndex: 0, share: 1 }],
        [{ cultureIndex: 0, share: 0.55 }, { cultureIndex: 1, share: 0.45 }],
        [{ cultureIndex: 0, share: 1 }],
        [{ cultureIndex: 0, share: 1 }],
        [{ cultureIndex: 0, share: 1 }],
        [{ cultureIndex: 0, share: 1 }],
      ],
      hearthRegions: [6],
      religionOriginRegions: new Set([6]),
      dominantReligionIndex: Int32Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0]),
      religionCosts: [Float32Array.from([50, 45, 40, 35, 30, 20, 0, 20, 30])],
      religionArchetypes: [bundle.religions[0]!],
    }

    const profiles = evaluateSettlementFeatures({ ...common, urbanConcentration: 0.65, capabilities: modernCaps })
    const powerProfiles = new Map<string, PolityPowerDiagnostic>()
    const traitsList = emergePolityTraitsForCapitals(
      namedSettlements,
      {
        mesh,
        terrain: common.terrain,
        habitability: common.habitability,
        capabilities: modernCaps,
        urbanConcentration: 0.65,

        namedSettlements,
        settlementProfiles: profiles,
        regionCultures: common.regionCultures,
        dominantReligionIndex: common.dominantReligionIndex,
        religionArchetypes: common.religionArchetypes,
        onPowerEvaluated: value => powerProfiles.set(value.capitalSettlementId, value),
      },
      new DeterministicRandom('modern-diversity-seed'),
      400,
    )

    expect(traitsList[0]).toContain('industrial-power')
    expect(powerProfiles.get('c:1')!.scores.find(s => s.id === 'city-state-civic')!.score).toBeGreaterThan(0)
    expect(traitsList[1]).toContain('mercantile')
    expect(powerProfiles.get('c:2')!.scores[0]!.id).toBe('decentralized')
    expect(traitsList[3]).toContain('theocratic')
    expect(traitsList[4]).toContain('agrarian-realm')
    expect(new Set(traitsList.map(t => t.join(','))).size).toBeGreaterThanOrEqual(4)
  })
})
