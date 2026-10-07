import {
  interpolateBlues,
  interpolateMagma,
  interpolateRdBu,
} from 'd3-scale-chromatic'
import { clamp } from '@/core/math/math'

export function getWindColor(strength: number): string {
  const value = clamp(strength, 0, 1)
  return interpolateMagma(0.9 - 0.78 * value)
}

export function getOceanCurrentSpeedColor(strength: number): string {
  const value = clamp(strength, 0, 1)
  return interpolateBlues(0.32 + 0.5 * value)
}

export function getOceanCurrentThermalColor(warmth: number): string {
  const value = clamp(warmth, -1, 1)
  return interpolateRdBu(0.5 - 0.5 * value)
}

export const OCEAN_CURRENT_THERMAL_COLORS = {
  cold: getOceanCurrentThermalColor(-1),
  neutral: getOceanCurrentThermalColor(0),
  warm: getOceanCurrentThermalColor(1),
} as const
