import type { ValidationIssue, ValidationResult } from '@another-earth/world-data'
import type { SphericalMesh } from './spherical-mesh'
import { sphericalTriangleArea } from '../math/spherical'
import { icosphereRegionCount } from './icosphere'
/** O(V+E+F) verification of generated typed storage, capped at 100 reported issues. */
export function validateSphericalMesh(m: SphericalMesh): ValidationResult {
  const issues: ValidationIssue[] = []
  const add = (path: string, message: string) => {
    if (issues.length < 100)
      issues.push({ code: 'topology', path, message })
  }
  let count: number
  try {
    count = icosphereRegionCount(m.subdivisionLevel)
  }
  catch {
    return { valid: false, issues: [{ code: 'range', path: 'subdivisionLevel', message: 'Expected L0–L7' }] }
  }
  if (!Number.isFinite(m.irregularity) || m.irregularity < 0 || m.irregularity > 1 || typeof m.seed !== 'string' || !m.seed.trim())
    add('irregularity/seed', 'Invalid mesh generation parameters')
  const regular = m.irregularity === 0
  const faces = 20 * 4 ** m.subdivisionLevel
  const edges = 30 * 4 ** m.subdivisionLevel
  if (m.regionCount !== count)
    add('regionCount', 'Incorrect region count')
  const lengths: readonly [
    string,
    ArrayLike<number>,
    number,
  ][] = [
    ['centers', m.centers, 3 * count],
    ['triangles', m.triangles, 3 * faces],
    ['areaKm2', m.areaKm2, count],
    ['neighborOffsets', m.neighborOffsets, count + 1],
    ['neighbors', m.neighbors, 2 * edges],
    ['neighborEdges', m.neighborEdges, 2 * edges],
    ['dualVertices', m.dualVertices, 3 * faces],
    ['boundaryCorners', m.boundaryCorners, 3 * faces],
    ['edgeRegions', m.edgeRegions, 2 * edges],
    ['edgeTriangles', m.edgeTriangles, 2 * edges],
    ['triangleEdges', m.triangleEdges, 3 * faces],
    ['edgeAngularDistances', m.edgeAngularDistances, edges],
  ]
  for (const [path, values, expected] of lengths) {
    if (values.length !== expected)
      add(path, `Expected length ${expected}`)
    const floats = ['centers', 'areaKm2', 'dualVertices', 'edgeAngularDistances'].includes(path)
    if (floats ? !(values instanceof Float64Array) : !(values instanceof Uint32Array))
      add(path, 'Incorrect TypedArray dtype')
  }
  if (issues.length)
    return { valid: false, issues }
  if (!(m.physicalRadiusKm > 0) || !Number.isFinite(4 * Math.PI * m.physicalRadiusKm ** 2))
    add('physicalRadiusKm', 'Invalid radius')
  if (m.neighborOffsets[0] !== 0 || m.neighborOffsets[count] !== 2 * edges)
    add('neighborOffsets', 'Invalid CSR extent')
  for (let r = 0; r < count; r++) {
    if (m.neighborOffsets[r] > m.neighborOffsets[r + 1] || m.neighborOffsets[r + 1] > 2 * edges)
      add('neighborOffsets', 'Invalid CSR offsets')
    const degree = m.neighborOffsets[r + 1] - m.neighborOffsets[r]
    if (degree < 3 || (regular && degree !== 5 && degree !== 6))
      add('neighbors', 'Invalid spherical mesh valence')
  }
  if (issues.length)
    return { valid: false, issues }
  let pentagons = 0
  let area = 0
  const edgeUse = new Uint8Array(edges)
  const neighborUse = new Uint8Array(edges)
  const cornerSeen = new Uint32Array(faces)
  for (let t = 0; t < faces; t++) {
    const a = m.triangles[3 * t]
    const b = m.triangles[3 * t + 1]
    const c = m.triangles[3 * t + 2]
    if (a >= count || b >= count || c >= count || a === b || b === c || c === a) {
      add('triangles', 'Invalid or duplicate vertex')
      continue
    }
    const ax = m.centers[3 * a]
    const ay = m.centers[3 * a + 1]
    const az = m.centers[3 * a + 2]
    const bx = m.centers[3 * b]
    const by = m.centers[3 * b + 1]
    const bz = m.centers[3 * b + 2]
    const cx = m.centers[3 * c]
    const cy = m.centers[3 * c + 1]
    const cz = m.centers[3 * c + 2]
    const determinant = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
    if (!(determinant > 0))
      add('triangles', 'Degenerate or inward face')
    const x = m.dualVertices[3 * t]
    const y = m.dualVertices[3 * t + 1]
    const z = m.dualVertices[3 * t + 2]
    const da = x * ax + y * ay + z * az
    const db = x * bx + y * by + z * bz
    const dc = x * cx + y * cy + z * cz
    if (!Number.isFinite(x + y + z) || Math.abs(Math.hypot(x, y, z) - 1) > 1e-10 || da <= 0 || Math.abs(da - db) > 1e-10 || Math.abs(da - dc) > 1e-10)
      add('dualVertices', 'Invalid spherical circumcenter')
    for (let side = 0; side < 3; side++) {
      const e = m.triangleEdges[3 * t + side]
      const u = m.triangles[3 * t + side]
      const v = m.triangles[3 * t + (side + 1) % 3]
      if (e >= edges || !((m.edgeRegions[2 * e] === u && m.edgeRegions[2 * e + 1] === v) || (m.edgeRegions[2 * e] === v && m.edgeRegions[2 * e + 1] === u)) || (m.edgeTriangles[2 * e] !== t && m.edgeTriangles[2 * e + 1] !== t))
        add('triangleEdges', 'Inconsistent edge/face incidence')
      else
        edgeUse[e]++
    }
  }
  for (let e = 0; e < edges; e++) {
    if (edgeUse[e] !== 2 || m.edgeTriangles[2 * e] >= faces || m.edgeTriangles[2 * e + 1] >= faces || m.edgeTriangles[2 * e] === m.edgeTriangles[2 * e + 1])
      add('edgeTriangles', 'Edge must join two distinct triangles')
    const t = m.edgeTriangles[2 * e]
    const other = m.edgeTriangles[2 * e + 1]
    if (t < faces && other < faces) {
      const first = m.triangles[3 * t]
      const x = m.dualVertices[3 * t]
      const y = m.dualVertices[3 * t + 1]
      const z = m.dualVertices[3 * t + 2]
      const ownDot = x * m.centers[3 * first] + y * m.centers[3 * first + 1] + z * m.centers[3 * first + 2]
      for (let side = 0; side < 3; side++) {
        const r = m.triangles[3 * other + side]
        if (x * m.centers[3 * r] + y * m.centers[3 * r + 1] + z * m.centers[3 * r + 2] > ownDot + 1e-12)
          add('dualVertices', 'Local Delaunay empty-cap condition failed')
      }
    }
    if (!(m.edgeAngularDistances[e] > 0 && m.edgeAngularDistances[e] < Math.PI))
      add('edgeAngularDistances', 'Invalid angular distance')
  }
  for (let r = 0; r < count; r++) {
    const x = m.centers[3 * r]
    const y = m.centers[3 * r + 1]
    const z = m.centers[3 * r + 2]
    if (!Number.isFinite(x + y + z) || Math.abs(Math.hypot(x, y, z) - 1) > 1e-10)
      add('centers', 'Region center must be unit length')
    if (!(m.areaKm2[r] > 0) || !Number.isFinite(m.areaKm2[r]))
      add('areaKm2', 'Area must be finite and positive')
    area += m.areaKm2[r]
    const start = m.neighborOffsets[r]
    const end = m.neighborOffsets[r + 1]
    const degree = end - start
    if (degree === 5)
      pentagons++
    else if (regular && degree !== 6)
      add('neighbors', 'Expected valence five or six')
    let cellArea = 0
    for (let i = start; i < end; i++) {
      const n = m.neighbors[i]
      const e = m.neighborEdges[i]
      if (n >= count || n === r || e >= edges) {
        add('neighbors', 'Invalid neighbor or edge')
        continue
      }
      const aRegion = m.edgeRegions[2 * e]
      const bRegion = m.edgeRegions[2 * e + 1]
      const direction = aRegion === r && bRegion === n ? 1 : bRegion === r && aRegion === n ? 2 : 0
      if (!direction || (neighborUse[e] & direction))
        add('neighbors', 'Duplicate or inconsistent adjacency')
      neighborUse[e] |= direction
      const a = m.boundaryCorners[i]
      const b = m.boundaryCorners[i + 1 < end ? i + 1 : start]
      if (a >= faces || b >= faces || a === b) {
        add('boundaryCorners', 'Invalid boundary corner')
        continue
      }
      const ax = m.dualVertices[3 * a]
      const ay = m.dualVertices[3 * a + 1]
      const az = m.dualVertices[3 * a + 2]
      const bx = m.dualVertices[3 * b]
      const by = m.dualVertices[3 * b + 1]
      const bz = m.dualVertices[3 * b + 2]
      if (!(x * (ay * bz - az * by) + y * (az * bx - ax * bz) + z * (ax * by - ay * bx) > 0))
        add('boundaryCorners', 'Boundary must wind outwards')
      if (cornerSeen[a] === r + 1)
        add('boundaryCorners', 'Duplicate boundary corner')
      cornerSeen[a] = r + 1
      if (m.triangles[3 * a] !== r && m.triangles[3 * a + 1] !== r && m.triangles[3 * a + 2] !== r)
        add('boundaryCorners', 'Corner is not incident to region')
      cellArea += sphericalTriangleArea(x, y, z, ax, ay, az, bx, by, bz) * m.physicalRadiusKm ** 2
      let shared = false
      for (let side = 0; side < 3; side++) {
        const edge = m.triangleEdges[3 * a + side]
        if ((m.edgeRegions[2 * edge] === r || m.edgeRegions[2 * edge + 1] === r) && ((m.edgeTriangles[2 * edge] === a && m.edgeTriangles[2 * edge + 1] === b) || (m.edgeTriangles[2 * edge] === b && m.edgeTriangles[2 * edge + 1] === a)))
          shared = true
      }
      if (!shared)
        add('boundaryCorners', 'Consecutive corners must share an incident edge')
    }
    if (Math.abs(cellArea - m.areaKm2[r]) > 1e-9 * m.areaKm2[r])
      add('areaKm2', 'Cell area disagrees with spherical boundary')
  }
  for (let e = 0; e < edges; e++) {
    if (neighborUse[e] !== 3)
      add('neighbors', 'Adjacency must be reciprocal')
  }
  if ((regular && pentagons !== 12) || count - edges + faces !== 2)
    add('counts', 'Invalid Euler characteristic or pentagon count')
  const expected = 4 * Math.PI * m.physicalRadiusKm ** 2
  if (!Number.isFinite(area) || Math.abs(area - expected) > 1e-9 * expected)
    add('areaKm2', 'Areas do not cover the sphere')
  return { valid: issues.length === 0, issues }
}
