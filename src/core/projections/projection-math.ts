import type { GeographicPoint } from '@/core/projections/map-projection'

export const FULL_LONGITUDE = Math.PI * 2

// Geographic frame: +Y is north, +Z is the zero meridian, and +X is 90°E.

export function wrapLongitude(longitude: number): number {
  return ((longitude + Math.PI) % FULL_LONGITUDE + FULL_LONGITUDE) % FULL_LONGITUDE - Math.PI
}

export function unwrapLongitudeNear(longitude: number, reference: number): number {
  let result = longitude
  while (result - reference > Math.PI)
    result -= FULL_LONGITUDE
  while (result - reference < -Math.PI)
    result += FULL_LONGITUDE
  return result
}

export function cartesianToGeographic(
  x: number,
  y: number,
  z: number,
): GeographicPoint {
  return {
    longitude: Math.atan2(x, z),
    latitude: Math.atan2(y, Math.hypot(x, z)),
  }
}

export function geographicToCartesian(
  longitude: number,
  latitude: number,
): readonly [number, number, number] {
  const horizontalRadius = Math.cos(latitude)
  return [
    Math.sin(longitude) * horizontalRadius,
    Math.sin(latitude),
    Math.cos(longitude) * horizontalRadius,
  ]
}
