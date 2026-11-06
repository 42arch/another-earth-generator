/** Public elevation fields use kilometres relative to mean sea level. */
export const MAX_LAND_ELEVATION_KM = 6
export const OCEAN_DEPTH_KM_PER_NORMALIZED_UNIT = 8
export const ELEVATION_DELTA_KM_PER_NORMALIZED_UNIT = 6

// Give 3–4 km uplands a wider coordinate interval, reserving >5 km for peaks.
const UPLAND_STOPS = [[0.5, 3], [0.72, 4], [0.82, 5], [1, MAX_LAND_ELEVATION_KM]] as const

function uplandGradient(
  previous: readonly [number, number],
  current: readonly [number, number],
  next: readonly [number, number],
): number {
  const before = current[0] - previous[0]
  const after = next[0] - current[0]
  const beforeSlope = (current[1] - previous[1]) / before
  const afterSlope = (next[1] - current[1]) / after
  // Weighted harmonic slopes keep the Hermite segments monotone.
  return 3 * (before + after)
    / ((2 * after + before) / beforeSlope + (after + 2 * before) / afterSlope)
}

const UPLAND_GRADIENTS = [
  9, // Match the lowland curve's derivative at 0.5.
  uplandGradient(UPLAND_STOPS[0], UPLAND_STOPS[1], UPLAND_STOPS[2]),
  uplandGradient(UPLAND_STOPS[1], UPLAND_STOPS[2], UPLAND_STOPS[3]),
  ELEVATION_DELTA_KM_PER_NORMALIZED_UNIT, // Match the >1 linear extension.
]

function uplandElevationToKm(elevation: number): number {
  let index = 1
  while (index < UPLAND_STOPS.length - 1 && elevation > UPLAND_STOPS[index][0])
    index++
  const [start, startKm] = UPLAND_STOPS[index - 1]
  const [end, endKm] = UPLAND_STOPS[index]
  const width = end - start
  const t = (elevation - start) / width
  const squared = t * t
  const cubed = squared * t
  return (2 * cubed - 3 * squared + 1) * startKm
    + (cubed - 2 * squared + t) * width * UPLAND_GRADIENTS[index - 1]
    + (-2 * cubed + 3 * squared) * endKm
    + (cubed - squared) * width * UPLAND_GRADIENTS[index]
}

/** Converts shaping coordinates into km with the terrain-v19 upland transfer curve. */
export function normalizedElevationToKm(elevation: number): number {
  if (elevation <= 0)
    return elevation * OCEAN_DEPTH_KM_PER_NORMALIZED_UNIT

  const value = Math.min(elevation, 1)
  const shaped = value <= 0.5
    ? MAX_LAND_ELEVATION_KM * (value * value) * (3 - 2 * value)
    : uplandElevationToKm(value)
  return elevation > 1
    ? shaped + (elevation - 1) * ELEVATION_DELTA_KM_PER_NORMALIZED_UNIT
    : shaped
}

export function normalizedElevationArrayToKm(source: Float32Array): Float32Array {
  const result = new Float32Array(source.length)
  for (let index = 0; index < source.length; index++)
    result[index] = normalizedElevationToKm(source[index])
  return result
}
