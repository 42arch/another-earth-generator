export const RAD_TO_DEG = 180 / Math.PI
export const DEG_TO_RAD = Math.PI / 180

export type Vec3Tuple = readonly [x: number, y: number, z: number]
export type LonLatTuple = readonly [longitudeDegrees: number, latitudeDegrees: number]

export function normalizeVec3(x: number, y: number, z: number): Vec3Tuple {
  const length = Math.hypot(x, y, z)
  if (!Number.isFinite(length) || !(length > 0))
    throw new RangeError('Expected finite non-zero 3D vector')
  return [x / length, y / length, z / length]
}

export function dotVec3(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function crossVec3(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

export function sphericalAngleRad(a: Vec3Tuple, b: Vec3Tuple): number {
  const cross = crossVec3(a, b)
  const sin = Math.hypot(cross[0], cross[1], cross[2])
  const cos = dotVec3(a, b)
  return Math.atan2(sin, cos)
}

export function slerpVec3(a: Vec3Tuple, b: Vec3Tuple, t: number): Vec3Tuple {
  const clamped = Math.max(0, Math.min(1, t))
  const angle = sphericalAngleRad(a, b)
  if (angle < 1e-6) {
    return normalizeVec3(
      a[0] + (b[0] - a[0]) * clamped,
      a[1] + (b[1] - a[1]) * clamped,
      a[2] + (b[2] - a[2]) * clamped,
    )
  }
  const invSin = 1 / Math.sin(angle)
  const wA = Math.sin((1 - clamped) * angle) * invSin
  const wB = Math.sin(clamped * angle) * invSin
  return normalizeVec3(
    a[0] * wA + b[0] * wB,
    a[1] * wA + b[1] * wB,
    a[2] * wA + b[2] * wB,
  )
}

export function wrapLongitudeDeg(lonDeg: number): number {
  if (!Number.isFinite(lonDeg))
    throw new RangeError('Expected finite longitude in degrees')
  const wrapped = ((lonDeg + 180) % 360 + 360) % 360 - 180
  return Object.is(wrapped, -0) ? 0 : wrapped
}

export function unwrapLongitudeDegNear(lonDeg: number, referenceLonDeg: number): number {
  let result = lonDeg
  while (result - referenceLonDeg > 180)
    result -= 360
  while (result - referenceLonDeg < -180)
    result += 360
  return result
}

/**
 * Right-handed Y-up geographic frame matching `@another-earth/world-core`:
 * +Y is North, +Z is 0° meridian, +X is +90°E.
 */
export function cartesianToLonLatDeg(x: number, y: number, z: number): LonLatTuple {
  const length = Math.hypot(x, y, z)
  if (!Number.isFinite(length) || !(length > 0))
    throw new RangeError('Expected finite non-zero Cartesian coordinates')
  const nx = x / length
  const ny = y / length
  const nz = z / length
  const latRad = Math.atan2(ny, Math.hypot(nx, nz))
  const lonRad = nx === 0 && nz === 0 ? 0 : Math.atan2(nx, nz)
  const lonDeg = wrapLongitudeDeg(lonRad * RAD_TO_DEG)
  const latDeg = Math.max(-90, Math.min(90, latRad * RAD_TO_DEG))
  return [lonDeg, Object.is(latDeg, -0) ? 0 : latDeg]
}

/** Eastward spin around the +Y polar axis. Positive radians move a point to greater longitude. */
export function rotateAroundPolarAxis(point: Vec3Tuple, radians: number): Vec3Tuple {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return [
    point[0] * cos + point[2] * sin,
    point[1],
    point[2] * cos - point[0] * sin,
  ]
}

export function lonLatDegToCartesian(lonDeg: number, latDeg: number): Vec3Tuple {
  if (!Number.isFinite(lonDeg) || !Number.isFinite(latDeg) || Math.abs(latDeg) > 90)
    throw new RangeError('Invalid geographic coordinates in degrees')
  const lonRad = lonDeg * DEG_TO_RAD
  const latRad = latDeg * DEG_TO_RAD
  const cosLat = Math.cos(latRad)
  return [
    cosLat * Math.sin(lonRad),
    Math.sin(latRad),
    cosLat * Math.cos(lonRad),
  ]
}

export function buildTangentBasis(normal: Vec3Tuple): Readonly<{ east: Vec3Tuple, north: Vec3Tuple }> {
  const [nx, ny, nz] = normalizeVec3(normal[0], normal[1], normal[2])
  const horizontal = Math.hypot(nx, nz)
  const east: Vec3Tuple = horizontal > 1e-8
    ? [nz / horizontal, 0, -nx / horizontal]
    : [1, 0, 0]
  const north = normalizeVec3(
    ny * east[2] - nz * east[1],
    nz * east[0] - nx * east[2],
    nx * east[1] - ny * east[0],
  )
  return { east, north }
}

/**
 * Computes signed spherical vector-area projection `(sum (p_i x p_{i+1})) · normal`.
 * Positive (> 0) indicates counterclockwise (CCW) winding around `referenceNormal`
 * when viewed from outside the unit sphere; negative (< 0) indicates clockwise (CW).
 */
export function signedSphericalRingArea(
  points: readonly Vec3Tuple[],
  referenceNormal?: Vec3Tuple,
): number {
  const n = points.length
  if (n < 3)
    return 0
  const last = points[0][0] === points[n - 1][0]
    && points[0][1] === points[n - 1][1]
    && points[0][2] === points[n - 1][2]
    ? n - 1
    : n
  if (last < 3)
    return 0

  let crossX = 0
  let crossY = 0
  let crossZ = 0
  let sumX = 0
  let sumY = 0
  let sumZ = 0
  for (let i = 0; i < last; i++) {
    const a = points[i]
    const b = points[(i + 1) % last]
    crossX += a[1] * b[2] - a[2] * b[1]
    crossY += a[2] * b[0] - a[0] * b[2]
    crossZ += a[0] * b[1] - a[1] * b[0]
    sumX += a[0]
    sumY += a[1]
    sumZ += a[2]
  }
  const normal = referenceNormal ?? (
    Math.hypot(sumX, sumY, sumZ) > 1e-8
      ? normalizeVec3(sumX, sumY, sumZ)
      : points[0]
  )
  return crossX * normal[0] + crossY * normal[1] + crossZ * normal[2]
}

/**
 * Computes signed planar shoelace area on unwrapped `[lonDeg, latDeg]` coordinates.
 * Positive (> 0) is CCW; negative (< 0) is CW.
 */
export function signedPlanarUnwrappedRingArea(coords: readonly LonLatTuple[]): number {
  const n = coords.length
  if (n < 3)
    return 0
  const closed = coords[0][0] === coords[n - 1][0] && coords[0][1] === coords[n - 1][1]
  const count = closed ? n - 1 : n
  if (count < 3)
    return 0

  const unwrappedLon = new Float64Array(count + 1)
  unwrappedLon[0] = coords[0][0]
  for (let i = 1; i < count; i++)
    unwrappedLon[i] = unwrapLongitudeDegNear(coords[i][0], unwrappedLon[i - 1])
  unwrappedLon[count] = unwrapLongitudeDegNear(coords[0][0], unwrappedLon[count - 1])

  let area2 = 0
  for (let i = 0; i < count; i++) {
    const x0 = unwrappedLon[i]
    const y0 = coords[i][1]
    const x1 = unwrappedLon[i + 1]
    const y1 = coords[(i + 1) % count][1]
    area2 += x0 * y1 - x1 * y0
  }
  return area2 * 0.5
}
