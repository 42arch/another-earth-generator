/** Right-handed Y-up: north +Y, longitude zero +Z, east 90 degrees +X. Angles are radians. */
export interface Vector3Like {
  x: number
  y: number
  z: number
}
export interface LatLon {
  latitude: number
  longitude: number
}
/** Caller-owned output enables allocation-free hot loops. Zero/nonfinite vectors are rejected. */
export function normalizeVector(v: Vector3Like, out: Vector3Like): Vector3Like {
  const length = Math.hypot(v.x, v.y, v.z)
  if (!(length > 0) || !Number.isFinite(length))
    throw new RangeError('Expected a finite nonzero vector')
  out.x = v.x / length
  out.y = v.y / length
  out.z = v.z / length
  return out
}
export function latLonToCartesian(latitude: number, longitude: number, out: Vector3Like): Vector3Like {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > Math.PI / 2 || !Number.isFinite(longitude))
    throw new RangeError('Invalid latitude/longitude in radians')
  const cos = Math.cos(latitude)
  out.x = cos * Math.sin(longitude)
  out.y = Math.sin(latitude)
  out.z = cos * Math.cos(longitude)
  return out
}
export function cartesianToLatLon(v: Vector3Like, out: LatLon): LatLon {
  const length = Math.hypot(v.x, v.y, v.z)
  if (!(length > 0) || !Number.isFinite(length))
    throw new RangeError('Expected a finite nonzero vector')
  out.latitude = Math.atan2(v.y, Math.hypot(v.x, v.z))
  out.longitude = v.x === 0 && v.z === 0 ? 0 : Math.atan2(v.x, v.z)
  return out
}
/** Scale-independent angle in [0, pi], robust for very close and antipodal vectors. */
export function angularDistance(a: Vector3Like, b: Vector3Like): number {
  const al = Math.hypot(a.x, a.y, a.z)
  const bl = Math.hypot(b.x, b.y, b.z)
  if (!(al > 0 && bl > 0) || !Number.isFinite(al) || !Number.isFinite(bl))
    throw new RangeError('Expected finite nonzero vectors')
  const ax = a.x / al
  const ay = a.y / al
  const az = a.z / al
  const bx = b.x / bl
  const by = b.y / bl
  const bz = b.z / bl
  return Math.atan2(Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx), ax * bx + ay * by + az * bz)
}
export function greatCircleDistanceKm(a: Vector3Like, b: Vector3Like, physicalRadiusKm: number): number {
  if (!(physicalRadiusKm > 0) || !Number.isFinite(physicalRadiusKm))
    throw new RangeError('Invalid physical radius')
  return angularDistance(a, b) * physicalRadiusKm
}
/** Geographic east/north. At exact poles longitude zero supplies a deterministic frame. */
export function tangentDirections(v: Vector3Like, east: Vector3Like, north: Vector3Like): void {
  const length = Math.hypot(v.x, v.y, v.z)
  if (!(length > 0) || !Number.isFinite(length))
    throw new RangeError('Expected finite nonzero vector')
  const x = v.x / length
  const y = v.y / length
  const z = v.z / length
  const horizontal = Math.hypot(x, z)
  east.x = horizontal > 0 ? z / horizontal : 1
  east.y = 0
  east.z = horizontal > 0 ? -x / horizontal : 0
  north.x = y * east.z
  north.y = z * east.x - x * east.z
  north.z = -y * east.x
}
/** Solid angle (steradians) of a minor spherical triangle on the unit sphere. */
export function sphericalTriangleArea(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): number {
  const determinant = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
  return 2 * Math.atan2(Math.abs(determinant), 1 + ax * bx + ay * by + az * bz + bx * cx + by * cy + bz * cz + cx * ax + cy * ay + cz * az)
}
