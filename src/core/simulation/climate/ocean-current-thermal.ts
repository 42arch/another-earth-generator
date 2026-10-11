/** Values near zero have no reliable cold/warm sign after spatial projection. */
export const OCEAN_CURRENT_THERMAL_THRESHOLD = 0.08

export function classifyOceanCurrentThermal(warmth: number): 'cold' | 'neutral' | 'warm' {
  if (warmth <= -OCEAN_CURRENT_THERMAL_THRESHOLD)
    return 'cold'
  if (warmth >= OCEAN_CURRENT_THERMAL_THRESHOLD)
    return 'warm'
  return 'neutral'
}
