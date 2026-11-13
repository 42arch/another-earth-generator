import { loadBuiltinGenerationCatalog } from '@another-earth/world-data'
import { describe, expect, it } from 'vitest'
import {
  assembleNaturalWorld,
  createNaturalPipeline,
  createSphericalMesh,
  createWorldMapReader,
  decodeWorldArchive,
  DEFAULT_CLIMATE_PARAMETERS,
  DEFAULT_GEOLOGY_PARAMETERS,
  DEFAULT_HYDROLOGY_PARAMETERS,
  DEFAULT_LANDFORM_PARAMETERS,
  DEFAULT_TERRAIN_PARAMETERS,
  DeterministicRandom,
  encodeWorldArchive,
  queryClimateRegion,
  sphericalTriangleArea,
  validateWorldSnapshot,
  WorldStore,
} from '../index'

const naturalInput = {
  seed: 'slice1-world-map-reader',
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
  },
}
const identity = {
  snapshotId: 'snapshot:map-reader-test',
  worldId: 'world:map-reader-test',
  name: 'Map Reader World',
  createdAt: '2026-11-13T00:00:00Z',
}

function cornerKey(x: number, y: number, z: number): string {
  return `${x.toFixed(9)},${y.toFixed(9)},${z.toFixed(9)}`
}

function hasNoTypedArrayOrBuffer(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== 'object')
    return true
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof SharedArrayBuffer)
    return false
  if (seen.has(value))
    return true
  seen.add(value)
  for (const child of Object.values(value)) {
    if (!hasNoTypedArrayOrBuffer(child, seen))
      return false
  }
  return true
}

describe('worldMapReader & circulation closure', () => {
  it('reconstructs dual Voronoi corners, CCW boundary rings and shared edges identically to SphericalMesh', async () => {
    const pipeline = createNaturalPipeline()
    const result = await pipeline.execute(naturalInput)
    const packs = loadBuiltinGenerationCatalog().packs
    const snapshot = assembleNaturalWorld(naturalInput, result, pipeline.registry, identity, packs)
    const originalMesh = createSphericalMesh({
      subdivisionLevel: naturalInput.config.mesh.subdivisionLevel,
      irregularity: naturalInput.config.mesh.irregularity,
      seed: naturalInput.seed,
      physicalRadiusKm: naturalInput.config.planet.physicalRadiusKm,
    })
    expect(originalMesh.meshId).toBe(snapshot.mesh.meshId)

    const reader = createWorldMapReader(snapshot)
    expect(reader.mesh.regionCount).toBe(originalMesh.regionCount)
    expect(reader.mesh.cornerCount).toBe(originalMesh.dualVertices.length / 3)
    expect(reader.mesh.edgeCount).toBe(originalMesh.edgeRegions.length / 2)

    const p0 = { x: 0, y: 0, z: 0 }
    const p1 = { x: 0, y: 0, z: 0 }
    const p2 = { x: 0, y: 0, z: 0 }

    for (let r = 0; r < reader.mesh.regionCount; r++) {
      reader.mesh.getRegionCenter(r, p0)
      expect(p0.x).toBe(originalMesh.centers[3 * r])
      expect(p0.y).toBe(originalMesh.centers[3 * r + 1])
      expect(p0.z).toBe(originalMesh.centers[3 * r + 2])

      const reconstructedRing: string[] = []
      let reconstructedArea = 0
      const edgeIds: number[] = []
      reader.mesh.forEachRegionNeighbor(r, (_neighbor, cornerA, cornerB, edgeId) => {
        reader.mesh.getCornerPosition(cornerA, p1)
        reader.mesh.getCornerPosition(cornerB, p2)
        // Outward CCW check: det(center, cornerA, cornerB) > 0
        const crossX = p1.y * p2.z - p1.z * p2.y
        const crossY = p1.z * p2.x - p1.x * p2.z
        const crossZ = p1.x * p2.y - p1.y * p2.x
        expect(p0.x * crossX + p0.y * crossY + p0.z * crossZ).toBeGreaterThan(0)
        reconstructedArea += sphericalTriangleArea(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z)
        reconstructedRing.push(cornerKey(p2.x, p2.y, p2.z))
        edgeIds.push(edgeId)
      })

      expect(reconstructedRing.length).toBe(reader.mesh.getRegionDegree(r))
      expect(new Set(edgeIds).size).toBe(edgeIds.length)
      expect(reconstructedArea * reader.mesh.physicalRadiusKm ** 2).toBeCloseTo(reader.mesh.getRegionAreaKm2(r), 4)

      const start = originalMesh.neighborOffsets[r]
      const end = originalMesh.neighborOffsets[r + 1]
      const originalRing: string[] = []
      for (let i = start; i < end; i++) {
        const c = 3 * originalMesh.boundaryCorners[i]
        originalRing.push(cornerKey(originalMesh.dualVertices[c], originalMesh.dualVertices[c + 1], originalMesh.dualVertices[c + 2]))
      }

      const anchor = originalRing.indexOf(reconstructedRing[0])
      expect(anchor).toBeGreaterThanOrEqual(0)
      for (let k = 0; k < originalRing.length; k++)
        expect(reconstructedRing[k]).toBe(originalRing[(anchor + k) % originalRing.length])
    }

    let visitedEdges = 0
    reader.mesh.forEachEdge((edgeId, regionA, regionB, cornerA, cornerB) => {
      expect(edgeId).toBe(visitedEdges++)
      expect(regionA).toBeLessThan(regionB)
      let forwardFound = false
      reader.mesh.forEachRegionNeighbor(regionA, (nb, cA, cB, eId) => {
        if (nb === regionB) {
          expect(cA).toBe(cornerA)
          expect(cB).toBe(cornerB)
          expect(eId).toBe(edgeId)
          forwardFound = true
        }
      })
      let reverseFound = false
      reader.mesh.forEachRegionNeighbor(regionB, (nb, cA, cB, eId) => {
        if (nb === regionA) {
          expect(cA).toBe(cornerB)
          expect(cB).toBe(cornerA)
          expect(eId).toBe(edgeId)
          reverseFound = true
        }
      })
      expect(forwardFound).toBe(true)
      expect(reverseFound).toBe(true)
    })
    expect(visitedEdges).toBe(reader.mesh.edgeCount)
  })

  it('matches brute-force nearest Voronoi center across 1,000 random unit-sphere queries', () => {
    const mesh = createSphericalMesh({
      subdivisionLevel: 3,
      irregularity: 0.6,
      seed: 'locate-region-walk-seed',
      physicalRadiusKm: 6371,
    })
    const fakeSnapshot = {
      schemaVersion: 3,
      snapshotId: 'snapshot:walk',
      revision: 0,
      time: { year: 0 },
      metadata: {
        worldId: 'world:walk',
        name: 'Walk',
        seed: 'locate-region-walk-seed',
        createdAt: '2026-11-13T00:00:00Z',
        generatorVersion: 'test',
        contentSignature: 'sig',
        contentPacks: [],
        generationConfig: { mesh: { subdivisionLevel: 3, irregularity: 0.6 }, terrain: DEFAULT_TERRAIN_PARAMETERS },
        provenance: { stageVersions: {}, artifactSignatures: {}, configSignature: 'sig' },
      },
      planet: { physicalRadiusKm: 6371, rotationPeriodHours: 24, orbitalPeriodDays: 365.25, axialTiltDegrees: 23.44, seaLevelDatumKm: 0 },
      mesh: {
        meshId: mesh.meshId,
        regionCount: mesh.regionCount,
        centers: mesh.centers,
        areaKm2: mesh.areaKm2,
        neighborOffsets: mesh.neighborOffsets,
        neighbors: mesh.neighbors,
      },
      nature: {
        geology: { plates: [{ id: 'p:0' }], plateIndex: { meshId: mesh.meshId, values: new Uint32Array(mesh.regionCount) }, crustType: { meshId: mesh.meshId, values: new Uint8Array(mesh.regionCount) } },
        geography: { elevationKm: { meshId: mesh.meshId, values: new Float32Array(mesh.regionCount) }, landMask: { meshId: mesh.meshId, values: new Uint8Array(mesh.regionCount) } },
        climate: { monthsPerYear: 12, layout: 'month-major', temperatureC: { meshId: mesh.meshId, values: new Float32Array(12 * mesh.regionCount) }, precipitationMm: { meshId: mesh.meshId, values: new Float32Array(12 * mesh.regionCount) }, annualMeanTemperatureC: { meshId: mesh.meshId, values: new Float32Array(mesh.regionCount) }, annualPrecipitationMm: { meshId: mesh.meshId, values: new Float32Array(mesh.regionCount) }, koppenClass: { meshId: mesh.meshId, values: new Uint8Array(mesh.regionCount) } },
        hydrology: { monthlySnowWaterEquivalentMm: { meshId: mesh.meshId, values: new Float32Array(12 * mesh.regionCount) }, monthlySnowfallMm: { meshId: mesh.meshId, values: new Float32Array(12 * mesh.regionCount) }, monthlySnowmeltMm: { meshId: mesh.meshId, values: new Float32Array(12 * mesh.regionCount) }, downstreamRegion: { meshId: mesh.meshId, values: new Int32Array(mesh.regionCount).fill(-1) }, annualRunoffMm: { meshId: mesh.meshId, values: new Float32Array(mesh.regionCount) }, annualRunoffVolumeM3: { meshId: mesh.meshId, values: new Float64Array(mesh.regionCount) }, accumulatedAnnualFlowM3s: { meshId: mesh.meshId, values: new Float64Array(mesh.regionCount) }, contributingAreaKm2: { meshId: mesh.meshId, values: new Float64Array(mesh.regionCount) }, basinIndex: { meshId: mesh.meshId, values: new Int32Array(mesh.regionCount).fill(-1) }, basins: [], riverIndex: { meshId: mesh.meshId, values: new Int32Array(mesh.regionCount).fill(-1) }, rivers: [], lakeIndex: { meshId: mesh.meshId, values: new Int32Array(mesh.regionCount).fill(-1) }, lakes: [] },
        ecology: { potentialBiomeIds: ['ocean'], landCoverIds: ['water'], potentialBiomeIndex: { meshId: mesh.meshId, values: new Uint16Array(mesh.regionCount) }, landCoverIndex: { meshId: mesh.meshId, values: new Uint16Array(mesh.regionCount) }, aridityIndex: { meshId: mesh.meshId, values: new Float32Array(mesh.regionCount) }, growingSeasonMonths: { meshId: mesh.meshId, values: new Uint8Array(mesh.regionCount) } },
      },
      civilization: { meshId: mesh.meshId, population: { meshId: mesh.meshId, values: new Float64Array(mesh.regionCount) }, species: [], cultures: [], religions: [], polities: [], settlements: [], populationGroups: [] },
    } as unknown as Parameters<typeof createWorldMapReader>[0]

    const reader = createWorldMapReader(fakeSnapshot)
    const rng = new DeterministicRandom('locate-region-queries')
    for (let i = 0; i < 1000; i++) {
      const z = rng.nextFloat() * 2 - 1
      const theta = rng.nextFloat() * 2 * Math.PI
      const radial = Math.sqrt(Math.max(0, 1 - z * z))
      const x = radial * Math.cos(theta)
      const y = radial * Math.sin(theta)

      let bruteBest = 0
      let bruteDistSq = Infinity
      for (let r = 0; r < mesh.regionCount; r++) {
        const dx = x - mesh.centers[3 * r]
        const dy = y - mesh.centers[3 * r + 1]
        const dz = z - mesh.centers[3 * r + 2]
        const d = dx * dx + dy * dy + dz * dz
        if (d < bruteDistSq || (d === bruteDistSq && r < bruteBest)) {
          bruteDistSq = d
          bruteBest = r
        }
      }
      expect(reader.mesh.locateRegion(x, y, z)).toBe(bruteBest)
    }
    expect(() => reader.mesh.locateRegion(0, 0, 0)).toThrow(RangeError)
    expect(() => reader.mesh.locateRegion(Number.NaN, 1, 0)).toThrow(RangeError)
  })

  it('persists calibrated circulation across archive round-trips, preserves backward compatibility and exposes zero mutable buffers', async () => {
    const pipeline = createNaturalPipeline()
    const result = await pipeline.execute(naturalInput)
    const packs = loadBuiltinGenerationCatalog().packs
    const climateArtifact = result.getOutput<Parameters<typeof queryClimateRegion>[0]>('climate-c0')
    const snapshot = assembleNaturalWorld(naturalInput, result, pipeline.registry, identity, packs)

    expect(snapshot.nature.climate.circulation).toBeDefined()
    const archive = encodeWorldArchive(snapshot, packs)
    const restoredStore = new WorldStore()
    restoredStore.restore(archive, packs)
    const freshStore = new WorldStore()
    freshStore.publish(snapshot, packs)

    const freshReader = freshStore.mapReader()
    const restoredReader = restoredStore.mapReader()
    expect(freshReader.capabilities).toEqual({
      hasGeographicRegions: true,
      hasGeographicNames: true,
      hasSeaClassification: true,
      hasCirculation: true,
    })
    expect(restoredReader.capabilities).toEqual(freshReader.capabilities)

    for (const month of [0, 3, 6, 10]) {
      const windSpeed = restoredReader.monthlyField('windSpeedMps', month)
      const oceanSpeed = restoredReader.monthlyField('oceanSpeedMps', month)
      const oceanWarmth = restoredReader.monthlyField('oceanWarmth', month)
      const oceanAvail = restoredReader.field('oceanAvailable')

      for (let r = 0; r < snapshot.mesh.regionCount; r += 7) {
        const expected = queryClimateRegion(climateArtifact, r, month)
        expect(windSpeed.get(r)).toBeCloseTo(expected.windSpeedMps, 5)
        expect(oceanAvail.get(r)).toBe(expected.oceanCurrentAvailable ? 1 : 0)
        if (expected.oceanCurrentAvailable) {
          expect(oceanSpeed.get(r)).toBeCloseTo(expected.oceanSpeedMps!, 5)
          expect(oceanWarmth.get(r)).toBeCloseTo(expected.oceanWarmth, 5)
        }
        else {
          expect(oceanSpeed.get(r)).toBe(0)
          expect(oceanWarmth.get(r)).toBe(0)
        }
      }
    }

    // Derived slope, hillshade and satellite surfaceDetail must match identically between fresh and restored worlds
    for (const derived of ['slopeDeg', 'surfaceDetail', 'hillshade'] as const) {
      const a = freshReader.field(derived)
      const b = restoredReader.field(derived)
      expect(a.length).toBe(snapshot.mesh.regionCount)
      for (let r = 0; r < a.length; r++) {
        expect(Number.isFinite(a.get(r))).toBe(true)
        expect(b.get(r)).toBe(a.get(r))
      }
    }

    // Older Schema 3 archive without circulation remains valid and marks hasCirculation === false
    const legacySnapshot = structuredClone(snapshot)
    delete (legacySnapshot.nature.climate as { circulation?: unknown }).circulation
    expect(validateWorldSnapshot(legacySnapshot, packs).valid).toBe(true)
    const legacyArchive = encodeWorldArchive(legacySnapshot, packs)
    const legacyDecoded = decodeWorldArchive(legacyArchive, packs)
    const legacyReader = createWorldMapReader(legacyDecoded)
    expect(legacyReader.capabilities.hasCirculation).toBe(false)
    expect(() => legacyReader.field('oceanAvailable')).toThrow('Climate circulation is unavailable')
    expect(() => legacyReader.monthlyField('windSpeedMps', 0)).toThrow('Climate circulation is unavailable')

    // Zero mutable TypedArray / ArrayBuffer leakage across all reader surfaces
    expect(hasNoTypedArrayOrBuffer(restoredReader)).toBe(true)
    expect(hasNoTypedArrayOrBuffer(restoredReader.field('elevationKm'))).toBe(true)
    expect(hasNoTypedArrayOrBuffer(restoredReader.field('surfaceDetail'))).toBe(true)
    expect(hasNoTypedArrayOrBuffer(restoredReader.monthlyField('temperatureC', 0))).toBe(true)
    expect(hasNoTypedArrayOrBuffer(restoredReader.plates())).toBe(true)
    expect(hasNoTypedArrayOrBuffer(restoredReader.geographicRegions())).toBe(true)
    expect(hasNoTypedArrayOrBuffer(restoredReader.basins())).toBe(true)
    expect(hasNoTypedArrayOrBuffer(restoredReader.rivers())).toBe(true)
    expect(hasNoTypedArrayOrBuffer(restoredReader.lakes())).toBe(true)
    expect(hasNoTypedArrayOrBuffer(restoredReader.ecologyDictionaries())).toBe(true)
  })
})
