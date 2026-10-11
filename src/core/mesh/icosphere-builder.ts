import alea from 'alea'
import Delaunator from 'delaunator'
import { sphericalTriangleArea } from '@/core/math/math'

export interface SphericalMeshData {
  numRegions: number
  numTriangles: number
  regionPosition: Float32Array
  regionLatitude: Float32Array
  regionLongitude: Float32Array
  regionArea: Float32Array
  neighborOffsets: Uint32Array
  neighbors: Uint32Array
  triangles: Uint32Array
}

/**
 * Icosphere subdivision levels and their resulting vertex (region) counts.
 *
 * | Level | Regions (V = 10×4^L + 2) |
 * |-------|--------------------------|
 * |   3   |        642               |
 * |   4   |      2,562               |
 * |   5   |     10,242               |
 * |   6   |     40,962               |
 * |   7   |    163,842               |
 * |   8   |    655,362               |
 */
export function icosphereRegionCount(level: number): number {
  return 10 * (4 ** level) + 2
}

/** Maps a target region count to the nearest Icosphere subdivision level. */
export function nearestIcosphereLevel(targetRegions: number): number {
  // V = 10 × 4^L + 2  →  L = log4((V − 2) / 10)
  const raw = Math.log2(Math.max(1, (targetRegions - 2) / 10)) / 2
  return Math.max(0, Math.round(raw))
}

const DEFAULT_IRREGULARITY = 0.75

// Icosahedron base geometry (unit sphere)
const PHI = (1 + Math.sqrt(5)) / 2
const ICO_RAW: [number, number, number][] = [
  [-1, PHI, 0],
  [1, PHI, 0],
  [-1, -PHI, 0],
  [1, -PHI, 0],
  [0, -1, PHI],
  [0, 1, PHI],
  [0, -1, -PHI],
  [0, 1, -PHI],
  [PHI, 0, -1],
  [PHI, 0, 1],
  [-PHI, 0, -1],
  [-PHI, 0, 1],
]

const ICO_FACES: [number, number, number][] = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
]

/**
 * Generates a spherical mesh via Icosphere subdivision.
 *
 * Vertices of the subdivided icosahedron become Voronoi cell centers (regions).
 * The triangulation is the dual's Delaunay, and the topology is fully determined
 * by the subdivision rules — no external Delaunay library is needed.
 */
export class IcosphereBuilder {
  build(level: number, seed = 0, irregularity = DEFAULT_IRREGULARITY): SphericalMeshData {
    const { positions, triangleIndices } = this.subdivide(level)
    const numRegions = positions.length / 3
    const numTriangles = triangleIndices.length / 3

    // Apply irregularity jitter before computing derived data
    let triangles: Uint32Array
    if (irregularity > 0) {
      this.applyJitter(positions, numRegions, seed, irregularity)
      // Rebuild Delaunay topology since large jitter invalidates the Icosphere topology
      triangles = this.buildSphericalDelaunay(positions)
    }
    else {
      triangles = new Uint32Array(triangleIndices)
    }

    const regionPosition = new Float32Array(positions)
    const { neighborOffsets, neighbors } = this.buildAdjacency(numRegions, triangles)
    const { regionLatitude, regionLongitude } = this.buildCoordinates(regionPosition)
    const regionArea = this.buildAreas(regionPosition, triangles)

    return {
      numRegions,
      numTriangles,
      regionPosition,
      regionLatitude,
      regionLongitude,
      regionArea,
      neighborOffsets,
      neighbors,
      triangles,
    }
  }

  private subdivide(level: number): { positions: number[], triangleIndices: number[] } {
    // Initialize icosahedron vertices, normalized to unit sphere
    const positions: number[] = []
    for (const [x, y, z] of ICO_RAW) {
      const len = Math.hypot(x, y, z)
      positions.push(x / len, y / len, z / len)
    }

    let faces = ICO_FACES.map(f => [...f] as [number, number, number])

    // Edge midpoint cache: "min:max" → vertex index
    const getMidpoint = (cache: Map<string, number>, a: number, b: number): number => {
      const low = Math.min(a, b)
      const high = Math.max(a, b)
      const key = `${low}:${high}`
      const existing = cache.get(key)
      if (existing !== undefined)
        return existing

      const ai = a * 3
      const bi = b * 3
      let mx = positions[ai] + positions[bi]
      let my = positions[ai + 1] + positions[bi + 1]
      let mz = positions[ai + 2] + positions[bi + 2]
      // Normalize to unit sphere
      const len = Math.hypot(mx, my, mz) || 1
      mx /= len
      my /= len
      mz /= len

      const index = positions.length / 3
      positions.push(mx, my, mz)
      cache.set(key, index)
      return index
    }

    // Recursive 4-way subdivision
    for (let l = 0; l < level; l++) {
      const cache = new Map<string, number>()
      const newFaces: [number, number, number][] = []

      for (const [a, b, c] of faces) {
        const ab = getMidpoint(cache, a, b)
        const bc = getMidpoint(cache, b, c)
        const ca = getMidpoint(cache, c, a)
        newFaces.push(
          [a, ab, ca],
          [b, bc, ab],
          [c, ca, bc],
          [ab, bc, ca],
        )
      }
      faces = newFaces
    }

    // Flatten triangle indices
    const triangleIndices: number[] = []
    for (const [a, b, c] of faces) {
      triangleIndices.push(a, b, c)
    }

    return { positions, triangleIndices }
  }

  /**
   * Apply tangential jitter to break up the regular hexagonal grid pattern.
   * Each vertex is displaced along its local tangent plane using seeded random values.
   * The displacement is clamped to prevent triangle flips.
   */
  private applyJitter(
    positions: number[],
    numRegions: number,
    seed: number,
    irregularity: number,
  ): void {
    const random = alea(seed)
    const jitterStrength = Math.max(0, Math.min(1, irregularity))

    // Average angular spacing between adjacent vertices
    const avgSpacing = Math.sqrt(4 * Math.PI / numRegions)
    // Max displacement as a fraction of spacing. Since we use a robust Delaunay
    // triangulator, we can safely use a large displacement without triangle flips.
    const maxDisplacement = avgSpacing * 0.75 * jitterStrength

    // Skip the 12 original icosahedron vertices (indices 0..11) to preserve
    // topology at the pentagonal singularities
    const startIndex = 12

    for (let i = startIndex; i < numRegions; i++) {
      const idx = i * 3
      const nx = positions[idx]
      const ny = positions[idx + 1]
      const nz = positions[idx + 2]

      // Build a local tangent frame on the sphere
      // Choose a reference vector not parallel to the normal
      const refX = Math.abs(ny) < 0.9 ? 0 : 1
      const refY = Math.abs(ny) < 0.9 ? 1 : 0
      // East = ref × normal
      let eastX = refY * nz
      let eastY = -refX * nz
      let eastZ = refX * ny - refY * nx
      const eastLen = Math.hypot(eastX, eastY, eastZ) || 1
      eastX /= eastLen
      eastY /= eastLen
      eastZ /= eastLen
      // North = normal × east
      const northX = ny * eastZ - nz * eastY
      const northY = nz * eastX - nx * eastZ
      const northZ = nx * eastY - ny * eastX

      // Two independent random displacements (subtraction gives roughly zero-mean)
      const du = (random() - random()) * maxDisplacement
      const dv = (random() - random()) * maxDisplacement

      // Displace along tangent plane
      const px = nx + du * eastX + dv * northX
      const py = ny + du * eastY + dv * northY
      const pz = nz + du * eastZ + dv * northZ

      // Re-project onto unit sphere
      const len = Math.hypot(px, py, pz) || 1
      positions[idx] = px / len
      positions[idx + 1] = py / len
      positions[idx + 2] = pz / len
    }
  }

  private buildAdjacency(numRegions: number, triangles: Uint32Array) {
    const MAX_DEGREE = 12
    const adj = new Uint32Array(numRegions * MAX_DEGREE)
    const degree = new Uint32Array(numRegions)

    const addEdge = (u: number, v: number) => {
      const start = u * MAX_DEGREE
      const deg = degree[u]
      for (let i = 0; i < deg; i++) {
        if (adj[start + i] === v)
          return
      }
      if (deg < MAX_DEGREE) {
        adj[start + deg] = v
        degree[u]++
      }
    }

    for (let index = 0; index < triangles.length; index += 3) {
      const a = triangles[index]
      const b = triangles[index + 1]
      const c = triangles[index + 2]
      addEdge(a, b)
      addEdge(b, a)
      addEdge(b, c)
      addEdge(c, b)
      addEdge(c, a)
      addEdge(a, c)
    }

    const neighborOffsets = new Uint32Array(numRegions + 1)
    for (let region = 0; region < numRegions; region++) {
      neighborOffsets[region + 1] = neighborOffsets[region] + degree[region]
    }

    const neighbors = new Uint32Array(neighborOffsets[numRegions])
    for (let region = 0; region < numRegions; region++) {
      const start = region * MAX_DEGREE
      const deg = degree[region]
      const local = adj.subarray(start, start + deg)
      local.sort()
      neighbors.set(local, neighborOffsets[region])
    }
    return { neighborOffsets, neighbors }
  }

  private buildCoordinates(position: Float32Array) {
    const numRegions = position.length / 3
    const regionLatitude = new Float32Array(numRegions)
    const regionLongitude = new Float32Array(numRegions)
    for (let region = 0; region < numRegions; region++) {
      const index = region * 3
      regionLatitude[region] = Math.asin(Math.min(1, Math.max(-1, position[index + 1])))
      regionLongitude[region] = Math.atan2(position[index], position[index + 2])
    }
    return { regionLatitude, regionLongitude }
  }

  private buildAreas(position: Float32Array, triangles: Uint32Array): Float32Array {
    const regionArea = new Float32Array(position.length / 3)
    for (let index = 0; index < triangles.length; index += 3) {
      const a = triangles[index]
      const b = triangles[index + 1]
      const c = triangles[index + 2]
      const ai = a * 3
      const bi = b * 3
      const ci = c * 3
      const share = sphericalTriangleArea(
        position[ai],
        position[ai + 1],
        position[ai + 2],
        position[bi],
        position[bi + 1],
        position[bi + 2],
        position[ci],
        position[ci + 1],
        position[ci + 2],
      ) / 3
      regionArea[a] += share
      regionArea[b] += share
      regionArea[c] += share
    }
    return regionArea
  }

  /**
   * Triangulates points on a sphere using 2D Delaunator via Stereographic Projection.
   */
  private buildSphericalDelaunay(positions: number[]): Uint32Array {
    const numRegions = positions.length / 3

    // Pick Vertex 0 as the stereographic projection pole
    const px = positions[0]
    const py = positions[1]
    const pz = positions[2]

    // Convert 3D points to 2D via Stereographic Projection
    // We project from Vertex 0, so we exclude Vertex 0 from the 2D triangulation.
    const points2d = new Float64Array((numRegions - 1) * 2)

    for (let i = 1; i < numRegions; i++) {
      const idx = i * 3
      const x = positions[idx]
      const y = positions[idx + 1]
      const z = positions[idx + 2]

      // Rotate the sphere so that the pole P is at (0, 0, 1)
      let rx = x
      let ry = y
      let rz = z
      if (pz < 0.999999) {
        if (pz < -0.999999) {
          rx = -x
          rz = -z
        }
        else {
          const vx = py
          const vy = -px
          const cx = vy * z
          const cy = -vx * z
          const cz = vx * y - vy * x
          const k = 1.0 / (1.0 + pz)
          const ccx = vy * cz
          const ccy = -vx * cz
          const ccz = vx * cy - vy * cx
          rx = x + cx + ccx * k
          ry = y + cy + ccy * k
          rz = z + cz + ccz * k
        }
      }

      // Stereographic projection from (0,0,1) onto the z=0 plane
      // X = x / (1 - z), Y = y / (1 - z)
      // Since vertex 0 is at (0,0,1), no other vertex should have rz = 1.
      const denom = 1.0 - rz
      const outIdx = (i - 1) * 2
      points2d[outIdx] = rx / denom
      points2d[outIdx + 1] = ry / denom
    }

    // Triangulate the 2D points using Delaunator (highly optimized O(N log N))
    const delaunay = new Delaunator(points2d)
    const totalTriangles = 2 * numRegions - 4
    const triangles = new Uint32Array(totalTriangles * 3)
    let triIdx = 0

    // The 2D triangulation provides the base mesh (excluding the pole)
    const dTriangles = delaunay.triangles
    for (let i = 0; i < dTriangles.length; i += 3) {
      triangles[triIdx++] = dTriangles[i] + 1
      triangles[triIdx++] = dTriangles[i + 1] + 1
      triangles[triIdx++] = dTriangles[i + 2] + 1
    }

    // The convex hull of the 2D triangulation corresponds to the polygon
    // of vertices that are connected to the projection pole (Vertex 0) in 3D.
    const hull = delaunay.hull
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i] + 1
      const b = hull[(i + 1) % hull.length] + 1
      // Connect each hull edge to Vertex 0
      triangles[triIdx++] = 0
      triangles[triIdx++] = b
      triangles[triIdx++] = a
    }

    // Enforce correct winding order globally (CCW from outside the sphere)
    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i]
      const b = triangles[i + 1]
      const c = triangles[i + 2]

      const ax = positions[a * 3]
      const ay = positions[a * 3 + 1]
      const az = positions[a * 3 + 2]
      const bx = positions[b * 3]
      const by = positions[b * 3 + 1]
      const bz = positions[b * 3 + 2]
      const cx = positions[c * 3]
      const cy = positions[c * 3 + 1]
      const cz = positions[c * 3 + 2]

      // Cross product (B - A) x (C - A)
      const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay)
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
      const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)

      // Dot product with A (normal should point in the same direction as position)
      if (nx * ax + ny * ay + nz * az < 0) {
        triangles[i + 1] = c
        triangles[i + 2] = b
      }
    }

    return triangles
  }
}
