import { describe, expect, it } from 'vitest'
import { testContentPack, testContentPort, testPipelineContent } from '#content/test-content'
import {
  assembleWorld,
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
      mesh: { subdivisionLevel: 2, irregularity: 0.45 },
      reference: { subdivisionLevel: 2 },
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
    expect(worldA.civilization.polities.length).toBeGreaterThan(0)
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
      ...baseInput({ ...DEFAULT_CIVILIZATION_PARAMETERS, populationScale: 1.8, polityCohesion: 0.9 }),
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
