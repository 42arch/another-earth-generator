import type { GlobeDisplayMode } from '@/core/spherical/config'
import type { SphericalBiomeCode, SphericalWorldData } from '@/core/spherical/spherical-world-data'
import { SEA_LEVEL } from '@/constants'
import { REGION_FEATURE } from '@/core/spherical/geography/region-feature'
import { clamp } from '@/core/spherical/geometry/spherical-math'
import {
  LAKE_ICE_STATE,
  SPHERICAL_BIOME,
} from '@/core/spherical/spherical-world-data'

type Rgb = readonly [number, number, number]

const DEEP_OCEAN: Rgb = [0.012, 0.052, 0.13]
const MID_OCEAN: Rgb = [0.025, 0.14, 0.24]
const RIDGE_OCEAN: Rgb = [0.05, 0.235, 0.31]
const SHALLOW_OCEAN: Rgb = [0.055, 0.31, 0.38]
const WARM_SHALLOW_OCEAN: Rgb = [0.07, 0.39, 0.4]
const LAKE: Rgb = [0.07, 0.28, 0.34]
const FROZEN_LAKE: Rgb = [0.58, 0.73, 0.76]
const BARE_ROCK: Rgb = [0.39, 0.36, 0.32]
const DRY_SOIL: Rgb = [0.54, 0.42, 0.25]
const SNOW: Rgb = [0.9, 0.93, 0.94]
const UNASSIGNED_TERRITORY: Rgb = [0.62, 0.64, 0.62]
const COLD_TEMPERATURE: Rgb = [0.08, 0.2, 0.58]
const FREEZING_TEMPERATURE: Rgb = [0.58, 0.84, 0.94]
const TEMPERATE_TEMPERATURE: Rgb = [0.96, 0.86, 0.42]
const HOT_TEMPERATURE: Rgb = [0.78, 0.16, 0.08]
const OCEAN_ABYSS_DEPTH_METERS = 6500
const OCEAN_BASIN_DEPTH_METERS = 3800
const OCEAN_RIDGE_DEPTH_METERS = 1600
const COASTAL_WATER_DEPTH_METERS = 1400
const BIOME_COLORS: Record<SphericalBiomeCode, Rgb> = {
  [SPHERICAL_BIOME.Ocean]: [0.055, 0.24, 0.42],
  [SPHERICAL_BIOME.Ice]: [0.9, 0.95, 0.98],
  [SPHERICAL_BIOME.PolarDesert]: [0.76, 0.76, 0.69],
  [SPHERICAL_BIOME.Tundra]: [0.66, 0.69, 0.58],
  [SPHERICAL_BIOME.BorealForest]: [0.18, 0.34, 0.22],
  [SPHERICAL_BIOME.ColdDesert]: [0.68, 0.61, 0.42],
  [SPHERICAL_BIOME.TemperateGrassland]: [0.65, 0.67, 0.32],
  [SPHERICAL_BIOME.TemperateWoodland]: [0.4, 0.51, 0.24],
  [SPHERICAL_BIOME.MediterraneanShrubland]: [0.52, 0.55, 0.26],
  [SPHERICAL_BIOME.TemperateSeasonalForest]: [0.22, 0.47, 0.24],
  [SPHERICAL_BIOME.TemperateRainforest]: [0.12, 0.38, 0.26],
  [SPHERICAL_BIOME.HotDesert]: [0.78, 0.64, 0.36],
  [SPHERICAL_BIOME.XericShrubland]: [0.67, 0.62, 0.31],
  [SPHERICAL_BIOME.TropicalSavanna]: [0.52, 0.64, 0.2],
  [SPHERICAL_BIOME.TropicalDryForest]: [0.34, 0.53, 0.19],
  [SPHERICAL_BIOME.TropicalSeasonalForest]: [0.2, 0.46, 0.18],
  [SPHERICAL_BIOME.TropicalRainforest]: [0.08, 0.36, 0.19],
  [SPHERICAL_BIOME.AlpineTundra]: [0.58, 0.61, 0.56],
  [SPHERICAL_BIOME.MontaneConiferForest]: [0.14, 0.29, 0.24],
  [SPHERICAL_BIOME.MontaneCloudForest]: [0.07, 0.31, 0.24],
}

/**
 * Muted surface reflectance approximations used by the natural-terrain view.
 * Unlike the categorical biome palette above, adjacent formations intentionally
 * overlap so the globe reads like continuous satellite imagery.
 */
const NATURAL_BIOME_COLORS: Record<SphericalBiomeCode, Rgb> = {
  [SPHERICAL_BIOME.Ocean]: MID_OCEAN,
  [SPHERICAL_BIOME.Ice]: SNOW,
  [SPHERICAL_BIOME.PolarDesert]: [0.56, 0.55, 0.5],
  [SPHERICAL_BIOME.Tundra]: [0.39, 0.42, 0.34],
  [SPHERICAL_BIOME.BorealForest]: [0.075, 0.2, 0.13],
  [SPHERICAL_BIOME.ColdDesert]: [0.54, 0.47, 0.34],
  [SPHERICAL_BIOME.TemperateGrassland]: [0.4, 0.46, 0.23],
  [SPHERICAL_BIOME.TemperateWoodland]: [0.25, 0.37, 0.18],
  [SPHERICAL_BIOME.MediterraneanShrubland]: [0.39, 0.4, 0.21],
  [SPHERICAL_BIOME.TemperateSeasonalForest]: [0.14, 0.33, 0.15],
  [SPHERICAL_BIOME.TemperateRainforest]: [0.075, 0.27, 0.15],
  [SPHERICAL_BIOME.HotDesert]: [0.68, 0.54, 0.32],
  [SPHERICAL_BIOME.XericShrubland]: [0.54, 0.48, 0.27],
  [SPHERICAL_BIOME.TropicalSavanna]: [0.43, 0.45, 0.18],
  [SPHERICAL_BIOME.TropicalDryForest]: [0.28, 0.37, 0.14],
  [SPHERICAL_BIOME.TropicalSeasonalForest]: [0.13, 0.32, 0.12],
  [SPHERICAL_BIOME.TropicalRainforest]: [0.045, 0.23, 0.11],
  [SPHERICAL_BIOME.AlpineTundra]: [0.44, 0.44, 0.4],
  [SPHERICAL_BIOME.MontaneConiferForest]: [0.08, 0.22, 0.16],
  [SPHERICAL_BIOME.MontaneCloudForest]: [0.045, 0.25, 0.15],
}

export class WorldColorizer {
  build(data: SphericalWorldData, mode: GlobeDisplayMode): Float32Array {
    const colors = new Float32Array(data.elevation.length * 3)
    const plateColors = mode === 'plates'
      ? this.buildPlateColors(data.tectonics.plateSeeds.length)
      : null
    const usesUniformBiomeOcean = mode === 'cultures'
      || mode === 'religions'
      || mode === 'polities'
    for (let region = 0; region < data.elevation.length; region++) {
      const target = region * 3
      let color: Rgb
      if (mode === 'plates') {
        const plateIndex = data.tectonics.regionPlate[region] * 3
        colors[target] = plateColors![plateIndex]
        colors[target + 1] = plateColors![plateIndex + 1]
        colors[target + 2] = plateColors![plateIndex + 2]
        continue
      }
      if (
        usesUniformBiomeOcean
        && data.regionFeature[region] === REGION_FEATURE.Ocean
      ) {
        color = BIOME_COLORS[SPHERICAL_BIOME.Ocean]
      }
      else if (mode === 'trade') {
        const intensity = data.human.trade.regionTradeIntensity[region]
        color = intensity > 0
          ? this.mix(
              this.terrainColor(data, region),
              [1, 0.7, 0.12],
              0.1 + intensity * 0.58,
            )
          : this.terrainColor(data, region)
      }
      else if (mode === 'cultures') {
        const culture = data.human.culture.regionCulture[region]
        color = culture >= 0
          ? this.mix(
              this.terrainColor(data, region),
              data.human.culture.cultures[culture]?.color ?? UNASSIGNED_TERRITORY,
              0.58 + data.human.culture.cultureInfluence[region] * 0.38,
            )
          : this.unassignedThematicColor(data, region)
      }
      else if (mode === 'religions') {
        const religion = data.human.religion.regionReligion[region]
        color = religion >= 0
          ? this.mix(
              this.terrainColor(data, region),
              data.human.religion.religions[religion]?.color ?? UNASSIGNED_TERRITORY,
              0.55 + data.human.religion.religionInfluence[region] * 0.4,
            )
          : this.unassignedThematicColor(data, region)
      }
      else if (mode === 'polities') {
        const polity = data.human.politics.regionPolity[region]
        color = polity >= 0
          ? data.human.politics.polities[polity]?.color ?? UNASSIGNED_TERRITORY
          : this.unassignedThematicColor(data, region)
      }
      else if (mode === 'biomes') {
        if (data.regionFeature[region] === REGION_FEATURE.Lake) {
          const iceState = this.getLakeIceState(data, region)
          color = iceState === LAKE_ICE_STATE.Subglacial
            ? BIOME_COLORS[SPHERICAL_BIOME.Ice]
            : iceState === LAKE_ICE_STATE.SeasonallyFrozen
              ? FROZEN_LAKE
              : LAKE
        }
        else {
          color = this.biomeColor(data.climate.biome[region])
        }
      }
      else if (mode === 'elevation') {
        color = this.elevationColor(data.elevation[region])
      }
      else if (mode === 'contours') {
        color = this.elevationColor(Math.floor(data.elevation[region] / 0.05) * 0.05)
      }
      else {
        color = this.terrainColor(data, region)
      }
      colors[target] = color[0]
      colors[target + 1] = color[1]
      colors[target + 2] = color[2]
    }
    return colors
  }

  /**
   * 生成供完整球面底层使用的颜色：海洋保留显示模式对应的水色，
   * 陆地由 stencil 限制的上层单元覆盖。这样海岸线不会依赖可见的
   * 对称缓冲带来填补海陆边界。
   */
  buildWaterBaseColors(data: SphericalWorldData, mode: GlobeDisplayMode): Float32Array {
    const colors = this.build(data, mode)
    if (mode === 'plates')
      return colors
    for (let region = 0; region < data.landMask.length; region++) {
      if (data.landMask[region] === 0)
        continue
      const target = region * 3
      const color = mode === 'elevation'
        ? this.elevationColor(data.elevation[region])
        : mode === 'contours'
          ? this.elevationColor(Math.floor(data.elevation[region] / 0.05) * 0.05)
          : this.oceanColor(data, region)
      colors[target] = color[0]
      colors[target + 1] = color[1]
      colors[target + 2] = color[2]
    }
    return colors
  }

  buildPrecipitationColors(data: SphericalWorldData): Float32Array {
    return this.buildScalarColors(data.climate.precipitation, [0.03, 0.12, 0.24], [0.18, 0.82, 0.96])
  }

  buildMoistureColors(data: SphericalWorldData): Float32Array {
    return this.buildScalarColors(data.climate.moisture, [0.09, 0.04, 0.2], [0.22, 0.95, 0.88])
  }

  buildTemperatureColors(data: SphericalWorldData): Float32Array {
    const colors = new Float32Array(data.climate.temperature.length * 3)
    for (let region = 0; region < data.climate.temperature.length; region++) {
      const temperature = data.climate.temperature[region]
      const color = temperature < 0
        ? this.mix(COLD_TEMPERATURE, FREEZING_TEMPERATURE, (temperature + 30) / 30)
        : temperature < 22
          ? this.mix(FREEZING_TEMPERATURE, TEMPERATE_TEMPERATURE, temperature / 22)
          : this.mix(TEMPERATE_TEMPERATURE, HOT_TEMPERATURE, (temperature - 22) / 16)
      const target = region * 3
      colors[target] = color[0]
      colors[target + 1] = color[1]
      colors[target + 2] = color[2]
    }
    return colors
  }

  buildSeaSurfaceTemperatureColors(data: SphericalWorldData): Float32Array {
    const colors = new Float32Array(data.climate.seaSurfaceTemperature.length * 3)
    for (let region = 0; region < data.climate.seaSurfaceTemperature.length; region++) {
      const temperature = data.climate.seaSurfaceTemperature[region]
      const color = temperature < 2
        ? this.mix(COLD_TEMPERATURE, FREEZING_TEMPERATURE, (temperature + 2) / 4)
        : temperature < 20
          ? this.mix(FREEZING_TEMPERATURE, TEMPERATE_TEMPERATURE, (temperature - 2) / 18)
          : this.mix(TEMPERATE_TEMPERATURE, HOT_TEMPERATURE, (temperature - 20) / 12)
      const target = region * 3
      colors[target] = color[0]
      colors[target + 1] = color[1]
      colors[target + 2] = color[2]
    }
    return colors
  }

  buildFluxColors(data: SphericalWorldData): Float32Array {
    const flowScale = this.getMaskedPercentile(
      data.rivers.flowAccumulation,
      data.landMask,
      0.98,
    )
    return this.buildScalarColors(
      data.rivers.flowAccumulation,
      [0.08, 0.2, 0.1],
      [0.96, 0.78, 0.16],
      true,
      flowScale,
    )
  }

  private terrainColor(data: SphericalWorldData, region: number): Rgb {
    const elevation = data.elevation[region]
    if (data.regionFeature[region] === REGION_FEATURE.Lake) {
      const iceState = this.getLakeIceState(data, region)
      if (iceState === LAKE_ICE_STATE.Subglacial)
        return BIOME_COLORS[SPHERICAL_BIOME.Ice]
      if (iceState === LAKE_ICE_STATE.SeasonallyFrozen)
        return FROZEN_LAKE
      return this.mix(DEEP_OCEAN, LAKE, clamp(elevation / SEA_LEVEL, 0, 1))
    }
    if (elevation < SEA_LEVEL) {
      return this.oceanColor(data, region)
    }

    const biome = data.climate.biome[region] as SphericalBiomeCode
    let color = NATURAL_BIOME_COLORS[biome]
      ?? NATURAL_BIOME_COLORS[SPHERICAL_BIOME.Tundra]
    if (biome === SPHERICAL_BIOME.Ice)
      return color

    const elevationMeters = data.climateElevationMeters[region]
    const annualPrecipitation = data.climate.annualPrecipitationMm[region]
    const meanTemperature = data.climate.temperature[region]
    const warmestTemperature = data.climate.warmestMonthTemperature[region]
    const normalizedElevation = clamp((elevation - SEA_LEVEL) / (1 - SEA_LEVEL), 0, 1)

    // Dry regions expose warm mineral soil; wet formations retain a deeper,
    // darker vegetation signature. Both are continuous to avoid biome bands.
    const aridity = 1 - clamp(annualPrecipitation / 900, 0, 1)
    const warmth = clamp((meanTemperature + 5) / 32, 0, 1)
    color = this.mix(color, DRY_SOIL, aridity * warmth * 0.14)
    const wetness = clamp((annualPrecipitation - 700) / 1800, 0, 1)
    color = this.mix(color, [0.035, 0.17, 0.08], wetness * 0.12)

    // Satellite imagery loses vegetation with altitude and reveals grey-brown
    // ridges. Render elevation adds subtle tonal relief even on the spherical
    // surface, whose geometry itself is not displaced by terrain height.
    const rockExposure = clamp((elevationMeters - 1250) / 2600, 0, 1)
    color = this.mix(color, BARE_ROCK, rockExposure * 0.72)
    color = this.scale(color, 0.94 + normalizedElevation * 0.1)

    // Permanent high-mountain snow depends on both summit height and summer
    // warmth, preventing an implausible fixed white contour across the planet.
    const summit = clamp((elevationMeters - 2300) / 2100, 0, 1)
    const summerCold = clamp((14 - warmestTemperature) / 14, 0, 1)
    const snowCover = summit * (0.12 + summerCold * 0.88)
    return this.mix(color, SNOW, snowCover)
  }

  private unassignedThematicColor(data: SphericalWorldData, region: number): Rgb {
    if (data.regionFeature[region] === REGION_FEATURE.Ocean)
      return BIOME_COLORS[SPHERICAL_BIOME.Ocean]
    if (data.regionFeature[region] === REGION_FEATURE.Lake)
      return this.terrainColor(data, region)
    return UNASSIGNED_TERRITORY
  }

  private oceanColor(data: SphericalWorldData, region: number): Rgb {
    // Use scale-aware bathymetry so the natural palette has an explicit,
    // monotonic visual hierarchy without exposing a one-cell-wide tectonic axis.
    const depthMeters = Math.max(0, -data.naturalBathymetryMeters[region])
    let color: Rgb
    if (depthMeters >= OCEAN_ABYSS_DEPTH_METERS) {
      color = DEEP_OCEAN
    }
    else if (depthMeters >= OCEAN_BASIN_DEPTH_METERS) {
      color = this.mix(
        MID_OCEAN,
        DEEP_OCEAN,
        (depthMeters - OCEAN_BASIN_DEPTH_METERS)
        / (OCEAN_ABYSS_DEPTH_METERS - OCEAN_BASIN_DEPTH_METERS),
      )
    }
    else if (depthMeters >= OCEAN_RIDGE_DEPTH_METERS) {
      color = this.mix(
        RIDGE_OCEAN,
        MID_OCEAN,
        (depthMeters - OCEAN_RIDGE_DEPTH_METERS)
        / (OCEAN_BASIN_DEPTH_METERS - OCEAN_RIDGE_DEPTH_METERS),
      )
    }
    else {
      color = this.mix(
        SHALLOW_OCEAN,
        RIDGE_OCEAN,
        depthMeters / OCEAN_RIDGE_DEPTH_METERS,
      )
    }
    const coastalAmount = clamp(
      (COASTAL_WATER_DEPTH_METERS - depthMeters)
      / COASTAL_WATER_DEPTH_METERS,
      0,
      1,
    )
    const coastalWater = coastalAmount * coastalAmount * (3 - 2 * coastalAmount)
    const tropicalWarmth = clamp(
      (data.climate.seaSurfaceTemperature[region] - 18) / 12,
      0,
      1,
    )
    color = this.mix(color, WARM_SHALLOW_OCEAN, coastalWater * tropicalWarmth * 0.38)
    return color
  }

  private biomeColor(code: number): Rgb {
    return BIOME_COLORS[code as SphericalBiomeCode] ?? BIOME_COLORS[SPHERICAL_BIOME.Ocean]
  }

  private getLakeIceState(data: SphericalWorldData, region: number): number {
    const lakeId = data.lakes.regionLakeId[region]
    return lakeId >= 0
      ? data.lakes.iceState[lakeId] ?? LAKE_ICE_STATE.OpenWater
      : LAKE_ICE_STATE.OpenWater
  }

  private elevationColor(elevation: number): Rgb {
    const normalized = clamp(elevation, 0, 1)
    if (normalized < SEA_LEVEL)
      return this.mix(DEEP_OCEAN, SHALLOW_OCEAN, normalized / SEA_LEVEL)
    if (normalized < 0.48)
      return this.mix([0.1, 0.56, 0.46], [0.75, 0.78, 0.25], (normalized - SEA_LEVEL) / 0.28)
    if (normalized < 0.75)
      return this.mix([0.75, 0.78, 0.25], [0.72, 0.32, 0.18], (normalized - 0.48) / 0.27)
    return this.mix([0.72, 0.32, 0.18], SNOW, (normalized - 0.75) / 0.25)
  }

  private buildPlateColors(count: number): Float32Array {
    const colors = new Float32Array(count * 3)
    for (let plate = 0; plate < count; plate++) {
      const hue = (plate * 0.61803398875 + 0.08) % 1
      const color = this.hslToRgb(hue, 0.58, 0.5)
      const index = plate * 3
      colors[index] = color[0]
      colors[index + 1] = color[1]
      colors[index + 2] = color[2]
    }
    return colors
  }

  private buildScalarColors(
    values: Float32Array,
    low: Rgb,
    high: Rgb,
    logarithmic = false,
    maximumOverride?: number,
  ): Float32Array {
    const colors = new Float32Array(values.length * 3)
    let maximum = maximumOverride ?? 0
    if (maximumOverride === undefined) {
      for (const value of values)
        maximum = Math.max(maximum, value)
    }
    const denominator = logarithmic ? Math.log1p(maximum) : maximum
    for (let region = 0; region < values.length; region++) {
      const normalized = denominator > 0
        ? logarithmic
          ? Math.log1p(Math.max(0, values[region])) / denominator
          : values[region] / denominator
        : 0
      const color = this.mix(low, high, normalized)
      const target = region * 3
      colors[target] = color[0]
      colors[target + 1] = color[1]
      colors[target + 2] = color[2]
    }
    return colors
  }

  private getMaskedPercentile(
    values: Float32Array,
    mask: Uint8Array,
    percentile: number,
  ): number {
    const samples: number[] = []
    for (let region = 0; region < values.length; region++) {
      if (mask[region] !== 0 && values[region] > 0)
        samples.push(values[region])
    }
    if (samples.length === 0)
      return 0
    samples.sort((a, b) => a - b)
    return samples[Math.floor((samples.length - 1) * clamp(percentile, 0, 1))]
  }

  private mix(a: Rgb, b: Rgb, amount: number): Rgb {
    const t = clamp(amount, 0, 1)
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ]
  }

  private scale(color: Rgb, amount: number): Rgb {
    return [
      clamp(color[0] * amount, 0, 1),
      clamp(color[1] * amount, 0, 1),
      clamp(color[2] * amount, 0, 1),
    ]
  }

  private hslToRgb(h: number, s: number, l: number): Rgb {
    const hueToRgb = (p: number, q: number, input: number) => {
      let t = input
      if (t < 0)
        t += 1
      if (t > 1)
        t -= 1
      if (t < 1 / 6)
        return p + (q - p) * 6 * t
      if (t < 1 / 2)
        return q
      if (t < 2 / 3)
        return p + (q - p) * (2 / 3 - t) * 6
      return p
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)]
  }
}
