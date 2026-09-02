import { describe, expect, it } from 'vitest'
import { GlobeRiverGeometry } from '@/core/rendering/globe/river-geometry'
import { GlobeSurfaceGeometry } from '@/core/rendering/globe/surface-geometry'
import { SphericalGraticuleGeometry } from '@/core/rendering/shared/spherical-graticule-geometry'
import { REGION_FEATURE } from '@/core/spherical/geography/region-feature'
import { PLATE_BOUNDARY } from '@/core/spherical/geology/plate-boundary'
import { cloneGlobeGenParams, DEFAULT_GLOBE_GEN_PARAMS } from '@/core/spherical/config'
import { SphericalBiomeClassifier } from '@/core/spherical/climate/biome-classifier'
import { SphericalGeomorphologyGenerator } from '@/core/spherical/geology/geomorphology-generator'
import { IcosphereBuilder } from '@/core/spherical/mesh/icosphere-builder'
import SphericalMesh from '@/core/spherical/spherical-mesh'
import {
  CLIMATE_MONTH_COUNT,
  CLIMATE_SEASON_COUNT,
  EDGE_SUBDUCTION_POLARITY,
  LAKE_ICE_STATE,
  SPHERICAL_BIOME,
  SPHERICAL_CRUST_TYPE,
  SPHERICAL_ISLAND_TYPE,
} from '@/core/spherical/spherical-world-data'
import { SphericalWorldGenerator } from '@/core/spherical/spherical-world-generator'

describe('spherical world invariants', () => {
  it('builds an elevated latitude-longitude graticule', () => {
    const radius = 100.75
    const geometry = new SphericalGraticuleGeometry().create(radius)
    const positions = geometry.getAttribute('position')

    expect(positions.count).toBeGreaterThan(0)
    expect(positions.count % 2).toBe(0)
    expect(geometry.userData.latitudeLineCount).toBe(11)
    expect(geometry.userData.longitudeLineCount).toBe(24)
    for (let vertex = 0; vertex < positions.count; vertex++) {
      expect(Math.hypot(
        positions.getX(vertex),
        positions.getY(vertex),
        positions.getZ(vertex),
      )).toBeCloseTo(radius, 4)
    }
    geometry.dispose()
  })

  it('classifies climate using enhanced Whittaker regions and terrain modifiers', () => {
    const classifier = new SphericalBiomeClassifier()
    const landMask = new Uint8Array(20).fill(1)
    landMask[0] = 0
    const meanAnnualTemperature = new Float32Array([
      20,
      -15,
      -5,
      -5,
      5,
      2,
      7,
      5,
      10,
      16,
      10,
      10,
      10,
      26,
      26,
      26,
      26,
      26,
      26,
      16,
    ])
    const warmestMonthTemperature = new Float32Array([
      25,
      -1,
      5,
      5,
      12,
      15,
      15,
      18,
      18,
      24,
      18,
      18,
      18,
      32,
      32,
      32,
      32,
      32,
      32,
      22,
    ])
    const coldestMonthTemperature = new Float32Array([
      15,
      -29,
      -15,
      -15,
      -2,
      -11,
      -1,
      -8,
      -5,
      4,
      -5,
      -5,
      -5,
      20,
      20,
      20,
      20,
      20,
      20,
      10,
    ])
    const annualPrecipitationMm = new Float32Array([
      4000,
      1000,
      100,
      400,
      800,
      600,
      900,
      100,
      300,
      600,
      700,
      1200,
      2500,
      400,
      600,
      1000,
      1400,
      1900,
      2500,
      1800,
    ])
    const summerPrecipitationMm = Float32Array.from(
      annualPrecipitationMm,
      precipitation => precipitation / 4,
    )
    const winterPrecipitationMm = new Float32Array(summerPrecipitationMm)
    const driestSeasonPrecipitationMm = new Float32Array(summerPrecipitationMm)
    const wettestSeasonPrecipitationMm = new Float32Array(summerPrecipitationMm)
    summerPrecipitationMm[9] = 60
    winterPrecipitationMm[9] = 300
    driestSeasonPrecipitationMm[9] = 60
    wettestSeasonPrecipitationMm[9] = 300
    const climateElevationMeters = new Float32Array([
      0,
      0,
      0,
      0,
      2800,
      500,
      2000,
      300,
      300,
      300,
      300,
      300,
      300,
      300,
      300,
      300,
      300,
      300,
      300,
      2000,
    ])

    expect([...classifier.classify(
      landMask,
      meanAnnualTemperature,
      warmestMonthTemperature,
      coldestMonthTemperature,
      annualPrecipitationMm,
      summerPrecipitationMm,
      winterPrecipitationMm,
      driestSeasonPrecipitationMm,
      wettestSeasonPrecipitationMm,
      climateElevationMeters,
    )]).toEqual([
      SPHERICAL_BIOME.Ocean,
      SPHERICAL_BIOME.Ice,
      SPHERICAL_BIOME.PolarDesert,
      SPHERICAL_BIOME.Tundra,
      SPHERICAL_BIOME.AlpineTundra,
      SPHERICAL_BIOME.BorealForest,
      SPHERICAL_BIOME.MontaneConiferForest,
      SPHERICAL_BIOME.ColdDesert,
      SPHERICAL_BIOME.TemperateGrassland,
      SPHERICAL_BIOME.MediterraneanShrubland,
      SPHERICAL_BIOME.TemperateWoodland,
      SPHERICAL_BIOME.TemperateSeasonalForest,
      SPHERICAL_BIOME.TemperateRainforest,
      SPHERICAL_BIOME.HotDesert,
      SPHERICAL_BIOME.XericShrubland,
      SPHERICAL_BIOME.TropicalSavanna,
      SPHERICAL_BIOME.TropicalDryForest,
      SPHERICAL_BIOME.TropicalSeasonalForest,
      SPHERICAL_BIOME.TropicalRainforest,
      SPHERICAL_BIOME.MontaneCloudForest,
    ])
  })

  it('builds a closed, irregular and area-preserving spherical mesh', () => {
    const mesh = new IcosphereBuilder().build(2, 42)
    const repeated = new IcosphereBuilder().build(2, 42)
    const alternate = new IcosphereBuilder().build(2, 43)
    expect(mesh.numRegions).toBe(162)
    expect(mesh.numTriangles).toBe(320)
    expect(mesh.regionPosition).toEqual(repeated.regionPosition)
    expect(mesh.triangles).toEqual(repeated.triangles)
    expect(mesh.regionPosition).not.toEqual(alternate.regionPosition)

    let area = 0
    const degrees = new Set<number>()
    for (let region = 0; region < mesh.numRegions; region++) {
      const index = region * 3
      expect(Math.hypot(
        mesh.regionPosition[index],
        mesh.regionPosition[index + 1],
        mesh.regionPosition[index + 2],
      )).toBeCloseTo(1, 5)
      const degree = mesh.neighborOffsets[region + 1] - mesh.neighborOffsets[region]
      expect(degree).toBeGreaterThanOrEqual(3)
      degrees.add(degree)
      area += mesh.regionArea[region]
    }
    expect(degrees.size).toBeGreaterThan(2)
    expect(area).toBeCloseTo(4 * Math.PI, 4)

    const edgeUse = new Map<string, number>()
    for (let index = 0; index < mesh.triangles.length; index += 3) {
      const triangle = [mesh.triangles[index], mesh.triangles[index + 1], mesh.triangles[index + 2]]
      for (let edge = 0; edge < 3; edge++) {
        const a = triangle[edge]
        const b = triangle[(edge + 1) % 3]
        const key = `${Math.min(a, b)}:${Math.max(a, b)}`
        edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1)
      }
    }
    expect([...edgeUse.values()].every(count => count === 2)).toBe(true)
    expect(mesh.numRegions - edgeUse.size + mesh.numTriangles).toBe(2)
  })

  it('conserves area-weighted terrain volume during geomorphic evolution', () => {
    const mesh = new SphericalMesh(new IcosphereBuilder().build(2, 29))
    const rawElevation = new Float64Array(mesh.numRegions)
    const landMask = new Uint8Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      const index = region * 3
      rawElevation[region] = mesh.regionPosition[index] * 1350
        + mesh.regionPosition[index + 1] * 480
        + mesh.regionPosition[index + 2] ** 2 * 720
        - 180
      landMask[region] = rawElevation[region] >= 0 ? 1 : 0
    }
    const original = new Float64Array(rawElevation)
    const evolved = new SphericalGeomorphologyGenerator().evolve(
      mesh,
      rawElevation,
      landMask,
    )
    let originalVolume = 0
    let evolvedVolume = 0
    for (let region = 0; region < mesh.numRegions; region++) {
      originalVolume += original[region] * mesh.regionArea[region]
      evolvedVolume += evolved[region] * mesh.regionArea[region]
    }

    expect(rawElevation).toEqual(original)
    expect(evolved).not.toEqual(original)
    expect([...evolved].every(Number.isFinite)).toBe(true)
    expect(evolvedVolume).toBeCloseTo(originalVolume, 8)
  })

  it('generates deterministic spherical geography with finite elevations', () => {
    const params = cloneGlobeGenParams(DEFAULT_GLOBE_GEN_PARAMS)
    params.seed = 42
    params.subdivision = 3
    params.plateCount = 10
    params.continentCount = 4
    params.islandCount = 8
    const generator = new SphericalWorldGenerator()
    const first = generator.generate(params)
    const second = generator.generate(params)

    expect(first.mesh.triangles).toEqual(second.mesh.triangles)
    expect(first.data.tectonics.regionPlate).toEqual(second.data.tectonics.regionPlate)
    expect(first.data.tectonics.plateContinentalFraction)
      .toEqual(second.data.tectonics.plateContinentalFraction)
    expect(first.data.tectonics.edgeBoundarySegment)
      .toEqual(second.data.tectonics.edgeBoundarySegment)
    expect(first.data.tectonics.edgeBoundaryActivity)
      .toEqual(second.data.tectonics.edgeBoundaryActivity)
    expect(first.data.tectonics.edgeSubductionPolarity)
      .toEqual(second.data.tectonics.edgeSubductionPolarity)
    expect(first.data.tectonics.regionCrustType)
      .toEqual(second.data.tectonics.regionCrustType)
    expect(first.data.tectonics.regionCrustAge)
      .toEqual(second.data.tectonics.regionCrustAge)
    expect(first.data.tectonics.regionCrustThicknessKm)
      .toEqual(second.data.tectonics.regionCrustThicknessKm)
    expect(first.data.baseLandMask).toEqual(second.data.baseLandMask)
    expect(first.data.landMask).toEqual(second.data.landMask)
    expect(first.data.baseElevation).toEqual(second.data.baseElevation)
    expect(first.data.elevation).toEqual(second.data.elevation)
    expect(first.data.physicalElevationMeters).toEqual(second.data.physicalElevationMeters)
    expect(first.data.climateElevationMeters).toEqual(second.data.climateElevationMeters)
    expect(first.data.continentality).toEqual(second.data.continentality)
    expect(first.data.lakes.lakeMask).toEqual(second.data.lakes.lakeMask)
    expect(first.data.lakes.regionLakeId).toEqual(second.data.lakes.regionLakeId)
    expect(first.data.lakes.surfaceElevation).toEqual(second.data.lakes.surfaceElevation)
    expect(first.data.lakes.area).toEqual(second.data.lakes.area)
    expect(first.data.lakes.inflow).toEqual(second.data.lakes.inflow)
    expect(first.data.lakes.seasonalInflow).toEqual(second.data.lakes.seasonalInflow)
    expect(first.data.lakes.evaporation).toEqual(second.data.lakes.evaporation)
    expect(first.data.lakes.seasonalEvaporation).toEqual(second.data.lakes.seasonalEvaporation)
    expect(first.data.lakes.fillRatio).toEqual(second.data.lakes.fillRatio)
    expect(first.data.lakes.seasonalFillRatio).toEqual(second.data.lakes.seasonalFillRatio)
    expect(first.data.lakes.salinity).toEqual(second.data.lakes.salinity)
    expect(first.data.lakes.isEndorheic).toEqual(second.data.lakes.isEndorheic)
    expect(first.data.lakes.isSeasonal).toEqual(second.data.lakes.isSeasonal)
    expect(first.data.lakes.iceState).toEqual(second.data.lakes.iceState)
    expect(first.data.climate.temperature).toEqual(second.data.climate.temperature)
    expect(first.data.climate.monthlyTemperature).toEqual(second.data.climate.monthlyTemperature)
    expect(first.data.climate.warmestMonthTemperature).toEqual(second.data.climate.warmestMonthTemperature)
    expect(first.data.climate.coldestMonthTemperature).toEqual(second.data.climate.coldestMonthTemperature)
    expect(first.data.climate.moisture).toEqual(second.data.climate.moisture)
    expect(first.data.climate.precipitation).toEqual(second.data.climate.precipitation)
    expect(first.data.climate.annualPrecipitationMm).toEqual(second.data.climate.annualPrecipitationMm)
    expect(first.data.climate.seasonalPrecipitationMm).toEqual(second.data.climate.seasonalPrecipitationMm)
    expect(first.data.climate.summerPrecipitationMm).toEqual(second.data.climate.summerPrecipitationMm)
    expect(first.data.climate.winterPrecipitationMm).toEqual(second.data.climate.winterPrecipitationMm)
    expect(first.data.climate.driestSeasonPrecipitationMm).toEqual(second.data.climate.driestSeasonPrecipitationMm)
    expect(first.data.climate.wettestSeasonPrecipitationMm).toEqual(second.data.climate.wettestSeasonPrecipitationMm)
    expect(first.data.climate.precipitationSeasonality).toEqual(second.data.climate.precipitationSeasonality)
    expect(first.data.climate.evapotranspiration).toEqual(second.data.climate.evapotranspiration)
    expect(first.data.climate.runoff).toEqual(second.data.climate.runoff)
    expect(first.data.climate.seasonalRunoff).toEqual(second.data.climate.seasonalRunoff)
    expect(first.data.climate.wind).toEqual(second.data.climate.wind)
    expect(first.data.climate.seasonalWind).toEqual(second.data.climate.seasonalWind)
    expect(first.data.climate.oceanCurrent).toEqual(second.data.climate.oceanCurrent)
    expect(first.data.climate.oceanCurrentSpeed).toEqual(second.data.climate.oceanCurrentSpeed)
    expect(first.data.climate.seaSurfaceTemperature).toEqual(second.data.climate.seaSurfaceTemperature)
    expect(first.data.climate.seaSurfaceTemperatureAnomaly).toEqual(second.data.climate.seaSurfaceTemperatureAnomaly)
    expect(first.data.climate.biome).toEqual(second.data.climate.biome)
    expect(first.data.rivers.downstreamRegion).toEqual(second.data.rivers.downstreamRegion)
    expect(first.data.rivers.flowAccumulation).toEqual(second.data.rivers.flowAccumulation)
    expect(first.data.rivers.seasonalFlowAccumulation).toEqual(second.data.rivers.seasonalFlowAccumulation)
    expect(first.data.rivers.seasonalRiverMask).toEqual(second.data.rivers.seasonalRiverMask)
    expect(first.data.rivers.riverSeasonality).toEqual(second.data.rivers.riverSeasonality)
    expect(first.data.rivers.seasonalTotalRunoff).toEqual(second.data.rivers.seasonalTotalRunoff)
    expect(first.data.rivers.segmentSource).toEqual(second.data.rivers.segmentSource)
    expect([...first.data.tectonics.regionPlate].every(plate => plate >= 0 && plate < params.plateCount)).toBe(true)
    expect([...first.data.elevation].every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true)
    expect([...first.data.physicalElevationMeters].every(Number.isFinite)).toBe(true)
    expect(Number.isFinite(first.data.seaLevelMeters)).toBe(true)
    expect([...first.data.climateElevationMeters].every(value => Number.isFinite(value) && value >= 0 && value <= 6000)).toBe(true)
    expect([...first.data.continentality].every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true)
    expect([...first.data.climate.temperature].every(Number.isFinite)).toBe(true)
    expect(first.data.climate.monthlyTemperature.length).toBe(first.mesh.numRegions * CLIMATE_MONTH_COUNT)
    expect([...first.data.climate.monthlyTemperature].every(Number.isFinite)).toBe(true)
    expect([...first.data.climate.warmestMonthTemperature].every(Number.isFinite)).toBe(true)
    expect([...first.data.climate.coldestMonthTemperature].every(Number.isFinite)).toBe(true)
    expect([...first.data.climate.moisture].every(value => Number.isFinite(value) && value >= 0)).toBe(true)
    expect([...first.data.climate.precipitation].every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true)
    expect([...first.data.climate.annualPrecipitationMm].every(value => Number.isFinite(value) && value >= 0 && value <= 4000)).toBe(true)
    expect(first.data.climate.seasonalPrecipitationMm.length).toBe(first.mesh.numRegions * CLIMATE_SEASON_COUNT)
    expect([...first.data.climate.seasonalPrecipitationMm].every(value => Number.isFinite(value) && value >= 0 && value <= 4000)).toBe(true)
    expect([...first.data.climate.precipitationSeasonality].every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true)
    expect([...first.data.climate.evapotranspiration].every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true)
    expect([...first.data.climate.runoff].every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true)
    expect(first.data.climate.seasonalRunoff.length).toBe(first.mesh.numRegions * CLIMATE_SEASON_COUNT)
    expect(first.data.climate.seasonalWind.length).toBe(first.mesh.numRegions * CLIMATE_SEASON_COUNT * 3)
    expect(first.data.climate.oceanCurrent.length).toBe(first.mesh.numRegions * 3)
    expect(first.data.climate.oceanCurrentSpeed.length).toBe(first.mesh.numRegions)
    expect(first.data.climate.seaSurfaceTemperature.length).toBe(first.mesh.numRegions)
    expect(first.data.climate.seaSurfaceTemperatureAnomaly.length).toBe(first.mesh.numRegions)
    expect([...first.data.climate.biome].every(value => value >= SPHERICAL_BIOME.Ocean && value <= SPHERICAL_BIOME.MontaneCloudForest)).toBe(true)

    let wetLandRegions = 0
    let selectedLakeArea = 0
    let movingOceanRegions = 0
    for (let region = 0; region < first.mesh.numRegions; region++) {
      const index = region * 3
      const windX = first.data.climate.wind[index]
      const windY = first.data.climate.wind[index + 1]
      const windZ = first.data.climate.wind[index + 2]
      const windLength = Math.hypot(windX, windY, windZ)
      const radialWind = first.mesh.regionPosition[index] * windX
        + first.mesh.regionPosition[index + 1] * windY
        + first.mesh.regionPosition[index + 2] * windZ
      expect(windLength).toBeCloseTo(1, 5)
      expect(Math.abs(radialWind)).toBeLessThan(1e-5)
      const currentX = first.data.climate.oceanCurrent[index]
      const currentY = first.data.climate.oceanCurrent[index + 1]
      const currentZ = first.data.climate.oceanCurrent[index + 2]
      const currentSpeed = Math.hypot(currentX, currentY, currentZ)
      const radialCurrent = first.mesh.regionPosition[index] * currentX
        + first.mesh.regionPosition[index + 1] * currentY
        + first.mesh.regionPosition[index + 2] * currentZ
      expect(currentSpeed).toBeCloseTo(
        first.data.climate.oceanCurrentSpeed[region],
        6,
      )
      expect(Math.abs(radialCurrent)).toBeLessThan(1e-5)
      if (first.data.baseLandMask[region] === 0) {
        expect(first.data.climate.seaSurfaceTemperature[region])
          .toBeGreaterThanOrEqual(-1.8)
        expect(first.data.climate.seaSurfaceTemperature[region])
          .toBeLessThanOrEqual(32)
        expect(Math.abs(first.data.climate.seaSurfaceTemperatureAnomaly[region]))
          .toBeLessThanOrEqual(8)
        if (currentSpeed > Number.EPSILON)
          movingOceanRegions++
      }
      else {
        expect(currentSpeed).toBe(0)
        expect(first.data.climate.seaSurfaceTemperature[region]).toBe(0)
        expect(first.data.climate.seaSurfaceTemperatureAnomaly[region]).toBe(0)
      }
      expect(first.data.climate.warmestMonthTemperature[region])
        .toBeGreaterThanOrEqual(first.data.climate.temperature[region])
      expect(first.data.climate.coldestMonthTemperature[region])
        .toBeLessThanOrEqual(first.data.climate.temperature[region])
      let seasonalPrecipitation = 0
      for (let season = 0; season < CLIMATE_SEASON_COUNT; season++) {
        seasonalPrecipitation += first.data.climate.seasonalPrecipitationMm[
          season * first.mesh.numRegions + region
        ]
      }
      expect(seasonalPrecipitation).toBeCloseTo(
        first.data.climate.annualPrecipitationMm[region],
        3,
      )
      if (
        first.data.landMask[region] !== 0
        && first.data.climate.precipitation[region] > 0
      ) {
        wetLandRegions++
      }
      if (first.data.landMask[region] === 0) {
        if (first.data.baseLandMask[region] === 0)
          expect(first.data.climate.biome[region]).toBe(SPHERICAL_BIOME.Ocean)
        expect(first.data.climate.evapotranspiration[region]).toBe(0)
        expect(first.data.climate.runoff[region]).toBe(0)
      }
      else {
        expect(
          first.data.climate.evapotranspiration[region]
          + first.data.climate.runoff[region],
        ).toBeLessThanOrEqual(first.data.climate.precipitation[region] + 1e-6)
      }
      if (first.data.lakes.lakeMask[region] !== 0) {
        const lakeId = first.data.lakes.regionLakeId[region]
        expect(first.data.baseLandMask[region]).toBe(1)
        expect(first.data.landMask[region]).toBe(0)
        expect(first.data.regionFeature[region]).toBe(REGION_FEATURE.Lake)
        expect(lakeId).toBeGreaterThanOrEqual(0)
        expect(lakeId).toBeLessThan(first.data.lakes.area.length)
        expect(first.data.elevation[region]).toBeCloseTo(
          first.data.lakes.surfaceElevation[lakeId],
          6,
        )
        selectedLakeArea += first.mesh.regionArea[region]
      }
    }
    expect(wetLandRegions).toBeGreaterThan(0)
    expect(movingOceanRegions).toBeGreaterThan(0)

    const lakeCount = first.data.lakes.area.length
    expect(first.data.lakes.inflow.length).toBe(lakeCount)
    expect(first.data.lakes.seasonalInflow.length).toBe(
      lakeCount * CLIMATE_SEASON_COUNT,
    )
    expect(first.data.lakes.evaporation.length).toBe(lakeCount)
    expect(first.data.lakes.seasonalEvaporation.length).toBe(
      lakeCount * CLIMATE_SEASON_COUNT,
    )
    expect(first.data.lakes.fillRatio.length).toBe(lakeCount)
    expect(first.data.lakes.seasonalFillRatio.length).toBe(
      lakeCount * CLIMATE_SEASON_COUNT,
    )
    expect(first.data.lakes.salinity.length).toBe(lakeCount)
    expect(first.data.lakes.isEndorheic.length).toBe(lakeCount)
    expect(first.data.lakes.isSeasonal.length).toBe(lakeCount)
    expect(first.data.lakes.iceState.length).toBe(lakeCount)
    for (let lake = 0; lake < lakeCount; lake++) {
      expect(first.data.lakes.area[lake]).toBeGreaterThan(0)
      expect(first.data.lakes.volume[lake]).toBeGreaterThanOrEqual(0)
      expect(first.data.lakes.inflow[lake]).toBeGreaterThanOrEqual(0)
      expect(first.data.lakes.evaporation[lake]).toBeGreaterThanOrEqual(0)
      expect(first.data.lakes.fillRatio[lake]).toBeGreaterThanOrEqual(params.lakeMinFillRatio)
      expect(first.data.lakes.fillRatio[lake]).toBeLessThanOrEqual(1)
      expect(first.data.lakes.salinity[lake]).toBeGreaterThanOrEqual(0)
      expect(first.data.lakes.salinity[lake]).toBeLessThanOrEqual(1)
      expect(first.data.lakes.iceState[lake]).toBeGreaterThanOrEqual(
        LAKE_ICE_STATE.OpenWater,
      )
      expect(first.data.lakes.iceState[lake]).toBeLessThanOrEqual(
        LAKE_ICE_STATE.Subglacial,
      )
      let seasonalInflow = 0
      let seasonalEvaporation = 0
      let minimumSeasonalFill = 1
      for (let season = 0; season < CLIMATE_SEASON_COUNT; season++) {
        const index = season * lakeCount + lake
        seasonalInflow += first.data.lakes.seasonalInflow[index]
        seasonalEvaporation += first.data.lakes.seasonalEvaporation[index]
        minimumSeasonalFill = Math.min(
          minimumSeasonalFill,
          first.data.lakes.seasonalFillRatio[index],
        )
        expect(first.data.lakes.seasonalFillRatio[index]).toBeGreaterThanOrEqual(0)
        expect(first.data.lakes.seasonalFillRatio[index]).toBeLessThanOrEqual(1)
      }
      expect(seasonalInflow).toBeCloseTo(first.data.lakes.inflow[lake], 5)
      expect(seasonalEvaporation).toBeCloseTo(
        first.data.lakes.evaporation[lake],
        5,
      )
      if (first.data.lakes.isSeasonal[lake] !== 0) {
        expect(first.data.lakes.isEndorheic[lake]).toBe(1)
        expect(minimumSeasonalFill).toBeLessThan(0.35)
      }
      if (first.data.lakes.iceState[lake] === LAKE_ICE_STATE.Subglacial) {
        expect(first.data.lakes.evaporation[lake]).toBe(0)
        expect(first.data.lakes.isEndorheic[lake]).toBe(1)
      }
      if (first.data.lakes.isEndorheic[lake] === 0) {
        expect(first.data.lakes.outletRegion[lake]).toBeGreaterThanOrEqual(0)
        expect(first.data.lakes.outletTarget[lake]).toBeGreaterThanOrEqual(0)
        expect(first.data.lakes.fillRatio[lake]).toBe(1)
        expect(first.data.lakes.salinity[lake]).toBe(0)
      }
      else {
        expect(first.data.lakes.outletRegion[lake]).toBe(-1)
        expect(first.data.lakes.outletTarget[lake]).toBe(-1)
      }
    }

    let baseLandArea = 0
    for (let region = 0; region < first.mesh.numRegions; region++) {
      if (first.data.baseLandMask[region] !== 0)
        baseLandArea += first.mesh.regionArea[region]
    }
    expect(selectedLakeArea).toBeLessThanOrEqual(
      baseLandArea * params.lakeMaxLandCoverage + 1e-6,
    )
    expect(first.data.landArea).toBeCloseTo(baseLandArea - selectedLakeArea, 6)

    let totalArea = 0
    for (const area of first.mesh.regionArea)
      totalArea += area
    expect(first.data.landArea / totalArea).toBeCloseTo(params.landCoverage, 1)

    const edgeCount = first.mesh.voronoi.edgeRegions.length / 2
    expect(first.data.tectonics.edgeBoundaryType.length).toBe(edgeCount)
    expect(first.data.tectonics.edgeBoundarySegment.length).toBe(edgeCount)
    expect(first.data.tectonics.edgeBoundaryActivity.length).toBe(edgeCount)
    expect(first.data.tectonics.edgeNormalVelocity.length).toBe(edgeCount)
    expect(first.data.tectonics.edgeShearVelocity.length).toBe(edgeCount)
    expect(first.data.tectonics.edgeStress.length).toBe(edgeCount)
    expect(first.data.tectonics.edgeSubductionPolarity.length).toBe(edgeCount)
    expect(first.data.tectonics.regionCrustType.length).toBe(first.mesh.numRegions)
    expect(first.data.tectonics.regionCrustAge.length).toBe(first.mesh.numRegions)
    expect(first.data.tectonics.regionCrustThicknessKm.length).toBe(first.mesh.numRegions)
    expect(first.data.tectonics.plateContinentalFraction.length).toBe(params.plateCount)
    expect([...first.data.tectonics.plateContinentalFraction].every(
      value => Number.isFinite(value) && value >= 0 && value <= 1,
    )).toBe(true)
    for (let edge = 0; edge < edgeCount; edge++) {
      const index = edge * 2
      const regionA = first.mesh.voronoi.edgeRegions[index]
      const regionB = first.mesh.voronoi.edgeRegions[index + 1]
      const samePlate = first.data.tectonics.regionPlate[regionA]
        === first.data.tectonics.regionPlate[regionB]
      if (samePlate) {
        expect(first.data.tectonics.edgeBoundaryType[edge]).toBe(PLATE_BOUNDARY.None)
        expect(first.data.tectonics.edgeBoundarySegment[edge]).toBe(-1)
        expect(first.data.tectonics.edgeBoundaryActivity[edge]).toBe(0)
        expect(first.data.tectonics.edgeStress[edge]).toBe(0)
        expect(first.data.tectonics.edgeSubductionPolarity[edge])
          .toBe(EDGE_SUBDUCTION_POLARITY.None)
      }
      else {
        expect(first.data.tectonics.edgeBoundaryType[edge]).not.toBe(PLATE_BOUNDARY.None)
        expect(first.data.tectonics.edgeBoundarySegment[edge]).toBeGreaterThanOrEqual(0)
        expect(first.data.tectonics.edgeBoundaryActivity[edge]).toBeGreaterThan(0)
        expect(first.data.tectonics.edgeBoundaryActivity[edge]).toBeLessThanOrEqual(1)
        expect(first.data.tectonics.edgeStress[edge]).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(first.data.tectonics.edgeNormalVelocity[edge])).toBe(true)
        expect(Number.isFinite(first.data.tectonics.edgeShearVelocity[edge])).toBe(true)
      }
      const polarity = first.data.tectonics.edgeSubductionPolarity[edge]
      expect([
        EDGE_SUBDUCTION_POLARITY.RegionAUnderB,
        EDGE_SUBDUCTION_POLARITY.None,
        EDGE_SUBDUCTION_POLARITY.RegionBUnderA,
      ]).toContain(polarity)
      if (first.data.tectonics.edgeBoundaryType[edge] !== PLATE_BOUNDARY.Convergent)
        expect(polarity).toBe(EDGE_SUBDUCTION_POLARITY.None)
      if (polarity === EDGE_SUBDUCTION_POLARITY.RegionAUnderB) {
        expect(first.data.tectonics.regionCrustType[regionA])
          .toBe(SPHERICAL_CRUST_TYPE.Oceanic)
      }
      if (polarity === EDGE_SUBDUCTION_POLARITY.RegionBUnderA) {
        expect(first.data.tectonics.regionCrustType[regionB])
          .toBe(SPHERICAL_CRUST_TYPE.Oceanic)
      }
    }

    for (let plate = 0; plate < params.plateCount; plate++) {
      const index = plate * 3
      const cx = first.data.tectonics.plateCentroid[index]
      const cy = first.data.tectonics.plateCentroid[index + 1]
      const cz = first.data.tectonics.plateCentroid[index + 2]
      const wx = first.data.tectonics.plateAngularVelocity[index]
      const wy = first.data.tectonics.plateAngularVelocity[index + 1]
      const wz = first.data.tectonics.plateAngularVelocity[index + 2]
      const vx = wy * cz - wz * cy
      const vy = wz * cx - wx * cz
      const vz = wx * cy - wy * cx
      const dot = cx * vx + cy * vy + cz * vz
      expect(Math.abs(dot)).toBeLessThan(1e-5)
      expect(Math.hypot(vx, vy, vz)).toBeGreaterThan(0)
    }

    for (let region = 0; region < first.mesh.numRegions; region++) {
      expect([
        SPHERICAL_CRUST_TYPE.Oceanic,
        SPHERICAL_CRUST_TYPE.Continental,
      ]).toContain(first.data.tectonics.regionCrustType[region])
      expect(first.data.tectonics.regionCrustAge[region]).toBeGreaterThanOrEqual(0)
      expect(first.data.tectonics.regionCrustAge[region]).toBeLessThanOrEqual(1)
      expect(first.data.tectonics.regionCrustThicknessKm[region]).toBeGreaterThan(0)
      if (
        first.data.regionIslandType[region]
        === SPHERICAL_ISLAND_TYPE.ContinentalFragment
      ) {
        expect(first.data.tectonics.regionCrustType[region])
          .toBe(SPHERICAL_CRUST_TYPE.Continental)
      }
      if (first.data.baseLandMask[region] !== 0) {
        expect(first.data.physicalElevationMeters[region]).toBeGreaterThanOrEqual(0)
        expect(first.data.baseElevation[region]).toBeGreaterThanOrEqual(0.2)
      }
      else {
        expect(first.data.physicalElevationMeters[region]).toBeLessThan(0)
        expect(first.data.baseElevation[region]).toBeLessThan(0.2)
      }
    }
  })

  it('routes climate runoff to water and creates an acyclic river network', () => {
    const params = cloneGlobeGenParams(DEFAULT_GLOBE_GEN_PARAMS)
    params.seed = 42
    params.subdivision = 3
    params.riverBasinThreshold = 0.003
    params.riverMinSourceElevation = 0.22
    params.riverMinLength = 2
    const world = new SphericalWorldGenerator().generate(params)
    const { mesh, data } = world
    const rivers = data.rivers

    expect(rivers.sourceRegions.length).toBeGreaterThan(0)
    expect(rivers.segmentSource.length).toBeGreaterThan(0)
    expect(rivers.segmentSource.length).toBe(rivers.segmentTarget.length)
    expect([...rivers.drainageElevation].every(Number.isFinite)).toBe(true)
    expect([...rivers.flowAccumulation].every(value => Number.isFinite(value) && value >= 0)).toBe(true)
    expect(rivers.seasonalFlowAccumulation.length).toBe(
      mesh.numRegions * CLIMATE_SEASON_COUNT,
    )
    expect(rivers.seasonalTotalRunoff.length).toBe(CLIMATE_SEASON_COUNT)
    expect([...rivers.riverSeasonality].every(
      value => Number.isFinite(value) && value >= 0 && value <= 1,
    )).toBe(true)

    let terminalFlow = 0
    let expectedTotalRunoff = 0
    for (let region = 0; region < mesh.numRegions; region++) {
      if (data.landMask[region] === 0) {
        if (rivers.downstreamRegion[region] < 0)
          terminalFlow += rivers.flowAccumulation[region]
        continue
      }
      expectedTotalRunoff += mesh.regionArea[region] * data.climate.runoff[region]
      const downstream = rivers.downstreamRegion[region]
      expect(downstream).toBeGreaterThanOrEqual(0)
      expect([...mesh.forEachNeighborOfRegion(region)]).toContain(downstream)
      expect(rivers.drainageElevation[downstream]).toBeLessThan(rivers.drainageElevation[region])
      const downstreamSlope = (
        rivers.drainageElevation[region] - rivers.drainageElevation[downstream]
      ) / mesh.distanceBetweenRegions(region, downstream)
      let steepestSlope = 0
      for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
        const drop = rivers.drainageElevation[region] - rivers.drainageElevation[neighbor]
        if (drop <= 0)
          continue
        steepestSlope = Math.max(
          steepestSlope,
          drop / mesh.distanceBetweenRegions(region, neighbor),
        )
      }
      expect(downstreamSlope).toBeCloseTo(steepestSlope, 6)

      let current = region
      for (let guard = 0; guard <= mesh.numRegions; guard++) {
        if (data.landMask[current] === 0)
          break
        current = rivers.downstreamRegion[current]
        expect(current).toBeGreaterThanOrEqual(0)
        if (guard === mesh.numRegions)
          throw new Error(`Drainage cycle detected from region ${region}`)
      }
    }
    expect(rivers.totalRunoff).toBeCloseTo(expectedTotalRunoff, 6)
    expect([...rivers.seasonalTotalRunoff].reduce((sum, value) => sum + value, 0))
      .toBeCloseTo(rivers.totalRunoff, 5)
    expect(rivers.thresholdFlow).toBeCloseTo(
      rivers.totalRunoff * params.riverBasinThreshold,
      8,
    )
    expect(terminalFlow).toBeCloseTo(rivers.totalRunoff, 4)

    for (let segment = 0; segment < rivers.segmentSource.length; segment++) {
      const source = rivers.segmentSource[segment]
      expect(data.landMask[source]).toBe(1)
      expect(rivers.riverMask[source]).toBe(1)
      expect(rivers.segmentTarget[segment]).toBe(rivers.downstreamRegion[source])
      let seasonalFlow = 0
      for (let season = 0; season < CLIMATE_SEASON_COUNT; season++) {
        seasonalFlow += rivers.seasonalFlowAccumulation[
          season * mesh.numRegions + source
        ]
      }
      expect(seasonalFlow).toBeCloseTo(rivers.flowAccumulation[source], 5)
      if (rivers.seasonalRiverMask[source] !== 0)
        expect(rivers.riverSeasonality[source]).toBeGreaterThan(0.75)
    }

    for (const source of rivers.sourceRegions) {
      const isLakeOutflow = [...mesh.forEachNeighborOfRegion(source)].some((neighbor) => {
        const lakeId = data.lakes.regionLakeId[neighbor]
        return lakeId >= 0
          && data.lakes.isEndorheic[lakeId] === 0
          && rivers.downstreamRegion[neighbor] === source
      })
      expect(
        data.elevation[source] >= params.riverMinSourceElevation || isLakeOutflow,
      ).toBe(true)
      let pathLength = 0
      let current = source
      for (let guard = 0; guard < mesh.numRegions; guard++) {
        if (data.landMask[current] === 0)
          break
        const downstream = rivers.downstreamRegion[current]
        if (downstream < 0)
          break
        pathLength++
        if (data.landMask[downstream] === 0)
          break
        current = downstream
      }
      expect(pathLength).toBeGreaterThanOrEqual(params.riverMinLength)
    }

    const radius = params.planetRadius + 0.26
    const geometry = new GlobeRiverGeometry().create(mesh, rivers, data.landMask, radius)
    const positions = geometry.getAttribute('position')
    const normals = geometry.getAttribute('normal')
    expect(positions.count).toBeGreaterThan(0)
    expect(normals.count).toBe(positions.count)
    expect(geometry.userData.riverPathCount).toBeGreaterThan(0)

    const incomingRiverCount = new Uint16Array(mesh.numRegions)
    for (let segment = 0; segment < rivers.segmentSource.length; segment++) {
      const target = rivers.segmentTarget[segment]
      if (data.landMask[target] !== 0)
        incomingRiverCount[target]++
    }
    const confluenceRegions = [...incomingRiverCount.keys()]
      .filter(region => incomingRiverCount[region] >= 2)
    expect(confluenceRegions.length).toBeGreaterThan(0)
    expect(geometry.userData.riverJunctionCount).toBe(confluenceRegions.length)

    for (let vertex = 0; vertex < positions.count; vertex++) {
      expect(Math.hypot(
        positions.getX(vertex),
        positions.getY(vertex),
        positions.getZ(vertex),
      )).toBeCloseTo(radius, 3)
    }

    for (let vertex = 0; vertex < positions.count; vertex += 3) {
      const ax = positions.getX(vertex)
      const ay = positions.getY(vertex)
      const az = positions.getZ(vertex)
      const bx = positions.getX(vertex + 1)
      const by = positions.getY(vertex + 1)
      const bz = positions.getZ(vertex + 1)
      const cx = positions.getX(vertex + 2)
      const cy = positions.getY(vertex + 2)
      const cz = positions.getZ(vertex + 2)
      const normalX = (by - ay) * (cz - az) - (bz - az) * (cy - ay)
      const normalY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
      const normalZ = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
      expect(normalX * (ax + bx + cx) + normalY * (ay + by + cy) + normalZ * (az + bz + cz))
        .toBeGreaterThan(0)
    }

    for (const region of confluenceRegions) {
      const index = region * 3
      const centerX = mesh.regionPosition[index] * radius
      const centerY = mesh.regionPosition[index + 1] * radius
      const centerZ = mesh.regionPosition[index + 2] * radius
      let hasJunctionCenter = false
      for (let vertex = 0; vertex < positions.count; vertex++) {
        if (Math.hypot(
          positions.getX(vertex) - centerX,
          positions.getY(vertex) - centerY,
          positions.getZ(vertex) - centerZ,
        ) < 1e-3) {
          hasJunctionCenter = true
          break
        }
      }
      expect(hasJunctionCenter).toBe(true)
    }

    const fullyHiddenMask = new Uint8Array(mesh.numRegions).fill(1)
    const hiddenGeometry = new GlobeRiverGeometry().create(
      mesh,
      rivers,
      data.landMask,
      radius,
      fullyHiddenMask,
    )
    expect(hiddenGeometry.getAttribute('position').count).toBe(0)
    expect(hiddenGeometry.userData.riverPathCount).toBe(0)
    expect(hiddenGeometry.userData.riverJunctionCount).toBe(0)
    hiddenGeometry.dispose()
    geometry.dispose()
  })

  it('rebuilds river flow when climate water-balance parameters change', () => {
    const params = cloneGlobeGenParams(DEFAULT_GLOBE_GEN_PARAMS)
    params.seed = 91
    params.subdivision = 2
    const generator = new SphericalWorldGenerator()
    const world = generator.generate(params)
    const initialRunoff = new Float32Array(world.data.climate.runoff)
    const initialFlow = new Float32Array(world.data.rivers.flowAccumulation)
    const initialTotalRunoff = world.data.rivers.totalRunoff

    params.infiltration = 0.45
    generator.regenerateClimate(world.mesh, world.data, params)

    expect(world.data.climate.runoff).not.toEqual(initialRunoff)
    expect(world.data.rivers.flowAccumulation).not.toEqual(initialFlow)
    expect(world.data.rivers.totalRunoff).toBeLessThan(initialTotalRunoff)
  })

  it('disables ocean heat anomalies and currents through climate controls', () => {
    const params = cloneGlobeGenParams(DEFAULT_GLOBE_GEN_PARAMS)
    params.seed = 73
    params.subdivision = 2
    const generator = new SphericalWorldGenerator()
    const world = generator.generate(params)
    expect([...world.data.climate.seaSurfaceTemperatureAnomaly].some(
      value => Math.abs(value) > 1e-4,
    )).toBe(true)

    params.oceanHeatTransport = 0
    params.oceanCurrentStrength = 0
    generator.regenerateClimate(world.mesh, world.data, params)

    expect([...world.data.climate.seaSurfaceTemperatureAnomaly].every(
      value => Math.abs(value) <= 1e-6,
    )).toBe(true)
    expect([...world.data.climate.oceanCurrentSpeed].every(value => value === 0))
      .toBe(true)
  })

  it('restores the base terrain when topographic lakes are disabled', () => {
    const params = cloneGlobeGenParams(DEFAULT_GLOBE_GEN_PARAMS)
    params.seed = 42
    params.subdivision = 2
    const generator = new SphericalWorldGenerator()
    const world = generator.generate(params)

    params.lakeDensity = 0
    generator.regenerateLakes(world.mesh, world.data, params)

    expect(world.data.lakes.area.length).toBe(0)
    expect(world.data.landMask).toEqual(world.data.baseLandMask)
    expect(world.data.elevation).toEqual(world.data.baseElevation)
  })

  it('builds a closed spherical Voronoi dual from the irregular Delaunay topology', () => {
    const params = cloneGlobeGenParams(DEFAULT_GLOBE_GEN_PARAMS)
    params.subdivision = 2
    const { mesh } = new SphericalWorldGenerator().generate(params)
    const voronoi = mesh.voronoi

    expect(voronoi.cornerPosition.length).toBe(mesh.numTriangles * 3)
    expect(voronoi.cellCorners.length).toBe(mesh.numTriangles * 3)
    expect(voronoi.edgeRegions.length / 2).toBe(mesh.numTriangles * 3 / 2)

    let totalArea = 0
    for (let region = 0; region < mesh.numRegions; region++) {
      const start = voronoi.cellCornerOffsets[region]
      const end = voronoi.cellCornerOffsets[region + 1]
      expect(end - start).toBe(mesh.neighborOffsets[region + 1] - mesh.neighborOffsets[region])
      totalArea += voronoi.cellArea[region]

      const center = region * 3
      for (let index = start; index < end; index++) {
        const cornerA = voronoi.cellCorners[index] * 3
        const cornerB = voronoi.cellCorners[index + 1 < end ? index + 1 : start] * 3
        const ax = voronoi.cornerPosition[cornerA] - mesh.regionPosition[center]
        const ay = voronoi.cornerPosition[cornerA + 1] - mesh.regionPosition[center + 1]
        const az = voronoi.cornerPosition[cornerA + 2] - mesh.regionPosition[center + 2]
        const bx = voronoi.cornerPosition[cornerB] - mesh.regionPosition[center]
        const by = voronoi.cornerPosition[cornerB + 1] - mesh.regionPosition[center + 1]
        const bz = voronoi.cornerPosition[cornerB + 2] - mesh.regionPosition[center + 2]
        const outward = (ay * bz - az * by) * mesh.regionPosition[center]
          + (az * bx - ax * bz) * mesh.regionPosition[center + 1]
          + (ax * by - ay * bx) * mesh.regionPosition[center + 2]
        expect(outward).toBeGreaterThan(0)
      }
    }
    expect(totalArea).toBeCloseTo(4 * Math.PI, 4)

    for (let edge = 0; edge < voronoi.edgeRegions.length / 2; edge++) {
      const index = edge * 2
      expect(voronoi.edgeCorners[index]).not.toBe(voronoi.edgeCorners[index + 1])
      expect(voronoi.getSharedBoundaryCorners(
        voronoi.edgeRegions[index],
        voronoi.edgeRegions[index + 1],
      )).toEqual([voronoi.edgeCorners[index], voronoi.edgeCorners[index + 1]])
    }
  })

  it('keeps the rendered globe at a fixed radius regardless of elevation', () => {
    const params = cloneGlobeGenParams(DEFAULT_GLOBE_GEN_PARAMS)
    params.subdivision = 1
    const world = new SphericalWorldGenerator().generate(params)
    const colors = new Float32Array(world.mesh.numRegions * 3)
    const geometry = new GlobeSurfaceGeometry().create(world.mesh, params.planetRadius, colors)
    const positions = geometry.getAttribute('position')

    expect(positions.count).toBe(world.mesh.voronoi.cellCorners.length * 3)
    for (let vertex = 0; vertex < positions.count; vertex++) {
      expect(Math.hypot(
        positions.getX(vertex),
        positions.getY(vertex),
        positions.getZ(vertex),
      )).toBeCloseTo(params.planetRadius, 4)
    }
    geometry.dispose()
  })

  it('creates varied mainland areas and responds to spherical shape controls', () => {
    const params = cloneGlobeGenParams(DEFAULT_GLOBE_GEN_PARAMS)
    params.seed = 77
    params.subdivision = 3
    params.continentCount = 5
    params.islandCount = 0
    params.islandLandShare = 0
    params.sizeVariety = 0.9
    params.elongation = 0.9
    params.coastlineRoughness = 0.9
    const generator = new SphericalWorldGenerator()
    const varied = generator.generate(params)
    const areas = new Float64Array(params.continentCount)
    for (let region = 0; region < varied.mesh.numRegions; region++) {
      const continent = varied.data.regionContinent[region]
      if (continent >= 0 && continent < params.continentCount)
        areas[continent] += varied.mesh.regionArea[region]
    }

    const sortedAreas = [...areas].sort((a, b) => a - b)
    expect(sortedAreas[0]).toBeGreaterThan(0)
    expect(sortedAreas.at(-1)! / sortedAreas[0]).toBeGreaterThan(2)

    const compactParams = cloneGlobeGenParams(params)
    compactParams.elongation = 0
    compactParams.coastlineRoughness = 0
    const compact = generator.generate(compactParams)
    expect(varied.data.landMask).not.toEqual(compact.data.landMask)
  })
})
