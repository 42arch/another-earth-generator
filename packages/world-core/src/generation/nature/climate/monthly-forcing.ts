import type { SeasonalCirculationData } from './climate-data'
import { ITCZ_LONGITUDE_SAMPLES } from './climate-data'
import { DEG } from './climate-geometry'

/** Four equal-phase circulation anchors: March equinox through December solstice. */
export interface MonthlyForcing {
  days: number
  solarDeclination: number
  orbitalPhase: number
  itczLatitude: Float32Array
  pressureHpa: Float32Array
  windEast: Float32Array
  windNorth: Float32Array
  monsoonEast: Float32Array
  oceanEast: Float32Array
  oceanNorth: Float32Array
  oceanWarmth: Float32Array
}

export function interpolateMonthlyForcing(circulation: SeasonalCirculationData, month: number, axialTiltDeg: number, orbitalPeriodDays: number): MonthlyForcing {
  if (!Number.isInteger(month) || month < 0 || month >= 12)
    throw new RangeError(`Invalid climate month: ${month}`)
  if (!Number.isFinite(axialTiltDeg) || axialTiltDeg < 0 || axialTiltDeg > 45 || !Number.isFinite(orbitalPeriodDays) || orbitalPeriodDays <= 0)
    throw new RangeError('Invalid Earthlike orbital forcing')
  // Month zero is January-like. Every bin spans one twelfth of the planet year.
  const yearPosition = (month + 0.5) / 12
  const equinoxPosition = 79 / 365
  const phase = (yearPosition - equinoxPosition + 1) % 1
  const lowerSeason = Math.floor(phase * 4)
  const upperSeason = (lowerSeason + 1) % 4
  const t = phase * 4 - lowerSeason
  const blend = 0.5 - 0.5 * Math.cos(Math.PI * t)
  const count = circulation.regionCount
  const interpolate = (source: Float32Array, stride: number): Float32Array => {
    const result = new Float32Array(stride)
    const lowerOffset = lowerSeason * stride
    const upperOffset = upperSeason * stride
    for (let index = 0; index < stride; index++)
      result[index] = source[lowerOffset + index] * (1 - blend) + source[upperOffset + index] * blend
    return result
  }
  const orbitalPhase = 2 * Math.PI * phase
  const tilt = axialTiltDeg * DEG
  return {
    days: orbitalPeriodDays / 12,
    solarDeclination: Math.asin(Math.sin(tilt) * Math.sin(orbitalPhase)),
    orbitalPhase,
    itczLatitude: interpolate(circulation.itczLatitude, ITCZ_LONGITUDE_SAMPLES),
    pressureHpa: interpolate(circulation.pressureHpa, count),
    windEast: interpolate(circulation.windEast, count),
    windNorth: interpolate(circulation.windNorth, count),
    monsoonEast: interpolate(circulation.monsoonEast, count),
    oceanEast: interpolate(circulation.oceanEast, count),
    oceanNorth: interpolate(circulation.oceanNorth, count),
    oceanWarmth: interpolate(circulation.oceanWarmth, count),
  }
}

export function itczAtLongitude(itczLatitude: Float32Array, longitude: number): number {
  const count = ITCZ_LONGITUDE_SAMPLES
  const position = ((longitude + Math.PI) / (2 * Math.PI) * count - 0.5 + count) % count
  const lower = Math.floor(position)
  const fraction = position - lower
  return itczLatitude[lower] * (1 - fraction) + itczLatitude[(lower + 1) % count] * fraction
}
