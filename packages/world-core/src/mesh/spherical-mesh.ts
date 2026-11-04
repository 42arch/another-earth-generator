import type { IcosphereGeometry, IcosphereOptions } from './icosphere'
import type { MeshTopology } from './mesh-types'
import { sphericalTriangleArea } from '../math/spherical'
import { generateIcosphere, icosphereRegionCount } from './icosphere'
/** Core-owned stable storage. readonly does not protect array elements; use MeshQueries for readers. */
export interface SphericalMesh extends MeshTopology {
  readonly irregularity: number
  readonly seed: string
  readonly subdivisionLevel: number
  readonly physicalRadiusKm: number
  readonly triangles: Uint32Array
  /** One outward spherical circumcenter per triangle, length 3F. Corner ID = triangle ID. */
  readonly dualVertices: Float64Array
  /** CCW corner IDs viewed from outside. Offsets reuse neighborOffsets; length 3F = 2E. */
  readonly boundaryCorners: Uint32Array
  /** End-region pairs, length 2E; stable edge IDs in first-face encounter order. */
  readonly edgeRegions: Uint32Array
  /** Two adjacent triangle/corner IDs per edge, length 2E. */
  readonly edgeTriangles: Uint32Array
  /** Triangle side -> edge ID, length 3F. Side j connects triangle[j] to triangle[(j+1)%3]. */
  readonly triangleEdges: Uint32Array
  /** CSR adjacency slot -> edge ID, length 2E, aligned with neighbors. */
  readonly neighborEdges: Uint32Array
  /** Region-center great-circle angular distance per edge, length E, radians. */
  readonly edgeAngularDistances: Float64Array
}
export interface SphericalMeshOptions extends IcosphereOptions {
  readonly subdivisionLevel: number
  readonly physicalRadiusKm: number
}
export function createSphericalMesh(options: SphericalMeshOptions): SphericalMesh {
  if (!(4 * Math.PI * options.physicalRadiusKm ** 2 > 0) || !(options.physicalRadiusKm > 0) || !Number.isFinite(4 * Math.PI * options.physicalRadiusKm ** 2))
    throw new RangeError('Invalid physical radius')
  return buildSphericalVoronoi(generateIcosphere(options.subdivisionLevel, options), options.physicalRadiusKm)
}
/** Takes exclusive ownership of generated geometry; do not mutate or transfer it afterwards. */
export function buildSphericalVoronoi(geometry: IcosphereGeometry, physicalRadiusKm: number): SphericalMesh {
  const { centers, triangles, subdivisionLevel, irregularity, seed } = geometry
  const count = icosphereRegionCount(subdivisionLevel)
  if (!(physicalRadiusKm > 0) || !(4 * Math.PI * physicalRadiusKm ** 2 > 0) || !Number.isFinite(4 * Math.PI * physicalRadiusKm ** 2))
    throw new RangeError('Invalid physical radius')
  if (centers.length !== 3 * count || triangles.length !== 60 * 4 ** subdivisionLevel)
    throw new RangeError('Invalid Icosphere geometry lengths')
  const faces = triangles.length / 3
  const edgeCount = triangles.length / 2
  const edgeRegions = new Uint32Array(2 * edgeCount)
  const edgeTriangles = new Uint32Array(2 * edgeCount).fill(0xFFFFFFFF)
  const triangleEdges = new Uint32Array(triangles.length)
  const degree = new Uint32Array(count)
  const lookup = new Map<number, number>()
  let edges = 0
  for (let t = 0; t < faces; t++) {
    for (let side = 0; side < 3; side++) {
      const a = triangles[3 * t + side]
      const b = triangles[3 * t + (side + 1) % 3]
      if (a >= count || b >= count || a === b)
        throw new Error('Invalid triangle index')
      const key = Math.min(a, b) * count + Math.max(a, b)
      let edge = lookup.get(key)
      if (edge === undefined) {
        edge = edges++
        lookup.set(key, edge)
        edgeRegions[2 * edge] = a
        edgeRegions[2 * edge + 1] = b
        edgeTriangles[2 * edge] = t
        degree[a]++
        degree[b]++
      }
      else {
        if (edgeTriangles[2 * edge + 1] !== 0xFFFFFFFF || edgeRegions[2 * edge] !== b)
          throw new Error('Nonmanifold or inconsistent triangle winding')
        edgeTriangles[2 * edge + 1] = t
      }
      triangleEdges[3 * t + side] = edge
    }
  }
  if (edges !== edgeCount || edgeTriangles.includes(0xFFFFFFFF))
    throw new Error('Mesh must be closed')
  const neighborOffsets = new Uint32Array(count + 1)
  for (let r = 0; r < count; r++)
    neighborOffsets[r + 1] = neighborOffsets[r] + degree[r]
  const neighbors = new Uint32Array(2 * edges)
  const neighborEdges = new Uint32Array(2 * edges)
  const cursor = neighborOffsets.slice()
  const edgeAngularDistances = new Float64Array(edges)
  for (let e = 0; e < edges; e++) {
    const a = edgeRegions[2 * e]
    const b = edgeRegions[2 * e + 1]
    const i = cursor[a]++
    const j = cursor[b]++
    neighbors[i] = b
    neighbors[j] = a
    neighborEdges[i] = neighborEdges[j] = e
    const ax = centers[3 * a]
    const ay = centers[3 * a + 1]
    const az = centers[3 * a + 2]
    const bx = centers[3 * b]
    const by = centers[3 * b + 1]
    const bz = centers[3 * b + 2]
    edgeAngularDistances[e] = Math.atan2(Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx), ax * bx + ay * by + az * bz)
  }
  const dualVertices = new Float64Array(3 * faces)
  const boundaryCorners = new Uint32Array(triangles.length)
  cursor.set(neighborOffsets)
  for (let t = 0; t < faces; t++) {
    const a = 3 * triangles[3 * t]
    const b = 3 * triangles[3 * t + 1]
    const c = 3 * triangles[3 * t + 2]
    const abx = centers[b] - centers[a]
    const aby = centers[b + 1] - centers[a + 1]
    const abz = centers[b + 2] - centers[a + 2]
    const acx = centers[c] - centers[a]
    const acy = centers[c + 1] - centers[a + 1]
    const acz = centers[c + 2] - centers[a + 2]
    const x = aby * acz - abz * acy
    const y = abz * acx - abx * acz
    const z = abx * acy - aby * acx
    const length = Math.hypot(x, y, z)
    if (!(length > 0) || x * centers[a] + y * centers[a + 1] + z * centers[a + 2] <= 0)
      throw new Error('Degenerate or inward triangle')
    dualVertices[3 * t] = x / length
    dualVertices[3 * t + 1] = y / length
    dualVertices[3 * t + 2] = z / length
    for (let side = 0; side < 3; side++)
      boundaryCorners[cursor[triangles[3 * t + side]]++] = t
  }
  const areaKm2 = new Float64Array(count)
  const angles = new Float64Array(degree.reduce((max, value) => Math.max(max, value), 0))
  for (let r = 0; r < count; r++) {
    const start = neighborOffsets[r]
    const end = neighborOffsets[r + 1]
    if (end - start < 3)
      throw new Error('Invalid spherical cell valence')
    const x = centers[3 * r]
    const y = centers[3 * r + 1]
    const z = centers[3 * r + 2]
    // Same stable local-frame construction as the legacy Voronoi sorter.
    const refx = Math.abs(y) < 0.9 ? 0 : 1
    const refy = Math.abs(y) < 0.9 ? 1 : 0
    const el = Math.hypot(refy * z, -refx * z, refx * y - refy * x)
    const ex = refy * z / el
    const ey = -refx * z / el
    const ez = (refx * y - refy * x) / el
    const nx = y * ez - z * ey
    const ny = z * ex - x * ez
    const nz = x * ey - y * ex
    for (let i = start; i < end; i++) {
      const c = boundaryCorners[i] * 3
      angles[i - start] = Math.atan2(dualVertices[c] * nx + dualVertices[c + 1] * ny + dualVertices[c + 2] * nz, dualVertices[c] * ex + dualVertices[c + 1] * ey + dualVertices[c + 2] * ez)
    }
    for (let i = 1; i < end - start; i++) {
      const corner = boundaryCorners[start + i]
      const angle = angles[i]
      let j = i - 1
      while (j >= 0 && angles[j] > angle) {
        boundaryCorners[start + j + 1] = boundaryCorners[start + j]
        angles[j + 1] = angles[j]
        j--
      }
      boundaryCorners[start + j + 1] = corner
      angles[j + 1] = angle
    }
    let area = 0
    for (let i = start; i < end; i++) {
      const a = 3 * boundaryCorners[i]
      const b = 3 * boundaryCorners[i + 1 < end ? i + 1 : start]
      area += sphericalTriangleArea(x, y, z, dualVertices[a], dualVertices[a + 1], dualVertices[a + 2], dualVertices[b], dualVertices[b + 1], dualVertices[b + 2])
    }
    areaKm2[r] = area * physicalRadiusKm ** 2
    if (!(areaKm2[r] > 0))
      throw new RangeError('Region area underflow')
  }
  const meshId = irregularity === 0 ? `icosphere-v1:L${subdivisionLevel}:R${physicalRadiusKm}` : `icosphere-jitter-v1:L${subdivisionLevel}:R${physicalRadiusKm}:I${irregularity}:S${encodeURIComponent(seed)}`
  return { meshId, irregularity, seed, subdivisionLevel, physicalRadiusKm, regionCount: count, centers, triangles, areaKm2, neighborOffsets, neighbors, dualVertices, boundaryCorners, edgeRegions, edgeTriangles, triangleEdges, neighborEdges, edgeAngularDistances }
}
