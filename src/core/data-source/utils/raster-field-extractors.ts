import type { ClimateVectorDisplayData } from '@/core/simulation/climate/climate-data'

/**
 * Extracts speed magnitude from a 2D vector field.
 */
export function extractVectorSpeed(
  vector: ClimateVectorDisplayData | undefined,
  count: number,
  isLand?: Uint8Array,
  maskLand = false,
): Float32Array {
  const speed = new Float32Array(count)
  if (!vector || vector.east.length !== count || vector.north.length !== count)
    return speed
  const east = vector.east
  const north = vector.north
  for (let i = 0; i < count; i++) {
    if (maskLand && isLand && isLand[i])
      continue
    speed[i] = Math.hypot(east[i], north[i])
  }
  return speed
}

/**
 * Extracts sea surface warmth temperature anomaly from an ocean current vector field.
 */
export function extractOceanWarmth(
  vector: ClimateVectorDisplayData | undefined,
  count: number,
  isLand?: Uint8Array,
): Float32Array {
  const warmth = new Float32Array(count)
  if (!vector || !vector.warmth || vector.warmth.length !== count)
    return warmth
  const raw = vector.warmth
  for (let i = 0; i < count; i++) {
    if (isLand && isLand[i])
      continue
    warmth[i] = raw[i]
  }
  return warmth
}
