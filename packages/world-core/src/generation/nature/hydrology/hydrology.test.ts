import type { ClimateArtifact } from '#generation/nature/climate/climate'
import type { TerrainArtifact } from '#generation/nature/geography'
import { createSphericalMesh } from '#mesh/spherical-mesh'
import { describe, expect, it } from 'vitest'
import { DEFAULT_HYDROLOGY_PARAMETERS, generateCryosphereI0, generateHydrologyH0, queryHydrologyRegion, validateHydrologyArtifact } from './hydrology'

function inputs(ocean = true, cold = false) {
  const mesh = createSphericalMesh({ subdivisionLevel: 0, physicalRadiusKm: 6371, irregularity: 0, seed: 'hydrology-fixture' })
  const n = mesh.regionCount
  const landMask = new Uint8Array(n).fill(1)
  if (ocean)
    landMask[0] = 0
  const elevationKm = Float32Array.from({ length: n }, (_, r) => landMask[r] ? 0.1 + (r % 3) * 0.1 : -1)
  const terrain = { meshId: mesh.meshId, landMask, elevationKm } as Pick<TerrainArtifact, 'meshId' | 'landMask' | 'elevationKm'>
  const temperatureC = new Float32Array(12 * n).fill(cold ? -10 : 10)
  const precipitationMm = new Float32Array(12 * n).fill(100)
  const climate = { meshId: mesh.meshId, regionCount: n, temperatureC, precipitationMm, koppenClass: new Uint8Array(n).fill(1) } as ClimateArtifact
  return { mesh, terrain, climate }
}

describe('preliminary cryosphere and hydrology', () => {
  it('stores snowfall and limits melt to available snow', () => {
    const { mesh, terrain, climate } = inputs(false)
    climate.temperatureC.fill(-10)
    const i0 = generateCryosphereI0(mesh, terrain, climate, DEFAULT_HYDROLOGY_PARAMETERS)
    expect(i0.monthlySnowmeltMm.every(value => value === 0)).toBe(true)
    expect(i0.monthlySnowWaterEquivalentMm[11 * mesh.regionCount]).toBeGreaterThan(0)
    for (let month = 6; month < 12; month++) climate.temperatureC.fill(10, month * mesh.regionCount, (month + 1) * mesh.regionCount)
    const melt = generateCryosphereI0(mesh, terrain, climate, DEFAULT_HYDROLOGY_PARAMETERS)
    for (let month = 0; month < 12; month++) {
      const previous = month ? melt.monthlySnowWaterEquivalentMm[(month - 1) * mesh.regionCount] : 0
      const i = month * mesh.regionCount
      expect(melt.monthlySnowmeltMm[i]).toBeLessThanOrEqual(previous + melt.monthlySnowfallMm[i] + 1e-3)
    }
  })

  it('keeps annual runoff local while accumulating flow downstream and conserves the annual land water ledger', () => {
    const { mesh, terrain, climate } = inputs()
    const i0 = generateCryosphereI0(mesh, terrain, climate, DEFAULT_HYDROLOGY_PARAMETERS)
    const h0 = generateHydrologyH0(mesh, terrain, climate, i0, { evapotranspirationFactorMmPerCMonth: 2, minimumRiverDrainageAreaKm2: 0, riverDensityMultiplier: 1, orbitalPeriodDays: 400 })
    const earthYear = generateHydrologyH0(mesh, terrain, climate, i0, { evapotranspirationFactorMmPerCMonth: 2, minimumRiverDrainageAreaKm2: 0, riverDensityMultiplier: 1, orbitalPeriodDays: 365.25 })
    validateHydrologyArtifact(h0, mesh, terrain, climate, i0)
    expect(h0.algorithmVersion).toBe('hydrology-h0-v4')
    expect(h0.effectiveRiverThresholdKm2).toBeCloseTo(mesh.areaKm2.reduce((sum, area) => sum + area, 0) / mesh.regionCount * 16)
    for (let r = 1; r < mesh.regionCount; r++) {
      let inputMm = 0
      let evapMm = 0
      let runoffMm = 0
      for (let m = 0; m < 12; m++) {
        const index = m * mesh.regionCount + r
        inputMm += climate.precipitationMm[index]
        evapMm += h0.monthlyEvapotranspirationMm[index]
        runoffMm += h0.monthlyRunoffMm[index]
      }
      const storage = i0.monthlySnowWaterEquivalentMm[11 * mesh.regionCount + r]
      expect(Math.abs(inputMm - evapMm - runoffMm - storage)).toBeLessThan(0.1)
      expect(h0.annualRunoffVolumeM3[r]).toBeCloseTo(h0.annualRunoffMm[r] * mesh.areaKm2[r] * 1000, 3)
      const receiver = h0.downstreamRegion[r]
      if (receiver >= 0)
        expect(h0.accumulatedAnnualFlowM3s[receiver]).toBeGreaterThanOrEqual(h0.accumulatedAnnualFlowM3s[r])
    }
    const query = queryHydrologyRegion(h0, 1, climate, i0)
    expect(query.monthlyPrecipitationMm[0]).toBe(100)
    expect(query.accumulatedFlowM3s).toBeGreaterThanOrEqual(0)
    expect(earthYear.accumulatedAnnualFlowM3s[1] / h0.accumulatedAnnualFlowM3s[1]).toBeCloseTo(400 / 365.25, 5)
  })

  it('creates an explicit internal sink when no ocean outlet exists', () => {
    const { mesh, terrain, climate } = inputs(false)
    const i0 = generateCryosphereI0(mesh, terrain, climate, DEFAULT_HYDROLOGY_PARAMETERS)
    const h0 = generateHydrologyH0(mesh, terrain, climate, i0, { evapotranspirationFactorMmPerCMonth: 0, minimumRiverDrainageAreaKm2: 0, riverDensityMultiplier: 1, orbitalPeriodDays: 365.25 })
    expect(h0.downstreamRegion.includes(-1)).toBe(true)
    expect(h0.basins).toHaveLength(1)
    expect(h0.basins[0].endorheic).toBe(true)
  })

  it('routes a perfectly flat mesh deterministically without equal-height cycles', () => {
    const { mesh, terrain: original, climate } = inputs(false)
    const terrain = { ...original, elevationKm: new Float32Array(mesh.regionCount).fill(0.1) }
    const i0 = generateCryosphereI0(mesh, terrain, climate, DEFAULT_HYDROLOGY_PARAMETERS)
    const params = { evapotranspirationFactorMmPerCMonth: 2, minimumRiverDrainageAreaKm2: 0, riverDensityMultiplier: 1, orbitalPeriodDays: 365.25 }
    const first = generateHydrologyH0(mesh, terrain, climate, i0, params)
    const second = generateHydrologyH0(mesh, terrain, climate, i0, params)
    expect(first.downstreamRegion).toEqual(second.downstreamRegion)
    expect(() => validateHydrologyArtifact(first, mesh, terrain, climate, i0)).not.toThrow()
    expect(first.downstreamRegion.filter(region => region < 0)).toHaveLength(1)
  })

  it('does not create rivers from zero precipitation', () => {
    const { mesh, terrain, climate } = inputs()
    climate.precipitationMm.fill(0)
    const i0 = generateCryosphereI0(mesh, terrain, climate, DEFAULT_HYDROLOGY_PARAMETERS)
    const h0 = generateHydrologyH0(mesh, terrain, climate, i0, { evapotranspirationFactorMmPerCMonth: 2, minimumRiverDrainageAreaKm2: 0, riverDensityMultiplier: 1, orbitalPeriodDays: 365.25 })
    expect(h0.annualRunoffMm.every(value => value === 0)).toBe(true)
    expect(h0.riverMask.every(value => value === 0)).toBe(true)
    expect(h0.rivers).toHaveLength(0)
  })

  it('is deterministic and rejects malformed mesh references', () => {
    const { mesh, terrain, climate } = inputs()
    const i0 = generateCryosphereI0(mesh, terrain, climate, DEFAULT_HYDROLOGY_PARAMETERS)
    const parameters = { evapotranspirationFactorMmPerCMonth: 2, minimumRiverDrainageAreaKm2: 0, riverDensityMultiplier: 1, orbitalPeriodDays: 365.25 }
    const first = generateHydrologyH0(mesh, terrain, climate, i0, parameters)
    const second = generateHydrologyH0(mesh, terrain, climate, i0, parameters)
    expect(second.downstreamRegion).toEqual(first.downstreamRegion)
    expect(second.riverMask).toEqual(first.riverMask)
    expect(second.rivers.map(river => river.id)).toEqual(first.rivers.map(river => river.id))
    expect(() => generateHydrologyH0(mesh, { ...terrain, meshId: 'other-mesh' }, climate, i0, parameters)).toThrow('mesh mismatch')
  })
})
