import type { MapProjection } from '#projections/map-projections'
import type { LonLatTuple, Vec3Tuple } from '#projections/spherical-math'
import type { GpuResourceTracker } from '#rendering/gpu-resource-tracker'
import type { MapSourceRegistry } from '#sources/registry'
import type { GeoJsonFeature, GeoJsonPolygonGeometry, GeoJsonSource } from '#sources/types'
import type { CompiledMapStyleLayer } from '#styles/compiler'
import { clipRingToGeographicBox } from '#projections/seam-clipper'
import {
  buildTangentBasis,
  cartesianToLonLatDeg,
  crossVec3,
  dotVec3,
  lonLatDegToCartesian,
  normalizeVec3,
  sphericalAngleRad,
  unwrapLongitudeDegNear,
} from '#projections/spherical-math'
import { parseCssColorToRgba8 } from '#rendering/satellite-shader'
import * as THREE from 'three'

export type GeoJsonRingCoordinates = readonly LonLatTuple[]
export type GeoJsonPolygonCoordinates = GeoJsonPolygonGeometry['coordinates']

export const MAX_SPHERICAL_TRIANGLE_EDGE_RAD = 0.036
export const MAX_ATLAS_TRIANGLE_EDGE_DEG = 3.0
const DIRECT_GNOMONIC_MIN_DOT = Math.cos(65 * Math.PI / 180)
const CUBE_CLIP_SLACK = -1e-5
const DEDUP_EPSILON = 1e-6

interface CubeFaceBasis {
  readonly normal: Vec3Tuple
  readonly uAxis: Vec3Tuple
  readonly vAxis: Vec3Tuple
  readonly planes: readonly Vec3Tuple[]
}

const S = Math.SQRT1_2
const CUBE_FACES: readonly CubeFaceBasis[] = [
  { normal: [1, 0, 0], uAxis: [0, 0, -1], vAxis: [0, 1, 0], planes: [[S, 0, S], [S, 0, -S], [S, S, 0], [S, -S, 0]] },
  { normal: [-1, 0, 0], uAxis: [0, 0, 1], vAxis: [0, 1, 0], planes: [[-S, 0, -S], [-S, 0, S], [-S, S, 0], [-S, -S, 0]] },
  { normal: [0, 1, 0], uAxis: [1, 0, 0], vAxis: [0, 0, -1], planes: [[0, S, S], [0, S, -S], [S, S, 0], [-S, S, 0]] },
  { normal: [0, -1, 0], uAxis: [1, 0, 0], vAxis: [0, 0, 1], planes: [[0, -S, -S], [0, -S, S], [S, -S, 0], [-S, -S, 0]] },
  { normal: [0, 0, 1], uAxis: [1, 0, 0], vAxis: [0, 1, 0], planes: [[S, 0, S], [-S, 0, S], [0, S, S], [0, -S, S]] },
  { normal: [0, 0, -1], uAxis: [-1, 0, 0], vAxis: [0, 1, 0], planes: [[-S, 0, -S], [S, 0, -S], [0, S, -S], [0, -S, -S]] },
]

export interface ProjectedGnomonicPatch {
  readonly center: Vec3Tuple
  readonly uAxis: Vec3Tuple
  readonly vAxis: Vec3Tuple
  readonly exterior: readonly [number, number][]
  readonly holes: readonly (readonly [number, number][])[]
}

export interface SphericalTriangulationResult {
  readonly positions: Float32Array
  readonly normals: Float32Array
  readonly triangleCount: number
  readonly patches: readonly ProjectedGnomonicPatch[]
}

function ringCoordinatesToUnitPoints(ring: GeoJsonRingCoordinates): Vec3Tuple[] {
  const rawCount = ring.length
  if (rawCount < 3)
    return []
  const first = ring[0]
  const last = ring[rawCount - 1]
  const isClosed = Math.abs(first[0] - last[0]) < 1e-7 && Math.abs(first[1] - last[1]) < 1e-7
  const limit = isClosed ? rawCount - 1 : rawCount
  const points: Vec3Tuple[] = []

  for (let i = 0; i < limit; i++) {
    const [lon, lat] = ring[i]
    const pt = lonLatDegToCartesian(lon, lat)
    const prev = points.at(-1)
    if (!prev || Math.hypot(pt[0] - prev[0], pt[1] - prev[1], pt[2] - prev[2]) > DEDUP_EPSILON) {
      points.push(pt)
    }
  }
  if (points.length >= 2) {
    const a = points[0]
    const b = points.at(-1)!
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= DEDUP_EPSILON) {
      points.pop()
    }
  }
  return points
}

function signedArea2D(ring: readonly [number, number][]): number {
  let area = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  }
  return area * 0.5
}

export function pointInRing2D(point: readonly [number, number], ring: readonly [number, number][]): boolean {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi) {
      inside = !inside
    }
  }
  return inside
}

function projectToGnomonic2D(
  points: readonly Vec3Tuple[],
  center: Vec3Tuple,
  uAxis: Vec3Tuple,
  vAxis: Vec3Tuple,
): [number, number][] | null {
  const projected: [number, number][] = []
  for (const p of points) {
    const denom = dotVec3(p, center)
    if (denom <= 0.08)
      return null
    const u = dotVec3(p, uAxis) / denom
    const v = dotVec3(p, vAxis) / denom
    const prev = projected.at(-1)
    if (!prev || Math.hypot(u - prev[0], v - prev[1]) > DEDUP_EPSILON) {
      projected.push([u, v])
    }
  }
  if (projected.length >= 2) {
    const first = projected[0]
    const last = projected.at(-1)!
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= DEDUP_EPSILON) {
      projected.pop()
    }
  }
  return projected.length >= 3 && Math.abs(signedArea2D(projected)) > 1e-11 ? projected : null
}

function clipRingByHalfSpace(ring: readonly Vec3Tuple[], planeNormal: Vec3Tuple): Vec3Tuple[] {
  if (ring.length < 3)
    return []
  const output: Vec3Tuple[] = []
  for (let i = 0; i < ring.length; i++) {
    const current = ring[i]
    const previous = ring[(i - 1 + ring.length) % ring.length]
    const curDot = dotVec3(current, planeNormal)
    const prevDot = dotVec3(previous, planeNormal)
    const curIn = curDot >= CUBE_CLIP_SLACK
    const prevIn = prevDot >= CUBE_CLIP_SLACK

    if (curIn !== prevIn) {
      const denom = prevDot - curDot
      const t = Math.abs(denom) > 1e-12 ? prevDot / denom : 0.5
      const clampedT = Math.max(0, Math.min(1, t))
      output.push(normalizeVec3(
        previous[0] + (current[0] - previous[0]) * clampedT,
        previous[1] + (current[1] - previous[1]) * clampedT,
        previous[2] + (current[2] - previous[2]) * clampedT,
      ))
    }
    if (curIn) {
      output.push(current)
    }
  }
  return output
}

function unprojectGnomonicPoint(
  uv: readonly [number, number],
  center: Vec3Tuple,
  uAxis: Vec3Tuple,
  vAxis: Vec3Tuple,
): Vec3Tuple {
  return normalizeVec3(
    center[0] + uv[0] * uAxis[0] + uv[1] * vAxis[0],
    center[1] + uv[0] * uAxis[1] + uv[1] * vAxis[1],
    center[2] + uv[0] * uAxis[2] + uv[1] * vAxis[2],
  )
}

function ensureCCW2D(ring: readonly [number, number][]): [number, number][] {
  return signedArea2D(ring) < 0 ? [...ring].reverse() : [...ring]
}

function ensureCW2D(ring: readonly [number, number][]): [number, number][] {
  return signedArea2D(ring) > 0 ? [...ring].reverse() : [...ring]
}

function subdivideSphericalTriangle(
  a: Vec3Tuple,
  b: Vec3Tuple,
  c: Vec3Tuple,
  maxEdgeRad: number,
  radius: number,
  outPositions: number[],
  outNormals: number[],
  depth = 0,
): void {
  const abRad = sphericalAngleRad(a, b)
  const bcRad = sphericalAngleRad(b, c)
  const caRad = sphericalAngleRad(c, a)

  if (depth < 7 && (abRad > maxEdgeRad || bcRad > maxEdgeRad || caRad > maxEdgeRad)) {
    if (abRad >= bcRad && abRad >= caRad) {
      const m = normalizeVec3((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5)
      subdivideSphericalTriangle(a, m, c, maxEdgeRad, radius, outPositions, outNormals, depth + 1)
      subdivideSphericalTriangle(m, b, c, maxEdgeRad, radius, outPositions, outNormals, depth + 1)
      return
    }
    if (bcRad >= abRad && bcRad >= caRad) {
      const m = normalizeVec3((b[0] + c[0]) * 0.5, (b[1] + c[1]) * 0.5, (b[2] + c[2]) * 0.5)
      subdivideSphericalTriangle(a, b, m, maxEdgeRad, radius, outPositions, outNormals, depth + 1)
      subdivideSphericalTriangle(a, m, c, maxEdgeRad, radius, outPositions, outNormals, depth + 1)
      return
    }
    const m = normalizeVec3((c[0] + a[0]) * 0.5, (c[1] + a[1]) * 0.5, (c[2] + a[2]) * 0.5)
    subdivideSphericalTriangle(a, b, m, maxEdgeRad, radius, outPositions, outNormals, depth + 1)
    subdivideSphericalTriangle(m, b, c, maxEdgeRad, radius, outPositions, outNormals, depth + 1)
    return
  }

  const ab: Vec3Tuple = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const ac: Vec3Tuple = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const cross = crossVec3(ab, ac)
  const doubleArea = Math.hypot(cross[0], cross[1], cross[2])
  if (doubleArea <= 1e-11)
    return

  const sum: Vec3Tuple = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]]
  const orient = dotVec3(cross, sum)
  const v1 = a
  const v2 = orient >= 0 ? b : c
  const v3 = orient >= 0 ? c : b

  outPositions.push(
    v1[0] * radius,
    v1[1] * radius,
    v1[2] * radius,
    v2[0] * radius,
    v2[1] * radius,
    v2[2] * radius,
    v3[0] * radius,
    v3[1] * radius,
    v3[2] * radius,
  )
  outNormals.push(
    v1[0],
    v1[1],
    v1[2],
    v2[0],
    v2[1],
    v2[2],
    v3[0],
    v3[1],
    v3[2],
  )
}

function triangulateGnomonicPatch(
  patch: ProjectedGnomonicPatch,
  radius: number,
  maxEdgeRad: number,
  outPositions: number[],
  outNormals: number[],
): void {
  const exteriorCCW = ensureCCW2D(patch.exterior)
  const holesCW = patch.holes.map(h => ensureCW2D(h))
  const contourVec2 = exteriorCCW.map(([u, v]) => new THREE.Vector2(u, v))
  const holesVec2 = holesCW.map(hole => hole.map(([u, v]) => new THREE.Vector2(u, v)))
  const allVertices: [number, number][] = [...exteriorCCW, ...holesCW.flat()]
  const triangles = THREE.ShapeUtils.triangulateShape(contourVec2, holesVec2)

  for (const [i0, i1, i2] of triangles) {
    const p0 = allVertices[i0]
    const p1 = allVertices[i1]
    const p2 = allVertices[i2]
    if (!p0 || !p1 || !p2)
      continue
    const a = unprojectGnomonicPoint(p0, patch.center, patch.uAxis, patch.vAxis)
    const b = unprojectGnomonicPoint(p1, patch.center, patch.uAxis, patch.vAxis)
    const c = unprojectGnomonicPoint(p2, patch.center, patch.uAxis, patch.vAxis)
    subdivideSphericalTriangle(a, b, c, maxEdgeRad, radius, outPositions, outNormals, 0)
  }
}

/**
 * Triangulates a spherical GeoJSON Polygon (exterior ring + arbitrary interior holes)
 * using local Gnomonic tangent-plane projection (or 6-cube-face Gnomonic clipping for hemisphere-spanning polygons),
 * hole triangulation, and recursive spherical midpoint subdivision for edges `> maxEdgeRad` (`0.06 rad`).
 */
export function triangulateSphericalPolygon(
  coordinates: GeoJsonPolygonCoordinates,
  options: {
    readonly radius?: number
    readonly maxEdgeRad?: number
  } = {},
): SphericalTriangulationResult {
  const radius = options.radius ?? 1.0008
  const maxEdgeRad = options.maxEdgeRad ?? MAX_SPHERICAL_TRIANGLE_EDGE_RAD
  const outPositions: number[] = []
  const outNormals: number[] = []
  const patches: ProjectedGnomonicPatch[] = []

  if (coordinates.length === 0) {
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      triangleCount: 0,
      patches,
    }
  }

  const unitRings = coordinates
    .map(ring => ringCoordinatesToUnitPoints(ring))
    .filter(ring => ring.length >= 3)
  if (unitRings.length === 0) {
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      triangleCount: 0,
      patches,
    }
  }

  const exteriorUnit = unitRings[0]
  let sx = 0
  let sy = 0
  let sz = 0
  for (const p of exteriorUnit) {
    sx += p[0]
    sy += p[1]
    sz += p[2]
  }
  const centroidLen = Math.hypot(sx, sy, sz)
  let canUseDirectGnomonic = centroidLen > 1e-4
  const centroid: Vec3Tuple = canUseDirectGnomonic
    ? [sx / centroidLen, sy / centroidLen, sz / centroidLen]
    : exteriorUnit[0]

  if (canUseDirectGnomonic) {
    for (const ring of unitRings) {
      for (const p of ring) {
        if (dotVec3(p, centroid) < DIRECT_GNOMONIC_MIN_DOT) {
          canUseDirectGnomonic = false
          break
        }
      }
      if (!canUseDirectGnomonic)
        break
    }
  }

  if (canUseDirectGnomonic) {
    const { east, north } = buildTangentBasis(centroid)
    const ext2D = projectToGnomonic2D(exteriorUnit, centroid, east, north)
    if (ext2D) {
      const holes2D: [number, number][][] = []
      for (let h = 1; h < unitRings.length; h++) {
        const hole2D = projectToGnomonic2D(unitRings[h], centroid, east, north)
        if (hole2D)
          holes2D.push(hole2D)
      }
      const patch: ProjectedGnomonicPatch = {
        center: centroid,
        uAxis: east,
        vAxis: north,
        exterior: ext2D,
        holes: holes2D,
      }
      patches.push(patch)
      triangulateGnomonicPatch(patch, radius, maxEdgeRad, outPositions, outNormals)
      return {
        positions: new Float32Array(outPositions),
        normals: new Float32Array(outNormals),
        triangleCount: outPositions.length / 9,
        patches,
      }
    }
  }

  // Fallback for very large (continent/ocean-scale) polygons: clip against the 6 cube faces
  for (const face of CUBE_FACES) {
    const clipped2D: { ring: [number, number][], absArea: number }[] = []
    for (const unitRing of unitRings) {
      let clipped: readonly Vec3Tuple[] = unitRing
      for (const plane of face.planes) {
        clipped = clipRingByHalfSpace(clipped, plane)
        if (clipped.length < 3)
          break
      }
      if (clipped.length < 3)
        continue
      const proj = projectToGnomonic2D(clipped, face.normal, face.uAxis, face.vAxis)
      if (proj) {
        clipped2D.push({
          ring: proj,
          absArea: Math.abs(signedArea2D(proj)),
        })
      }
    }
    if (clipped2D.length === 0)
      continue

    // Build containment hierarchy on this cube face (even depth = exterior, odd depth = hole)
    clipped2D.sort((a, b) => b.absArea - a.absArea)
    const parents = Array.from({ length: clipped2D.length }).fill(-1)
    const depths = Array.from({ length: clipped2D.length }).fill(0)

    for (let i = 0; i < clipped2D.length; i++) {
      const probe = clipped2D[i].ring[0]
      let parent = -1
      let depth = 0
      for (let j = i - 1; j >= 0; j--) {
        if (pointInRing2D(probe, clipped2D[j].ring)) {
          if (parent === -1)
            parent = j
          depth++
        }
      }
      parents[i] = parent
      depths[i] = depth
    }

    for (let i = 0; i < clipped2D.length; i++) {
      if (depths[i] % 2 !== 0)
        continue
      const holes: [number, number][][] = []
      for (let j = i + 1; j < clipped2D.length; j++) {
        if (parents[j] === i && depths[j] === depths[i] + 1) {
          holes.push(clipped2D[j].ring)
        }
      }
      const patch: ProjectedGnomonicPatch = {
        center: face.normal,
        uAxis: face.uAxis,
        vAxis: face.vAxis,
        exterior: clipped2D[i].ring,
        holes,
      }
      patches.push(patch)
      triangulateGnomonicPatch(patch, radius, maxEdgeRad, outPositions, outNormals)
    }
  }

  return {
    positions: new Float32Array(outPositions),
    normals: new Float32Array(outNormals),
    triangleCount: outPositions.length / 9,
    patches,
  }
}

function subdivideLonLatTriangle(
  a: LonLatTuple,
  b: LonLatTuple,
  c: LonLatTuple,
  maxEdgeDeg: number,
  projection: MapProjection,
  zOffset: number,
  outPositions: number[],
  outNormals: number[],
  depth = 0,
): void {
  const abDeg = Math.hypot(b[0] - a[0], b[1] - a[1])
  const bcDeg = Math.hypot(c[0] - b[0], c[1] - b[1])
  const caDeg = Math.hypot(a[0] - c[0], a[1] - c[1])

  if (depth < 5 && (abDeg > maxEdgeDeg || bcDeg > maxEdgeDeg || caDeg > maxEdgeDeg)) {
    if (abDeg >= bcDeg && abDeg >= caDeg) {
      const m: LonLatTuple = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5]
      subdivideLonLatTriangle(a, m, c, maxEdgeDeg, projection, zOffset, outPositions, outNormals, depth + 1)
      subdivideLonLatTriangle(m, b, c, maxEdgeDeg, projection, zOffset, outPositions, outNormals, depth + 1)
      return
    }
    if (bcDeg >= abDeg && bcDeg >= caDeg) {
      const m: LonLatTuple = [(b[0] + c[0]) * 0.5, (b[1] + c[1]) * 0.5]
      subdivideLonLatTriangle(a, b, m, maxEdgeDeg, projection, zOffset, outPositions, outNormals, depth + 1)
      subdivideLonLatTriangle(a, m, c, maxEdgeDeg, projection, zOffset, outPositions, outNormals, depth + 1)
      return
    }
    const m: LonLatTuple = [(c[0] + a[0]) * 0.5, (c[1] + a[1]) * 0.5]
    subdivideLonLatTriangle(a, b, m, maxEdgeDeg, projection, zOffset, outPositions, outNormals, depth + 1)
    subdivideLonLatTriangle(m, b, c, maxEdgeDeg, projection, zOffset, outPositions, outNormals, depth + 1)
    return
  }

  const pa = projection.project(a[0], a[1])
  const pb = projection.project(b[0], b[1])
  const pc = projection.project(c[0], c[1])
  const na = lonLatDegToCartesian(a[0], a[1])
  const nb = lonLatDegToCartesian(b[0], b[1])
  const nc = lonLatDegToCartesian(c[0], c[1])

  outPositions.push(pa[0], pa[1], zOffset, pb[0], pb[1], zOffset, pc[0], pc[1], zOffset)
  outNormals.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2])
}

/**
 * Triangulates a GeoJSON Polygon for 2D `AtlasView` directly from its 3D spherical Gnomonic
 * triangulation (`triangulateSphericalPolygon`), then clips each small spherical triangle
 * against `[-180, 180] × [-maxLat, maxLat]` in unwrapped `[lon, lat]` space.
 *
 * Why this completely eliminates 2D horizontal stretching / dateline spikes:
 * - In 3D Gnomonic tangent space (`(x, y, z)` on the unit sphere), there is NO `±180°` longitude
 *   branch cut and NO polar singularity, so `earcut` never encounters wrapped longitudes or
 *   multi-entry boundary bridges along `±180°`.
 * - Each resulting spherical triangle is tiny (`<= 0.036 rad` ~ `2°`), so unwrapping its 3 vertices
 *   and clipping against `[-180, 180]` is 100% convex and guaranteed never to span across the map.
 */
export function triangulateAtlasPolygon(
  coordinates: GeoJsonPolygonCoordinates,
  projection: MapProjection,
  options: {
    readonly zOffset?: number
    readonly maxEdgeDeg?: number
  } = {},
): SphericalTriangulationResult {
  const zOffset = options.zOffset ?? 0.001
  const maxEdgeDeg = options.maxEdgeDeg ?? MAX_ATLAS_TRIANGLE_EDGE_DEG
  const outPositions: number[] = []
  const outNormals: number[] = []

  const spherical = triangulateSphericalPolygon(coordinates, {
    radius: 1.0,
    maxEdgeRad: MAX_SPHERICAL_TRIANGLE_EDGE_RAD,
  })
  if (spherical.triangleCount > 0) {
    projectSphericalTrianglesToAtlas(
      spherical.positions,
      projection,
      zOffset,
      maxEdgeDeg,
      outPositions,
      outNormals,
    )
  }

  return {
    positions: new Float32Array(outPositions),
    normals: new Float32Array(outNormals),
    triangleCount: outPositions.length / 9,
    patches: spherical.patches,
  }
}

/**
 * Projects a spherical triangle `(a, b, c)` (unit vectors) into 2D `AtlasView` world coordinates
 * by unwrapping longitudes relative to `a` and clipping against `[-180, 180] × [-maxLat, maxLat]`.
 * Used as a fallback for hemisphere/circumpolar polygons (such as global oceans) whose rings wrap the pole.
 */
function projectSphericalTrianglesToAtlas(
  sphericalPositions: Float32Array,
  projection: MapProjection,
  zOffset: number,
  maxEdgeDeg: number,
  outPositions: number[],
  outNormals: number[],
): void {
  const maxLat = projection.maxLatitudeDegrees
  const triCount = Math.floor(sphericalPositions.length / 9)

  for (let t = 0; t < triCount; t++) {
    const base = t * 9
    const ax = sphericalPositions[base]
    const ay = sphericalPositions[base + 1]
    const az = sphericalPositions[base + 2]
    const bx = sphericalPositions[base + 3]
    const by = sphericalPositions[base + 4]
    const bz = sphericalPositions[base + 5]
    const cx = sphericalPositions[base + 6]
    const cy = sphericalPositions[base + 7]
    const cz = sphericalPositions[base + 8]

    // Use the triangle's 3D centroid longitude as the unwrap reference so polar triangles never drift
    const [centroidLon] = cartesianToLonLatDeg(ax + bx + cx, ay + by + cy, az + bz + cz)
    const [rawLonA, latA] = cartesianToLonLatDeg(ax, ay, az)
    const [rawLonB, latB] = cartesianToLonLatDeg(bx, by, bz)
    const [rawLonC, latC] = cartesianToLonLatDeg(cx, cy, cz)

    const wLonA = unwrapLongitudeDegNear(rawLonA, centroidLon)
    const uLonB = unwrapLongitudeDegNear(rawLonB, centroidLon)
    const uLonC = unwrapLongitudeDegNear(rawLonC, centroidLon)

    // Skip degenerate polar-cap slivers whose unwrapped longitude span exceeds 150°
    const minLon = Math.min(wLonA, uLonB, uLonC)
    const maxLon = Math.max(wLonA, uLonB, uLonC)
    if (maxLon - minLon > 150)
      continue

    const triRing: [number, number][] = [
      [wLonA, latA],
      [uLonB, latB],
      [uLonC, latC],
    ]

    for (const shift of [-360, 0, 360]) {
      if (maxLon + shift < -180 || minLon + shift > 180)
        continue
      const shifted: [number, number][] = shift === 0
        ? triRing
        : triRing.map(([lon, lat]) => [lon + shift, lat])
      const clipped = clipRingToGeographicBox(shifted, -180, 180, -maxLat, maxLat)
      if (clipped.length < 3)
        continue
      for (let i = 1; i < clipped.length - 1; i++) {
        subdivideLonLatTriangle(
          clipped[0],
          clipped[i],
          clipped[i + 1],
          maxEdgeDeg,
          projection,
          zOffset,
          outPositions,
          outNormals,
          0,
        )
      }
    }
  }
}

export function containsSphericalPointInPatches(
  unitPoint: Vec3Tuple,
  patches: readonly ProjectedGnomonicPatch[],
): boolean {
  for (const patch of patches) {
    const denom = dotVec3(unitPoint, patch.center)
    if (denom <= 0.12)
      continue
    const u = dotVec3(unitPoint, patch.uAxis) / denom
    const v = dotVec3(unitPoint, patch.vAxis) / denom
    const pt: [number, number] = [u, v]
    if (!pointInRing2D(pt, patch.exterior))
      continue
    let inHole = false
    for (const hole of patch.holes) {
      if (pointInRing2D(pt, hole)) {
        inHole = true
        break
      }
    }
    if (!inHole)
      return true
  }
  return false
}

const FILL_VERTEX_SHADER = /* glsl */`
  #if __VERSION__ >= 300
    #define FLAT_VARYING flat
  #else
    #define FLAT_VARYING
  #endif
  attribute float aFeatureIndex;
  FLAT_VARYING varying float vFeatureIndex;
  varying vec3 vWorldNormal;

  void main() {
    vFeatureIndex = aFeatureIndex;
    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FILL_FRAGMENT_SHADER = /* glsl */`
  #if __VERSION__ >= 300
    #define FLAT_VARYING flat
  #else
    #define FLAT_VARYING
  #endif
  uniform sampler2D uFeatureColorTex;
  uniform int uTexWidth;
  uniform int uTexHeight;
  uniform float uDayNightEnabled;
  uniform vec3 uSunDirection;

  FLAT_VARYING varying float vFeatureIndex;
  varying vec3 vWorldNormal;

  vec3 srgbToLinear(vec3 srgb) {
    return mix(srgb / 12.92, pow((srgb + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), srgb));
  }

  vec3 linearToSrgb(vec3 linear) {
    vec3 clamped = clamp(linear, 0.0, 1.0);
    return mix(clamped * 12.92, 1.055 * pow(clamped, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), clamped));
  }

  vec4 fetchFeatureColor(int idx) {
    int col = idx - (idx / uTexWidth) * uTexWidth;
    int row = idx / uTexWidth;
    #if __VERSION__ >= 300
      return texelFetch(uFeatureColorTex, ivec2(col, row), 0);
    #else
      vec2 uv = (vec2(float(col), float(row)) + 0.5) / vec2(float(uTexWidth), float(uTexHeight));
      return texture2D(uFeatureColorTex, uv);
    #endif
  }

  void main() {
    int idx = int(floor(vFeatureIndex + 0.5));
    vec4 color = fetchFeatureColor(idx);
    if (color.a <= 0.002) {
      discard;
    }

    vec3 rgb = color.rgb;
    if (uDayNightEnabled > 0.5) {
      float dotNL = max(0.0, dot(normalize(vWorldNormal), normalize(uSunDirection)));
      vec3 ambientIrradiance = vec3(0.081, 0.130, 0.199) * 1.1;
      vec3 directIrradiance = vec3(1.0, 0.963, 0.871) * (4.0 * dotNL);
      vec3 lightFactor = (ambientIrradiance + directIrradiance) * 0.318309886;
      vec3 linearLit = srgbToLinear(rgb) * lightFactor;
      rgb = linearToSrgb(linearLit);
    }

    gl_FragColor = vec4(rgb, color.a);
  }
`

export interface FillLayerOptions {
  readonly renderOrder?: number
  readonly surfaceOffset?: number
  readonly polygonOffsetFactor?: number
  readonly polygonOffsetUnits?: number
  readonly projection?: MapProjection
  readonly tracker?: GpuResourceTracker
}

interface IndexedFillFeature {
  readonly feature: GeoJsonFeature
  readonly patches: readonly ProjectedGnomonicPatch[]
}

/**
 * Batched GPU `FillLayer` renderer:
 * - Merges all polygon features of a source into 1 `THREE.BufferGeometry` with `aFeatureIndex`.
 * - Stores per-feature RGBA8 colors in a `THREE.DataTexture` so style/zoom changes never re-triangulate.
 * - Eliminates overlapping darkening on hydrography (`lake-polygons`, `river-polygons`) via depth/stencil-clean rendering.
 */
export class FillLayer {
  readonly id: string
  readonly sourceId: string
  readonly interactive: boolean
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  readonly colorTexture: THREE.DataTexture
  readonly colorBuffer: Uint8Array
  readonly texWidth: number
  readonly texHeight: number

  private readonly indexedFeatures: IndexedFillFeature[] = []
  private readonly visibleByFeature: Uint8Array
  private disposed = false

  constructor(
    compiledLayer: CompiledMapStyleLayer,
    source: GeoJsonSource,
    options: FillLayerOptions = {},
  ) {
    this.id = compiledLayer.id
    this.sourceId = compiledLayer.source
    this.interactive = compiledLayer.interactive

    const surfaceOffset = options.surfaceOffset ?? 0.001
    const radius = 1.0 + surfaceOffset
    const allPositions: number[] = []
    const allNormals: number[] = []
    const allFeatureIndices: number[] = []

    for (const feature of source.data.features) {
      const polygons: GeoJsonPolygonCoordinates[] = feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature.geometry.type === 'MultiPolygon'
          ? [...feature.geometry.coordinates]
          : []
      if (polygons.length === 0)
        continue

      const featureIndex = this.indexedFeatures.length
      const featurePatches: ProjectedGnomonicPatch[] = []

      for (const poly of polygons) {
        const result = options.projection
          ? triangulateAtlasPolygon(poly, options.projection, {
              zOffset: surfaceOffset,
              maxEdgeDeg: MAX_ATLAS_TRIANGLE_EDGE_DEG,
            })
          : triangulateSphericalPolygon(poly, {
              radius,
              maxEdgeRad: MAX_SPHERICAL_TRIANGLE_EDGE_RAD,
            })
        featurePatches.push(...result.patches)
        for (let i = 0; i < result.positions.length; i++) {
          allPositions.push(result.positions[i])
          allNormals.push(result.normals[i])
        }
        const vertexCount = result.positions.length / 3
        for (let v = 0; v < vertexCount; v++) {
          allFeatureIndices.push(featureIndex)
        }
      }

      this.indexedFeatures.push({
        feature,
        patches: featurePatches,
      })
    }

    const featureCount = Math.max(1, this.indexedFeatures.length)
    this.visibleByFeature = new Uint8Array(featureCount)
    this.texWidth = Math.min(256, featureCount)
    this.texHeight = Math.max(1, Math.ceil(featureCount / this.texWidth))
    this.colorBuffer = new Uint8Array(this.texWidth * this.texHeight * 4)

    this.colorTexture = new THREE.DataTexture(
      this.colorBuffer,
      this.texWidth,
      this.texHeight,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    )
    this.colorTexture.minFilter = THREE.NearestFilter
    this.colorTexture.magFilter = THREE.NearestFilter
    this.colorTexture.generateMipmaps = false
    this.colorTexture.needsUpdate = true
    options.tracker?.trackTexture(this.colorTexture)

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(allPositions), 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(allNormals), 3))
    geometry.setAttribute('aFeatureIndex', new THREE.BufferAttribute(new Float32Array(allFeatureIndices), 1))
    const boundRadius = options.projection
      ? Math.hypot(options.projection.worldWidth, options.projection.worldHeight)
      : radius + 0.02
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), boundRadius)
    options.tracker?.trackGeometry(geometry)

    const isWaterLayer = this.sourceId === 'lake-polygons' || this.sourceId === 'river-polygons'
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uFeatureColorTex: { value: this.colorTexture },
        uTexWidth: { value: this.texWidth },
        uTexHeight: { value: this.texHeight },
        uDayNightEnabled: { value: 0 },
        uSunDirection: { value: new THREE.Vector3(0.6, 0.35, 0.72).normalize() },
      },
      vertexShader: FILL_VERTEX_SHADER,
      fragmentShader: FILL_FRAGMENT_SHADER,
      transparent: !isWaterLayer,
      depthTest: true,
      depthWrite: isWaterLayer,
      polygonOffset: true,
      polygonOffsetFactor: options.polygonOffsetFactor ?? -1,
      polygonOffsetUnits: options.polygonOffsetUnits ?? -1,
    })
    options.tracker?.trackMaterial(material)

    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.name = `FillLayer:${this.id}`
    this.mesh.renderOrder = options.renderOrder ?? 2
  }

  updateStyle(compiledLayer: CompiledMapStyleLayer, styleZoom: number): void {
    if (this.disposed)
      return

    const layoutVis = compiledLayer.layout.visibility?.evaluate({ zoom: styleZoom })
    this.mesh.visible = styleZoom >= compiledLayer.minzoom && styleZoom <= compiledLayer.maxzoom && layoutVis !== 'none'
    if (!this.mesh.visible)
      return

    const colorExpr = compiledLayer.paint['fill-color']
    const opacityExpr = compiledLayer.paint['fill-opacity']
    const filterExpr = compiledLayer.filter
    const isWaterLayer = this.sourceId === 'lake-polygons' || this.sourceId === 'river-polygons'
    let hasTransparency = false

    for (let i = 0; i < this.indexedFeatures.length; i++) {
      const { feature } = this.indexedFeatures[i]
      const evalInput = { zoom: styleZoom, properties: feature.properties }
      const offset = i * 4

      if (filterExpr && !filterExpr.evaluate(evalInput)) {
        this.colorBuffer[offset] = 0
        this.colorBuffer[offset + 1] = 0
        this.colorBuffer[offset + 2] = 0
        this.colorBuffer[offset + 3] = 0
        this.visibleByFeature[i] = 0
        continue
      }

      const rawOpacity = opacityExpr ? Number(opacityExpr.evaluate(evalInput) ?? 1) : 1
      const effectiveOpacity = isWaterLayer ? (rawOpacity > 0 ? 1 : 0) : rawOpacity
      const alpha = Math.max(0, Math.min(255, Math.round(effectiveOpacity * 255)))
      if (alpha === 0) {
        this.colorBuffer[offset] = 0
        this.colorBuffer[offset + 1] = 0
        this.colorBuffer[offset + 2] = 0
        this.colorBuffer[offset + 3] = 0
        this.visibleByFeature[i] = 0
        continue
      }

      const rawColor = colorExpr ? String(colorExpr.evaluate(evalInput) ?? '#4488cc') : '#4488cc'
      const [cr, cg, cb, ca] = parseCssColorToRgba8(rawColor)
      const finalAlpha = isWaterLayer ? 255 : Math.round((alpha * ca) / 255)
      if (finalAlpha < 255)
        hasTransparency = true

      this.colorBuffer[offset] = cr
      this.colorBuffer[offset + 1] = cg
      this.colorBuffer[offset + 2] = cb
      this.colorBuffer[offset + 3] = finalAlpha
      this.visibleByFeature[i] = finalAlpha > 0 ? 1 : 0
    }

    this.mesh.material.transparent = !isWaterLayer && hasTransparency
    this.mesh.material.depthWrite = isWaterLayer || !hasTransparency
    this.colorTexture.needsUpdate = true
  }

  pickSphericalPoint(unitPoint: Vec3Tuple): { layerId: string, sourceId: string, featureId: string } | null {
    if (this.disposed || !this.mesh.visible || !this.interactive)
      return null

    for (let i = this.indexedFeatures.length - 1; i >= 0; i--) {
      if (!this.visibleByFeature[i])
        continue
      const entry = this.indexedFeatures[i]
      if (containsSphericalPointInPatches(unitPoint, entry.patches)) {
        return {
          layerId: this.id,
          sourceId: this.sourceId,
          featureId: entry.feature.id,
        }
      }
    }
    return null
  }

  setLighting(dayNightEnabled: boolean, sunDirection: THREE.Vector3): void {
    if (this.disposed)
      return
    this.mesh.material.uniforms.uDayNightEnabled.value = dayNightEnabled ? 1 : 0
    this.mesh.material.uniforms.uSunDirection.value.copy(sunDirection).normalize()
  }

  dispose(): void {
    if (this.disposed)
      return
    this.disposed = true
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.colorTexture.dispose()
  }
}

export function createFillLayerFromRegistry(
  compiledLayer: CompiledMapStyleLayer,
  registry: MapSourceRegistry,
  month: number,
  options: FillLayerOptions = {},
): FillLayer | null {
  const source = registry.getSource(compiledLayer.source, { month })
  if (source.unavailable || source.kind !== 'geojson')
    return null
  return new FillLayer(compiledLayer, source, options)
}
