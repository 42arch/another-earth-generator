import type { TerrainArtifact } from '#generation/nature/geography'
import { createSphericalMesh } from '#mesh/spherical-mesh'
import { describe, expect, it } from 'vitest'
import { aggregateClimateSurface, DEFAULT_CLIMATE_PARAMETERS, generateClimateC0, projectClimateC0, queryClimateRegion, sampleClimateCirculation, sampleClimateSpeedMps, validateClimateArtifact } from './climate'
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

  it('estimates monthly speed from both components and distinguishes calm from missing current', () => {
    const climate = generateClimateC0(mesh, terrain, DEFAULT_CLIMATE_PARAMETERS)
    climate.circulation.windEast.fill(3)
    climate.circulation.windNorth.fill(-4)
    climate.circulation.oceanEast.fill(-0.3)
    climate.circulation.oceanNorth.fill(0.4)

    const region = 0
    const month = 5
    const result = queryClimateRegion(climate, region, month)
    expect(result).toMatchObject({ windEast: 3, windNorth: -4, oceanCurrentAvailable: true })
    expect(result.windSpeedMps).toBeCloseTo(5 * 0.257)
    expect(result.oceanSpeedMps).toBeCloseTo(0.5 * 0.097)
    expect(sampleClimateSpeedMps(climate, region, month, 'wind')).toBe(result.windSpeedMps)
    expect(sampleClimateSpeedMps(climate, region, month, 'ocean')).toBe(result.oceanSpeedMps)

    climate.circulation.oceanEast.fill(0)
    climate.circulation.oceanNorth.fill(0)
    expect(queryClimateRegion(climate, region, month).oceanSpeedMps).toBe(0)
    climate.oceanReference[region] = -1
    expect(queryClimateRegion(climate, region, month).oceanSpeedMps).toBeNull()
    expect(sampleClimateSpeedMps(climate, region, month, 'ocean')).toBeNull()
    expect(() => sampleClimateSpeedMps(climate, region, 12, 'ocean')).toThrow(RangeError)
  })

  it('applies elevation corrections only to final land temperatures', () => {
    const reference = { ...terrain, landMask: new Uint8Array(mesh.regionCount) }
    reference.landMask[0] = 1
    const source = generateClimateC0(mesh, reference, DEFAULT_CLIMATE_PARAMETERS)
    source.temperatureC.fill(20)
    const output = { ...reference, elevationKm: new Float32Array(mesh.regionCount).fill(-3) }
    output.elevationKm[0] = 1
    const identity = Uint32Array.from({ length: mesh.regionCount }, (_, i) => i)
    const projected = projectClimateC0(mesh, mesh, output, reference, source, identity)
    expect(projected.temperatureC[0]).toBeCloseTo(13.8, 4)
    expect(projected.temperatureC[1]).toBeCloseTo(20, 4)
    expect(projected.annualMeanTemperatureC[1]).toBeCloseTo(20, 4)
  })

  it('fills connected ocean gaps without copying a current across land', () => {
    const connected = mesh.neighbors[0]
    const neighbors = new Set(mesh.neighbors.subarray(mesh.neighborOffsets[0], mesh.neighborOffsets[1]))
    for (const region of mesh.neighbors.subarray(mesh.neighborOffsets[connected], mesh.neighborOffsets[connected + 1]))
      neighbors.add(region)
    const isolated = Array.from({ length: mesh.regionCount }, (_, i) => i).find(i => i !== 0 && !neighbors.has(i))!
    const output = { ...terrain, landMask: new Uint8Array(mesh.regionCount).fill(1) }
    output.landMask[0] = output.landMask[connected] = output.landMask[isolated] = 0
    const reference = { ...terrain, landMask: new Uint8Array(mesh.regionCount).fill(1) }
    reference.landMask[0] = 0
    const source = generateClimateC0(mesh, reference, DEFAULT_CLIMATE_PARAMETERS)
    for (let season = 0; season < 4; season++)
      source.circulation.oceanEast[season * mesh.regionCount] = 0.75
    const nearest = new Uint32Array(mesh.regionCount)
    nearest[connected] = connected
    const projected = projectClimateC0(mesh, mesh, output, reference, source, nearest)
    const sampled = queryClimateRegion(projected, connected, 0)
    expect(sampled.oceanCurrentAvailable).toBe(true)
    expect(sampled.oceanEast).toBeCloseTo(0.75)
    expect(queryClimateRegion(projected, isolated, 0)).toMatchObject({ oceanCurrentAvailable: false, oceanEast: 0 })
    const land = output.landMask.findIndex(value => value === 1)
    expect(queryClimateRegion(projected, land, 0)).toMatchObject({ oceanCurrentAvailable: false, oceanEast: 0 })
    expect(() => validateClimateArtifact(projected)).not.toThrow()
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
