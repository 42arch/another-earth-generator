/** Values near zero have no reliable cold/warm sign after spatial projection. */
export const OCEAN_CURRENT_THERMAL_THRESHOLD = 0.08

export const OCEAN_CURRENT_THERMAL_COLORS = {
  cold: '#8dd8ff',
  neutral: '#e4eef2',
  warm: '#ffa75e',
} as const

export function classifyOceanCurrentThermal(warmth: number): keyof typeof OCEAN_CURRENT_THERMAL_COLORS {
  if (warmth <= -OCEAN_CURRENT_THERMAL_THRESHOLD)
    return 'cold'
  if (warmth >= OCEAN_CURRENT_THERMAL_THRESHOLD)
    return 'warm'
  return 'neutral'
}
