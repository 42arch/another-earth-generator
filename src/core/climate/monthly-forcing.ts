import type { SeasonalCirculationData } from '@/core/climate/climate-data'
import { ITCZ_LONGITUDE_SAMPLES } from '@/core/climate/climate-data'
import { clamp, DEG } from '@/core/climate/climate-geometry'

/** Non-leap calendar; month 0 is January. */
export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const
const ANCHOR_DAYS = [79, 172, 266, 355, 444] as const
const YEAR_DAYS = 365

export interface MonthlyForcing {
  days: number
  /** Radians at the middle of this calendar month. */
  solarDeclination: number
  /** Orbital angle since the March equinox, in radians. */
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

function monthMidpoint(month: number): number {
  let start = 0
  for (let index = 0; index < month; index++)
    start += MONTH_DAYS[index]
  return start + MONTH_DAYS[month] / 2
}

export function interpolateMonthlyForcing(
  circulation: SeasonalCirculationData,
  month: number,
  axialTiltDeg: number,
): MonthlyForcing {
  if (!Number.isInteger(month) || month < 0 || month >= MONTH_DAYS.length)
    throw new RangeError(`Invalid climate month: ${month}`)
  const midpoint = monthMidpoint(month)
  const wrappedDay = midpoint < ANCHOR_DAYS[0] ? midpoint + YEAR_DAYS : midpoint
  let lowerSeason = 0
  while (wrappedDay >= ANCHOR_DAYS[lowerSeason + 1])
    lowerSeason++
  const upperSeason = (lowerSeason + 1) % 4
  const t = (wrappedDay - ANCHOR_DAYS[lowerSeason])
    / (ANCHOR_DAYS[lowerSeason + 1] - ANCHOR_DAYS[lowerSeason])
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

  const orbitalPhase = 2 * Math.PI * (midpoint - ANCHOR_DAYS[0]) / YEAR_DAYS
  const tilt = clamp(axialTiltDeg, 0, 90) * DEG
  return {
    days: MONTH_DAYS[month],
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

/** Longitude bins are centred at -177.5°, -172.5°, …, 177.5°. */
export function itczAtLongitude(itczLatitude: Float32Array, longitude: number): number {
  const count = ITCZ_LONGITUDE_SAMPLES
  const position = ((longitude + Math.PI) / (2 * Math.PI) * count - 0.5 + count) % count
  const lower = Math.floor(position)
  const fraction = position - lower
  return itczLatitude[lower] * (1 - fraction) + itczLatitude[(lower + 1) % count] * fraction
}
