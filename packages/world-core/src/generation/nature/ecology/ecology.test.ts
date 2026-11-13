import type { ClimateArtifact } from '#generation/nature/climate/climate'
import type { TerrainArtifact } from '#generation/nature/geography'
import { createSphericalMesh } from '#mesh/spherical-mesh'
import { NATURAL_BIOME_DEFINITIONS, NATURAL_LAND_COVER_DEFINITIONS } from '@another-earth/world-data'
import { describe, expect, it } from 'vitest'
import { generateEcologyE0, queryEcologyRegion, validateEcologyArtifact } from './ecology'

const mesh = createSphericalMesh({ subdivisionLevel: 0, physicalRadiusKm: 6371 })
const n = mesh.regionCount

function inputs() {
  const terrain = {
    meshId: mesh.meshId,
    elevationKm: new Float32Array(n),
    landMask: new Uint8Array(n),
  } satisfies Pick<TerrainArtifact, 'meshId' | 'elevationKm' | 'landMask'>
  const climate = {
    meshId: mesh.meshId,
    terrainMeshId: mesh.meshId,
    monthsPerYear: 12,
    layout: 'month-major',
    regionCount: n,
    temperatureC: new Float32Array(12 * n),
    precipitationMm: new Float32Array(12 * n),
    annualMeanTemperatureC: new Float32Array(n),
    annualPrecipitationMm: new Float32Array(n),
    koppenClass: new Uint8Array(n),
  } satisfies Pick<ClimateArtifact, 'meshId' | 'terrainMeshId' | 'monthsPerYear' | 'layout' | 'regionCount' | 'temperatureC' | 'precipitationMm' | 'annualMeanTemperatureC' | 'annualPrecipitationMm' | 'koppenClass'>
  function setRegion(region: number, temperature: number, precipitation: number, koppenClass: number) {
    terrain.landMask[region] = 1
    climate.annualMeanTemperatureC[region] = temperature
    climate.annualPrecipitationMm[region] = precipitation * 12
    climate.koppenClass[region] = koppenClass
    for (let month = 0; month < 12; month++) {
      climate.temperatureC[month * n + region] = temperature
      climate.precipitationMm[month * n + region] = precipitation
    }
  }
  return { terrain, climate, setRegion }
}

describe('e0 ecology contract', () => {
  it('classifies ocean and distinct land climates without human land cover', () => {
    const { terrain, climate, setRegion } = inputs()
    setRegion(1, 26, 200, 1) // Af
    setRegion(2, 30, 0, 5) // BWh
    setRegion(3, -20, 20, 31) // EF
    const ecology = generateEcologyE0(mesh, terrain, climate, 365.25)
    expect(() => validateEcologyArtifact(ecology, mesh.meshId, n)).not.toThrow()
    expect(queryEcologyRegion(ecology, 0)).toMatchObject({ potentialBiomeCode: 'Ocean', landCoverCode: 'Ocean', growingSeasonMonths: 0 })
    expect(queryEcologyRegion(ecology, 1)).toMatchObject({ potentialBiomeCode: 'TropicalRainforest', landCoverCode: 'Forest', growingSeasonMonths: 12 })
    expect(queryEcologyRegion(ecology, 2)).toMatchObject({ potentialBiomeCode: 'HotDesert', landCoverCode: 'Desert', aridityIndex: 0 })
    expect(queryEcologyRegion(ecology, 3)).toMatchObject({ potentialBiomeCode: 'IceSheet', landCoverCode: 'SnowIce', growingSeasonMonths: 0 })
    expect(ecology.potentialBiomeIds).toEqual(NATURAL_BIOME_DEFINITIONS.map(definition => definition.id))
    expect(ecology.landCoverIds).toEqual(NATURAL_LAND_COVER_DEFINITIONS.map(definition => definition.id))
    expect(() => queryEcologyRegion(ecology, n)).toThrow(RangeError)
  })

  it('rejects inconsistent annual input and corrupt classification indices', () => {
    const { terrain, climate, setRegion } = inputs()
    setRegion(1, 26, 200, 1)
    climate.annualPrecipitationMm[1] = 0
    expect(() => generateEcologyE0(mesh, terrain, climate, 365.25)).toThrow('annual climate aggregation')
    climate.annualPrecipitationMm[1] = 2400
    climate.precipitationMm[n + 1] = -1
    climate.annualPrecipitationMm[1] = 2199
    expect(() => generateEcologyE0(mesh, terrain, climate, 365.25)).toThrow('invalid climate')
    climate.precipitationMm[n + 1] = 200
    climate.annualPrecipitationMm[1] = 2400
    const ecology = generateEcologyE0(mesh, terrain, climate, 365.25)
    ecology.potentialBiomeIndex[1] = ecology.potentialBiomeIds.length
    expect(() => validateEcologyArtifact(ecology, mesh.meshId, n)).toThrow('values')
  })

  it('reads latitude and hemisphere from the same Y axis as C0', () => {
    const { terrain, climate, setRegion } = inputs()
    const polar = 1
    const equatorial = 2
    for (const region of [polar, equatorial]) {
      setRegion(region, -10, 20, 30) // ET
      climate.temperatureC[region] = -30
      climate.temperatureC[6 * n + region] = 2
      climate.annualMeanTemperatureC[region] = (-30 + 2 - 10 * 10) / 12
    }
    const centers = mesh.centers.slice()
    centers[polar * 3 + 1] = 0.99
    centers[polar * 3 + 2] = 0
    centers[equatorial * 3 + 1] = 0
    centers[equatorial * 3 + 2] = 0.99
    const ecology = generateEcologyE0({ ...mesh, centers }, terrain, climate, 365.25)
    expect(queryEcologyRegion(ecology, polar).potentialBiomeCode).toBe('IceSheet')
    expect(queryEcologyRegion(ecology, equatorial).potentialBiomeCode).toBe('Tundra')
  })

  it('uses the Y hemisphere for seasonal dry-summer classification', () => {
    const { terrain, climate, setRegion } = inputs()
    for (const region of [1, 2]) {
      setRegion(region, 15, 0, 9) // Csa
      for (let month = 0; month < 12; month++)
        climate.precipitationMm[month * n + region] = month >= 3 && month <= 8 ? 10 : 100
      climate.annualPrecipitationMm[region] = 660
    }
    const centers = mesh.centers.slice()
    centers[1 * 3 + 1] = 0.3
    centers[1 * 3 + 2] = 0
    centers[2 * 3 + 1] = -0.3
    centers[2 * 3 + 2] = 0
    const ecology = generateEcologyE0({ ...mesh, centers }, terrain, climate, 365.25)
    expect(queryEcologyRegion(ecology, 1).potentialBiomeCode).toBe('MediterraneanShrubland')
    expect(queryEcologyRegion(ecology, 2).potentialBiomeCode).toBe('TemperateGrassland')
  })
})
