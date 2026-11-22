import type { ContentId, FieldView, WorldSnapshot } from '../index'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { testContentPack, testContentPort, testNamingStyle } from '#content/test-content'
import { createFieldView, decodeWorldArchive, DEFAULT_CIVILIZATION_PARAMETERS, encodeWorldArchive, validateWorldSnapshot, WORLD_SCHEMA_VERSION } from '../index'

const pack = testContentPack

function withPolityTraits(world: WorldSnapshot, traits: WorldSnapshot['civilization']['polities'][number]['traits']): WorldSnapshot {
  return { ...world, civilization: { ...world.civilization, polities: world.civilization.polities.map((polity, i) => i === 0 ? { ...polity, traits } : polity) } }
}

function withSettlementFeatures(world: WorldSnapshot, features: WorldSnapshot['civilization']['settlements'][number]['features']): WorldSnapshot {
  return { ...world, civilization: { ...world.civilization, settlements: world.civilization.settlements.map((settlement, i) => i === 0 ? { ...settlement, features } : settlement) } }
}

function snapshot(civilized = false): WorldSnapshot {
  const field = <T extends Float32Array | Float64Array | Uint8Array | Uint16Array | Uint32Array | Int32Array>(values: T) => ({ meshId: 'mesh:test', values })
  const planet = { physicalRadiusKm: 1, rotationPeriodHours: 24, orbitalPeriodDays: 365, axialTiltDegrees: 23.4, seaLevelDatumKm: 0 }
  const s = 1 / Math.sqrt(3)
  const stageIds = [
    'mesh',
    'reference-mesh',
    'reference-subdivisions',
    'plate-topology',
    'continental-crust',
    'geological-mapping',
    'geology',
    'plate-dynamics',
    'tectonics',
    'tectonic-elevation',
    'terrain',
    'geographic-regions',
    'geographic-names',
    'climate-c0',
    'cryosphere-i0',
    'hydrology-h0',
    'static-lakes-l1',
    'ecology-e0',
    ...(civilized ? ['resource-potential', 'habitability', 'population-settlements', 'transport-network', 'peoples-cultures', 'polities-religions'] : []),
  ]
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
      contentSignature: testContentPort.calculateContentSignature([pack]),
      contentPacks: [{ id: pack.manifest.id, version: pack.manifest.version, contentHash: pack.manifest.contentHash }],
      generationConfig: {
        planet,
        mesh: { subdivisionLevel: 0, irregularity: 0 },
        regionCount: 4,
        civilizationEnabled: civilized,
        ...(civilized ? { civilization: { ...DEFAULT_CIVILIZATION_PARAMETERS, polityCount: 1 } } : {}),
        geology: { primaryPlateCount: 1, microPlateCount: 0, plateSizeVariety: 0, continentCount: 0, continentSizeVariety: 0, candidateLandCoverage: 0 },
        landforms: { islandArcCount: 0, islandDensity: 0, hotspotCount: 0 },
        terrain: { roughness: 0, terrainWarp: 0, smoothing: 0, glacialErosion: 0, hydraulicErosion: 0, ridgeSharpening: 0 },
        climate: { rotationPeriodHours: 24, axialTiltDegrees: 23.4, orbitalPeriodDays: 365, temperatureOffsetC: 0, precipitationScale: 0 },
        hydrology: { snowTemperatureMinC: -2, snowTemperatureMaxC: 2, degreeDayMeltFactorMmPerCMonth: 3, evapotranspirationFactorMmPerCMonth: 2, minimumRiverDrainageAreaKm2: 5000, riverDensityMultiplier: 1, minimumLakeAreaKm2: 0 },
      },
      provenance: {
        stageVersions: Object.fromEntries(stageIds.map(id => [id, id === 'geographic-names' ? 'geographic-names-v3' : '1'])),
        artifactSignatures: Object.fromEntries(stageIds.map(id => [id, 'sig:test'])),
        configSignature: 'config:test',
      },
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
      geography: { elevationKm: field(new Float32Array(4)), landMask: field(new Uint8Array(4)), regions: { nameStyleId: testNamingStyle.id, nameStyleSignature: testContentPort.calculateNamingStyleSignature(testNamingStyle), continentIndex: field(new Int32Array(4).fill(-1)), oceanIndex: field(new Int32Array(4).fill(-1)), seaIndex: field(new Int32Array(4).fill(-1)), continents: [], oceans: [], seas: [] } },
      climate: { monthsPerYear: 12, layout: 'month-major', temperatureC: field(new Float32Array(48)), precipitationMm: field(new Float32Array(48)), annualMeanTemperatureC: field(new Float32Array(4)), annualPrecipitationMm: field(new Float32Array(4)), koppenClass: field(new Uint8Array(4)) },
      hydrology: { monthlySnowWaterEquivalentMm: field(new Float32Array(48)), monthlySnowfallMm: field(new Float32Array(48)), monthlySnowmeltMm: field(new Float32Array(48)), downstreamRegion: field(new Int32Array(4).fill(-1)), annualRunoffMm: field(new Float32Array(4)), annualRunoffVolumeM3: field(new Float64Array(4)), accumulatedAnnualFlowM3s: field(new Float64Array(4)), contributingAreaKm2: field(new Float64Array(4)), basinIndex: field(new Int32Array(4).fill(-1)), basins: [], riverIndex: field(new Int32Array(4).fill(-1)), rivers: [], lakeIndex: field(new Int32Array(4).fill(-1)), lakes: [] },
      ecology: { potentialBiomeIds: ['ocean'], landCoverIds: ['water'], potentialBiomeIndex: field(new Uint16Array(4)), landCoverIndex: field(new Uint16Array(4)), aridityIndex: field(new Float32Array(4)), growingSeasonMonths: field(new Uint8Array(4)) },
      resources: {
        resourceIds: civilized ? ['test:resource/iron'] : [],
        agriculturalPotential: field(new Float32Array([civilized ? 0.7 : 0, 0, 0, 0])),
        forestryPotential: field(new Float32Array([civilized ? 0.4 : 0, 0, 0, 0])),
        fisheryPotential: field(new Float32Array([0, 0.5, 0, 0])),
        deposits: civilized ? [{ id: 'deposit:0', resourceId: 'test:resource/iron', regionId: 0, category: 'mineral', richness: 0.8, primaryFactor: 'orogen' }] : [],
      },
    },
    civilization: {
      meshId: 'mesh:test',
      population: field(new Float64Array([civilized ? 100 : 0, 0, 0, 0])),
      peoples: civilized ? [{ id: 'people:a', name: '山民', foundedAtYear: -100, archetypeId: 'test:people/basic' }] : [],
      cultures: civilized ? [{ id: 'culture:a', name: '星辉文脉', foundedAtYear: -10, archetypeId: 'test:culture/basic', peopleId: 'people:a', namingStyleId: testNamingStyle.id as ContentId }] : [],
      religions: civilized ? [{ id: 'religion:a', name: '晨曦圣宗', foundedAtYear: -10, archetypeId: 'test:religion/basic' }] : [],
      polities: civilized ? [{ id: 'polity:a', name: '海风合众', foundedAtYear: -5, cultureId: 'culture:a', archetypeId: 'test:polity/basic', capitalSettlementId: 'settlement:a', traits: ['centralized', 'agrarian-realm'] }] : [],
      settlements: civilized ? [{ id: 'settlement:a', name: '新港', foundedAtYear: -5, regionId: 0, polityId: 'polity:a', cultureId: 'culture:a', population: 60, features: ['agrarian', 'maritime-trade'] }] : [],
      populationGroups: civilized ? [{ regionId: 0, peopleId: 'people:a', cultureId: 'culture:a', religionId: 'religion:a', polityId: 'polity:a', population: 100 }] : [],
      territoryPolityIndex: field(new Int32Array(4).fill(-1)),
      transport: {
        nodes: civilized
          ? [
              { id: 'node:0', regionId: 0, settlementId: 'settlement:a', kind: 'settlement' },
              { id: 'node:1', regionId: 1, settlementId: null, kind: 'junction' },
            ]
          : [],
        routes: civilized
          ? [
              { id: 'route:0', fromNodeId: 'node:0', toNodeId: 'node:1', mode: 'road', regions: new Uint32Array([0, 1]), cost: 1.5, trafficScore: 10 },
            ]
          : [],
        accessibility: field(new Float32Array([civilized ? 0.85 : 0, 0, 0, 0])),
      },
    },
  }
}
const validate = (s: WorldSnapshot) => validateWorldSnapshot(s, [pack], testContentPort)

describe('worldSnapshot public contract', () => {
  it('accepts a complete natural world', () => expect(validate(snapshot())).toEqual({ valid: true, issues: [] }))
  it('accepts a world with civilization and a nonduplicated urban population', () => expect(validate(snapshot(true)).valid).toBe(true))
  it('requires complete valid capabilities in saved civilization configuration', () => {
    const original = snapshot(true)
    const config = original.metadata.generationConfig
    const civilization = config.civilization!
    const invalid = { ...civilization, capabilities: { ...civilization.capabilities, seafaringCapability: -1 } }
    expect(validate({ ...original, metadata: { ...original.metadata, generationConfig: { ...config, civilization: invalid } } }).valid).toBe(false)
    expect(validate({ ...original, metadata: { ...original.metadata, generationConfig: { ...config, civilization: undefined } } }).valid).toBe(false)
  })
  it('rejects a polity count that differs from the saved exact count', () => {
    const world = snapshot(true)
    const wrongCount = { ...world, metadata: { ...world.metadata, generationConfig: { ...world.metadata.generationConfig,
      civilization: { ...DEFAULT_CIVILIZATION_PARAMETERS, polityCount: 2 },
    } } }
    expect(validate(wrongCount).issues).toContainEqual(expect.objectContaining({ path: 'civilization.polities', code: 'range' }))
  })

  it('rejects polity ownership of ocean', () => {
    const s = snapshot(true)
    s.civilization.territoryPolityIndex.values[0] = 0
    expect(validate(s).issues.some(issue => issue.path === 'civilization.territoryPolityIndex[0]')).toBe(true)
  })
  it('rejects mismatched field length and mesh identity', () => {
    const s = snapshot()
    expect(validate({ ...s, nature: { ...s.nature, geography: { ...s.nature.geography, elevationKm: { meshId: 'wrong', values: new Float32Array(3) } } } }).issues.map(e => e.code)).toEqual(expect.arrayContaining(['length', 'reference']))
  })
  it('rejects invalid physics and legacy schemas', () => {
    const s = snapshot()
    expect(validate({ ...s, planet: { ...s.planet, physicalRadiusKm: -1 } }).valid).toBe(false)
    // @ts-expect-error Schema 6 and earlier are rejected without migration
    expect(validate({ ...s, schemaVersion: 6 }).valid).toBe(false)
    // @ts-expect-error Schema 10 uses the three-dimensional trait contract
    expect(validate({ ...s, schemaVersion: 10 }).valid).toBe(false)
    // @ts-expect-error Schema 9 uses the obsolete count-range contract
    expect(validate({ ...s, schemaVersion: 9 }).valid).toBe(false)
  })
  it('rejects unresolved world entities, resources, transport routes, and content versions', () => {
    const s = snapshot(true)
    expect(validate({ ...s, civilization: { ...s.civilization, religions: [] } }).issues.some(e => e.code === 'reference')).toBe(true)
    expect(validate({ ...s, nature: { ...s.nature, resources: { ...s.nature.resources, resourceIds: ['test:resource/missing'] } } }).issues.some(e => e.code === 'reference')).toBe(true)
    expect(validate({
      ...s,
      civilization: {
        ...s.civilization,
        transport: {
          ...s.civilization.transport,
          routes: [{ id: 'route:bad', fromNodeId: 'node:0', toNodeId: 'node:1', mode: 'road', regions: new Uint32Array([1, 0]), cost: 1, trafficScore: 1 }],
        },
      },
    }).issues.some(e => e.code === 'topology')).toBe(true)
    expect(validateWorldSnapshot(s, [], testContentPort).valid).toBe(false)
  })
  it('rejects duplicate stable IDs across entity kinds', () => {
    const s = snapshot(true)
    expect(validate({ ...s, civilization: { ...s.civilization, peoples: [...s.civilization.peoples, ...s.civilization.peoples] } }).issues.some(e => e.code === 'duplicate')).toBe(true)
  })
  it('rejects nonfinite climate and documents structure-only validation', () => {
    const s = snapshot()
    s.nature.climate.temperatureC.values[0] = Number.NaN
    expect(validate(s).valid).toBe(false)
    expect(validateWorldSnapshot(s, [pack], testContentPort, { mode: 'structure' }).valid).toBe(true)
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
  it('requires complete natural provenance and parameters in Schema 7', () => {
    const s = snapshot()
    const missingHydrology = { ...s.metadata.generationConfig.hydrology }
    delete (missingHydrology as Partial<typeof missingHydrology>).minimumRiverDrainageAreaKm2
    expect(validate({ ...s, metadata: { ...s.metadata, generationConfig: { ...s.metadata.generationConfig, hydrology: missingHydrology } } }).valid).toBe(false)
    expect(validate({ ...s, metadata: { ...s.metadata, provenance: { ...s.metadata.provenance, stageVersions: { mesh: '1' } } } }).valid).toBe(false)
    s.nature.hydrology.basinIndex.values[0] = -2
    expect(validate(s).issues.some(issue => issue.path === 'hydrology.basinIndex[0]')).toBe(true)
  })
  it('round trips a complete world and rejects corruption, legacy Schema 3 archives, or missing content', () => {
    const original = snapshot(true)
    const archive = encodeWorldArchive(original, [pack], testContentPort)
    const restored = decodeWorldArchive(archive, [pack], testContentPort)
    expect(restored).toEqual(original)
    expect(restored.mesh.centers).toBeInstanceOf(Float64Array)
    expect(restored.nature.climate.temperatureC.values).toBeInstanceOf(Float32Array)
    expect(restored.civilization.transport.routes[0]?.regions).toBeInstanceOf(Uint32Array)
    expect(() => decodeWorldArchive(archive.replace('snapshot:test', 'snapshot:changed'), [pack], testContentPort)).toThrow()
    expect(() => decodeWorldArchive(archive, [], testContentPort)).toThrow()
  })
  it('requires reproducible mesh input and provenance', () => {
    const s = snapshot()
    expect(validate({ ...s, metadata: { ...s.metadata, generationConfig: { ...s.metadata.generationConfig, mesh: { subdivisionLevel: 9, irregularity: 0 } } } }).valid).toBe(false)
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
  it('validates optional climate circulation masks and bounds when present', () => {
    const s = snapshot()
    const field = <T extends Float32Array | Uint8Array>(values: T) => ({ meshId: s.mesh.meshId, values })
    const withCirculation: WorldSnapshot = {
      ...s,
      nature: {
        ...s.nature,
        climate: {
          ...s.nature.climate,
          circulation: {
            windEastMps: field(new Float32Array(48)),
            windNorthMps: field(new Float32Array(48)),
            oceanEastMps: field(new Float32Array(48)),
            oceanNorthMps: field(new Float32Array(48)),
            oceanWarmth: field(new Float32Array(48)),
            oceanAvailable: field(new Uint8Array([1, 1, 0, 1])),
          },
        },
      },
    }
    expect(validate(withCirculation).valid).toBe(true)

    const nonzeroUnavailable = structuredClone(withCirculation)
    nonzeroUnavailable.nature.climate.circulation!.oceanEastMps.values[2] = 0.5
    expect(validate(nonzeroUnavailable).valid).toBe(false)

    const outOfRangeWarmth = structuredClone(withCirculation)
    outOfRangeWarmth.nature.climate.circulation!.oceanWarmth.values[0] = 1.5
    expect(validate(outOfRangeWarmth).valid).toBe(false)
  })
  it('enforces recorded trait dimensions and archetype requirements at publication', () => {
    const world = snapshot(true)
    const recordedPack = {
      ...pack,
      polityTraits: [
        { id: 'centralized', dimension: 'power' as const, displayNameKey: 'centralized', descriptionKey: 'centralized.description' },
        { id: 'decentralized', dimension: 'power' as const, displayNameKey: 'decentralized', descriptionKey: 'decentralized.description' },
        { id: 'agrarian-realm', dimension: 'economy' as const, displayNameKey: 'agrarian', descriptionKey: 'agrarian.description' },
        { id: 'theocratic', dimension: 'governance' as const, displayNameKey: 'theocratic', descriptionKey: 'theocratic.description' },
      ],
    }
    expect(validateWorldSnapshot(world, [recordedPack], testContentPort).valid).toBe(true)
    const territoryPack = { ...recordedPack, polityTraits: [...recordedPack.polityTraits, { id: 'small-area', dimension: 'territory' as const, sizeClasses: ['city-state' as const], displayNameKey: 'small-area', descriptionKey: 'small-area.description' }] }
    const fourTraits = withPolityTraits(world, ['centralized', 'theocratic', 'agrarian-realm', 'small-area'])
    const classified = { ...fourTraits, civilization: { ...fourTraits.civilization, polities: fourTraits.civilization.polities.map(polity => ({ ...polity, sizeClass: 'city-state' as const })) } }
    expect(validateWorldSnapshot(classified, [territoryPack], testContentPort).valid).toBe(true)
    const missingSizeTrait = withPolityTraits(classified, ['centralized', 'theocratic', 'agrarian-realm'])
    expect(validateWorldSnapshot(missingSizeTrait, [territoryPack], testContentPort).issues).toContainEqual(expect.objectContaining({ code: 'range', message: 'Territory trait disagrees with physical territory size' }))
    const conflicting = withPolityTraits(world, ['centralized', 'decentralized', 'agrarian-realm'])
    expect(validateWorldSnapshot(conflicting, [recordedPack], testContentPort).valid).toBe(false)
    const missingEconomy = withPolityTraits(world, ['centralized'])
    expect(validateWorldSnapshot(missingEconomy, [recordedPack], testContentPort).valid).toBe(false)
    const requiredPack = { ...recordedPack, polities: recordedPack.polities.map(a => ({ ...a, requiredTraits: ['theocratic'] })) }
    expect(validateWorldSnapshot(world, [requiredPack], testContentPort).valid).toBe(false)
  })

  it('validates settlement features and polity traits and rejects invalid, empty, or duplicate entries', () => {
    const valid = snapshot(true)
    expect(validate(valid).valid).toBe(true)

    const emptyFeatures = withSettlementFeatures(valid, [])
    expect(validate(emptyFeatures).valid).toBe(false)

    const unknownFeature = withSettlementFeatures(valid, ['unknown-feature' as never])
    expect(validate(unknownFeature).valid).toBe(false)

    const duplicateFeature = withSettlementFeatures(valid, ['agrarian', 'agrarian'])
    expect(validate(duplicateFeature).valid).toBe(false)

    const emptyTraits = withPolityTraits(valid, [])
    expect(validate(emptyTraits).valid).toBe(false)

    const unknownTrait = withPolityTraits(valid, ['unknown-trait' as never])
    expect(validate(unknownTrait).valid).toBe(false)

    const duplicateTrait = withPolityTraits(valid, ['centralized', 'centralized'])
    expect(validate(duplicateTrait).valid).toBe(false)
  })
})
