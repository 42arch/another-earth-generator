import type { TerrainArtifact } from '#generation/nature/geography'
import { createSphericalMesh } from '#mesh/spherical-mesh'
import { describe, expect, it } from 'vitest'
import { aggregateClimateSurface, DEFAULT_CLIMATE_PARAMETERS, generateClimateC0, projectClimateC0, queryClimateRegion, sampleClimateCirculation, validateClimateArtifact } from './climate'
import { interpolateMonthlyForcing } from './monthly-forcing'

const mesh = createSphericalMesh({ subdivisionLevel: 0, physicalRadiusKm: 6371 })
const terrain: Pick<TerrainArtifact, 'meshId' | 'elevationKm' | 'landMask'> = {
  meshId: mesh.meshId,
  elevationKm: new Float32Array(mesh.regionCount),
  landMask: new Uint8Array(mesh.regionCount),
}

describe('preliminary monthly climate', () => {
  it('produces twelve valid equal-duration months and reproducible annual values', () => {
    const first = generateClimateC0(mesh, terrain, DEFAULT_CLIMATE_PARAMETERS)
    const second = generateClimateC0(mesh, terrain, DEFAULT_CLIMATE_PARAMETERS)
    expect(first.temperatureC).toEqual(second.temperatureC)
    expect(first.precipitationMm).toEqual(second.precipitationMm)
    expect(() => validateClimateArtifact(first, mesh.meshId, mesh.regionCount)).not.toThrow()
    expect(first.temperatureC.length).toBe(mesh.regionCount * 12)
    expect(first.circulation.windEast.length).toBe(mesh.regionCount * 4)
    expect(first.circulation.oceanWarmth.length).toBe(mesh.regionCount * 4)
    expect(first.koppenClass.every(code => code === 0)).toBe(true)
    expect(Number.isFinite(sampleClimateCirculation(first, 0, 0, 'windEast'))).toBe(true)
    expect(queryClimateRegion(first, 0, 11).month).toBe(11)
    expect(() => queryClimateRegion(first, 0, 12)).toThrow(RangeError)
  })

  it('keeps zero precipitation zero through projection and rejects bad source indices', () => {
    const dry = generateClimateC0(mesh, terrain, { ...DEFAULT_CLIMATE_PARAMETERS, precipitationScale: 0 })
    const identity = Uint32Array.from({ length: mesh.regionCount }, (_, i) => i)
    const result = projectClimateC0(mesh, mesh, terrain, terrain, dry, identity)
    expect(result.annualPrecipitationMm.every(value => value === 0)).toBe(true)
    expect(() => validateClimateArtifact(result)).not.toThrow()
    identity[0] = mesh.regionCount
    expect(() => projectClimateC0(mesh, mesh, terrain, terrain, dry, identity)).toThrow()
  })

  it('reverses the seasonal temperature signal across hemispheres', () => {
    const climate = generateClimateC0(mesh, terrain, DEFAULT_CLIMATE_PARAMETERS)
    const north = Array.from({ length: mesh.regionCount }, (_, r) => r).find(r => mesh.centers[3 * r + 1] > 0.4)!
    const south = Array.from({ length: mesh.regionCount }, (_, r) => r).find(r => mesh.centers[3 * r + 1] < -0.4)!
    expect(queryClimateRegion(climate, north, 5).temperatureC).toBeGreaterThan(queryClimateRegion(climate, north, 11).temperatureC)
    expect(queryClimateRegion(climate, south, 5).temperatureC).toBeLessThan(queryClimateRegion(climate, south, 11).temperatureC)
  })

  it('aggregates a mixed coast by area and conserves monthly precipitation volume on identity projection', () => {
    const mixed = { ...terrain, landMask: new Uint8Array(mesh.regionCount) }
    mixed.landMask[0] = 1
    const identity = Uint32Array.from({ length: mesh.regionCount }, (_, i) => i)
    const surface = aggregateClimateSurface(mesh, mesh, mixed, identity)
    expect(surface.landMask).toEqual(mixed.landMask)
    const source = generateClimateC0(mesh, surface, DEFAULT_CLIMATE_PARAMETERS)
    const projected = projectClimateC0(mesh, mesh, mixed, surface, source, identity)
    for (let month = 0; month < 12; month++) {
      let sourceVolume = 0
      let projectedVolume = 0
      for (let r = 0; r < mesh.regionCount; r++) {
        sourceVolume += source.precipitationMm[month * mesh.regionCount + r] * mesh.areaKm2[r]
        projectedVolume += projected.precipitationMm[month * mesh.regionCount + r] * mesh.areaKm2[r]
      }
      expect(Math.abs(sourceVolume - projectedVolume) / sourceVolume).toBeLessThan(1e-6)
    }
  })

  it('rejects malformed monthly and annual data', () => {
    const climate = generateClimateC0(mesh, terrain, DEFAULT_CLIMATE_PARAMETERS)
    climate.precipitationMm[0] = -1
    expect(() => validateClimateArtifact(climate)).toThrow()
    expect(() => generateClimateC0(mesh, terrain, { ...DEFAULT_CLIMATE_PARAMETERS, axialTiltDegrees: 91 })).toThrow(RangeError)
  })

  it('rejects malformed circulation and uses twelve equal orbital bins', () => {
    const climate = generateClimateC0(mesh, terrain, DEFAULT_CLIMATE_PARAMETERS)
    const days = Array.from({ length: 12 }, (_, month) => interpolateMonthlyForcing(climate.circulation, month, DEFAULT_CLIMATE_PARAMETERS.axialTiltDegrees, DEFAULT_CLIMATE_PARAMETERS.orbitalPeriodDays).days)
    expect(days.every(day => day === DEFAULT_CLIMATE_PARAMETERS.orbitalPeriodDays / 12)).toBe(true)
    climate.circulation.windEast[0] = Number.NaN
    expect(() => validateClimateArtifact(climate)).toThrow('circulation')
  })
})
