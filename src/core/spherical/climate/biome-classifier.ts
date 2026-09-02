import type { SphericalBiomeCode } from '@/core/spherical/climate/climate-data'
import { clamp } from '@/core/spherical/geometry/spherical-math'
import { SPHERICAL_BIOME } from '@/core/spherical/climate/climate-data'

const BOREAL_TEMPERATURE_LIMIT = 5
const TROPICAL_TEMPERATURE = 20
const ICE_WARMEST_MONTH_TEMPERATURE = 0
const TUNDRA_WARMEST_MONTH_TEMPERATURE = 10
const POLAR_DESERT_PRECIPITATION_MM = 180
const ALPINE_ELEVATION_METERS = 2200
const ALPINE_WARMEST_MONTH_TEMPERATURE = 14
const MONTANE_FOREST_ELEVATION_METERS = 1600
const CLOUD_FOREST_PRECIPITATION_MM = 1400

/**
 * Enhanced Whittaker-style classification with separate dryland and tropical
 * forest formations. Permanent ice and polar vegetation are resolved from
 * summer warmth; elevation then introduces alpine and montane formations.
 * Remaining land uses sloped temperature-precipitation boundaries.
 */
export class SphericalBiomeClassifier {
  classify(
    landMask: Uint8Array,
    meanAnnualTemperature: Float32Array,
    warmestMonthTemperature: Float32Array,
    coldestMonthTemperature: Float32Array,
    annualPrecipitationMm: Float32Array,
    summerPrecipitationMm: Float32Array,
    winterPrecipitationMm: Float32Array,
    driestSeasonPrecipitationMm: Float32Array,
    wettestSeasonPrecipitationMm: Float32Array,
    climateElevationMeters: Float32Array,
  ): Uint8Array {
    const biome = new Uint8Array(landMask.length)

    for (let region = 0; region < landMask.length; region += 1) {
      biome[region] = this.classifyRegion(
        landMask[region] === 1,
        meanAnnualTemperature[region],
        warmestMonthTemperature[region],
        coldestMonthTemperature[region],
        annualPrecipitationMm[region],
        summerPrecipitationMm[region],
        winterPrecipitationMm[region],
        driestSeasonPrecipitationMm[region],
        wettestSeasonPrecipitationMm[region],
        climateElevationMeters[region],
      )
    }

    return biome
  }

  private classifyRegion(
    isLand: boolean,
    meanAnnualTemperature: number,
    warmestMonthTemperature: number,
    coldestMonthTemperature: number,
    annualPrecipitationMm: number,
    summerPrecipitationMm: number,
    winterPrecipitationMm: number,
    driestSeasonPrecipitationMm: number,
    wettestSeasonPrecipitationMm: number,
    elevationMeters: number,
  ): SphericalBiomeCode {
    if (!isLand)
      return SPHERICAL_BIOME.Ocean
    if (warmestMonthTemperature < ICE_WARMEST_MONTH_TEMPERATURE)
      return SPHERICAL_BIOME.Ice
    if (warmestMonthTemperature < TUNDRA_WARMEST_MONTH_TEMPERATURE) {
      return annualPrecipitationMm < POLAR_DESERT_PRECIPITATION_MM
        ? SPHERICAL_BIOME.PolarDesert
        : SPHERICAL_BIOME.Tundra
    }

    if (
      elevationMeters >= ALPINE_ELEVATION_METERS
      && warmestMonthTemperature < ALPINE_WARMEST_MONTH_TEMPERATURE
    ) {
      return SPHERICAL_BIOME.AlpineTundra
    }

    if (elevationMeters >= MONTANE_FOREST_ELEVATION_METERS) {
      if (
        meanAnnualTemperature >= 8
        && annualPrecipitationMm >= CLOUD_FOREST_PRECIPITATION_MM
      ) {
        return SPHERICAL_BIOME.MontaneCloudForest
      }
      if (
        meanAnnualTemperature < 12
        && annualPrecipitationMm >= 500
      ) {
        return SPHERICAL_BIOME.MontaneConiferForest
      }
    }

    if (meanAnnualTemperature < BOREAL_TEMPERATURE_LIMIT) {
      return annualPrecipitationMm < 250
        ? SPHERICAL_BIOME.ColdDesert
        : SPHERICAL_BIOME.BorealForest
    }

    if (meanAnnualTemperature < TROPICAL_TEMPERATURE) {
      const temperateWarmth = clamp(
        (meanAnnualTemperature - BOREAL_TEMPERATURE_LIMIT)
        / (TROPICAL_TEMPERATURE - BOREAL_TEMPERATURE_LIMIT),
        0,
        1,
      )
      const desertLimit = 180 + temperateWarmth * 180
      const grasslandLimit = 500 + temperateWarmth * 180
      const woodlandLimit = 850 + temperateWarmth * 250
      const seasonalForestLimit = 1600 + temperateWarmth * 400
      const mediterraneanClimate = this.isMediterraneanClimate(
        meanAnnualTemperature,
        warmestMonthTemperature,
        coldestMonthTemperature,
        annualPrecipitationMm,
        summerPrecipitationMm,
        winterPrecipitationMm,
      )

      if (annualPrecipitationMm < desertLimit) {
        return meanAnnualTemperature < 12
          ? SPHERICAL_BIOME.ColdDesert
          : SPHERICAL_BIOME.HotDesert
      }
      if (annualPrecipitationMm < grasslandLimit) {
        return mediterraneanClimate
          ? SPHERICAL_BIOME.MediterraneanShrubland
          : SPHERICAL_BIOME.TemperateGrassland
      }
      if (annualPrecipitationMm < woodlandLimit) {
        return mediterraneanClimate
          ? SPHERICAL_BIOME.MediterraneanShrubland
          : SPHERICAL_BIOME.TemperateWoodland
      }
      if (annualPrecipitationMm < seasonalForestLimit)
        return SPHERICAL_BIOME.TemperateSeasonalForest
      return SPHERICAL_BIOME.TemperateRainforest
    }

    const tropicalWarmth = clamp(
      (meanAnnualTemperature - TROPICAL_TEMPERATURE) / 10,
      0,
      1,
    )
    const desertLimit = 300 + tropicalWarmth * 200
    const xericShrublandLimit = 650 + tropicalWarmth * 200
    const savannaLimit = 1000 + tropicalWarmth * 250
    const dryForestLimit = 1400 + tropicalWarmth * 300
    const seasonalForestLimit = 1900 + tropicalWarmth * 350

    if (annualPrecipitationMm < desertLimit)
      return SPHERICAL_BIOME.HotDesert
    if (annualPrecipitationMm < xericShrublandLimit)
      return SPHERICAL_BIOME.XericShrubland
    if (annualPrecipitationMm < savannaLimit)
      return SPHERICAL_BIOME.TropicalSavanna
    if (annualPrecipitationMm < dryForestLimit)
      return SPHERICAL_BIOME.TropicalDryForest
    if (annualPrecipitationMm < seasonalForestLimit)
      return SPHERICAL_BIOME.TropicalSeasonalForest
    if (
      driestSeasonPrecipitationMm
      < wettestSeasonPrecipitationMm * 0.35
    ) {
      return SPHERICAL_BIOME.TropicalSeasonalForest
    }
    return SPHERICAL_BIOME.TropicalRainforest
  }

  private isMediterraneanClimate(
    meanAnnualTemperature: number,
    warmestMonthTemperature: number,
    coldestMonthTemperature: number,
    annualPrecipitationMm: number,
    summerPrecipitationMm: number,
    winterPrecipitationMm: number,
  ): boolean {
    if (
      meanAnnualTemperature < 12
      || meanAnnualTemperature >= TROPICAL_TEMPERATURE
      || warmestMonthTemperature < 18
      || coldestMonthTemperature <= 0
      || annualPrecipitationMm < 250
      || annualPrecipitationMm > 1200
    ) {
      return false
    }

    const driestSummerMonthMm = summerPrecipitationMm / 3
    return driestSummerMonthMm < 40
      && summerPrecipitationMm < winterPrecipitationMm / 3
  }
}
