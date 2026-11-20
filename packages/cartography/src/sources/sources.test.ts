import type { ContentPort, WorldMapReader, WorldSnapshot } from '@another-earth/world-core'
import type { ContentPack, ContentPackV1, NamingStyle } from '@another-earth/world-data'
import {
  assembleWorld,
  civilizationContentSignature,
  createNaturalPipeline,
  createWorldMapReader,
  createWorldPipeline,
  DEFAULT_CIVILIZATION_PARAMETERS,
  DEFAULT_CLIMATE_PARAMETERS,
  DEFAULT_GEOLOGY_PARAMETERS,
  DEFAULT_HYDROLOGY_PARAMETERS,
  DEFAULT_LANDFORM_PARAMETERS,
  DEFAULT_TERRAIN_PARAMETERS,
  ecologyVocabularySignature,
  resourceDefinitionsSignature,
} from '@another-earth/world-core'
import {
  calculateContentHash,
  calculateContentSignature,
  calculateNamingStyleSignature,
  createContentCatalog,
  createNamingStylePack,
  loadBuiltinCatalog,
  loadBuiltinGenerationCatalog,
  loadBuiltinNamingStyles,
  NATURAL_BIOME_DEFINITIONS,
  NATURAL_LAND_COVER_DEFINITIONS,
  validateContentPack,
} from '@another-earth/world-data'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  BUILTIN_MAP_SOURCE_SCHEMAS,
  computeTerritorySpine,
  lonLatDegToCartesian,
  MapSourceRegistry,
  sampleSpineGlyphAnchors,
  signedPlanarUnwrappedRingArea,
  sphericalAngleRad,
} from '../index'

const styleId = 'builtin:naming-style/western-zh-cn'
const namingCatalog = createContentCatalog([
  ...loadBuiltinCatalog().packs.filter(pack => pack.manifest.id === 'core' || pack.manifest.id === 'earthlike'),
  createNamingStylePack(loadBuiltinNamingStyles().find(style => style.id === styleId)!),
])
const builtinContentPacks = namingCatalog.packs
const builtinNamingStyle = (namingCatalog.get(styleId) as ContentPackV1).namingStyles.find(style => style.id === styleId)!
const builtinEcologyVocabulary = {
  biomes: NATURAL_BIOME_DEFINITIONS.map(({ id, code, nameZh }) => ({ id, code, nameZh })),
  landCover: NATURAL_LAND_COVER_DEFINITIONS.map(({ id, code, nameZh }) => ({ id, code, nameZh })),
}
const builtinContentPort: ContentPort = {
  calculateContentHash: pack => calculateContentHash(pack as ContentPack),
  calculateContentSignature: packs => calculateContentSignature(packs as readonly ContentPack[]),
  calculateNamingStyleSignature: style => calculateNamingStyleSignature(style as NamingStyle),
  validateContentPack: (pack, resolved) => validateContentPack(pack as ContentPack, resolved as readonly ContentPack[]),
}
const builtinPipelineContent = {
  content: { 'geographic-naming-style': builtinNamingStyle, 'ecology-classes': builtinEcologyVocabulary },
  contentSignatures: {
    'geographic-naming-style': calculateNamingStyleSignature(builtinNamingStyle),
    'ecology-classes': ecologyVocabularySignature(builtinEcologyVocabulary),
  },
}

const naturalInput = {
  seed: 'slice2-cartography-sources',
  config: {
    ecology: true as const,
    planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
    mesh: { subdivisionLevel: 3, irregularity: 0.45 },
    reference: { subdivisionLevel: 2 },
    geology: DEFAULT_GEOLOGY_PARAMETERS,
    landforms: DEFAULT_LANDFORM_PARAMETERS,
    terrain: DEFAULT_TERRAIN_PARAMETERS,
    climate: DEFAULT_CLIMATE_PARAMETERS,
    hydrology: {
      ...DEFAULT_HYDROLOGY_PARAMETERS,
      riverDensityScale: 2.5,
    },
  },
}

const identity = {
  snapshotId: 'snapshot:slice2-sources',
  worldId: 'world:slice2-sources',
  name: 'Slice 2 World',
  createdAt: '2026-11-14T00:00:00Z',
}

function assertValidRing(
  ring: readonly (readonly [number, number])[],
  expectedWinding: 'ccw' | 'cw',
): void {
  expect(ring.length).toBeGreaterThanOrEqual(4)
  for (const [lon, lat] of ring) {
    expect(Number.isFinite(lon)).toBe(true)
    expect(Number.isFinite(lat)).toBe(true)
    expect(lon).toBeGreaterThanOrEqual(-180)
    expect(lon).toBeLessThanOrEqual(180)
    expect(lat).toBeGreaterThanOrEqual(-90)
    expect(lat).toBeLessThanOrEqual(90)
  }
  const first = ring[0]
  const last = ring.at(-1)!
  expect(first[0]).toBeCloseTo(last[0], 9)
  expect(first[1]).toBeCloseTo(last[1], 9)

  const area = signedPlanarUnwrappedRingArea(ring)
  if (expectedWinding === 'ccw')
    expect(area).toBeGreaterThan(0)
  else
    expect(area).toBeLessThan(0)
}

function assertPolygonRingsValid(
  coordinates: readonly (readonly (readonly [number, number])[])[],
): void {
  expect(coordinates.length).toBeGreaterThanOrEqual(1)
  assertValidRing(coordinates[0], 'ccw')
  for (let h = 1; h < coordinates.length; h++)
    assertValidRing(coordinates[h], 'cw')
}

describe('mapSourceRegistry & natural source adapters (Slice 2)', () => {
  let snapshot: WorldSnapshot
  let reader: WorldMapReader

  beforeAll(async () => {
    const pipeline = createNaturalPipeline()
    const result = await pipeline.execute({ ...naturalInput, ...builtinPipelineContent })
    snapshot = assembleWorld(naturalInput, result, pipeline.registry, identity, builtinContentPacks, builtinContentPort)
    reader = createWorldMapReader(snapshot)
  })

  it('registers all 27 built-in sources and enforces instance-scoped caching & monthly invalidation', () => {
    const registry = new MapSourceRegistry(reader)
    const allIds = Object.keys(BUILTIN_MAP_SOURCE_SCHEMAS)
    expect(allIds).toHaveLength(27)

    const land1 = registry.getGeoJsonSource('land-areas')
    const land2 = registry.getGeoJsonSource('land-areas')
    expect(land1).toBe(land2)
    expect(registry.getComputeCount('land-areas')).toBe(1)

    const surface1 = registry.getRasterSource('world-surface')
    const surface2 = registry.getRasterSource('world-surface')
    expect(surface1).toBe(surface2)
    expect(registry.getComputeCount('world-surface')).toBe(1)

    // Monthly source caches per month and does not recompute static sources
    const m0 = registry.getRasterSource('climate-monthly', { month: 0 })
    const m0Repeat = registry.getRasterSource('climate-monthly', { month: 0 })
    const m6 = registry.getRasterSource('climate-monthly', { month: 6 })
    expect(m0).toBe(m0Repeat)
    expect(m6).not.toBe(m0)
    expect(m0.cacheKey).toContain(':m0')
    expect(m6.cacheKey).toContain(':m6')
    expect(registry.getComputeCount('climate-monthly')).toBe(2)
    expect(registry.getComputeCount('land-areas')).toBe(1)
    expect(registry.getComputeCount('world-surface')).toBe(1)

    // Separate registry instance has independent cache
    const secondRegistry = new MapSourceRegistry(reader)
    expect(secondRegistry.getComputeCount('land-areas')).toBe(0)
    expect(secondRegistry.getGeoJsonSource('land-areas')).not.toBe(land1)
  })

  it('produces closed, finite, CCW exterior and CW interior hole rings across all polygon sources', () => {
    const registry = new MapSourceRegistry(reader)
    for (const sourceId of [
      'land-areas',
      'continent-areas',
      'plate-areas',
      'koppen-areas',
      'biome-areas',
      'land-cover-areas',
      'lake-polygons',
      'river-polygons',
    ] as const) {
      const source = registry.getGeoJsonSource(sourceId)
      expect(source.geometryKind).toBe('polygon')
      if (sourceId !== 'lake-polygons' && sourceId !== 'river-polygons')
        expect(source.data.features.length, sourceId).toBeGreaterThan(0)

      for (const feature of source.data.features) {
        expect(typeof feature.id).toBe('string')
        expect(feature.id.length).toBeGreaterThan(0)
        if (feature.geometry.type === 'Polygon') {
          assertPolygonRingsValid(feature.geometry.coordinates)
        }
        else {
          expect(feature.geometry.type).toBe('MultiPolygon')
          for (const poly of feature.geometry.coordinates as readonly (readonly (readonly (readonly [number, number])[])[])[])
            assertPolygonRingsValid(poly)
        }
      }
    }

    // Explicitly verify interior holes when an inland lake/sea is surrounded by land
    const syntheticLandReader = createWorldMapReader({
      ...snapshot,
      nature: {
        ...snapshot.nature,
        geography: {
          ...snapshot.nature.geography,
          landMask: {
            meshId: snapshot.mesh.meshId,
            // Make all cells land except cell 0 (an inland sea hole) and cell 100
            values: Uint8Array.from({ length: snapshot.mesh.regionCount }, (_, idx) => (idx === 0 ? 0 : 1)),
          },
        },
      },
    })
    const holeRegistry = new MapSourceRegistry(syntheticLandReader)
    const landWithHole = holeRegistry.getGeoJsonSource('land-areas')
    expect(landWithHole.data.features).toHaveLength(1)
    const geom = landWithHole.data.features[0].geometry
    const polygons: readonly (readonly (readonly (readonly [number, number])[])[])[] = geom.type === 'Polygon'
      ? [geom.coordinates as unknown as readonly (readonly (readonly [number, number])[])[]]
      : geom.coordinates as unknown as readonly (readonly (readonly (readonly [number, number])[])[])[]
    for (const polygon of polygons)
      assertPolygonRingsValid(polygon)
  })

  it('scales river polygon area monotonically with flow discharge and bridges confluences without gaps', () => {
    // Build a deterministic 2-tributary confluence fixture on the existing mesh
    const r0 = 10
    let r1 = -1
    reader.mesh.forEachRegionNeighbor(r0, (nb) => {
      if (r1 < 0)
        r1 = nb
    })
    let r2 = -1
    let rTrib = -1
    reader.mesh.forEachRegionNeighbor(r1, (nb) => {
      if (nb !== r0 && r2 < 0)
        r2 = nb
      else if (nb !== r0 && nb !== r2 && rTrib < 0)
        rTrib = nb
    })
    let r3 = -1
    reader.mesh.forEachRegionNeighbor(r2, (nb) => {
      if (nb !== r1 && nb !== rTrib && r3 < 0)
        r3 = nb
    })

    const count = snapshot.mesh.regionCount
    const flowValues = new Float64Array(count)
    const riverIndexValues = new Int32Array(count).fill(-1)
    const downstreamValues = snapshot.nature.hydrology.downstreamRegion.values.slice()

    // River 0 (low discharge): r0 -> r1 (drains into r2)
    // River 1 (medium tributary): rTrib -> r1 (drains into r2, forming a confluence at r1)
    // River 2 (high discharge mainstem): r1 -> r2 -> r3
    downstreamValues[r0] = r1
    downstreamValues[rTrib] = r1
    downstreamValues[r1] = r2
    downstreamValues[r2] = r3

    flowValues[r0] = 20
    flowValues[rTrib] = 180
    flowValues[r1] = 200
    flowValues[r2] = 1200
    flowValues[r3] = 2500

    riverIndexValues[r0] = 0
    riverIndexValues[rTrib] = 1
    riverIndexValues[r1] = 2
    riverIndexValues[r2] = 2
    riverIndexValues[r3] = 2

    const hydroSnapshot: WorldSnapshot = {
      ...snapshot,
      nature: {
        ...snapshot.nature,
        hydrology: {
          ...snapshot.nature.hydrology,
          downstreamRegion: { meshId: snapshot.mesh.meshId, values: downstreamValues },
          accumulatedAnnualFlowM3s: { meshId: snapshot.mesh.meshId, values: flowValues },
          riverIndex: { meshId: snapshot.mesh.meshId, values: riverIndexValues },
          rivers: [
            {
              id: 'river:small',
              sourceRegion: r0,
              mouthRegion: r0,
              downstreamRiver: 2,
              annualMeanDischargeM3s: 20,
              strahlerOrder: 1,
              endorheic: false,
              regions: Uint32Array.from([r0]),
            },
            {
              id: 'river:medium',
              sourceRegion: rTrib,
              mouthRegion: rTrib,
              downstreamRiver: 2,
              annualMeanDischargeM3s: 180,
              strahlerOrder: 1,
              endorheic: false,
              regions: Uint32Array.from([rTrib]),
            },
            {
              id: 'river:large',
              sourceRegion: r1,
              mouthRegion: r2,
              downstreamRiver: -1,
              annualMeanDischargeM3s: 1200,
              strahlerOrder: 2,
              endorheic: false,
              regions: Uint32Array.from([r1, r2]),
            },
          ],
        },
      },
    }

    const hydroReader = createWorldMapReader(hydroSnapshot)
    const registry = new MapSourceRegistry(hydroReader)
    const riverPolys = registry.getGeoJsonSource('river-polygons')
    const riverLines = registry.getGeoJsonSource('river-centerlines')

    expect(riverPolys.data.features).toHaveLength(3)
    expect(riverLines.data.features).toHaveLength(3)

    const areas = riverPolys.data.features.map(feature => Number(feature.properties.areaKm2))
    expect(areas.every(area => area > 0)).toBe(true)

    // Verify tributary centerlines reach the exact confluence cell center of the mainstem
    const line0End = (riverLines.data.features[0].geometry.coordinates as readonly (readonly [number, number])[]).at(-1)! as readonly [number, number]
    const line1End = (riverLines.data.features[1].geometry.coordinates as readonly (readonly [number, number])[]).at(-1)! as readonly [number, number]
    const line2Start = (riverLines.data.features[2].geometry.coordinates as readonly (readonly [number, number])[])[0] as readonly [number, number]
    const gap0 = sphericalAngleRad(
      lonLatDegToCartesian(line0End[0], line0End[1]),
      lonLatDegToCartesian(line2Start[0], line2Start[1]),
    )
    const gap1 = sphericalAngleRad(
      lonLatDegToCartesian(line1End[0], line1End[1]),
      lonLatDegToCartesian(line2Start[0], line2Start[1]),
    )
    expect(gap0).toBeLessThan(1e-6)
    expect(gap1).toBeLessThan(1e-6)

    // Confluence node r1 has 2 upstream tributaries, so a circular confluence cap is emitted (MultiPolygon)
    const hasConfluenceCap = riverPolys.data.features.some(f => f.geometry.type === 'MultiPolygon')
    expect(hasConfluenceCap).toBe(true)
  })

  it('extracts curved PCA territory spines when elongation >= 1.35 and falls back to interior point anchors when compact', () => {
    const centerOut = { x: 0, y: 0, z: 0 }
    const elongatedBelt: number[] = []
    const compactCap: number[] = []

    for (let r = 0; r < reader.mesh.regionCount; r++) {
      reader.mesh.getRegionCenter(r, centerOut)
      const latDeg = Math.asin(Math.max(-1, Math.min(1, centerOut.y))) * (180 / Math.PI)
      const lonDeg = Math.atan2(centerOut.x, centerOut.z) * (180 / Math.PI)
      if (Math.abs(latDeg) <= 9 && lonDeg >= -55 && lonDeg <= 55)
        elongatedBelt.push(r)
      if (centerOut.z > 0.86)
        compactCap.push(r)
    }

    const elongatedSpine = computeTerritorySpine(reader.mesh, {
      featureId: 'continent:belt',
      displayName: '苍岚大陆',
      kind: 'continent',
      areaKm2: 12_000_000,
      memberRegions: elongatedBelt,
    })
    expect(elongatedSpine.elongation).toBeGreaterThanOrEqual(1.35)
    expect(elongatedSpine.isCurved).toBe(true)
    expect(elongatedSpine.spinePoints.length).toBeGreaterThanOrEqual(3)
    expect(elongatedBelt).toContain(elongatedSpine.anchorRegion)

    // Left-to-right glyph sampling reverses order when viewed from upside-down/opposite right vector
    const glyphsEast = sampleSpineGlyphAnchors(elongatedSpine, '苍岚大陆', [1, 0, 0])
    const glyphsWest = sampleSpineGlyphAnchors(elongatedSpine, '苍岚大陆', [-1, 0, 0])
    expect(glyphsEast).toHaveLength(4)
    expect(glyphsWest).toHaveLength(4)
    expect(glyphsEast[0].coordinates[0]).toBeLessThan(glyphsEast.at(-1)!.coordinates[0])
    expect(glyphsWest[0].coordinates[0]).toBeGreaterThan(glyphsWest.at(-1)!.coordinates[0])

    const compactSpine = computeTerritorySpine(reader.mesh, {
      featureId: 'continent:cap',
      displayName: '圆洲大陆',
      kind: 'continent',
      areaKm2: 5_000_000,
      memberRegions: compactCap,
    })
    expect(compactSpine.elongation).toBeLessThan(1.35)
    expect(compactSpine.isCurved).toBe(false)
    expect(compactSpine.spinePoints).toHaveLength(0)
    expect(compactCap).toContain(compactSpine.anchorRegion)
  })

  it('reports SourceUnavailable when optional world capabilities are absent', () => {
    const legacySnapshot: WorldSnapshot = structuredClone(snapshot)
    delete (legacySnapshot.nature.climate as { circulation?: unknown }).circulation
    delete (legacySnapshot.nature.geography as { regions?: unknown }).regions

    const legacyReader = createWorldMapReader(legacySnapshot)
    const registry = new MapSourceRegistry(legacyReader)

    const circVectors = registry.getSource('circulation-vectors', { month: 0 })
    expect(circVectors.unavailable).toBe(true)
    if (circVectors.unavailable)
      expect(circVectors.reason).toContain('circulation')

    const continents = registry.getSource('continent-areas')
    expect(continents.unavailable).toBe(true)

    const labels = registry.getSource('geographic-labels')
    expect(labels.unavailable).toBe(true)

    // Civilization sources return SourceUnavailable when civilization/resources are absent
    for (const civSourceId of [
      'population-density',
      'resource-potential',
      'polity-territory',
      'culture-dominant',
      'religion-dominant',
      'polity-borders',
      'transport-routes',
      'settlements',
      'polity-labels',
      'settlement-labels',
    ] as const) {
      const resolved = registry.getSource(civSourceId)
      expect(resolved.unavailable, civSourceId).toBe(true)
    }
  })

  it('builds all 10 civilization and resource cartography sources with valid borders, territories, routes, settlements and labels', async () => {
    const genCatalog = loadBuiltinGenerationCatalog()
    const genPacks = genCatalog.packs
    const genNamingStyle = genPacks.flatMap(pack => pack.namingStyles ?? []).find(s => s.id === styleId) ?? builtinNamingStyle
    const translations: Record<string, Record<string, string>> = {}
    for (const pack of genPacks) {
      if (!pack.translations)
        continue
      for (const [locale, texts] of Object.entries(pack.translations)) {
        translations[locale] ??= {}
        Object.assign(translations[locale], texts)
      }
    }
    const resources = genPacks.flatMap(pack => pack.resources)
    const civContent = {
      peoples: genPacks.flatMap(pack => pack.peoples),
      cultures: genPacks.flatMap(pack => pack.cultures),
      religions: genPacks.flatMap(pack => pack.religions),
      polities: genPacks.flatMap(pack => pack.polities),
      namingStyles: genPacks.flatMap(pack => pack.namingStyles ?? []),
      translations,
    }
    const worldInput = {
      seed: 'slice3-civ-cartography',
      config: {
        ...naturalInput.config,
        civilization: DEFAULT_CIVILIZATION_PARAMETERS,
      },
      content: {
        'geographic-naming-style': genNamingStyle,
        'ecology-classes': builtinEcologyVocabulary,
        'resource-definitions': resources,
        'civilization-content': civContent,
      },
      contentSignatures: {
        'geographic-naming-style': calculateNamingStyleSignature(genNamingStyle),
        'ecology-classes': ecologyVocabularySignature(builtinEcologyVocabulary),
        'resource-definitions': resourceDefinitionsSignature(resources),
        'civilization-content': civilizationContentSignature(civContent),
      },
    }

    const civPipeline = createWorldPipeline()
    const civResult = await civPipeline.execute(worldInput)
    const civSnapshot = assembleWorld(
      worldInput,
      civResult,
      civPipeline.registry,
      { ...identity, snapshotId: 'snapshot:slice3-civ' },
      genPacks,
      builtinContentPort,
    )
    const civReader = createWorldMapReader(civSnapshot)
    const registry = new MapSourceRegistry(civReader)

    const popRaster = registry.getRasterSource('population-density')
    expect(popRaster.regionCount).toBe(civReader.identity.regionCount)
    expect(popRaster.fields.populationDensity).toBeDefined()

    const resRaster = registry.getRasterSource('resource-potential')
    expect(resRaster.fields.agriculturalPotential).toBeDefined()
    expect(resRaster.fields.depositRichness).toBeDefined()

    for (const polySourceId of ['polity-territory', 'culture-dominant', 'religion-dominant'] as const) {
      const polySource = registry.getGeoJsonSource(polySourceId)
      expect(polySource.geometryKind).toBe('polygon')
      expect(polySource.data.features.length).toBeGreaterThan(0)
      for (const feature of polySource.data.features) {
        if (feature.properties.unassigned === true)
          expect(feature.properties.entityId).toBeUndefined()
        else
          expect(typeof feature.properties.entityId).toBe('string')
        if (feature.geometry.type === 'Polygon') {
          assertPolygonRingsValid(feature.geometry.coordinates)
        }
        else {
          expect(feature.geometry.type).toBe('MultiPolygon')
          for (const poly of feature.geometry.coordinates as readonly (readonly (readonly (readonly [number, number])[])[])[])
            assertPolygonRingsValid(poly)
        }
      }
    }

    const borders = registry.getGeoJsonSource('polity-borders')
    expect(borders.geometryKind).toBe('line')
    expect(borders.data.features.length).toBeGreaterThan(0)
    const coastPoints = new Set<string>()
    const coastCoords: [number, number][] = []
    const coasts = registry.getGeoJsonSource('coastlines')
    for (const feature of coasts.data.features) {
      const lines = feature.geometry.type === 'MultiLineString'
        ? feature.geometry.coordinates
        : [feature.geometry.coordinates]
      for (const line of lines) {
        for (const coord of line) {
          const point: [number, number] = [coord[0], coord[1]]
          coastCoords.push(point)
          coastPoints.add(`${point[0].toFixed(6)},${point[1].toFixed(6)}`)
        }
      }
    }
    let coastTouching = 0
    let pinned = 0
    for (const border of borders.data.features) {
      expect(border.geometry.type).toBe('LineString')
      const coords = border.geometry.coordinates as readonly (readonly [number, number])[]
      expect(coords.length).toBeGreaterThanOrEqual(2)
      for (const endpoint of [coords[0], coords.at(-1)!]) {
        let nearest = Infinity
        for (const coast of coastCoords) {
          const dLon = endpoint[0] - coast[0]
          const dLat = endpoint[1] - coast[1]
          nearest = Math.min(nearest, dLon * dLon + dLat * dLat)
        }
        if (nearest > 1)
          continue
        coastTouching++
        const key = `${endpoint[0].toFixed(6)},${endpoint[1].toFixed(6)}`
        if (coastPoints.has(key))
          pinned++
      }
    }
    expect(coastTouching).toBeGreaterThan(0)
    expect(pinned).toBe(coastTouching)

    const landMask = civReader.field('landMask')
    const polityField = civReader.field('dominantPolityIndex')
    let lakeRegion = -1
    for (let region = 0; region < civReader.mesh.regionCount && lakeRegion < 0; region++) {
      if (landMask.get(region) === 0)
        continue
      civReader.mesh.forEachRegionNeighbor(region, (neighbor) => {
        if (lakeRegion >= 0 || landMask.get(neighbor) === 0 || polityField.get(neighbor) < 0)
          return
        if (polityField.get(region) !== polityField.get(neighbor))
          lakeRegion = region
      })
    }
    expect(lakeRegion).toBeGreaterThanOrEqual(0)
    const lakeIndexValues = Int32Array.from(civSnapshot.nature.hydrology.lakeIndex.values)
    lakeIndexValues.fill(-1)
    lakeIndexValues[lakeRegion] = 0
    const lakeReader = createWorldMapReader({
      ...civSnapshot,
      nature: {
        ...civSnapshot.nature,
        hydrology: {
          ...civSnapshot.nature.hydrology,
          lakeIndex: { ...civSnapshot.nature.hydrology.lakeIndex, values: lakeIndexValues },
          lakes: [{
            id: 'lake:alignment',
            basinId: 'basin:alignment',
            endorheic: true,
            areaKm2: 1,
            waterLevelKm: 0,
            spillRegion: null,
            downstreamRegion: null,
            regions: Uint32Array.from([lakeRegion]),
          }],
        },
      },
      civilization: {
        ...civSnapshot.civilization,
        populationGroups: civSnapshot.civilization.populationGroups.filter(group => group.regionId !== lakeRegion),
      },
    })
    const alignedRegistry = new MapSourceRegistry(lakeReader)
    const alignedBorders = alignedRegistry.getGeoJsonSource('polity-borders')
    const alignedLakes = alignedRegistry.getGeoJsonSource('lake-polygons')
    const alignedBorderPoints = new Set<string>()
    for (const border of alignedBorders.data.features) {
      const coords = border.geometry.coordinates as readonly (readonly [number, number])[]
      for (const coord of coords)
        alignedBorderPoints.add(`${coord[0].toFixed(6)},${coord[1].toFixed(6)}`)
    }
    const alignedLakePoints: [number, number][] = []
    for (const feature of alignedLakes.data.features) {
      const polygons = feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates
      for (const polygon of polygons) {
        for (const ring of polygon)
          alignedLakePoints.push(...ring.map(coord => [coord[0], coord[1]] as [number, number]))
      }
    }
    let sharedVertices = 0
    for (const point of alignedLakePoints) {
      if (alignedBorderPoints.has(`${point[0].toFixed(6)},${point[1].toFixed(6)}`))
        sharedVertices++
    }
    expect(alignedLakes.data.features.length).toBeGreaterThan(0)
    expect(sharedVertices).toBeGreaterThan(0)

    const unassignedTerritory = alignedRegistry.getGeoJsonSource('polity-territory')
      .data.features.find(feature => feature.properties.unassigned === true)
    expect(unassignedTerritory).toBeDefined()
    expect(unassignedTerritory?.properties.groupIndex).toBe(-1)
    expect(unassignedTerritory?.properties.name).toBe('无归属地')
    expect(Number(unassignedTerritory?.properties.areaKm2)).toBeGreaterThan(0)

    const routes = registry.getGeoJsonSource('transport-routes')
    expect(routes.geometryKind).toBe('line')
    expect(routes.data.features.length).toBeGreaterThan(0)
    for (const route of routes.data.features) {
      expect(typeof route.properties.entityId).toBe('string')
      expect(['road', 'river', 'sea']).toContain(route.properties.mode)
    }

    const settlements = registry.getGeoJsonSource('settlements')
    expect(settlements.geometryKind).toBe('point')
    expect(settlements.data.features.length).toBe(civReader.settlements().length)
    expect(settlements.data.features.some(f => f.properties.symbolShape === 'star')).toBe(true)

    const polityLabels = registry.getGeoJsonSource('polity-labels')
    expect(polityLabels.geometryKind).toBe('point')
    expect(polityLabels.data.features.length).toBeGreaterThan(0)
    expect(polityLabels.spines?.size).toBe(polityLabels.data.features.length)

    const settlementLabels = registry.getGeoJsonSource('settlement-labels')
    expect(settlementLabels.geometryKind).toBe('point')
    expect(settlementLabels.data.features.length).toBe(civReader.settlements().length)
  })
})
