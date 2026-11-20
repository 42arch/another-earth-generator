import type { WorldMapReader } from '@another-earth/world-core'
import type { MapProjection } from '#projections/map-projections'
import type { Vec3Tuple } from '#projections/spherical-math'
import type { CircleLayer } from '#rendering/layers/circle-layer'
import type { FillLayer } from '#rendering/layers/fill-layer'
import type { LineLayer } from '#rendering/layers/line-layer'
import type { SymbolLayer } from '#rendering/layers/symbol-layer'
import type { MapViewportMode } from '#styles/spec'
import * as THREE from 'three'
import { cartesianToLonLatDeg, lonLatDegToCartesian, normalizeVec3, rotateAroundPolarAxis } from '#projections/spherical-math'

export const MAX_CLICK_DRAG_PX = 4

export interface MapFeatureHit {
  readonly layerId: string
  readonly sourceId: string
  readonly featureId: string
  readonly entityId?: string
}

export interface MapPickResult {
  readonly snapshotId: string
  readonly viewMode: MapViewportMode
  readonly regionId: number
  readonly coordinates: Readonly<{
    longitudeDegrees: number
    latitudeDegrees: number
  }>
  readonly entityId?: string
  readonly featureHit?: Readonly<MapFeatureHit>
}

export type PickableMapLayer
  = | { readonly kind: 'circle', readonly layer: CircleLayer }
    | { readonly kind: 'symbol', readonly layer: SymbolLayer }
    | { readonly kind: 'line', readonly layer: LineLayer }
    | { readonly kind: 'fill', readonly layer: FillLayer }

export function isPointerClickGesture(
  downClientX: number,
  downClientY: number,
  upClientX: number,
  upClientY: number,
): boolean {
  return Math.hypot(upClientX - downClientX, upClientY - downClientY) <= MAX_CLICK_DRAG_PX
}

/**
 * Intersects a 3D camera ray with the unit sphere centered at origin.
 */
export function intersectUnitSphereScreenPoint(
  screenX: number,
  screenY: number,
  viewportWidth: number,
  viewportHeight: number,
  camera: THREE.Camera,
  sphereRadius = 1.0,
): Vec3Tuple | null {
  if (viewportWidth <= 0 || viewportHeight <= 0)
    return null

  const ndcX = (screenX / viewportWidth) * 2 - 1
  const ndcY = -(screenY / viewportHeight) * 2 + 1
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)

  const origin = raycaster.ray.origin
  const dir = raycaster.ray.direction
  const b = 2 * origin.dot(dir)
  const c = origin.lengthSq() - sphereRadius * sphereRadius
  const disc = b * b - 4 * c
  if (disc < 0)
    return null

  const sqrtDisc = Math.sqrt(disc)
  let t = (-b - sqrtDisc) * 0.5
  if (t < 0) {
    t = (-b + sqrtDisc) * 0.5
  }
  if (t < 0)
    return null

  const hitX = origin.x + dir.x * t
  const hitY = origin.y + dir.y * t
  const hitZ = origin.z + dir.z * t
  return normalizeVec3(hitX, hitY, hitZ)
}

/**
 * Maps a 2D `AtlasView` screen pixel `(screenX, screenY)` into planar world coordinates `[worldX, worldY]`
 * for an `OrthographicCamera`.
 */
export function screenPointToAtlasWorldCoordinates(
  screenX: number,
  screenY: number,
  viewportWidth: number,
  viewportHeight: number,
  camera: THREE.OrthographicCamera,
): [worldX: number, worldY: number] | null {
  if (viewportWidth <= 0 || viewportHeight <= 0)
    return null
  const ndcX = (screenX / viewportWidth) * 2 - 1
  const ndcY = -(screenY / viewportHeight) * 2 + 1
  const vec = new THREE.Vector3(ndcX, ndcY, 0)
  vec.unproject(camera)
  return [vec.x, vec.y]
}

/**
 * Unified picking engine (`MapPicker`):
 * 1. Tests visible vector layers in reverse style layer order (topmost layer first):
 *    - `circle` / `symbol` (`<= radius + 6px`)
 *    - `line` (`<= lineWidth * 0.5 + 5px`)
 *    - `fill` with `interactive: true` (point-in-polygon on Gnomonic patch)
 * 2. Falls back to unit-sphere intersection (3D) or `projection.invert` (2D) + `reader.mesh.locateRegion(x, y, z)`.
 */
export class MapPicker {
  pickGlobe(params: {
    readonly reader: WorldMapReader
    readonly camera: THREE.Camera
    readonly screenX: number
    readonly screenY: number
    readonly viewportWidth: number
    readonly viewportHeight: number
    readonly orderedLayers: readonly PickableMapLayer[]
    /** Eastward planet spin around the polar axis. Screen hits are mapped back before region lookup. */
    readonly planetSpinRadians?: number
  }): MapPickResult | null {
    const {
      reader,
      camera,
      screenX,
      screenY,
      viewportWidth,
      viewportHeight,
      orderedLayers,
    } = params
    const planetSpinRadians = params.planetSpinRadians ?? 0

    camera.updateMatrixWorld()
    const screenHit = intersectUnitSphereScreenPoint(
      screenX,
      screenY,
      viewportWidth,
      viewportHeight,
      camera,
      1.0,
    )
    if (!screenHit)
      return null

    const unitHit = rotateAroundPolarAxis(screenHit, -planetSpinRadians)
    const regionId = reader.mesh.locateRegion(unitHit[0], unitHit[1], unitHit[2])
    const [lon, lat] = cartesianToLonLatDeg(unitHit[0], unitHit[1], unitHit[2])

    const featureHit = this.pickVectorLayers(
      orderedLayers,
      screenX,
      screenY,
      viewportWidth,
      viewportHeight,
      camera,
      unitHit,
      [0],
      planetSpinRadians,
    )

    return Object.freeze({
      snapshotId: reader.identity.snapshotId,
      viewMode: 'globe' as const,
      regionId,
      coordinates: Object.freeze({
        longitudeDegrees: lon,
        latitudeDegrees: lat,
      }),
      ...(featureHit?.entityId ? { entityId: featureHit.entityId } : {}),
      ...(featureHit ? { featureHit: Object.freeze(featureHit) } : {}),
    })
  }

  pickAtlas(params: {
    readonly reader: WorldMapReader
    readonly camera: THREE.OrthographicCamera
    readonly projection: MapProjection
    readonly screenX: number
    readonly screenY: number
    readonly viewportWidth: number
    readonly viewportHeight: number
    readonly orderedLayers: readonly PickableMapLayer[]
  }): MapPickResult | null {
    const {
      reader,
      camera,
      projection,
      screenX,
      screenY,
      viewportWidth,
      viewportHeight,
      orderedLayers,
    } = params

    camera.updateMatrixWorld()
    const worldPt = screenPointToAtlasWorldCoordinates(
      screenX,
      screenY,
      viewportWidth,
      viewportHeight,
      camera,
    )
    if (!worldPt)
      return null

    let [worldX, worldY] = worldPt
    if (projection.supportsHorizontalWrap) {
      const halfW = projection.worldWidth * 0.5
      worldX = (((worldX + halfW) % projection.worldWidth) + projection.worldWidth) % projection.worldWidth - halfW
    }

    const inverted = projection.invert(worldX, worldY)
    if (!inverted)
      return null

    const [lon, lat] = inverted
    const unitHit = lonLatDegToCartesian(lon, lat)
    const regionId = reader.mesh.locateRegion(unitHit[0], unitHit[1], unitHit[2])
    const worldOffsetsX = projection.supportsHorizontalWrap
      ? [-projection.worldWidth, 0, projection.worldWidth]
      : [0]

    const featureHit = this.pickVectorLayers(
      orderedLayers,
      screenX,
      screenY,
      viewportWidth,
      viewportHeight,
      camera,
      unitHit,
      worldOffsetsX,
    )

    return Object.freeze({
      snapshotId: reader.identity.snapshotId,
      viewMode: 'atlas' as const,
      regionId,
      coordinates: Object.freeze({
        longitudeDegrees: lon,
        latitudeDegrees: lat,
      }),
      ...(featureHit?.entityId ? { entityId: featureHit.entityId } : {}),
      ...(featureHit ? { featureHit: Object.freeze(featureHit) } : {}),
    })
  }

  private pickVectorLayers(
    orderedLayers: readonly PickableMapLayer[],
    screenX: number,
    screenY: number,
    viewportWidth: number,
    viewportHeight: number,
    camera: THREE.Camera,
    unitHit: Vec3Tuple,
    worldOffsetsX: readonly number[],
    planetSpinRadians = 0,
  ): MapFeatureHit | undefined {
    // Reverse layer order: visually topmost layer wins
    for (let i = orderedLayers.length - 1; i >= 0; i--) {
      const entry = orderedLayers[i]
      if (entry.kind === 'circle') {
        const hit = entry.layer.pickScreenPoint(
          screenX,
          screenY,
          viewportWidth,
          viewportHeight,
          camera,
          6,
          worldOffsetsX,
          planetSpinRadians,
        )
        if (hit) {
          return {
            layerId: hit.layerId,
            sourceId: hit.sourceId,
            featureId: hit.featureId,
            ...(hit.entityId ? { entityId: hit.entityId } : {}),
          }
        }
      }
      else if (entry.kind === 'symbol') {
        const hit = entry.layer.pickScreenPoint(screenX, screenY, 6)
        if (hit) {
          return {
            layerId: hit.layerId,
            sourceId: hit.sourceId,
            featureId: hit.featureId,
            ...(hit.entityId ? { entityId: hit.entityId } : {}),
          }
        }
      }
      else if (entry.kind === 'line') {
        const hit = entry.layer.pickScreenPoint(
          screenX,
          screenY,
          viewportWidth,
          viewportHeight,
          camera,
          5,
          worldOffsetsX,
          planetSpinRadians,
        )
        if (hit) {
          return {
            layerId: hit.layerId,
            sourceId: hit.sourceId,
            featureId: hit.featureId,
            ...(hit.entityId ? { entityId: hit.entityId } : {}),
          }
        }
      }
      else if (entry.kind === 'fill') {
        const hit = entry.layer.pickSphericalPoint(unitHit)
        if (hit) {
          return hit
        }
      }
    }
    return undefined
  }
}
