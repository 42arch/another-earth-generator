import { SEA_LEVEL } from '@/constants'
import { clamp } from '@/core/spherical/geometry/spherical-math'

const LAND_EPSILON = 1e-4
const MAX_LAND_ELEVATION_METERS = 9000
const MAX_OCEAN_DEPTH_METERS = 9000

export function physicalElevationToRender(physicalElevationMeters: number): number {
  if (physicalElevationMeters >= 0) {
    const normalized = clamp(
      physicalElevationMeters / MAX_LAND_ELEVATION_METERS,
      0,
      1,
    )
    return clamp(
      SEA_LEVEL + LAND_EPSILON
      + normalized ** 0.62 * (1 - SEA_LEVEL - LAND_EPSILON),
      SEA_LEVEL + LAND_EPSILON,
      1,
    )
  }
  const normalizedDepth = clamp(
    -physicalElevationMeters / MAX_OCEAN_DEPTH_METERS,
    0,
    1,
  )
  return clamp(
    SEA_LEVEL * (1 - normalizedDepth ** 0.72),
    0,
    SEA_LEVEL - LAND_EPSILON,
  )
}

/** Convert the existing normalized river-source control to a physical height. */
export function riverSourceElevationMeters(value: number): number {
  return MAX_LAND_ELEVATION_METERS
    * clamp((value - SEA_LEVEL - LAND_EPSILON) / (1 - SEA_LEVEL - LAND_EPSILON), 0, 1) ** (1 / 0.62)
}
