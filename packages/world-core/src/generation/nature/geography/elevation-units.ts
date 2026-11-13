/** Public elevation fields use kilometres relative to mean sea level. */
export const MAX_LAND_ELEVATION_KM = 7.7
export const OCEAN_DEPTH_KM_PER_NORMALIZED_UNIT = 8
export const ELEVATION_DELTA_KM_PER_NORMALIZED_UNIT = 18
const TRENCH_START_COORDINATE = -0.6
const TRENCH_EXTRA_DEPTH_KM = 6
const TRENCH_WIDTH_COORDINATE = 0.09

// Calibrated against area-weighted Earth elevation bands: about 74% of land
// below 1 km and about 8% above 2.5 km, while retaining a sparse high tail.
const LAND_STOPS = [
  [0, 0],
  [0.2, 0.37],
  [0.4, 0.92],
  [0.65, 2.5],
  [0.85, 4.5],
  [0.9, 5.1],
  [1, MAX_LAND_ELEVATION_KM],
] as const

function interiorGradient(
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

const LAND_GRADIENTS = LAND_STOPS.map((stop, index) => {
  if (index === 0)
    return (LAND_STOPS[1][1] - stop[1]) / (LAND_STOPS[1][0] - stop[0])
  if (index === LAND_STOPS.length - 1)
    return ELEVATION_DELTA_KM_PER_NORMALIZED_UNIT
  return interiorGradient(LAND_STOPS[index - 1], stop, LAND_STOPS[index + 1])
})

/** Converts shaping coordinates into km with an Earth-like land transfer curve. */
export function normalizedElevationToKm(elevation: number): number {
  if (elevation <= 0) {
    const base = elevation * OCEAN_DEPTH_KM_PER_NORMALIZED_UNIT
    if (elevation >= TRENCH_START_COORDINATE)
      return base
    const distance = (TRENCH_START_COORDINATE - elevation) / TRENCH_WIDTH_COORDINATE
    // Deepest coordinates occur at subduction margins; add a smooth, bounded
    // tail without shifting the abyssal plain or the sea-level crossing.
    return base - TRENCH_EXTRA_DEPTH_KM * (1 - Math.exp(-distance * distance))
  }
  if (elevation > 1)
    return MAX_LAND_ELEVATION_KM + (elevation - 1) * ELEVATION_DELTA_KM_PER_NORMALIZED_UNIT

  let index = 1
  while (index < LAND_STOPS.length - 1 && elevation > LAND_STOPS[index][0])
    index++
  const [start, startKm] = LAND_STOPS[index - 1]
  const [end, endKm] = LAND_STOPS[index]
  const width = end - start
  const t = (elevation - start) / width
  const squared = t * t
  const cubed = squared * t
  return (2 * cubed - 3 * squared + 1) * startKm
    + (cubed - 2 * squared + t) * width * LAND_GRADIENTS[index - 1]
    + (-2 * cubed + 3 * squared) * endKm
    + (cubed - squared) * width * LAND_GRADIENTS[index]
}

export function normalizedElevationArrayToKm(source: Float32Array): Float32Array {
  const result = new Float32Array(source.length)
  for (let index = 0; index < source.length; index++)
    result[index] = normalizedElevationToKm(source[index])
  return result
}
