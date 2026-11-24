import type { LonLatTuple } from '#projections/spherical-math'
import { DEG_TO_RAD, RAD_TO_DEG, wrapLongitudeDeg } from '#projections/spherical-math'

export type MapProjectionId = 'equirectangular' | 'equal-earth' | 'mercator'

export const MERCATOR_MAX_LATITUDE_DEGREES = 85.05112877980659

export interface MapProjection {
  readonly id: MapProjectionId
  readonly name: string
  readonly worldWidth: number
  readonly worldHeight: number
  readonly maxLatitudeDegrees: number
  readonly supportsHorizontalWrap: boolean
  /**
   * Projects geographic coordinates `(longitudeDegrees, latitudeDegrees)` into 2D planar world coordinates `[x, y]`.
   */
  project: (longitudeDegrees: number, latitudeDegrees: number) => [x: number, y: number]
  /**
   * Inverts 2D planar world coordinates `(x, y)` back into `[longitudeDegrees, latitudeDegrees]`,
   * or returns `null` if `(x, y)` lies outside the projection's valid domain.
   */
  invert: (x: number, y: number) => [longitudeDegrees: number, latitudeDegrees: number] | null
}

/**
 * Equirectangular (Plate Carrée) projection:
 * - `x = lonRad` in `[-PI, PI]` (`worldWidth = 2 * PI`)
 * - `y = latRad` in `[-PI/2, PI/2]` (`worldHeight = PI`)
 */
export const EQUIRECTANGULAR_PROJECTION: MapProjection = Object.freeze({
  id: 'equirectangular',
  name: '等距圆柱投影',
  worldWidth: Math.PI * 2,
  worldHeight: Math.PI,
  maxLatitudeDegrees: 90,
  supportsHorizontalWrap: true,
  project(longitudeDegrees: number, latitudeDegrees: number): [number, number] {
    const clampedLat = Math.max(-90, Math.min(90, latitudeDegrees))
    const clampedLon = Math.max(-180, Math.min(180, longitudeDegrees))
    return [clampedLon * DEG_TO_RAD, clampedLat * DEG_TO_RAD]
  },
  invert(x: number, y: number): [number, number] | null {
    if (!Number.isFinite(x) || !Number.isFinite(y))
      return null
    const halfH = Math.PI * 0.5
    if (Math.abs(y) > halfH + 1e-6)
      return null
    const clampedY = Math.max(-halfH, Math.min(halfH, y))
    const lonDeg = wrapLongitudeDeg(x * RAD_TO_DEG)
    const latDeg = clampedY * RAD_TO_DEG
    return [lonDeg, Object.is(latDeg, -0) ? 0 : latDeg]
  },
})

// Equal Earth polynomial coefficients (Šavrič et al., 2018)
const EE_A1 = 1.340264
const EE_A2 = -0.081106
const EE_A3 = 0.000893
const EE_A4 = 0.003796
const EE_SIN_FACTOR = Math.sqrt(3) * 0.5
const EE_THETA_MAX = Math.asin(EE_SIN_FACTOR) // PI / 3
const EE_THETA_MAX2 = EE_THETA_MAX * EE_THETA_MAX
const EE_THETA_MAX6 = EE_THETA_MAX2 * EE_THETA_MAX2 * EE_THETA_MAX2
const EE_RAW_Y_MAX = EE_THETA_MAX * (EE_A1 + EE_A2 * EE_THETA_MAX2 + EE_THETA_MAX6 * (EE_A3 + EE_A4 * EE_THETA_MAX2))
const EE_RAW_X_MAX = (2 * Math.sqrt(3) * Math.PI) / (3 * EE_A1)
// Normalize so worldHeight = PI (matching Equirectangular)
const EE_SCALE = (Math.PI * 0.5) / EE_RAW_Y_MAX

/**
 * Equal Earth equal-area pseudocylindrical projection (Šavrič et al., 2018).
 * Normalized so `worldHeight = PI` and inverse solved via 12-step Newton-Raphson (`error < 1e-11`).
 */
export const EQUAL_EARTH_PROJECTION: MapProjection = Object.freeze({
  id: 'equal-earth',
  name: 'Equal Earth 等积投影',
  worldWidth: EE_RAW_X_MAX * 2 * EE_SCALE,
  worldHeight: Math.PI,
  maxLatitudeDegrees: 90,
  supportsHorizontalWrap: false,
  project(longitudeDegrees: number, latitudeDegrees: number): [number, number] {
    const clampedLat = Math.max(-90, Math.min(90, latitudeDegrees))
    const clampedLon = Math.max(-180, Math.min(180, longitudeDegrees))
    const lam = clampedLon * DEG_TO_RAD
    const phi = clampedLat * DEG_TO_RAD
    const sinTheta = Math.max(-1, Math.min(1, EE_SIN_FACTOR * Math.sin(phi)))
    const theta = Math.asin(sinTheta)
    const theta2 = theta * theta
    const theta6 = theta2 * theta2 * theta2
    const deriv = EE_A1 + 3 * EE_A2 * theta2 + theta6 * (7 * EE_A3 + 9 * EE_A4 * theta2)
    const rawX = (2 * Math.sqrt(3) * lam * Math.cos(theta)) / (3 * deriv)
    const rawY = theta * (EE_A1 + EE_A2 * theta2 + theta6 * (EE_A3 + EE_A4 * theta2))
    return [rawX * EE_SCALE, rawY * EE_SCALE]
  },
  invert(x: number, y: number): [number, number] | null {
    if (!Number.isFinite(x) || !Number.isFinite(y))
      return null
    const rawX = x / EE_SCALE
    const rawY = y / EE_SCALE
    if (Math.abs(rawY) > EE_RAW_Y_MAX + 1e-6)
      return null

    const clampedRawY = Math.max(-EE_RAW_Y_MAX, Math.min(EE_RAW_Y_MAX, rawY))
    let theta = clampedRawY / EE_A1
    for (let iter = 0; iter < 12; iter++) {
      const theta2 = theta * theta
      const theta6 = theta2 * theta2 * theta2
      const f = theta * (EE_A1 + EE_A2 * theta2 + theta6 * (EE_A3 + EE_A4 * theta2)) - clampedRawY
      const df = EE_A1 + 3 * EE_A2 * theta2 + theta6 * (7 * EE_A3 + 9 * EE_A4 * theta2)
      const delta = f / df
      theta -= delta
      if (Math.abs(delta) < 1e-13)
        break
    }

    const theta2 = theta * theta
    const theta6 = theta2 * theta2 * theta2
    const df = EE_A1 + 3 * EE_A2 * theta2 + theta6 * (7 * EE_A3 + 9 * EE_A4 * theta2)
    const cosTheta = Math.cos(theta)
    const lam = cosTheta > 1e-12 ? (3 * rawX * df) / (2 * Math.sqrt(3) * cosTheta) : 0
    if (Math.abs(lam) > Math.PI + 1e-5)
      return null

    const clampedLam = Math.max(-Math.PI, Math.min(Math.PI, lam))
    const sinPhi = Math.max(-1, Math.min(1, Math.sin(theta) / EE_SIN_FACTOR))
    const phi = Math.asin(sinPhi)
    const lonDeg = wrapLongitudeDeg(clampedLam * RAD_TO_DEG)
    const latDeg = phi * RAD_TO_DEG
    return [lonDeg, Object.is(latDeg, -0) ? 0 : latDeg]
  },
})

/**
 * Conformal Web Mercator projection truncated at `±85.05112878°` latitude.
 * Uniformly scaled by `0.5` so `worldWidth = PI` and `worldHeight = PI` (preserving 1:1 conformal aspect).
 */
export const MERCATOR_PROJECTION: MapProjection = Object.freeze({
  id: 'mercator',
  name: '墨卡托投影',
  worldWidth: Math.PI,
  worldHeight: Math.PI,
  maxLatitudeDegrees: MERCATOR_MAX_LATITUDE_DEGREES,
  supportsHorizontalWrap: true,
  project(longitudeDegrees: number, latitudeDegrees: number): [number, number] {
    const clampedLat = Math.max(
      -MERCATOR_MAX_LATITUDE_DEGREES,
      Math.min(MERCATOR_MAX_LATITUDE_DEGREES, latitudeDegrees),
    )
    const clampedLon = Math.max(-180, Math.min(180, longitudeDegrees))
    const lam = clampedLon * DEG_TO_RAD
    const phi = clampedLat * DEG_TO_RAD
    const rawY = Math.log(Math.tan(Math.PI * 0.25 + phi * 0.5))
    return [lam * 0.5, rawY * 0.5]
  },
  invert(x: number, y: number): [number, number] | null {
    if (!Number.isFinite(x) || !Number.isFinite(y))
      return null
    const halfH = Math.PI * 0.5
    if (Math.abs(y) > halfH + 1e-6)
      return null
    const clampedY = Math.max(-halfH, Math.min(halfH, y))
    const lam = x * 2
    const phi = 2 * Math.atan(Math.exp(clampedY * 2)) - Math.PI * 0.5
    const lonDeg = wrapLongitudeDeg(lam * RAD_TO_DEG)
    const latDeg = Math.max(
      -MERCATOR_MAX_LATITUDE_DEGREES,
      Math.min(MERCATOR_MAX_LATITUDE_DEGREES, phi * RAD_TO_DEG),
    )
    return [lonDeg, Object.is(latDeg, -0) ? 0 : latDeg]
  },
})

export const BUILTIN_MAP_PROJECTIONS: Readonly<Record<MapProjectionId, MapProjection>> = Object.freeze({
  'equirectangular': EQUIRECTANGULAR_PROJECTION,
  'equal-earth': EQUAL_EARTH_PROJECTION,
  'mercator': MERCATOR_PROJECTION,
})

export function getMapProjection(projectionId: MapProjectionId): MapProjection {
  return BUILTIN_MAP_PROJECTIONS[projectionId] ?? EQUAL_EARTH_PROJECTION
}

/**
 * Computes the unified `styleZoom` (`0..12`) from the visible vertical world height in `AtlasView`:
 * `visibleArcRadians = (visibleWorldHeight / projection.worldHeight) * PI`
 * `styleZoom = clamp(log2(PI / visibleArcRadians), 0, 12)`
 */
export function computeAtlasStyleZoom(
  visibleWorldHeight: number,
  projection: MapProjection = EQUAL_EARTH_PROJECTION,
): number {
  const safeHeight = Math.max(1e-5, visibleWorldHeight)
  const visibleArcRadians = Math.max(1e-5, Math.min(Math.PI, (safeHeight / projection.worldHeight) * Math.PI))
  const rawZoom = Math.log2(Math.PI / visibleArcRadians)
  return Math.max(0, Math.min(12, rawZoom))
}

/**
 * Inverse of `computeAtlasStyleZoom`: returns the OrthographicCamera vertical frustum span
 * (`top - bottom`) in planar world units for a target `styleZoom` (`0..12`).
 */
export function computeAtlasVisibleWorldHeight(
  styleZoom: number,
  projection: MapProjection = EQUAL_EARTH_PROJECTION,
): number {
  const clampedZoom = Math.max(0, Math.min(12, styleZoom))
  return projection.worldHeight / (2 ** clampedZoom)
}

/**
 * Extra span at atlas zoom 0 so the projection border is not clipped by the viewport edge.
 * `1` would fit the world bounds exactly; a little slack keeps the silhouette stroke on screen.
 */
export const ATLAS_WORLD_FIT_PADDING = 1.02

/**
 * Orthographic frustum for `AtlasView`.
 * Zoom `0` contains the full projected world in the current viewport aspect (letterboxing the
 * shorter axis). Each +1 halves that fitted span. A 16:9 fullscreen is narrower than a 2:1
 * world map, so fitting height alone would crop the eastern and western edges.
 */
export function computeAtlasFittedFrustum(
  styleZoom: number,
  viewportAspect: number,
  projection: MapProjection = EQUAL_EARTH_PROJECTION,
  padding = ATLAS_WORLD_FIT_PADDING,
): { readonly visibleWidth: number, readonly visibleHeight: number } {
  const aspect = Math.max(1e-4, viewportAspect)
  const safePadding = Math.max(1, padding)
  const containHeight = Math.max(projection.worldHeight, projection.worldWidth / aspect) * safePadding
  const clampedZoom = Math.max(0, Math.min(12, styleZoom))
  const visibleHeight = containHeight / (2 ** clampedZoom)
  return {
    visibleHeight,
    visibleWidth: visibleHeight * aspect,
  }
}

/**
 * Builds the outer boundary silhouette ring in 2D projected world coordinates for backdrop rendering.
 */
export function buildProjectionSilhouettePoints(
  projection: MapProjection,
  latSamples = 72,
): [number, number][] {
  const maxLat = projection.maxLatitudeDegrees
  const points: [number, number][] = []
  // Right boundary (+180 deg from -maxLat to +maxLat)
  for (let i = 0; i <= latSamples; i++) {
    const lat = -maxLat + (2 * maxLat * i) / latSamples
    points.push(projection.project(180, lat))
  }
  // Left boundary (-180 deg from +maxLat down to -maxLat)
  for (let i = latSamples; i >= 0; i--) {
    const lat = -maxLat + (2 * maxLat * i) / latSamples
    points.push(projection.project(-180, lat))
  }
  return points
}

export function projectLonLatRing(
  ring: readonly LonLatTuple[],
  projection: MapProjection,
): [number, number][] {
  return ring.map(([lon, lat]) => projection.project(lon, lat))
}
