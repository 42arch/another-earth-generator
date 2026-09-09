import { describe, expect, it } from 'vitest'
import { DEFAULT_GLOBE_GEN_PARAMS } from '@/core/spherical/config'
import { SphericalClimateGenerator } from '@/core/spherical/climate/climate-generator'
import { MAX_HYDROLOGY_ITERATIONS, HYDROLOGY_INFLOW_TOLERANCE } from '@/core/spherical/hydrology/coupling-data'
import { SphericalWorldGenerator } from '@/core/spherical/spherical-world-generator'

const defaults = { ...DEFAULT_GLOBE_GEN_PARAMS, subdivision: 3, seed: 42 }

describe('physical hydrology', () => {
  it.each([42, 91, 2501])('reports bounded coupling and stores physical lake volume for seed %i', (seed) => {
    const { mesh, data } = new SphericalWorldGenerator().generate({ ...defaults, seed })
    const diagnostics = data.hydrologyDiagnostics
    expect(diagnostics.iterations).toBeLessThanOrEqual(MAX_HYDROLOGY_ITERATIONS)
    expect(Number.isFinite(diagnostics.maximumRelativeInflowChange)).toBe(true)
    if (diagnostics.converged) {
      expect(diagnostics.maximumRelativeInflowChange).toBeLessThanOrEqual(HYDROLOGY_INFLOW_TOLERANCE)
      expect(diagnostics.changedLakeRegions).toBe(0)
    }
    const volume = new Float64Array(data.lakes.area.length)
    for (let region = 0; region < mesh.numRegions; region++) {
      const lake = data.lakes.regionLakeId[region]
      if (lake < 0) {
        expect(data.hydrologyElevationMeters[region]).toBe(data.physicalElevationMeters[region])
        continue
      }
      expect(data.hydrologyElevationMeters[region]).toBe(data.lakes.surfaceElevation[lake])
      const depth = Math.max(0, data.lakes.surfaceElevation[lake] - data.physicalElevationMeters[region])
      volume[lake] += depth * mesh.regionArea[region] * defaults.physicalRadiusMeters ** 2
    }
    for (let lake = 0; lake < volume.length; lake++) {
      // Water levels are Float32; volume accumulation is Float64.
      expect(Math.abs(volume[lake] - data.lakes.volume[lake]) / Math.max(1, volume[lake])).toBeLessThan(0.001)
    }
  })

  it('responds to evaporation strength without quantile calibration', () => {
    const { mesh, data } = new SphericalWorldGenerator().generate({ ...defaults, lakeDensity: 0 })
    const generator = new SphericalClimateGenerator()
    const generate = (oceanEvaporation: number) => generator.generate(
      mesh, data.physicalElevationMeters, data.climateElevationMeters, data.continentality,
      data.baseLandMask, data.baseLandMask,
      { ...defaults, oceanEvaporation, precipitationCalibration: 0 },
    )
    const average = (rain: Float32Array) => {
      let total = 0
      for (let region = 0; region < mesh.numRegions; region++) {
        if (data.baseLandMask[region])
          total += rain[region] * mesh.regionArea[region]
      }
      return total
    }
    expect(average(generate(0.02).annualPrecipitationMm)).toBeLessThan(average(generate(0.04).annualPrecipitationMm))
    expect(average(generate(0).annualPrecipitationMm)).toBe(0)
  })

  it('does not change physical hydrology when the display elevation is altered', () => {
    const generator = new SphericalWorldGenerator()
    const { mesh, data } = generator.generate(defaults)
    const original = structuredClone({ climate: data.climate, lakes: data.lakes, rivers: data.rivers })
    data.baseElevation.fill(0.3)
    generator.regenerateLakes(mesh, data, defaults)
    expect(data.climate).toEqual(original.climate)
    expect(data.lakes).toEqual(original.lakes)
    expect(data.rivers).toEqual(original.rivers)
  })
})
