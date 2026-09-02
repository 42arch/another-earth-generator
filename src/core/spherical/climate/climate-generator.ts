import type { GlobeGenParams } from '@/core/spherical/config'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type { SphericalClimateData } from '@/core/spherical/climate/climate-data'
import alea from 'alea'
import { createNoise3D } from 'simplex-noise'
import { SphericalBiomeClassifier } from '@/core/spherical/climate/biome-classifier'
import { SphericalOceanCurrentGenerator } from '@/core/spherical/climate/ocean-current-generator'
import { clamp } from '@/core/spherical/geometry/spherical-math'
import {
  CLIMATE_MONTH_COUNT,
  CLIMATE_SEASON_COUNT,
} from '@/core/spherical/climate/climate-data'

const TEMPERATURE_NOISE_OFFSET = 130363
const WIND_NOISE_OFFSET = 174761
const WIND_TRANSITION_WIDTH = 4 * Math.PI / 180
const LOW_LATITUDE_BOUNDARY = 30 * Math.PI / 180
const HIGH_LATITUDE_BOUNDARY = 60 * Math.PI / 180
const MIN_VECTOR_LENGTH = 1e-8
const MAX_LOCAL_RAIN_FRACTION = 0.65
const MAX_OROGRAPHIC_RAIN_FRACTION = 0.72
const OROGRAPHIC_SLOPE_SCALE = 0.18
const EQUATORIAL_RAIN_WIDTH = 10 * Math.PI / 180
const SUBTROPICAL_DRY_CENTER = 28 * Math.PI / 180
const SUBTROPICAL_DRY_WIDTH = 9 * Math.PI / 180
const MIDLATITUDE_RAIN_CENTER = 50 * Math.PI / 180
const MIDLATITUDE_RAIN_WIDTH = 13 * Math.PI / 180
// Anchor several land-area quantiles so narrow ITCZ and orographic extremes
// cannot make the rest of the planet unrealistically arid.
const MAX_ANNUAL_PRECIPITATION_MM = 4000
const MEDIAN_ANNUAL_PRECIPITATION_MM = 700
const P90_ANNUAL_PRECIPITATION_MM = 1800
const P98_ANNUAL_PRECIPITATION_MM = 3200
const DRY_TAIL_EXPONENT = 0.55
const BIOME_PRECIPITATION_SMOOTHING_PASSES = 2
const BIOME_PRECIPITATION_SELF_WEIGHT = 0.64
const EARTH_AXIAL_TILT_DEGREES = 23.44
const DEGREES_TO_RADIANS = Math.PI / 180
const ATMOSPHERIC_BELT_SHIFT_FACTOR = 0.55
const SEASON_REPRESENTATIVE_MONTHS = [0, 3, 6, 9] as const

interface TemperatureData {
  monthly: Float32Array
  meanAnnual: Float32Array
  warmestMonth: Float32Array
  coldestMonth: Float32Array
}

interface MoistureTransportData {
  moisture: Float32Array
  precipitationRate: Float32Array
}

interface SeasonalMoistureData {
  moisture: Float32Array
  precipitation: Float32Array
  annualPrecipitationMm: Float32Array
  seasonalPrecipitationMm: Float32Array
  summerPrecipitationMm: Float32Array
  winterPrecipitationMm: Float32Array
  driestSeasonPrecipitationMm: Float32Array
  wettestSeasonPrecipitationMm: Float32Array
  precipitationSeasonality: Float32Array
  wind: Float32Array
  seasonalWind: Float32Array
}

interface WaterBalanceData {
  evapotranspiration: Float32Array
  runoff: Float32Array
}

interface WindComponents {
  zonal: number
  meridional: number
}

export class SphericalClimateGenerator {
  private readonly biomeClassifier = new SphericalBiomeClassifier()
  private readonly oceanCurrentGenerator = new SphericalOceanCurrentGenerator()

  generate(
    mesh: SphericalMesh,
    elevation: Float32Array,
    climateElevationMeters: Float32Array,
    continentality: Float32Array,
    landMask: Uint8Array,
    climateLandMask: Uint8Array,
    params: GlobeGenParams,
  ): SphericalClimateData {
    const oceanWind = this.generateAnnualWind(mesh, params)
    const ocean = this.oceanCurrentGenerator.generate(
      mesh,
      climateLandMask,
      oceanWind,
      params,
    )
    const surfaceTemperatureAnomaly = this.spreadOceanTemperatureAnomaly(
      mesh,
      climateLandMask,
      ocean.seaSurfaceTemperatureAnomaly,
    )
    const temperature = this.generateTemperature(
      mesh,
      climateElevationMeters,
      continentality,
      climateLandMask,
      surfaceTemperatureAnomaly,
      params,
    )
    const {
      moisture,
      precipitation,
      annualPrecipitationMm,
      seasonalPrecipitationMm,
      summerPrecipitationMm,
      winterPrecipitationMm,
      driestSeasonPrecipitationMm,
      wettestSeasonPrecipitationMm,
      precipitationSeasonality,
      wind,
      seasonalWind,
    } = this.generateSeasonalMoisture(
      mesh,
      elevation,
      landMask,
      temperature.monthly,
      params,
    )
    const {
      evapotranspiration,
      runoff,
      seasonalRunoff,
    } = this.calculateSeasonalWaterBalance(
      landMask,
      temperature.monthly,
      seasonalPrecipitationMm,
      params,
    )
    // Vegetation responds to multi-year regional climate normals rather than
    // every cell-scale rain-shadow spike. Hydrology keeps the unsmoothed field.
    const biomePrecipitationMm = this.smoothLandClimateField(
      mesh,
      annualPrecipitationMm,
      climateLandMask,
      BIOME_PRECIPITATION_SMOOTHING_PASSES,
    )
    const biomeSummerPrecipitationMm = this.smoothLandClimateField(
      mesh,
      summerPrecipitationMm,
      climateLandMask,
      BIOME_PRECIPITATION_SMOOTHING_PASSES,
    )
    const biomeWinterPrecipitationMm = this.smoothLandClimateField(
      mesh,
      winterPrecipitationMm,
      climateLandMask,
      BIOME_PRECIPITATION_SMOOTHING_PASSES,
    )
    const biome = this.biomeClassifier.classify(
      climateLandMask,
      temperature.meanAnnual,
      temperature.warmestMonth,
      temperature.coldestMonth,
      biomePrecipitationMm,
      biomeSummerPrecipitationMm,
      biomeWinterPrecipitationMm,
      driestSeasonPrecipitationMm,
      wettestSeasonPrecipitationMm,
      climateElevationMeters,
    )
    return {
      temperature: temperature.meanAnnual,
      monthlyTemperature: temperature.monthly,
      warmestMonthTemperature: temperature.warmestMonth,
      coldestMonthTemperature: temperature.coldestMonth,
      moisture,
      precipitation,
      annualPrecipitationMm,
      seasonalPrecipitationMm,
      summerPrecipitationMm,
      winterPrecipitationMm,
      driestSeasonPrecipitationMm,
      wettestSeasonPrecipitationMm,
      precipitationSeasonality,
      evapotranspiration,
      runoff,
      seasonalRunoff,
      wind,
      seasonalWind,
      oceanCurrent: ocean.oceanCurrent,
      oceanCurrentSpeed: ocean.oceanCurrentSpeed,
      seaSurfaceTemperature: ocean.seaSurfaceTemperature,
      seaSurfaceTemperatureAnomaly: ocean.seaSurfaceTemperatureAnomaly,
      biome,
    }
  }

  private generateSeasonalMoisture(
    mesh: SphericalMesh,
    elevation: Float32Array,
    landMask: Uint8Array,
    monthlyTemperature: Float32Array,
    params: GlobeGenParams,
  ): SeasonalMoistureData {
    const numRegions = mesh.numRegions
    const seasonalPrecipitationRate = new Float32Array(
      numRegions * CLIMATE_SEASON_COUNT,
    )
    const seasonalWind = new Float32Array(
      numRegions * CLIMATE_SEASON_COUNT * 3,
    )
    const moisture = new Float32Array(numRegions)
    const wind = new Float32Array(numRegions * 3)
    const annualPrecipitationRate = new Float32Array(numRegions)
    const seasonalIterations = Math.max(
      8,
      Math.ceil(params.moistureIterations / 2),
    )

    for (let season = 0; season < CLIMATE_SEASON_COUNT; season++) {
      const month = SEASON_REPRESENTATIVE_MONTHS[season]
      const declination = this.solarDeclinationForMonth(month, params.axialTilt)
      const seasonWind = this.generateWind(mesh, params, declination)
      const temperatureOffset = month * numRegions
      const seasonTemperature = monthlyTemperature.subarray(
        temperatureOffset,
        temperatureOffset + numRegions,
      )
      const transport = this.transportMoisture(
        mesh,
        elevation,
        landMask,
        seasonTemperature,
        seasonWind,
        params,
        declination,
        seasonalIterations,
      )
      const seasonOffset = season * numRegions
      seasonalPrecipitationRate.set(
        transport.precipitationRate,
        seasonOffset,
      )
      seasonalWind.set(seasonWind, season * numRegions * 3)

      for (let region = 0; region < numRegions; region++) {
        moisture[region] += transport.moisture[region]
          / CLIMATE_SEASON_COUNT
        annualPrecipitationRate[region] += transport.precipitationRate[region]
          / CLIMATE_SEASON_COUNT
        const vector = region * 3
        wind[vector] += seasonWind[vector] / CLIMATE_SEASON_COUNT
        wind[vector + 1] += seasonWind[vector + 1] / CLIMATE_SEASON_COUNT
        wind[vector + 2] += seasonWind[vector + 2] / CLIMATE_SEASON_COUNT
      }
    }

    this.normalizeWindVectors(wind, seasonalWind)
    const precipitation = this.normalizePrecipitation(
      mesh,
      annualPrecipitationRate,
      landMask,
    )
    const annualPrecipitationMm = new Float32Array(numRegions)
    const seasonalPrecipitationMm = new Float32Array(
      numRegions * CLIMATE_SEASON_COUNT,
    )
    const summerPrecipitationMm = new Float32Array(numRegions)
    const winterPrecipitationMm = new Float32Array(numRegions)
    const driestSeasonPrecipitationMm = new Float32Array(numRegions)
    const wettestSeasonPrecipitationMm = new Float32Array(numRegions)
    const precipitationSeasonality = new Float32Array(numRegions)

    for (let region = 0; region < numRegions; region++) {
      const annualMillimetres = precipitation[region]
        * MAX_ANNUAL_PRECIPITATION_MM
      annualPrecipitationMm[region] = annualMillimetres
      let rateTotal = 0
      for (let season = 0; season < CLIMATE_SEASON_COUNT; season++) {
        rateTotal += seasonalPrecipitationRate[season * numRegions + region]
      }

      let driest = Infinity
      let wettest = 0
      for (let season = 0; season < CLIMATE_SEASON_COUNT; season++) {
        const index = season * numRegions + region
        const fraction = rateTotal > MIN_VECTOR_LENGTH
          ? seasonalPrecipitationRate[index] / rateTotal
          : 1 / CLIMATE_SEASON_COUNT
        const seasonalMillimetres = annualMillimetres * fraction
        seasonalPrecipitationMm[index] = seasonalMillimetres
        driest = Math.min(driest, seasonalMillimetres)
        wettest = Math.max(wettest, seasonalMillimetres)
      }

      const northernHemisphere = mesh.regionLatitude[region] >= 0
      const summerSeason = northernHemisphere ? 2 : 0
      const winterSeason = northernHemisphere ? 0 : 2
      summerPrecipitationMm[region]
        = seasonalPrecipitationMm[summerSeason * numRegions + region]
      winterPrecipitationMm[region]
        = seasonalPrecipitationMm[winterSeason * numRegions + region]
      driestSeasonPrecipitationMm[region] = Number.isFinite(driest) ? driest : 0
      wettestSeasonPrecipitationMm[region] = wettest
      precipitationSeasonality[region] = wettest > MIN_VECTOR_LENGTH
        ? clamp((wettest - driest) / wettest, 0, 1)
        : 0
    }

    return {
      moisture,
      precipitation,
      annualPrecipitationMm,
      seasonalPrecipitationMm,
      summerPrecipitationMm,
      winterPrecipitationMm,
      driestSeasonPrecipitationMm,
      wettestSeasonPrecipitationMm,
      precipitationSeasonality,
      wind,
      seasonalWind,
    }
  }

  private generateAnnualWind(
    mesh: SphericalMesh,
    params: GlobeGenParams,
  ): Float32Array {
    const annualWind = new Float32Array(mesh.numRegions * 3)
    let fallbackWind = new Float32Array(mesh.numRegions * 3)
    for (let season = 0; season < CLIMATE_SEASON_COUNT; season++) {
      const month = SEASON_REPRESENTATIVE_MONTHS[season]
      const declination = this.solarDeclinationForMonth(month, params.axialTilt)
      const seasonalWind = this.generateWind(mesh, params, declination)
      if (season === 0)
        fallbackWind = seasonalWind
      for (let index = 0; index < annualWind.length; index++)
        annualWind[index] += seasonalWind[index] / CLIMATE_SEASON_COUNT
    }
    this.normalizeWindVectors(annualWind, fallbackWind)
    return annualWind
  }

  private solarDeclinationForMonth(
    month: number,
    axialTiltDegrees: number,
  ): number {
    const axialTilt = clamp(axialTiltDegrees, 0, 90) * DEGREES_TO_RADIANS
    return -axialTilt * Math.cos(2 * Math.PI * month / CLIMATE_MONTH_COUNT)
  }

  private normalizeWindVectors(
    wind: Float32Array,
    seasonalWind: Float32Array,
  ): void {
    for (let index = 0; index < wind.length; index += 3) {
      const length = Math.hypot(wind[index], wind[index + 1], wind[index + 2])
      if (length > MIN_VECTOR_LENGTH) {
        wind[index] /= length
        wind[index + 1] /= length
        wind[index + 2] /= length
        continue
      }
      wind[index] = seasonalWind[index]
      wind[index + 1] = seasonalWind[index + 1]
      wind[index + 2] = seasonalWind[index + 2]
    }
  }

  private calculateSeasonalWaterBalance(
    landMask: Uint8Array,
    monthlyTemperature: Float32Array,
    seasonalPrecipitationMm: Float32Array,
    params: GlobeGenParams,
  ): WaterBalanceData & { seasonalRunoff: Float32Array } {
    const numRegions = landMask.length
    const evapotranspiration = new Float32Array(numRegions)
    const runoff = new Float32Array(numRegions)
    const seasonalRunoff = new Float32Array(
      numRegions * CLIMATE_SEASON_COUNT,
    )

    for (let season = 0; season < CLIMATE_SEASON_COUNT; season++) {
      const month = SEASON_REPRESENTATIVE_MONTHS[season]
      const temperatureOffset = month * numRegions
      const seasonOffset = season * numRegions
      const seasonTemperature = monthlyTemperature.subarray(
        temperatureOffset,
        temperatureOffset + numRegions,
      )
      const seasonPrecipitation = new Float32Array(numRegions)
      for (let region = 0; region < numRegions; region++) {
        seasonPrecipitation[region] = seasonalPrecipitationMm[seasonOffset + region]
          / MAX_ANNUAL_PRECIPITATION_MM
      }
      const balance = this.calculateWaterBalance(
        landMask,
        seasonTemperature,
        seasonPrecipitation,
        params,
      )
      seasonalRunoff.set(balance.runoff, seasonOffset)
      for (let region = 0; region < numRegions; region++) {
        evapotranspiration[region] += balance.evapotranspiration[region]
        runoff[region] += balance.runoff[region]
      }
    }

    return { evapotranspiration, runoff, seasonalRunoff }
  }

  private calculateWaterBalance(
    landMask: Uint8Array,
    temperature: Float32Array,
    precipitation: Float32Array,
    params: GlobeGenParams,
  ): WaterBalanceData {
    const evapotranspiration = new Float32Array(precipitation.length)
    const runoff = new Float32Array(precipitation.length)
    for (let region = 0; region < precipitation.length; region++) {
      if (landMask[region] === 0)
        continue
      const warmFactor = clamp((temperature[region] + 5) / 35, 0, 1)
      const evapotranspirationFraction = clamp(
        warmFactor * params.evapotranspirationStrength,
        0,
        0.95,
      )
      const lossFraction = clamp(
        params.infiltration + evapotranspirationFraction,
        0,
        0.95,
      )
      evapotranspiration[region] = precipitation[region]
        * evapotranspirationFraction
      runoff[region] = precipitation[region] * (1 - lossFraction)
    }
    return { evapotranspiration, runoff }
  }

  private generateTemperature(
    mesh: SphericalMesh,
    climateElevationMeters: Float32Array,
    continentality: Float32Array,
    landMask: Uint8Array,
    surfaceTemperatureAnomaly: Float32Array,
    params: GlobeGenParams,
  ): TemperatureData {
    const monthly = new Float32Array(mesh.numRegions * CLIMATE_MONTH_COUNT)
    const meanAnnual = new Float32Array(mesh.numRegions)
    const warmestMonth = new Float32Array(mesh.numRegions)
    const coldestMonth = new Float32Array(mesh.numRegions)
    const noise3D = createNoise3D(alea(params.seed + TEMPERATURE_NOISE_OFFSET))
    const tiltScale = clamp(params.axialTilt / EARTH_AXIAL_TILT_DEGREES, 0, 2)
    for (let region = 0; region < mesh.numRegions; region++) {
      const position = region * 3
      const x = mesh.regionPosition[position]
      const y = mesh.regionPosition[position + 1]
      const z = mesh.regionPosition[position + 2]
      const latitudeFactor = Math.abs(Math.sin(mesh.regionLatitude[region])) ** params.latitudeTemperatureExponent
      const seaLevelTemperature = params.equatorTemperature
        + (params.poleTemperature - params.equatorTemperature) * latitudeFactor
      const elevationCooling = landMask[region] === 0
        ? 0
        : climateElevationMeters[region] / 1000 * params.elevationLapseRate
      const variation = noise3D(x * 1.7, y * 1.7, z * 1.7)
        * params.temperatureNoiseStrength
      meanAnnual[region] = seaLevelTemperature
        - elevationCooling
        + variation
        + surfaceTemperatureAnomaly[region]

      const latitude = mesh.regionLatitude[region]
      const latitudeSeasonality = Math.abs(Math.sin(latitude)) ** 1.35 * 18
      const surfaceSeasonality = landMask[region] === 0
        ? 0.5
        : 0.75 + clamp(continentality[region], 0, 1) * 0.5
      const seasonalAmplitude = latitudeSeasonality * surfaceSeasonality * tiltScale
      const hemisphere = Math.sign(latitude)
      const thermalLagMonths = landMask[region] === 0 ? 1.5 : 0.5
      let warmest = -Infinity
      let coldest = Infinity

      for (let month = 0; month < CLIMATE_MONTH_COUNT; month++) {
        const phase = 2 * Math.PI
          * (month - 6 - thermalLagMonths)
          / CLIMATE_MONTH_COUNT
        const temperature = meanAnnual[region]
          + seasonalAmplitude * Math.cos(phase) * hemisphere
        monthly[month * mesh.numRegions + region] = temperature
        warmest = Math.max(warmest, temperature)
        coldest = Math.min(coldest, temperature)
      }
      warmestMonth[region] = warmest
      coldestMonth[region] = coldest
    }
    return { monthly, meanAnnual, warmestMonth, coldestMonth }
  }

  private spreadOceanTemperatureAnomaly(
    mesh: SphericalMesh,
    landMask: Uint8Array,
    oceanAnomaly: Float32Array,
  ): Float32Array {
    const anomaly = new Float32Array(oceanAnomaly)
    const distance = new Int8Array(mesh.numRegions).fill(-1)
    for (let region = 0; region < mesh.numRegions; region++) {
      if (landMask[region] === 0)
        distance[region] = 0
    }

    const maximumCoastalDistance = 4
    for (let layer = 1; layer <= maximumCoastalDistance; layer++) {
      const updates: Array<readonly [number, number]> = []
      for (let region = 0; region < mesh.numRegions; region++) {
        if (landMask[region] === 0 || distance[region] >= 0)
          continue
        let total = 0
        let count = 0
        for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
          if (distance[neighbor] !== layer - 1)
            continue
          total += anomaly[neighbor]
          count++
        }
        if (count > 0)
          updates.push([region, total / count * (layer === 1 ? 0.72 : 0.58)])
      }
      for (const [region, value] of updates) {
        distance[region] = layer
        anomaly[region] = value
      }
    }
    return anomaly
  }

  private generateWind(
    mesh: SphericalMesh,
    params: GlobeGenParams,
    solarDeclination: number,
  ): Float32Array {
    const wind = new Float32Array(mesh.numRegions * 3)
    const noise3D = createNoise3D(alea(params.seed + WIND_NOISE_OFFSET))
    for (let region = 0; region < mesh.numRegions; region++) {
      const index = region * 3
      const x = mesh.regionPosition[index]
      const y = mesh.regionPosition[index + 1]
      const z = mesh.regionPosition[index + 2]
      const horizontalLength = Math.hypot(x, z)
      const eastX = horizontalLength > MIN_VECTOR_LENGTH ? -z / horizontalLength : 0
      const eastY = 0
      const eastZ = horizontalLength > MIN_VECTOR_LENGTH ? x / horizontalLength : 1
      const northX = eastY * z - eastZ * y
      const northY = eastZ * x - eastX * z
      const northZ = eastX * y - eastY * x
      const latitude = mesh.regionLatitude[region]
      const circulationLatitude = latitude
        - solarDeclination * ATMOSPHERIC_BELT_SHIFT_FACTOR
      const components = this.getWindComponents(circulationLatitude)

      let windX = eastX * components.zonal + northX * components.meridional
      let windY = eastY * components.zonal + northY * components.meridional
      let windZ = eastZ * components.zonal + northZ * components.meridional

      let perturbX = noise3D(x * 1.35 + 19.7, y * 1.35 - 3.1, z * 1.35 + 7.6)
      let perturbY = noise3D(x * 1.35 - 11.4, y * 1.35 + 23.8, z * 1.35 - 5.2)
      let perturbZ = noise3D(x * 1.35 + 4.3, y * 1.35 + 9.9, z * 1.35 - 17.5)
      const radialPerturbation = perturbX * x + perturbY * y + perturbZ * z
      perturbX -= x * radialPerturbation
      perturbY -= y * radialPerturbation
      perturbZ -= z * radialPerturbation
      const perturbLength = Math.hypot(perturbX, perturbY, perturbZ)
      if (perturbLength > MIN_VECTOR_LENGTH) {
        const perturbation = params.windPerturbation / perturbLength
        windX += perturbX * perturbation
        windY += perturbY * perturbation
        windZ += perturbZ * perturbation
      }

      const radialWind = windX * x + windY * y + windZ * z
      windX -= x * radialWind
      windY -= y * radialWind
      windZ -= z * radialWind
      const windLength = Math.max(MIN_VECTOR_LENGTH, Math.hypot(windX, windY, windZ))
      wind[index] = windX / windLength
      wind[index + 1] = windY / windLength
      wind[index + 2] = windZ / windLength
    }
    return wind
  }

  private getWindComponents(latitude: number): WindComponents {
    const absoluteLatitude = Math.abs(latitude)
    const hemisphere = Math.sign(latitude)
    const tropical = { zonal: -1, meridional: -hemisphere * 0.28 }
    const temperate = { zonal: 1, meridional: hemisphere * 0.22 }
    const polar = { zonal: -1, meridional: -hemisphere * 0.18 }

    if (absoluteLatitude < LOW_LATITUDE_BOUNDARY - WIND_TRANSITION_WIDTH)
      return tropical
    if (absoluteLatitude < LOW_LATITUDE_BOUNDARY + WIND_TRANSITION_WIDTH) {
      const amount = this.smoothstep(
        LOW_LATITUDE_BOUNDARY - WIND_TRANSITION_WIDTH,
        LOW_LATITUDE_BOUNDARY + WIND_TRANSITION_WIDTH,
        absoluteLatitude,
      )
      return this.mixWindComponents(tropical, temperate, amount)
    }
    if (absoluteLatitude < HIGH_LATITUDE_BOUNDARY - WIND_TRANSITION_WIDTH)
      return temperate
    if (absoluteLatitude < HIGH_LATITUDE_BOUNDARY + WIND_TRANSITION_WIDTH) {
      const amount = this.smoothstep(
        HIGH_LATITUDE_BOUNDARY - WIND_TRANSITION_WIDTH,
        HIGH_LATITUDE_BOUNDARY + WIND_TRANSITION_WIDTH,
        absoluteLatitude,
      )
      return this.mixWindComponents(temperate, polar, amount)
    }
    return polar
  }

  private transportMoisture(
    mesh: SphericalMesh,
    elevation: Float32Array,
    landMask: Uint8Array,
    temperature: Float32Array,
    wind: Float32Array,
    params: GlobeGenParams,
    solarDeclination: number,
    iterations: number,
  ): MoistureTransportData {
    const { downwindWeight, uphillSlope } = this.buildTransportEdges(
      mesh,
      elevation,
      landMask,
      wind,
    )
    const iterationCount = Math.max(4, Math.floor(iterations))
    const spinUpIterations = Math.floor(iterationCount / 2)
    const sampleIterations = Math.max(1, iterationCount - spinUpIterations)
    let currentMoisture = new Float32Array(mesh.numRegions)
    let nextMoisture = new Float32Array(mesh.numRegions)
    const rainThisStep = new Float32Array(mesh.numRegions)
    const precipitationRate = new Float32Array(mesh.numRegions)
    const surfaceWetness = new Float32Array(mesh.numRegions)

    for (let iteration = 0; iteration < iterationCount; iteration++) {
      nextMoisture.fill(0)
      rainThisStep.fill(0)

      for (let region = 0; region < mesh.numRegions; region++) {
        const warmFactor = clamp((temperature[region] + 5) / 35, 0, 1)
        const evaporation = landMask[region] === 0
          ? params.oceanEvaporation * (0.35 + warmFactor * 0.65)
          : params.landEvaporation * warmFactor * surfaceWetness[region]
        const availableMoisture = currentMoisture[region] + evaporation
        const capacity = 0.15 + warmFactor * warmFactor * 0.85
        const excess = Math.max(0, availableMoisture - capacity)
        const latitude = mesh.regionLatitude[region]
        const circulationLatitude = latitude
          - solarDeclination * ATMOSPHERIC_BELT_SHIFT_FACTOR
        const absoluteLatitude = Math.abs(circulationLatitude)
        const equatorialConvergence = this.gaussianBand(
          absoluteLatitude,
          0,
          EQUATORIAL_RAIN_WIDTH,
        )
        const subtropicalSubsidence = this.gaussianBand(
          absoluteLatitude,
          SUBTROPICAL_DRY_CENTER,
          SUBTROPICAL_DRY_WIDTH,
        )
        const midlatitudeStorms = this.gaussianBand(
          absoluteLatitude,
          MIDLATITUDE_RAIN_CENTER,
          MIDLATITUDE_RAIN_WIDTH,
        )
        const backgroundRain = params.basePrecipitation
          * (1 - clamp(params.subtropicalDryness, 0, 0.95) * subtropicalSubsidence)
        const rainFraction = backgroundRain
          + equatorialConvergence * warmFactor * params.equatorialRainStrength
          + midlatitudeStorms * params.midlatitudeRainStrength
        const localRain = Math.min(
          availableMoisture * MAX_LOCAL_RAIN_FRACTION,
          Math.max(excess, availableMoisture * rainFraction),
        )
        rainThisStep[region] += localRain
        const transportable = (availableMoisture - localRain)
          * clamp(params.moistureRetention, 0, 1)

        const edgeStart = mesh.neighborOffsets[region]
        const edgeEnd = mesh.neighborOffsets[region + 1]
        for (let edge = edgeStart; edge < edgeEnd; edge++) {
          const neighbor = mesh.neighbors[edge]
          const transportedMoisture = transportable * downwindWeight[edge]
          const orographicFraction = clamp(
            uphillSlope[edge] * params.orographicStrength * OROGRAPHIC_SLOPE_SCALE,
            0,
            MAX_OROGRAPHIC_RAIN_FRACTION,
          )
          const orographicRain = transportedMoisture * orographicFraction
          rainThisStep[neighbor] += orographicRain
          nextMoisture[neighbor] += transportedMoisture - orographicRain
        }
      }

      for (let region = 0; region < mesh.numRegions; region++) {
        surfaceWetness[region] = clamp(
          surfaceWetness[region] * 0.82 + rainThisStep[region] * 4,
          0,
          1,
        )
        if (iteration >= spinUpIterations)
          precipitationRate[region] += rainThisStep[region] / sampleIterations
      }

      const previousMoisture = currentMoisture
      currentMoisture = nextMoisture
      nextMoisture = previousMoisture
    }

    return {
      moisture: new Float32Array(currentMoisture),
      precipitationRate,
    }
  }

  private buildTransportEdges(
    mesh: SphericalMesh,
    elevation: Float32Array,
    landMask: Uint8Array,
    wind: Float32Array,
  ) {
    const downwindWeight = new Float32Array(mesh.neighbors.length)
    const uphillSlope = new Float32Array(mesh.neighbors.length)
    for (let region = 0; region < mesh.numRegions; region++) {
      const regionIndex = region * 3
      const regionX = mesh.regionPosition[regionIndex]
      const regionY = mesh.regionPosition[regionIndex + 1]
      const regionZ = mesh.regionPosition[regionIndex + 2]
      const edgeStart = mesh.neighborOffsets[region]
      const edgeEnd = mesh.neighborOffsets[region + 1]
      let weightSum = 0
      let bestEdge = edgeStart
      let bestAlignment = -Infinity

      for (let edge = edgeStart; edge < edgeEnd; edge++) {
        const neighbor = mesh.neighbors[edge]
        const neighborIndex = neighbor * 3
        const neighborX = mesh.regionPosition[neighborIndex]
        const neighborY = mesh.regionPosition[neighborIndex + 1]
        const neighborZ = mesh.regionPosition[neighborIndex + 2]
        const radialProjection = regionX * neighborX
          + regionY * neighborY
          + regionZ * neighborZ
        let directionX = neighborX - regionX * radialProjection
        let directionY = neighborY - regionY * radialProjection
        let directionZ = neighborZ - regionZ * radialProjection
        const directionLength = Math.max(
          MIN_VECTOR_LENGTH,
          Math.hypot(directionX, directionY, directionZ),
        )
        directionX /= directionLength
        directionY /= directionLength
        directionZ /= directionLength
        const alignment = wind[regionIndex] * directionX
          + wind[regionIndex + 1] * directionY
          + wind[regionIndex + 2] * directionZ
        if (alignment > bestAlignment) {
          bestAlignment = alignment
          bestEdge = edge
        }
        const weight = Math.max(0, alignment) ** 2
        downwindWeight[edge] = weight
        weightSum += weight

        if (landMask[neighbor] !== 0) {
          const rise = Math.max(0, elevation[neighbor] - elevation[region])
          const distance = Math.acos(clamp(radialProjection, -1, 1))
          uphillSlope[edge] = distance > MIN_VECTOR_LENGTH ? rise / distance : 0
        }
      }

      if (weightSum <= MIN_VECTOR_LENGTH) {
        downwindWeight[bestEdge] = 1
        weightSum = 1
      }
      for (let edge = edgeStart; edge < edgeEnd; edge++)
        downwindWeight[edge] /= weightSum
    }
    return { downwindWeight, uphillSlope }
  }

  private normalizePrecipitation(
    mesh: SphericalMesh,
    precipitationRate: Float32Array,
    landMask: Uint8Array,
  ): Float32Array {
    const landRegions: number[] = []
    let totalLandArea = 0
    for (let region = 0; region < mesh.numRegions; region++) {
      if (landMask[region] === 0)
        continue
      landRegions.push(region)
      totalLandArea += mesh.regionArea[region]
    }
    landRegions.sort((a, b) => precipitationRate[a] - precipitationRate[b] || a - b)

    const precipitation = new Float32Array(mesh.numRegions)
    if (totalLandArea <= MIN_VECTOR_LENGTH)
      return precipitation

    const medianRate = this.areaWeightedQuantile(
      mesh,
      precipitationRate,
      landRegions,
      totalLandArea,
      0.5,
    )
    const p90Rate = this.areaWeightedQuantile(
      mesh,
      precipitationRate,
      landRegions,
      totalLandArea,
      0.9,
    )
    const p98Rate = this.areaWeightedQuantile(
      mesh,
      precipitationRate,
      landRegions,
      totalLandArea,
      0.98,
    )
    let maximumRate = 0
    for (const region of landRegions)
      maximumRate = Math.max(maximumRate, precipitationRate[region])

    if (p98Rate <= MIN_VECTOR_LENGTH)
      return precipitation

    for (let region = 0; region < mesh.numRegions; region++) {
      const rate = Math.max(0, precipitationRate[region])
      let annualMillimetres: number
      if (rate <= medianRate && medianRate > MIN_VECTOR_LENGTH) {
        annualMillimetres = MEDIAN_ANNUAL_PRECIPITATION_MM
          * (rate / medianRate) ** DRY_TAIL_EXPONENT
      }
      else if (rate <= p90Rate) {
        annualMillimetres = this.remapRange(
          rate,
          medianRate,
          p90Rate,
          MEDIAN_ANNUAL_PRECIPITATION_MM,
          P90_ANNUAL_PRECIPITATION_MM,
        )
      }
      else if (rate <= p98Rate) {
        annualMillimetres = this.remapRange(
          rate,
          p90Rate,
          p98Rate,
          P90_ANNUAL_PRECIPITATION_MM,
          P98_ANNUAL_PRECIPITATION_MM,
        )
      }
      else {
        annualMillimetres = this.remapRange(
          rate,
          p98Rate,
          maximumRate,
          P98_ANNUAL_PRECIPITATION_MM,
          MAX_ANNUAL_PRECIPITATION_MM,
        )
      }
      precipitation[region] = clamp(
        annualMillimetres / MAX_ANNUAL_PRECIPITATION_MM,
        0,
        1,
      )
    }
    return precipitation
  }

  private areaWeightedQuantile(
    mesh: SphericalMesh,
    values: Float32Array,
    sortedRegions: number[],
    totalArea: number,
    quantile: number,
  ): number {
    const targetArea = totalArea * clamp(quantile, 0, 1)
    let accumulatedArea = 0
    for (const region of sortedRegions) {
      accumulatedArea += mesh.regionArea[region]
      if (accumulatedArea >= targetArea)
        return values[region]
    }
    const finalRegion = sortedRegions[sortedRegions.length - 1]
    return finalRegion === undefined ? 0 : values[finalRegion]
  }

  private remapRange(
    value: number,
    inputMinimum: number,
    inputMaximum: number,
    outputMinimum: number,
    outputMaximum: number,
  ): number {
    if (inputMaximum - inputMinimum <= MIN_VECTOR_LENGTH)
      return value <= inputMinimum ? outputMinimum : outputMaximum
    const amount = clamp(
      (value - inputMinimum) / (inputMaximum - inputMinimum),
      0,
      1,
    )
    return outputMinimum + (outputMaximum - outputMinimum) * amount
  }

  private smoothLandClimateField(
    mesh: SphericalMesh,
    source: Float32Array,
    landMask: Uint8Array,
    passes: number,
  ): Float32Array {
    let current = new Float32Array(source)
    let next = new Float32Array(source.length)
    for (let pass = 0; pass < passes; pass++) {
      for (let region = 0; region < mesh.numRegions; region++) {
        if (landMask[region] === 0) {
          next[region] = source[region]
          continue
        }
        let neighborArea = 0
        let neighborTotal = 0
        for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
          if (landMask[neighbor] === 0)
            continue
          const area = mesh.regionArea[neighbor]
          neighborArea += area
          neighborTotal += current[neighbor] * area
        }
        const neighborAverage = neighborArea > MIN_VECTOR_LENGTH
          ? neighborTotal / neighborArea
          : current[region]
        next[region] = current[region] * BIOME_PRECIPITATION_SELF_WEIGHT
          + neighborAverage * (1 - BIOME_PRECIPITATION_SELF_WEIGHT)
      }
      const previous = current
      current = next
      next = previous
    }
    return current
  }

  private mixWindComponents(
    a: WindComponents,
    b: WindComponents,
    amount: number,
  ): WindComponents {
    return {
      zonal: a.zonal + (b.zonal - a.zonal) * amount,
      meridional: a.meridional + (b.meridional - a.meridional) * amount,
    }
  }

  private gaussianBand(value: number, center: number, width: number): number {
    return Math.exp(-(((value - center) / width) ** 2))
  }

  private smoothstep(edge0: number, edge1: number, value: number): number {
    const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1)
    return amount * amount * (3 - 2 * amount)
  }
}
