import type { HabitabilityArtifact } from '#generation/civilization/habitability'
import { describe, expect, it } from 'vitest'
import { testContentPack, testContentPort, testPipelineContent } from '#content/test-content'
import {
  assembleWorld,
  createWorldMapReader,
  createWorldPipeline,
  decodeWorldArchive,
  DEFAULT_CIVILIZATION_PARAMETERS,
  DEFAULT_CLIMATE_PARAMETERS,
  DEFAULT_GEOLOGY_PARAMETERS,
  DEFAULT_HYDROLOGY_PARAMETERS,
  DEFAULT_LANDFORM_PARAMETERS,
  DEFAULT_TERRAIN_PARAMETERS,
  encodeWorldArchive,
  validateWorldSnapshot,
  WorldStore,
} from '../../index'

function baseInput(civilization = DEFAULT_CIVILIZATION_PARAMETERS) {
  return {
    seed: 'm2-civilization-seed',
    config: {
      ecology: true as const,
      planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
      mesh: { subdivisionLevel: 4, irregularity: 0.45 },
      reference: { subdivisionLevel: 4 },
      geology: DEFAULT_GEOLOGY_PARAMETERS,
      landforms: DEFAULT_LANDFORM_PARAMETERS,
      terrain: DEFAULT_TERRAIN_PARAMETERS,
      climate: DEFAULT_CLIMATE_PARAMETERS,
      hydrology: DEFAULT_HYDROLOGY_PARAMETERS,
      civilization,
    },
  }
}

const identity = {
  snapshotId: 'snapshot:civ-test',
  worldId: 'world:civ-test',
  name: 'Civilization Test',
  createdAt: '2026-11-20T00:00:00Z',
}

describe('world civilization pipeline (M2 Batch 2)', () => {
  it('normalizes omitted capability defaults before hashing and rejects invalid inputs', () => {
    const pipeline = createWorldPipeline()
    const input = { ...baseInput(), ...testPipelineContent() }
    const partial = { ...input, config: { ...input.config, civilization: { populationScale: 1 } } }
    expect(pipeline.plan(partial)).toEqual(pipeline.plan(input))
    const invalid = { ...input, config: { ...input.config, civilization: { capabilities: { landTransportCapability: Number.NaN } } } }
    expect(() => pipeline.plan(invalid)).toThrow()
  })

  it('saves detached capabilities and reproduces map queries after archive restoration', async () => {
    const packs = [testContentPack]
    const pipeline = createWorldPipeline()
    const capabilities = { agriculturalProductivity: 1.5, industrialCapability: 0.35, landTransportCapability: 1.75, seafaringCapability: 0, administrativeCapacity: 0.6 }
    const polityCount = 3
    const input = { ...baseInput({ ...DEFAULT_CIVILIZATION_PARAMETERS, capabilities, urbanConcentration: 0.8, polityCount, politySizeVariation: 0.8, culturalDiversity: 1.5 }), ...testPipelineContent(packs) }
    const result = await pipeline.execute(input)
    const world = assembleWorld(input, result, pipeline.registry, identity, packs, testContentPort)
    expect(world.metadata.generationConfig.civilization?.capabilities).toEqual(capabilities)
    expect(world.metadata.generationConfig.civilization?.capabilities).not.toBe(capabilities)
    expect(world.civilization.transport.routes.some(route => route.mode === 'sea')).toBe(false)
    const restored = decodeWorldArchive(encodeWorldArchive(world, packs, testContentPort), packs, testContentPort)
    expect(restored.metadata.generationConfig.civilization?.urbanConcentration).toBe(0.8)
    expect(restored.metadata.generationConfig.civilization?.polityCount).toBe(3)
    expect(restored.metadata.generationConfig.civilization?.culturalDiversity).toBe(1.5)
    const reader = createWorldMapReader(restored)
    // Changing pending caller parameters must not change the published queries.
    capabilities.agriculturalProductivity = 0.25
    input.config.civilization = { ...input.config.civilization, polityCount: 1 }
    expect(world.metadata.generationConfig.civilization?.polityCount).toBe(3)
    expect(world.civilization.polities).toHaveLength(3)
    const generated = result.getOutput<HabitabilityArtifact>('habitability')
    for (let r = 0; r < world.mesh.regionCount; r++) {
      expect(reader.field('habitability').get(r)).toBeCloseTo(generated.habitability[r]!, 6)
      expect(reader.field('carryingCapacityPerKm2').get(r)).toBeCloseTo(generated.carryingCapacityPerKm2[r]!, 3)
    }
    expect(world.metadata.generationConfig.civilization?.capabilities.agriculturalProductivity).toBe(1.5)
  })

  it('invalidates only relevant stages when capabilities change', async () => {
    const pipeline = createWorldPipeline()
    const input = { ...baseInput(), ...testPipelineContent() }
    await pipeline.execute(input)
    const changed = (key: keyof typeof DEFAULT_CIVILIZATION_PARAMETERS.capabilities, value: number) => ({
      ...input,
      config: { ...input.config, civilization: { ...DEFAULT_CIVILIZATION_PARAMETERS, capabilities: { ...DEFAULT_CIVILIZATION_PARAMETERS.capabilities, [key]: value } } },
    })
    const maritime = pipeline.plan(changed('seafaringCapability', 0))
    expect(maritime.filter(stage => stage.action === 'execute').map(stage => stage.stageId)).toEqual(['transport-network', 'peoples-cultures', 'polities-religions'])
    for (const key of ['agriculturalProductivity', 'industrialCapability', 'landTransportCapability'] as const) {
      const plan = pipeline.plan(changed(key, 1.5))
      expect(plan.find(stage => stage.stageId === 'resource-potential')?.action).toBe('cache-hit')
      expect(plan.find(stage => stage.stageId === 'terrain')?.action).toBe('cache-hit')
      expect(plan.find(stage => stage.stageId === 'habitability')?.action).toBe('execute')
      expect(plan.find(stage => stage.stageId === 'population-settlements')?.action).toBe('execute')
    }
    const execution = (civilization: typeof DEFAULT_CIVILIZATION_PARAMETERS) => pipeline.plan({ ...input, config: { ...input.config, civilization } }).filter(stage => stage.action === 'execute').map(stage => stage.stageId)
    expect(execution({ ...DEFAULT_CIVILIZATION_PARAMETERS, capabilities: { ...DEFAULT_CIVILIZATION_PARAMETERS.capabilities, administrativeCapacity: 1 } })).toEqual(['polities-religions'])
    expect(execution({ ...DEFAULT_CIVILIZATION_PARAMETERS, polityCount: 4 })).toEqual(['polities-religions'])
    expect(execution({ ...DEFAULT_CIVILIZATION_PARAMETERS, politySizeVariation: 1 })).toEqual(['polities-religions'])
    expect(execution({ ...DEFAULT_CIVILIZATION_PARAMETERS, culturalDiversity: 2 })).toEqual(['peoples-cultures', 'polities-religions'])
    expect(execution({ ...DEFAULT_CIVILIZATION_PARAMETERS, urbanConcentration: 1 })).toEqual(['population-settlements', 'transport-network', 'peoples-cultures', 'polities-religions'])
  })

  it('generates reproducible resources, settlements, transport, peoples, cultures, religions and polities with full conservation', async () => {
    const packs = [testContentPack]
    const pipelineA = createWorldPipeline()
    const pipelineB = createWorldPipeline()
    const input = { ...baseInput(), ...testPipelineContent(packs) }

    const resultA = await pipelineA.execute(input)
    const resultB = await pipelineB.execute(input)
    const worldA = assembleWorld(input, resultA, pipelineA.registry, identity, packs, testContentPort)
    const worldB = assembleWorld(input, resultB, pipelineB.registry, identity, packs, testContentPort)

    expect(worldA).toEqual(worldB)
    expect(worldA.metadata.generationConfig.civilizationEnabled).toBe(true)
    expect(worldA.nature.resources.resourceIds.length).toBeGreaterThan(0)
    expect(worldA.nature.resources.deposits.length).toBeGreaterThan(0)
    expect(worldA.civilization.peoples.length).toBeGreaterThan(0)
    expect(worldA.civilization.cultures.length).toBeGreaterThan(0)
    expect(worldA.civilization.religions.length).toBeGreaterThan(0)
    expect(worldA.civilization.polities).toHaveLength(60)
    expect(worldA.civilization.settlements.length).toBeGreaterThan(0)
    expect(worldA.civilization.transport.nodes.length).toBe(worldA.civilization.settlements.length)
    expect(worldA.civilization.transport.routes.length).toBeGreaterThan(0)

    const allNames = [
      ...worldA.civilization.peoples.map(p => p.name),
      ...worldA.civilization.cultures.map(c => c.name),
      ...worldA.civilization.religions.map(r => r.name),
      ...worldA.civilization.polities.map(p => p.name),
      ...worldA.civilization.settlements.map(s => s.name),
    ]
    expect(new Set(allNames).size).toBe(allNames.length)

    expect(validateWorldSnapshot(worldA, packs, testContentPort).valid).toBe(true)
    const unrestrictedSizes = ['city-state', 'regional', 'kingdom', 'empire'] as const
    const sizedPacks = packs.map(pack => ({ ...pack, polities: pack.polities.map(arch => ({ ...arch, allowedSizeClasses: unrestrictedSizes })) }))
    expect(validateWorldSnapshot(worldA, sizedPacks, testContentPort).valid).toBe(true)
    const territorialPacks = packs.map(pack => ({ ...pack, polityTraits: [
      { id: 'centralized', dimension: 'power' as const, displayNameKey: 'centralized', descriptionKey: 'centralized.description' },
      { id: 'city-state-civic', dimension: 'power' as const, displayNameKey: 'city-state-civic', descriptionKey: 'city-state-civic.description' },
      { id: 'decentralized', dimension: 'power' as const, displayNameKey: 'decentralized', descriptionKey: 'decentralized.description' },
      { id: 'tribal-kinship', dimension: 'power' as const, displayNameKey: 'tribal-kinship', descriptionKey: 'tribal-kinship.description' },
      { id: 'nomadic-pastoral', dimension: 'power' as const, displayNameKey: 'nomadic-pastoral', descriptionKey: 'nomadic-pastoral.description' },
      ...['theocratic', 'democratic', 'militaristic', 'dynastic-aristocratic', 'ancestral-ritual'].map(id => ({ id, dimension: 'governance' as const, displayNameKey: id, descriptionKey: id + '.description' })),
      ...['mercantile', 'agrarian-realm', 'industrial-power', 'artisan-craft', 'cultural-patron'].map(id => ({ id, dimension: 'economy' as const, displayNameKey: id, descriptionKey: id + '.description' })),
      { id: 'small-area', dimension: 'territory' as const, sizeClasses: ['city-state' as const], displayNameKey: 'small-area', descriptionKey: 'small-area.description' },
    ] }))
    expect(validateWorldSnapshot(worldA, territorialPacks, testContentPort).valid).toBe(true)
    const forgedTrait = { ...worldA, civilization: { ...worldA.civilization, polities: worldA.civilization.polities.map(polity => ({ ...polity, traits: [...polity.traits, 'small-area' as const] })) } }
    expect(validateWorldSnapshot(forgedTrait, territorialPacks, testContentPort).issues).toContainEqual(expect.objectContaining({ code: 'range', message: 'Territory trait disagrees with physical territory size' }))
    const requireSmall = territorialPacks.map(pack => ({ ...pack, polities: pack.polities.map(arch => ({ ...arch, requiredTraits: ['small-area'] })) }))
    expect(validateWorldSnapshot(worldA, requireSmall, testContentPort).issues).toContainEqual(expect.objectContaining({ code: 'reference', message: 'Polity does not satisfy its archetype trait requirements' }))
    const smallOnlyPacks = packs.map(pack => ({ ...pack, polities: pack.polities.map(arch => ({ ...arch, allowedSizeClasses: ['city-state' as const] })) }))
    expect(validateWorldSnapshot(worldA, smallOnlyPacks, testContentPort).issues).toContainEqual(expect.objectContaining({ code: 'range', message: 'Polity size is not allowed by its archetype' }))
    // A forged small label cannot hide the large territory of this generated world.
    const forgedSize = { ...worldA, civilization: { ...worldA.civilization, polities: worldA.civilization.polities.map(polity => ({ ...polity, sizeClass: 'city-state' as const })) } }
    expect(validateWorldSnapshot(forgedSize, smallOnlyPacks, testContentPort).issues).toContainEqual(expect.objectContaining({ code: 'range', message: 'Physical territory area disagrees with archetype size requirements' }))

    const store = new WorldStore(testContentPort)
    store.publish(worldA, packs)
    const archive = store.archive(packs)
    const restored = decodeWorldArchive(encodeWorldArchive(worldA, packs, testContentPort), packs, testContentPort)
    expect(restored).toEqual(worldA)
    const recoveredStore = new WorldStore(testContentPort)
    recoveredStore.restore(archive, packs)
    expect(recoveredStore.identity?.snapshotId).toBe(identity.snapshotId)
  })

  it('keeps natural stages 100% cache-hit when only civilization parameters change', async () => {
    const packs = [testContentPack]
    const pipeline = createWorldPipeline()
    const first = { ...baseInput(DEFAULT_CIVILIZATION_PARAMETERS), ...testPipelineContent(packs) }
    await pipeline.execute(first)

    const second = {
      ...baseInput({ ...DEFAULT_CIVILIZATION_PARAMETERS, populationScale: 1.8, capabilities: { ...DEFAULT_CIVILIZATION_PARAMETERS.capabilities, administrativeCapacity: 0.9 } }),
      ...testPipelineContent(packs),
    }
    const plan = pipeline.plan(second)
    const naturalIds = ['mesh', 'geology', 'terrain', 'geographic-regions', 'geographic-names', 'climate-c0', 'cryosphere-i0', 'hydrology-h0', 'static-lakes-l1', 'ecology-e0', 'resource-potential', 'habitability']
    for (const id of naturalIds)
      expect(plan.find(stage => stage.stageId === id)?.action).toBe('cache-hit')
    expect(plan.find(stage => stage.stageId === 'population-settlements')?.action).toBe('execute')
    expect(plan.find(stage => stage.stageId === 'polities-religions')?.action).toBe('execute')

    const result2 = await pipeline.execute(second)
    const world2 = assembleWorld(second, result2, pipeline.registry, { ...identity, snapshotId: 'snapshot:civ-2', revision: 1 }, packs, testContentPort)
    expect(validateWorldSnapshot(world2, packs, testContentPort).valid).toBe(true)
  })

  it('emits zero population and empty civilization entities when civilization.enabled is false', async () => {
    const packs = [testContentPack]
    const pipeline = createWorldPipeline()
    const disabled = {
      ...baseInput({ ...DEFAULT_CIVILIZATION_PARAMETERS, enabled: false }),
      ...testPipelineContent(packs),
    }
    const result = await pipeline.execute(disabled)
    const world = assembleWorld(disabled, result, pipeline.registry, identity, packs, testContentPort)

    expect(world.metadata.generationConfig.civilizationEnabled).toBe(false)
    expect(world.nature.resources.resourceIds.length).toBeGreaterThan(0)
    expect(world.civilization.peoples).toHaveLength(0)
    expect(world.civilization.cultures).toHaveLength(0)
    expect(world.civilization.religions).toHaveLength(0)
    expect(world.civilization.polities).toHaveLength(0)
    expect(world.civilization.settlements).toHaveLength(0)
    expect(world.civilization.populationGroups).toHaveLength(0)
    expect(world.civilization.transport.nodes).toHaveLength(0)
    expect(world.civilization.transport.routes).toHaveLength(0)
    expect(world.civilization.population.values.every(v => v === 0)).toBe(true)
    expect(validateWorldSnapshot(world, packs, testContentPort).valid).toBe(true)
  })
})
