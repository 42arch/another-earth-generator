import type { WorldMapReader } from '@another-earth/world-core'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1), 0, 1)
  return t * t * (3 - 2 * t)
}

function mixRgb(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  const u = clamp(t, 0, 1)
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
  ]
}

function scaleRgb(
  rgb: readonly [number, number, number],
  factor: number,
): [number, number, number] {
  return [
    clamp(rgb[0] * factor, 0, 1),
    clamp(rgb[1] * factor, 0, 1),
    clamp(rgb[2] * factor, 0, 1),
  ]
}

const ROCK_COLOR: readonly [number, number, number] = [0.39, 0.37, 0.33]
const SNOW_COLOR: readonly [number, number, number] = [0.83, 0.87, 0.90]
const DEEP_OCEAN_COLOR: readonly [number, number, number] = [0.018, 0.075, 0.17]
const SHALLOW_OCEAN_COLOR: readonly [number, number, number] = [0.065, 0.28, 0.34]
const COLD_DRY_COLOR: readonly [number, number, number] = [0.48, 0.46, 0.39]
const WARM_DRY_COLOR: readonly [number, number, number] = [0.66, 0.49, 0.30]
const COLD_VEGETATED_COLOR: readonly [number, number, number] = [0.20, 0.29, 0.24]
const WARM_VEGETATED_COLOR: readonly [number, number, number] = [0.065, 0.27, 0.09]

const SATELLITE_SHALLOW_WATER_LIMIT_KM = 1.0

function linearToSrgbByte(linear: number): number {
  const c = clamp(linear, 0, 1)
  const srgb = c <= 0.0031308 ? c * 12.92 : 1.055 * (c ** (1 / 2.4)) - 0.055
  return clamp(Math.round(srgb * 255), 0, 255)
}

export interface SatelliteSurfaceOptions {
  readonly hillshadeStrength?: number
  readonly opacity?: number
}

/**
 * Evaluates natural-looking satellite RGBA8 colors for all Voronoi cells from continuous
 * bathymetry (`elevationKm`), climate (`annualMeanTemperatureC`, `annualPrecipitationMm`, `aridityIndex`),
 * alpine/snow lines, deterministic multi-channel `surfaceDetail` micro-texture, and `hillshade` relief.
 */
export function writeSatelliteCellColorsRgba8(
  reader: WorldMapReader,
  targetRgba: Uint8Array,
  options: SatelliteSurfaceOptions = {},
): void {
  const count = reader.identity.regionCount
  const hillshadeStrength = clamp(options.hillshadeStrength ?? 1.0, 0, 1)
  const alphaByte = Math.round(clamp(options.opacity ?? 1, 0, 1) * 255)

  const landMask = reader.field('landMask')
  const elevationKmField = reader.field('elevationKm')
  const annualTempField = reader.field('annualMeanTemperatureC')
  const annualPrecipField = reader.field('annualPrecipitationMm')
  const aridityField = reader.field('aridityIndex')
  const surfaceDetailField = reader.field('surfaceDetail')
  const hillshadeField = reader.field('hillshade')

  for (let r = 0; r < count; r++) {
    const isLand = landMask.get(r) > 0
    const elevationKm = elevationKmField.get(r)
    const detail = surfaceDetailField.get(r)
    let rgb: [number, number, number]

    if (!isLand) {
      const depthKm = Math.max(0, -elevationKm)
      const shallowWater = 1 - smoothstep(0.015, SATELLITE_SHALLOW_WATER_LIMIT_KM, depthKm)
      rgb = mixRgb(DEEP_OCEAN_COLOR, SHALLOW_OCEAN_COLOR, shallowWater)
      rgb = scaleRgb(rgb, 1 + clamp(detail, -0.025, 0.025))
    }
    else {
      const annualTempC = annualTempField.get(r)
      const annualPrecipMm = annualPrecipField.get(r)
      const aridity = aridityField.get(r)

      const thermal = smoothstep(-18, 26, annualTempC)
      const aridityWetness = smoothstep(0.12, 0.85, aridity)
      const precipWetness = smoothstep(120, 1800, annualPrecipMm)
      const wetness = clamp(aridityWetness * 0.68 + precipWetness * 0.32, 0, 1)

      const dryColor = mixRgb(COLD_DRY_COLOR, WARM_DRY_COLOR, thermal)
      const vegetatedColor = mixRgb(COLD_VEGETATED_COLOR, WARM_VEGETATED_COLOR, thermal)
      rgb = mixRgb(dryColor, vegetatedColor, wetness)
      rgb = scaleRgb(rgb, 1 + clamp(detail, -0.14, 0.14))

      const treeLineKm = 0.65 + 2.9 * thermal
      const alpineFactor = smoothstep(treeLineKm, treeLineKm + 1.8, Math.max(0, elevationKm)) * 0.82
      rgb = mixRgb(rgb, ROCK_COLOR, alpineFactor)

      const coldness = 1 - smoothstep(-10, 3, annualTempC)
      const snowLineKm = 0.6 + 5.0 * thermal
      const altitudeSnow = smoothstep(snowLineKm, snowLineKm + 1.6, Math.max(0, elevationKm)) * (0.88 - 0.38 * thermal)
      const snowFactor = clamp(coldness * 0.72 + altitudeSnow, 0, 0.92)
      rgb = mixRgb(rgb, SNOW_COLOR, snowFactor)

      if (hillshadeStrength > 0) {
        const rawShade = hillshadeField.get(r)
        const shade = 1 + (rawShade - 1) * hillshadeStrength
        rgb = scaleRgb(rgb, shade)
      }
    }

    const offset = r * 4
    targetRgba[offset] = linearToSrgbByte(rgb[0])
    targetRgba[offset + 1] = linearToSrgbByte(rgb[1])
    targetRgba[offset + 2] = linearToSrgbByte(rgb[2])
    targetRgba[offset + 3] = alphaByte
  }
}

/**
 * Applies analytical hillshade modulation to an existing per-cell RGBA8 buffer
 * using the precomputed `hillshade` field from `WorldMapReader`.
 */
export function applyCellHillshadeRgba8(
  reader: WorldMapReader,
  targetRgba: Uint8Array,
  hillshadeStrength: number,
): void {
  const strength = clamp(hillshadeStrength, 0, 1)
  if (strength <= 1e-4)
    return

  const count = reader.identity.regionCount
  const landMask = reader.field('landMask')
  const hillshadeField = reader.field('hillshade')

  for (let r = 0; r < count; r++) {
    if (landMask.get(r) <= 0)
      continue
    const rawShade = hillshadeField.get(r)
    const shade = 1 + (rawShade - 1) * (strength / 0.35)
    const offset = r * 4
    targetRgba[offset] = clamp(Math.round(targetRgba[offset] * shade), 0, 255)
    targetRgba[offset + 1] = clamp(Math.round(targetRgba[offset + 1] * shade), 0, 255)
    targetRgba[offset + 2] = clamp(Math.round(targetRgba[offset + 2] * shade), 0, 255)
  }
}

export function parseCssColorToRgba8(colorStr: string): readonly [number, number, number, number] {
  if (!colorStr || typeof colorStr !== 'string')
    return [0, 0, 0, 255]
  const trimmed = colorStr.trim()
  if (/^#[\da-f]{6}$/i.test(trimmed)) {
    const val = Number.parseInt(trimmed.slice(1), 16)
    return [(val >> 16) & 0xFF, (val >> 8) & 0xFF, val & 0xFF, 255]
  }
  if (/^#[\da-f]{8}$/i.test(trimmed)) {
    const val = Number.parseInt(trimmed.slice(1), 16) >>> 0
    return [(val >>> 24) & 0xFF, (val >>> 16) & 0xFF, (val >>> 8) & 0xFF, val & 0xFF]
  }
  if (/^#[\da-f]{3}$/i.test(trimmed)) {
    return [
      Number.parseInt(trimmed[1] + trimmed[1], 16),
      Number.parseInt(trimmed[2] + trimmed[2], 16),
      Number.parseInt(trimmed[3] + trimmed[3], 16),
      255,
    ]
  }
  const rgbaMatch = trimmed.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i)
  if (rgbaMatch) {
    return [
      clamp(Math.round(Number(rgbaMatch[1])), 0, 255),
      clamp(Math.round(Number(rgbaMatch[2])), 0, 255),
      clamp(Math.round(Number(rgbaMatch[3])), 0, 255),
      rgbaMatch[4] !== undefined ? clamp(Math.round(Number(rgbaMatch[4]) * 255), 0, 255) : 255,
    ]
  }
  return [128, 128, 128, 255]
}
