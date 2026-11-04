import type { ContentPack } from '@another-earth/world-data'
import type { FieldView, WorldSnapshot } from '../index'
import { calculateContentHash, calculateContentSignature } from '@another-earth/world-data'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { createFieldView, decodeWorldArchive, encodeWorldArchive, validateWorldSnapshot, WORLD_SCHEMA_VERSION } from '../index'

const packDraft: ContentPack = {
  manifest: { id: 'test:core', version: '1.0.0', schemaVersion: 1, nameKey: 'pack', contentHash: '', dependencies: [] },
  names: [{ id: 'test:names/basic', displayNameKey: 'name', tags: [], entries: [{ value: 'Ada', weight: 1 }] }],
  cultures: [{ id: 'test:culture/basic', displayNameKey: 'culture', tags: [], namePoolId: 'test:names/basic', traits: [] }],
  religions: [{ id: 'test:religion/basic', displayNameKey: 'religion', tags: [], organization: 'decentralized', traits: [], tolerance: 0.5, spreadBias: 0.5, weight: 1 }],
  governments: [{ id: 'test:government/basic', displayNameKey: 'government', tags: [], governance: 'distributed', succession: 'elective', weight: 1 }],
  resources: [],
  presets: [],
  translations: { en: { pack: 'Test', name: 'Names', culture: 'Culture', religion: 'Religion', government: 'Government' } },
}
const pack: ContentPack = { ...packDraft, manifest: { ...packDraft.manifest, contentHash: calculateContentHash(packDraft) } }

function snapshot(civilized = false): WorldSnapshot {
  const field = <T extends Float32Array | Float64Array | Uint8Array | Uint16Array | Uint32Array | Int32Array>(values: T) => ({ meshId: 'mesh:test', values })
  const planet = { physicalRadiusKm: 1, rotationPeriodHours: 24, orbitalPeriodDays: 365, axialTiltDegrees: 23.4, seaLevelDatumKm: 0 }
  const s = 1 / Math.sqrt(3)
  return {
    schemaVersion: WORLD_SCHEMA_VERSION,
    snapshotId: 'snapshot:test',
    revision: 0,
    time: { year: 0 },
    metadata: {
      worldId: 'world:test',
      name: 'Test World',
      seed: 'fixed-test-seed',
      createdAt: '2026-01-01T00:00:00Z',
      generatorVersion: 'test-1',
      contentSignature: calculateContentSignature([pack]),
      contentPacks: [pack.manifest],
      generationConfig: { planet, mesh: { subdivisionLevel: 0, irregularity: 0 }, regionCount: 4, civilizationEnabled: civilized },
      provenance: { stageVersions: { mesh: '1' }, artifactSignatures: { mesh: 'mesh:test' }, configSignature: 'config:test' },
    },
    planet,
    mesh: {
      meshId: 'mesh:test',
      regionCount: 4,
      centers: new Float64Array([s, s, s, s, -s, -s, -s, s, -s, -s, -s, s]),
      areaKm2: new Float64Array(4).fill(Math.PI),
      neighborOffsets: new Uint32Array([0, 3, 6, 9, 12]),
      neighbors: new Uint32Array([1, 2, 3, 0, 2, 3, 0, 1, 3, 0, 1, 2]),
    },
    nature: {
      geology: { plates: [{ id: 'plate:test' }], plateIndex: field(new Uint32Array(4)), crustType: field(new Uint8Array(4)) },
      geography: { elevationKm: field(new Float32Array(4)), landMask: field(new Uint8Array(4)) },
      climate: { monthsPerYear: 12, layout: 'month-major', temperatureC: field(new Float32Array(48)), precipitationMm: field(new Float32Array(48)) },
      hydrology: { downstreamRegion: field(new Int32Array(4).fill(-1)), annualRunoffMm: field(new Float32Array(4)) },
      ecology: { potentialBiomeIds: ['ocean'], landCoverIds: ['water'], potentialBiomeIndex: field(new Uint16Array(4)), landCoverIndex: field(new Uint16Array(4)) },
    },
    civilization: {
      meshId: 'mesh:test',
      population: field(new Float64Array([civilized ? 100 : 0, 0, 0, 0])),
      species: civilized ? [{ id: 'species:a', name: 'People', foundedAtYear: -100 }] : [],
      cultures: civilized ? [{ id: 'culture:a', name: 'Culture', foundedAtYear: -10, archetypeId: 'test:culture/basic', speciesId: 'species:a' }] : [],
      religions: civilized ? [{ id: 'religion:a', name: 'Religion', foundedAtYear: -10, archetypeId: 'test:religion/basic' }] : [],
      polities: civilized ? [{ id: 'polity:a', name: 'Polity', foundedAtYear: -5, cultureId: 'culture:a', governmentArchetypeId: 'test:government/basic', capitalSettlementId: 'settlement:a' }] : [],
      settlements: civilized ? [{ id: 'settlement:a', name: 'Town', foundedAtYear: -5, regionId: 0, polityId: 'polity:a', cultureId: 'culture:a', population: 60 }] : [],
      populationGroups: civilized ? [{ regionId: 0, speciesId: 'species:a', cultureId: 'culture:a', religionId: 'religion:a', polityId: 'polity:a', population: 100 }] : [],
    },
  }
}
const validate = (s: WorldSnapshot) => validateWorldSnapshot(s, [pack])

describe('worldSnapshot public contract', () => {
  it('accepts a complete natural world', () => expect(validate(snapshot())).toEqual({ valid: true, issues: [] }))
  it('accepts a world with civilization and a nonduplicated urban population', () => expect(validate(snapshot(true)).valid).toBe(true))
  it('rejects mismatched field length and mesh identity', () => {
    const s = snapshot()
    expect(validate({ ...s, nature: { ...s.nature, geography: { ...s.nature.geography, elevationKm: { meshId: 'wrong', values: new Float32Array(3) } } } }).issues.map(e => e.code)).toEqual(expect.arrayContaining(['length', 'reference']))
  })
  it('rejects invalid physics and schema', () => {
    const s = snapshot()
    expect(validate({ ...s, planet: { ...s.planet, physicalRadiusKm: -1 } }).valid).toBe(false)
    // @ts-expect-error unsupported schema is also forbidden by the public type
    expect(validate({ ...s, schemaVersion: 3 }).valid).toBe(false)
  })
  it('rejects unresolved world entities and content versions', () => {
    const s = snapshot(true)
    expect(validate({ ...s, civilization: { ...s.civilization, religions: [] } }).issues.some(e => e.code === 'reference')).toBe(true)
    expect(validateWorldSnapshot(s, []).valid).toBe(false)
  })
  it('rejects duplicate stable IDs across entity kinds', () => {
    const s = snapshot(true)
    expect(validate({ ...s, civilization: { ...s.civilization, species: [...s.civilization.species, ...s.civilization.species] } }).issues.some(e => e.code === 'duplicate')).toBe(true)
  })
  it('rejects nonfinite climate and documents structure-only validation', () => {
    const s = snapshot()
    s.nature.climate.temperatureC.values[0] = Number.NaN
    expect(validate(s).valid).toBe(false)
    expect(validateWorldSnapshot(s, [pack], { mode: 'structure' }).valid).toBe(true)
  })
  it('rejects inconsistent monthly layout', () => {
    const s = snapshot()
    // @ts-expect-error only the documented layout is supported
    expect(validate({ ...s, nature: { ...s.nature, climate: { ...s.nature.climate, layout: 'region-major' } } }).valid).toBe(false)
  })
  it('rejects population mismatch, negative totals, and urban double counting', () => {
    for (const total of [10, -1, 101]) {
      const s = snapshot(true)
      s.civilization.population.values[0] = total
      expect(validate(s).valid).toBe(false)
    }
  })
  it('rejects incorrect sphere area, invalid centers, and mismatched masks', () => {
    const s = snapshot()
    s.mesh.areaKm2[0] = 0
    s.mesh.centers[0] = Infinity
    s.nature.geography.landMask.values[0] = 1
    expect(validate(s).valid).toBe(false)
  })
  it('rejects storage with an incorrect dtype', () => {
    const s = snapshot()
    const population = { meshId: s.mesh.meshId, values: new Float32Array(4) }
    // @ts-expect-error Float64 population storage is required at type and runtime boundaries
    expect(validate({ ...s, civilization: { ...s.civilization, population } }).issues.some(e => e.code === 'dtype')).toBe(true)
  })
  it('rejects missing required metadata', () => {
    const s = snapshot()
    expect(validate({ ...s, metadata: { ...s.metadata, seed: '', createdAt: 'yesterday' } }).valid).toBe(false)
  })
  it('round trips a complete world and rejects corruption or missing content', () => {
    const original = snapshot(true)
    const archive = encodeWorldArchive(original, [pack])
    const restored = decodeWorldArchive(archive, [pack])
    expect(restored).toEqual(original)
    expect(restored.mesh.centers).toBeInstanceOf(Float64Array)
    expect(restored.nature.climate.temperatureC.values).toBeInstanceOf(Float32Array)
    expect(() => decodeWorldArchive(archive.replace('snapshot:test', 'snapshot:changed'), [pack])).toThrow()
    expect(() => decodeWorldArchive(archive, [])).toThrow()
  })
  it('requires reproducible mesh input and provenance', () => {
    const s = snapshot()
    expect(validate({ ...s, metadata: { ...s.metadata, generationConfig: { ...s.metadata.generationConfig, mesh: { subdivisionLevel: 8, irregularity: 0 } } } }).valid).toBe(false)
    expect(validate({ ...s, metadata: { ...s.metadata, provenance: { ...s.metadata.provenance, stageVersions: {} } } }).valid).toBe(false)
    expect(validate({ ...s, metadata: { ...s.metadata, generationConfig: { ...s.metadata.generationConfig, planet: { ...s.planet, physicalRadiusKm: 2 } } } }).valid).toBe(false)
  })
  it('rejects broken CSR and drainage cycles', () => {
    const s = snapshot()
    s.mesh.neighborOffsets[0] = 1
    s.nature.hydrology.downstreamRegion.values.set([1, 0, -1, -1])
    expect(validate(s).issues.filter(e => e.code === 'topology')).toHaveLength(2)
  })
  it('provides a zero-copy field view without a writable array or buffer', () => {
    const s = snapshot()
    const view = createFieldView(s.nature.geography.elevationKm)
    expectTypeOf(view).toEqualTypeOf<FieldView>()
    expect(view).not.toHaveProperty('values')
    expect(view).not.toHaveProperty('buffer')
    expect(view.get(0)).toBe(0)
    expect(() => view.get(-1)).toThrow(RangeError)
    expect(() => view.get(4)).toThrow(RangeError)
  })
})
