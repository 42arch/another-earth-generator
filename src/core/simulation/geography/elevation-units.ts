/** Public elevation fields use kilometres relative to mean sea level. */
export const MAX_LAND_ELEVATION_KM = 6
export const OCEAN_DEPTH_KM_PER_NORMALIZED_UNIT = 8
export const ELEVATION_DELTA_KM_PER_NORMALIZED_UNIT = 6

/** Converts the reference generator's shaping coordinate into physical kilometres. */
export function normalizedElevationToKm(elevation: number): number {
  if (elevation <= 0)
    return elevation * OCEAN_DEPTH_KM_PER_NORMALIZED_UNIT

  const value = Math.min(elevation, 1)
  const squared = value * value
  const shaped = MAX_LAND_ELEVATION_KM
    * squared
    * squared
    * (5 - 4 * value)
  return elevation > 1
    ? shaped + (elevation - 1) * ELEVATION_DELTA_KM_PER_NORMALIZED_UNIT
    : shaped
}

/** Restores the reference shaping coordinate for display-only relief. */
export function elevationKmToDisplayCoordinate(elevationKm: number): number {
  if (elevationKm <= 0)
    return elevationKm / OCEAN_DEPTH_KM_PER_NORMALIZED_UNIT
  if (elevationKm >= MAX_LAND_ELEVATION_KM) {
    return 1 + (elevationKm - MAX_LAND_ELEVATION_KM)
      / ELEVATION_DELTA_KM_PER_NORMALIZED_UNIT
  }

  let lower = 0
  let upper = 1
  for (let iteration = 0; iteration < 14; iteration++) {
    const middle = (lower + upper) * 0.5
    if (normalizedElevationToKm(middle) < elevationKm)
      lower = middle
    else
      upper = middle
  }
  return (lower + upper) * 0.5
}

export function normalizedElevationArrayToKm(source: Float32Array): Float32Array {
  const result = new Float32Array(source.length)
  for (let index = 0; index < source.length; index++)
    result[index] = normalizedElevationToKm(source[index])
  return result
}

/** Converts additive diagnostic contributions to kilometres. */
export function normalizedElevationDeltaArrayToKm(source: Float32Array): Float32Array {
  const result = new Float32Array(source.length)
  for (let index = 0; index < source.length; index++)
    result[index] = source[index] * ELEVATION_DELTA_KM_PER_NORMALIZED_UNIT
  return result
}
