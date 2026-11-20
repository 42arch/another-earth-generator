import type { WorldMapReader, WorldSnapshot } from '@another-earth/world-core'
import { createWorldMapReader, WORLD_SCHEMA_VERSION } from '@another-earth/world-core'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  cartesianToLonLatDeg,
  CircleLayer,
  EQUIRECTANGULAR_PROJECTION,
  FillLayer,
  LineLayer,
  MapPicker,
  POLITICAL_ATLAS_STYLE_PRESET,
  StyleCompiler,
} from '../index'

function createMinimalMeshReader(): WorldMapReader {
  const field = <T extends Float32Array | Float64Array | Uint8Array | Uint16Array | Uint32Array | Int32Array>(values: T) => ({ meshId: 'mesh:picker-test', values })
  const s = 1 / Math.sqrt(3)
  const snapshot = {
    schemaVersion: WORLD_SCHEMA_VERSION,
    snapshotId: 'snap:picker-test',
    revision: 0,
    time: { year: 0 },
    metadata: {
      worldId: 'world:picker-test',
      name: 'Picker Test',
      seed: 'picker-test',
      createdAt: '2026-11-20T00:00:00Z',
      generatorVersion: 'test-1',
      contentSignature: 'sig',
      contentPacks: [],
      generationConfig: {
        planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
        mesh: { subdivisionLevel: 0, irregularity: 0 },
        regionCount: 4,
        civilizationEnabled: false,
      },
      provenance: {
        stageVersions: {},
        artifactSignatures: {},
        configSignature: 'cfg',
      },
    },
    planet: {
      physicalRadiusKm: 6371,
      rotationPeriodHours: 24,
      orbitalPeriodDays: 365.25,
      axialTiltDegrees: 23.44,
      seaLevelDatumKm: 0,
    },
    mesh: {
      meshId: 'mesh:picker-test',
      regionCount: 4,
      centers: new Float64Array([s, s, s, s, -s, -s, -s, s, -s, -s, -s, s]),
      areaKm2: new Float64Array(4).fill(100),
      neighborOffsets: new Uint32Array([0, 3, 6, 9, 12]),
      neighbors: new Uint32Array([1, 2, 3, 0, 2, 3, 0, 1, 3, 0, 1, 2]),
    },
    nature: {
      geology: {
        plateIndex: field(new Uint32Array(4)),
        crustType: field(new Uint8Array(4)),
        plates: [{ id: 'plate:test' }],
      },
      geography: {
        elevationKm: field(new Float32Array(4).fill(0.5)),
        landMask: field(new Uint8Array(4).fill(1)),
      },
      climate: {
        monthsPerYear: 12,
        layout: 'month-major',
        annualMeanTemperatureC: field(new Float32Array(4).fill(15)),
        annualPrecipitationMm: field(new Float32Array(4).fill(800)),
        temperatureC: field(new Float32Array(48).fill(15)),
        precipitationMm: field(new Float32Array(48).fill(70)),
        koppenClass: field(new Uint8Array(4).fill(15)),
      },
      hydrology: {
        monthlySnowWaterEquivalentMm: field(new Float32Array(48)),
        monthlySnowfallMm: field(new Float32Array(48)),
        monthlySnowmeltMm: field(new Float32Array(48)),
        downstreamRegion: field(new Int32Array(4).fill(-1)),
        annualRunoffMm: field(new Float32Array(4).fill(100)),
        annualRunoffVolumeM3: field(new Float64Array(4)),
        accumulatedAnnualFlowM3s: field(new Float64Array(4)),
        contributingAreaKm2: field(new Float64Array(4)),
        basinIndex: field(new Int32Array(4).fill(-1)),
        basins: [],
        riverIndex: field(new Int32Array(4).fill(-1)),
        rivers: [],
        lakeIndex: field(new Int32Array(4).fill(-1)),
        lakes: [],
      },
      ecology: {
        potentialBiomeIds: ['ocean'],
        landCoverIds: ['water'],
        potentialBiomeIndex: field(new Uint16Array(4)),
        landCoverIndex: field(new Uint16Array(4)),
        aridityIndex: field(new Float32Array(4)),
        growingSeasonMonths: field(new Uint8Array(4)),
      },
      resources: {
        resourceIds: [],
        agriculturalPotential: field(new Float32Array(4)),
        forestryPotential: field(new Float32Array(4)),
        fisheryPotential: field(new Float32Array(4)),
        deposits: [],
      },
    },
    civilization: {
      meshId: 'mesh:picker-test',
      peoples: [],
      cultures: [],
      religions: [],
      polities: [],
      settlements: [],
      population: field(new Float64Array(4)),
      populationGroups: [],
      transport: {
        nodes: [],
        routes: [],
        accessibility: field(new Float32Array(4)),
      },
    },
  } as unknown as WorldSnapshot

  return createWorldMapReader(snapshot)
}

describe('mapPicker entityId resolution', () => {
  const compiler = new StyleCompiler()
  const compiled = compiler.compile(POLITICAL_ATLAS_STYLE_PRESET)

  it('returns entityId on settlement circle hits and respects layer priority over lines and fills', () => {
    const reader = createMinimalMeshReader()
    const [lon, lat] = cartesianToLonLatDeg(0, 0, 1)

    const settlementLayer = new CircleLayer(
      compiled.layersById.get('overlay-settlements')!,
      {
        unavailable: false,
        kind: 'geojson',
        sourceId: 'settlements',
        snapshotId: reader.identity.snapshotId,
        adapterVersion: 'settlements-v1',
        cacheKey: 'k-settlements',
        geometryKind: 'point',
        data: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            id: 'settlement:capital-1',
            geometry: { type: 'Point', coordinates: [lon, lat] },
            properties: {
              id: 'settlement:capital-1',
              entityId: 'settlement:capital-1',
              tier: 'capital',
              symbolShape: 'star',
            },
          }],
        },
      },
    )
    settlementLayer.setViewport(800, 600, 1)
    settlementLayer.updateStyle(compiled.layersById.get('overlay-settlements')!, 2)

    const borderLayer = new LineLayer(
      compiled.layersById.get('overlay-polity-borders')!,
      {
        unavailable: false,
        kind: 'geojson',
        sourceId: 'polity-borders',
        snapshotId: reader.identity.snapshotId,
        adapterVersion: 'polity-borders-v1',
        cacheKey: 'k-borders',
        geometryKind: 'line',
        data: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            id: 'polity-border:0:1',
            geometry: {
              type: 'LineString',
              coordinates: [[lon - 5, lat], [lon + 5, lat]],
            },
            properties: {
              id: 'polity-border:0:1',
              entityId: 'polity:alpha',
              isFrontier: false,
            },
          }],
        },
      },
    )
    borderLayer.setViewport(800, 600, 1)
    borderLayer.updateStyle(compiled.layersById.get('overlay-polity-borders')!, 2)

    const territoryLayer = new FillLayer(
      compiled.layersById.get('thematic-polity-territory')!,
      {
        unavailable: false,
        kind: 'geojson',
        sourceId: 'polity-territory',
        snapshotId: reader.identity.snapshotId,
        adapterVersion: 'polity-territory-v1',
        cacheKey: 'k-territory',
        geometryKind: 'polygon',
        data: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            id: 'polity:beta',
            geometry: {
              type: 'Polygon',
              coordinates: [[[lon - 10, lat - 10], [lon + 10, lat - 10], [lon + 10, lat + 10], [lon - 10, lat + 10], [lon - 10, lat - 10]]],
            },
            properties: {
              id: 'polity:beta',
              entityId: 'polity:beta',
              groupIndex: 0,
            },
          }],
        },
      },
    )
    territoryLayer.updateStyle(compiled.layersById.get('thematic-polity-territory')!, 2)

    const camera = new THREE.PerspectiveCamera(42, 800 / 600, 0.1, 20)
    camera.position.set(0, 0, 3)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()

    const picker = new MapPicker()
    const pickAll = picker.pickGlobe({
      reader,
      camera,
      screenX: 400,
      screenY: 300,
      viewportWidth: 800,
      viewportHeight: 600,
      orderedLayers: [
        { kind: 'fill', layer: territoryLayer },
        { kind: 'line', layer: borderLayer },
        { kind: 'circle', layer: settlementLayer },
      ],
    })
    expect(pickAll).not.toBeNull()
    expect(pickAll?.entityId).toBe('settlement:capital-1')
    expect(pickAll?.featureHit).toEqual({
      layerId: 'overlay-settlements',
      sourceId: 'settlements',
      featureId: 'settlement:capital-1',
      entityId: 'settlement:capital-1',
    })

    const pickBorderAndFill = picker.pickGlobe({
      reader,
      camera,
      screenX: 400,
      screenY: 300,
      viewportWidth: 800,
      viewportHeight: 600,
      orderedLayers: [
        { kind: 'fill', layer: territoryLayer },
        { kind: 'line', layer: borderLayer },
      ],
    })
    expect(pickBorderAndFill?.entityId).toBe('polity:alpha')
    expect(pickBorderAndFill?.featureHit?.sourceId).toBe('polity-borders')

    const pickFillOnly = picker.pickGlobe({
      reader,
      camera,
      screenX: 400,
      screenY: 300,
      viewportWidth: 800,
      viewportHeight: 600,
      orderedLayers: [
        { kind: 'fill', layer: territoryLayer },
      ],
    })
    expect(pickFillOnly?.entityId).toBe('polity:beta')
    expect(pickFillOnly?.featureHit?.sourceId).toBe('polity-territory')

    settlementLayer.dispose()
    borderLayer.dispose()
    territoryLayer.dispose()
  })

  it('returns entityId in 2D pickAtlas for settlement markers', () => {
    const reader = createMinimalMeshReader()
    const settlementLayer = new CircleLayer(
      compiled.layersById.get('overlay-settlements')!,
      {
        unavailable: false,
        kind: 'geojson',
        sourceId: 'settlements',
        snapshotId: reader.identity.snapshotId,
        adapterVersion: 'settlements-v1',
        cacheKey: 'k-atlas-settlements',
        geometryKind: 'point',
        data: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            id: 'settlement:port-2',
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: {
              id: 'settlement:port-2',
              entityId: 'settlement:port-2',
              tier: 'city',
              symbolShape: 'double-ring',
            },
          }],
        },
      },
      { projection: EQUIRECTANGULAR_PROJECTION },
    )
    settlementLayer.setViewport(800, 400, 1)
    settlementLayer.updateStyle(compiled.layersById.get('overlay-settlements')!, 2)

    const camera = new THREE.OrthographicCamera(-2, 2, 1, -1, 0.1, 10)
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()

    const picker = new MapPicker()
    const hit = picker.pickAtlas({
      reader,
      camera,
      projection: EQUIRECTANGULAR_PROJECTION,
      screenX: 400,
      screenY: 200,
      viewportWidth: 800,
      viewportHeight: 400,
      orderedLayers: [{ kind: 'circle', layer: settlementLayer }],
    })
    expect(hit).not.toBeNull()
    expect(hit?.entityId).toBe('settlement:port-2')
    expect(hit?.featureHit?.entityId).toBe('settlement:port-2')

    settlementLayer.dispose()
  })
})
