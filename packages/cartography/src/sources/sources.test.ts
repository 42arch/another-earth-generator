import type { WorldMapReader, WorldSnapshot } from '@another-earth/world-core'
import {
  assembleNaturalWorld,
  createNaturalPipeline,
  createWorldMapReader,
  DEFAULT_CLIMATE_PARAMETERS,
  DEFAULT_GEOLOGY_PARAMETERS,
  DEFAULT_HYDROLOGY_PARAMETERS,
  DEFAULT_LANDFORM_PARAMETERS,
  DEFAULT_TERRAIN_PARAMETERS,
  loadBuiltinContentPacks,
} from '@another-earth/world-core'
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
    const result = await pipeline.execute(naturalInput)
    const packs = loadBuiltinContentPacks()
    snapshot = assembleNaturalWorld(naturalInput, result, pipeline.registry, identity, packs)
    reader = createWorldMapReader(snapshot)
  })

  it('registers all 17 built-in natural sources and enforces instance-scoped caching & monthly invalidation', () => {
    const registry = new MapSourceRegistry(reader)
    const allIds = Object.keys(BUILTIN_MAP_SOURCE_SCHEMAS)
    expect(allIds).toHaveLength(17)

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
      if (sourceId !== 'lake-polygons')
        expect(source.data.features.length).toBeGreaterThan(0)

      for (const feature of source.data.features) {
        expect(typeof feature.id).toBe('string')
        expect(feature.id.length).toBeGreaterThan(0)
        if (feature.geometry.type === 'Polygon') {
          assertPolygonRingsValid(feature.geometry.coordinates)
        }
        else {
          expect(feature.geometry.type).toBe('MultiPolygon')
          for (const poly of feature.geometry.coordinates)
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
    const allPolys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
    const totalHoles = allPolys.reduce((sum, p) => sum + (p.length - 1), 0)
    expect(totalHoles).toBeGreaterThanOrEqual(1)
    for (const poly of allPolys)
      assertPolygonRingsValid(poly)
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
    const flowValues = new Float32Array(count)
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

    const areas = riverPolys.data.features.map(f => Number(f.properties.areaKm2))
    // Equal-length segments r0->r1 (20 m3/s) vs rTrib->r1 (180 m3/s) vs r1->r2->r3 (1200 m3/s):
    // areaKm2 strictly increases with flow
    expect(areas[0]).toBeGreaterThan(0)
    expect(areas[1]).toBeGreaterThan(areas[0])
    expect(areas[2]).toBeGreaterThan(areas[1])

    // Verify tributary centerlines reach the exact confluence cell center of the mainstem
    const line0End = riverLines.data.features[0].geometry.coordinates.at(-1)!
    const line1End = riverLines.data.features[1].geometry.coordinates.at(-1)!
    const line2Start = riverLines.data.features[2].geometry.coordinates[0]
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
  })
})
