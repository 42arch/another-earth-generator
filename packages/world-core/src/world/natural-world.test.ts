import { describe, expect, it } from 'vitest'
import { testContentPack, testContentPort, testPipelineContent } from '#content/test-content'
import {
  assembleNaturalWorld,
  createNaturalPipeline,
  decodeWorldArchive,
  DEFAULT_CLIMATE_PARAMETERS,
  DEFAULT_GEOLOGY_PARAMETERS,
  DEFAULT_HYDROLOGY_PARAMETERS,
  DEFAULT_LANDFORM_PARAMETERS,
  DEFAULT_TERRAIN_PARAMETERS,
  encodeWorldArchive,
  validateWorldSnapshot,
  WORLD_SCHEMA_VERSION,
  WorldStore,
} from '../index'

const input = {
  seed: 'm1-natural-world',
  config: {
    ecology: true as const,
    planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
    mesh: { subdivisionLevel: 1, irregularity: 0.5 },
    reference: { subdivisionLevel: 2 },
    geology: DEFAULT_GEOLOGY_PARAMETERS,
    landforms: DEFAULT_LANDFORM_PARAMETERS,
    terrain: DEFAULT_TERRAIN_PARAMETERS,
    climate: DEFAULT_CLIMATE_PARAMETERS,
    hydrology: DEFAULT_HYDROLOGY_PARAMETERS,
  },
}
const identity = { snapshotId: 'snapshot:natural-test', worldId: 'world:natural-test', name: 'Natural Test', createdAt: '2026-11-12T00:00:00Z' }

describe('natural world publication', () => {
  it('assembles all natural facts, validates them and round trips a full archive', async () => {
    const pipeline = createNaturalPipeline()
    const packs = [testContentPack]
    const result = await pipeline.execute({ ...input, ...testPipelineContent(packs) })
    const candidate = assembleNaturalWorld(input, result, pipeline.registry, identity, packs, testContentPort)
    expect(candidate.schemaVersion).toBe(WORLD_SCHEMA_VERSION)
    expect(candidate.metadata.contentSignature).toBe(testContentPort.calculateContentSignature(packs))
    expect(candidate.metadata.contentPacks.map(pack => pack.id)).toEqual(['test:core'])
    expect(candidate.metadata.generationConfig.hydrology).toEqual(DEFAULT_HYDROLOGY_PARAMETERS)
    expect(candidate.metadata.provenance.stageVersions['ecology-e0']).toBe('ecology-e0-v3')
    expect(candidate.metadata.provenance.stageVersions['geographic-names']).toBe('geographic-names-v2')
    expect(candidate.nature.geography.regions?.nameContentSignature).toBe(candidate.metadata.contentSignature)
    expect(candidate.nature.geography.regions?.continents.every(item => !!item.name)).toBe(true)
    expect(candidate.nature.geography.regions?.oceans.every(item => !!item.name)).toBe(true)
    expect([...candidate.nature.geography.regions!.continents, ...candidate.nature.geography.regions!.oceans].every(item => item.name?.startsWith('苍岚') || item.name?.startsWith('沧溟'))).toBe(true)
    expect(candidate.nature.geography.regions?.seas?.every(item => !('name' in item))).toBe(true)
    expect(candidate.nature.hydrology.riverIndex.values.length).toBe(candidate.mesh.regionCount)
    expect(validateWorldSnapshot(candidate, packs, testContentPort).valid).toBe(true)
    const wrongLexicon = { ...candidate, nature: { ...candidate.nature, geography: { ...candidate.nature.geography, regions: { ...candidate.nature.geography.regions!, nameContentSignature: 'content:wrong' } } } }
    expect(validateWorldSnapshot(wrongLexicon, packs, testContentPort).issues.some(issue => issue.path === 'geography.regions.nameContentSignature')).toBe(true)
    const restored = decodeWorldArchive(encodeWorldArchive(candidate, packs, testContentPort), packs, testContentPort)
    expect(restored).toEqual(candidate)
    expect(result.getOutput<{ elevationKm: Float32Array }>('terrain').elevationKm.buffer).not.toBe(candidate.nature.geography.elevationKm.values.buffer)
  })

  it('keeps the last valid world through rejected candidates and hides mutable storage', async () => {
    const pipeline = createNaturalPipeline()
    const packs = [testContentPack]
    const candidate = assembleNaturalWorld(input, await pipeline.execute({ ...input, ...testPipelineContent(packs) }), pipeline.registry, identity, packs, testContentPort)
    const store = new WorldStore(testContentPort)
    store.publish(candidate, packs)
    const firstContinent = candidate.nature.geography.regions?.continents[0]
    if (firstContinent)
      expect(store.continent(firstContinent.id)?.name).toBe(firstContinent.name)
    const firstOcean = candidate.nature.geography.regions?.oceans[0]
    if (firstOcean)
      expect(store.ocean(firstOcean.id)?.name).toBe(firstOcean.name)
    const duplicate = structuredClone(candidate)
    const before = store.region(0)
    candidate.nature.geography.elevationKm.values[0] = 999
    expect(store.region(0)).toEqual(before)
    expect(store.field('elevationKm')).not.toHaveProperty('values')
    expect(store.field('elevationKm').get(0)).toBe(before.elevationKm)
    expect(store.field('temperatureC').length).toBe(candidate.mesh.regionCount * 12)
    expect(store.field('basinIndex').get(0)).toBe(before.basinId === null ? -1 : candidate.nature.hydrology.basinIndex.values[0])
    expect(store.region(0)).not.toHaveProperty('buffer')
    const invalid = structuredClone(candidate)
    invalid.nature.hydrology.basinIndex.values[0] = 999
    expect(() => store.publish(invalid, packs)).toThrow()
    expect(() => store.publish(duplicate, packs)).toThrow('revision must advance')
    expect(store.region(0)).toEqual(before)
    expect(() => store.restore('not an archive', packs)).toThrow()
    expect(store.region(0)).toEqual(before)
    const archive = store.archive(packs)
    const recovered = new WorldStore(testContentPort)
    recovered.restore(archive, packs)
    expect(recovered.region(0)).toEqual(before)
    expect(recovered.identity?.snapshotId).toBe(identity.snapshotId)
  })
})
