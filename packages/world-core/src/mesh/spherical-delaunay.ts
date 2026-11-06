import Delaunator from 'delaunator'
/**
 * Legacy stereographic construction: remove a site at infinity, triangulate the
 * finite sites, then join its planar hull back to that site. Input is a distinct,
 * unit-sphere point set covering the sphere (as produced by our jittered Icosphere).
 * No longitude/latitude triangulation. Pole is an existing region ID.
 */
export function triangulateSphericalDelaunay(centers: Float64Array, projectionPole = 0): Uint32Array {
  const count = centers.length / 3
  if (!Number.isInteger(count) || count < 4 || count > 655362 || !Number.isInteger(projectionPole) || projectionPole < 0 || projectionPole >= count)
    throw new RangeError('Invalid spherical sites or projection pole')
  for (let r = 0; r < count; r++) {
    const norm = Math.hypot(centers[3 * r], centers[3 * r + 1], centers[3 * r + 2])
    if (!Number.isFinite(norm) || Math.abs(norm - 1) > 1e-12)
      throw new RangeError('Spherical Delaunay sites must have unit length')
  }
  const px = centers[3 * projectionPole]
  const py = centers[3 * projectionPole + 1]
  const pz = centers[3 * projectionPole + 2]
  // Least-aligned coordinate reference, so no singular Rodrigues branch at +/-Z.

  // Least-aligned coordinate reference, so no singular Rodrigues branch at +/-Z.
  const axis = Math.abs(px) <= Math.abs(py) && Math.abs(px) <= Math.abs(pz) ? 0 : Math.abs(py) <= Math.abs(pz) ? 1 : 2
  const ex = axis === 0 ? 0 : axis === 1 ? pz : -py
  const ey = axis === 0 ? -pz : axis === 1 ? 0 : px
  const ez = axis === 0 ? py : axis === 1 ? -px : 0
  const el = Math.hypot(ex, ey, ez)
  const ux = ex / el
  const uy = ey / el
  const uz = ez / el
  const vx = py * uz - pz * uy
  const vy = pz * ux - px * uz
  const vz = px * uy - py * ux
  const projected = new Float64Array(2 * (count - 1))
  const regionIds = new Uint32Array(count - 1)
  let cursor = 0
  for (let r = 0; r < count; r++) {
    if (r === projectionPole)
      continue
    const x = centers[3 * r]
    const y = centers[3 * r + 1]
    const z = centers[3 * r + 2]
    // For unit vectors |q-p|²/2 = 1-dot(q,p); avoids near-pole cancellation.

    const dx = x - px
    const dy = y - py
    const dz = z - pz
    const denominator = (dx * dx + dy * dy + dz * dz) / 2
    if (!(denominator > 0))
      throw new RangeError('Duplicate site at projection pole')
    const a = (x * ux + y * uy + z * uz) / denominator
    const b = (x * vx + y * vy + z * vz) / denominator
    if (!Number.isFinite(a) || !Number.isFinite(b))
      throw new RangeError('Unrepresentable stereographic projection')
    projected[2 * cursor] = a
    projected[2 * cursor + 1] = b
    regionIds[cursor++] = r
  }
  const planar = new Delaunator(projected)
  const expectedLength = 3 * (2 * count - 4)
  if (planar.triangles.length + 3 * planar.hull.length !== expectedLength)
    throw new Error('Spherical triangulation omitted duplicate or numerically unresolved sites')
  const triangles = new Uint32Array(expectedLength)
  cursor = 0
  for (const id of planar.triangles)
    triangles[cursor++] = regionIds[id]
  for (let i = 0; i < planar.hull.length; i++) {
    triangles[cursor++] = projectionPole
    triangles[cursor++] = regionIds[planar.hull[(i + 1) % planar.hull.length]]
    triangles[cursor++] = regionIds[planar.hull[i]]
  }
  for (let i = 0; i < triangles.length; i += 3) {
    const a = 3 * triangles[i]
    const b = 3 * triangles[i + 1]
    const c = 3 * triangles[i + 2]
    const determinant = centers[a] * (centers[b + 1] * centers[c + 2] - centers[b + 2] * centers[c + 1])
      + centers[a + 1] * (centers[b + 2] * centers[c] - centers[b] * centers[c + 2])
      + centers[a + 2] * (centers[b] * centers[c + 1] - centers[b + 1] * centers[c])
    if (!Number.isFinite(determinant) || determinant === 0)
      throw new Error('Degenerate spherical Delaunay face')
    if (determinant < 0) {
      const swap = triangles[i + 1]
      triangles[i + 1] = triangles[i + 2]
      triangles[i + 2] = swap
    }
  }
  return triangles
}
