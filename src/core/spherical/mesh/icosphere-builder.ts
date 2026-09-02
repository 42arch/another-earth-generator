import { geoDelaunay } from 'd3-geo-voronoi'
import {
  deterministicUnit,
  sphericalTriangleArea,
} from '@/core/spherical/geometry/spherical-math'

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

const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2
const SITE_JITTER_RATIO = 0.32
const SITE_JITTER_SEED = 31847

const BASE_VERTICES = [
  -1,
  GOLDEN_RATIO,
  0,
  1,
  GOLDEN_RATIO,
  0,
  -1,
  -GOLDEN_RATIO,
  0,
  1,
  -GOLDEN_RATIO,
  0,
  0,
  -1,
  GOLDEN_RATIO,
  0,
  1,
  GOLDEN_RATIO,
  0,
  -1,
  -GOLDEN_RATIO,
  0,
  1,
  -GOLDEN_RATIO,
  GOLDEN_RATIO,
  0,
  -1,
  GOLDEN_RATIO,
  0,
  1,
  -GOLDEN_RATIO,
  0,
  -1,
  -GOLDEN_RATIO,
  0,
  1,
]

const BASE_TRIANGLES = [
  0,
  11,
  5,
  0,
  5,
  1,
  0,
  1,
  7,
  0,
  7,
  10,
  0,
  10,
  11,
  1,
  5,
  9,
  5,
  11,
  4,
  11,
  10,
  2,
  10,
  7,
  6,
  7,
  1,
  8,
  3,
  9,
  4,
  3,
  4,
  2,
  3,
  2,
  6,
  3,
  6,
  8,
  3,
  8,
  9,
  4,
  9,
  5,
  2,
  4,
  11,
  6,
  2,
  10,
  8,
  6,
  7,
  9,
  8,
  1,
]

export class IcosphereBuilder {
  build(subdivision: number, seed = 0): SphericalMeshData {
    const safeSubdivision = Math.max(0, Math.floor(subdivision))
    const vertices = [...BASE_VERTICES]
    this.normalizeAll(vertices)
    let baseTriangles = [...BASE_TRIANGLES]

    for (let level = 0; level < safeSubdivision; level++)
      baseTriangles = this.subdivide(vertices, baseTriangles)

    const baseTriangleArray = new Uint32Array(baseTriangles)
    const regionPosition = this.jitterSites(vertices, baseTriangleArray, seed)
    const triangleArray = this.buildSphericalDelaunay(regionPosition)
    const numRegions = regionPosition.length / 3
    const numTriangles = triangleArray.length / 3
    const { neighborOffsets, neighbors } = this.buildAdjacency(numRegions, triangleArray)
    const { regionLatitude, regionLongitude } = this.buildCoordinates(regionPosition)
    const regionArea = this.buildAreas(regionPosition, triangleArray)

    return {
      numRegions,
      numTriangles,
      regionPosition,
      regionLatitude,
      regionLongitude,
      regionArea,
      neighborOffsets,
      neighbors,
      triangles: triangleArray,
    }
  }

  private jitterSites(
    vertices: number[],
    triangles: Uint32Array,
    seed: number,
  ): Float32Array {
    const positions = new Float32Array(vertices)
    const { neighborOffsets, neighbors } = this.buildAdjacency(
      positions.length / 3,
      triangles,
    )

    for (let region = 0; region < positions.length / 3; region++) {
      const index = region * 3
      const x = vertices[index]
      const y = vertices[index + 1]
      const z = vertices[index + 2]
      let localSpacing = Infinity
      for (let offset = neighborOffsets[region]; offset < neighborOffsets[region + 1]; offset++) {
        const neighbor = neighbors[offset] * 3
        const dot = Math.min(1, Math.max(-1, x * vertices[neighbor]
          + y * vertices[neighbor + 1]
          + z * vertices[neighbor + 2]))
        localSpacing = Math.min(localSpacing, Math.acos(dot))
      }

      const referenceX = Math.abs(y) < 0.9 ? 0 : 1
      const referenceY = Math.abs(y) < 0.9 ? 1 : 0
      let tangentX = referenceY * z
      let tangentY = -referenceX * z
      let tangentZ = referenceX * y - referenceY * x
      const tangentLength = Math.hypot(tangentX, tangentY, tangentZ) || 1
      tangentX /= tangentLength
      tangentY /= tangentLength
      tangentZ /= tangentLength
      const bitangentX = y * tangentZ - z * tangentY
      const bitangentY = z * tangentX - x * tangentZ
      const bitangentZ = x * tangentY - y * tangentX
      const directionAngle = deterministicUnit(
        SITE_JITTER_SEED,
        seed,
        region,
      ) * Math.PI * 2
      const offsetAmount = localSpacing
        * SITE_JITTER_RATIO
        * (0.45 + deterministicUnit(SITE_JITTER_SEED + 1, seed, region) * 0.55)
      const directionX = tangentX * Math.cos(directionAngle)
        + bitangentX * Math.sin(directionAngle)
      const directionY = tangentY * Math.cos(directionAngle)
        + bitangentY * Math.sin(directionAngle)
      const directionZ = tangentZ * Math.cos(directionAngle)
        + bitangentZ * Math.sin(directionAngle)
      const cosOffset = Math.cos(offsetAmount)
      const sinOffset = Math.sin(offsetAmount)
      positions[index] = x * cosOffset + directionX * sinOffset
      positions[index + 1] = y * cosOffset + directionY * sinOffset
      positions[index + 2] = z * cosOffset + directionZ * sinOffset
    }
    return positions
  }

  private buildSphericalDelaunay(positions: Float32Array): Uint32Array {
    const points: [number, number][] = []
    for (let region = 0; region < positions.length / 3; region++) {
      const index = region * 3
      points.push([
        Math.atan2(positions[index + 2], positions[index]) * 180 / Math.PI,
        Math.asin(Math.min(1, Math.max(-1, positions[index + 1]))) * 180 / Math.PI,
      ])
    }

    const delaunay = geoDelaunay(points)
    const expectedTriangleCount = positions.length / 3 * 2 - 4
    if (delaunay.triangles.length !== expectedTriangleCount) {
      throw new Error(
        `Incomplete spherical Delaunay triangulation: expected ${expectedTriangleCount} triangles, received ${delaunay.triangles.length}`,
      )
    }
    const triangles = new Uint32Array(delaunay.triangles.length * 3)
    for (let triangle = 0; triangle < delaunay.triangles.length; triangle++) {
      const source = delaunay.triangles[triangle]
      const target = triangle * 3
      triangles[target] = source[0]
      triangles[target + 1] = source[1]
      triangles[target + 2] = source[2]
    }
    return triangles
  }

  private normalizeAll(vertices: number[]): void {
    for (let index = 0; index < vertices.length; index += 3) {
      const length = Math.hypot(vertices[index], vertices[index + 1], vertices[index + 2]) || 1
      vertices[index] /= length
      vertices[index + 1] /= length
      vertices[index + 2] /= length
    }
  }

  private subdivide(vertices: number[], triangles: number[]): number[] {
    const midpointCache = new Map<string, number>()
    const next: number[] = []
    const midpoint = (a: number, b: number) => {
      const low = Math.min(a, b)
      const high = Math.max(a, b)
      const key = `${low}:${high}`
      const cached = midpointCache.get(key)
      if (cached !== undefined)
        return cached

      const ai = a * 3
      const bi = b * 3
      let x = (vertices[ai] + vertices[bi]) * 0.5
      let y = (vertices[ai + 1] + vertices[bi + 1]) * 0.5
      let z = (vertices[ai + 2] + vertices[bi + 2]) * 0.5
      const length = Math.hypot(x, y, z) || 1
      x /= length
      y /= length
      z /= length
      const index = vertices.length / 3
      vertices.push(x, y, z)
      midpointCache.set(key, index)
      return index
    }

    for (let index = 0; index < triangles.length; index += 3) {
      const a = triangles[index]
      const b = triangles[index + 1]
      const c = triangles[index + 2]
      const ab = midpoint(a, b)
      const bc = midpoint(b, c)
      const ca = midpoint(c, a)
      next.push(
        a,
        ab,
        ca,
        b,
        bc,
        ab,
        c,
        ca,
        bc,
        ab,
        bc,
        ca,
      )
    }
    return next
  }

  private buildAdjacency(numRegions: number, triangles: Uint32Array) {
    const adjacency = Array.from({ length: numRegions }, () => new Set<number>())
    const addEdge = (a: number, b: number) => {
      adjacency[a].add(b)
      adjacency[b].add(a)
    }

    for (let index = 0; index < triangles.length; index += 3) {
      const a = triangles[index]
      const b = triangles[index + 1]
      const c = triangles[index + 2]
      addEdge(a, b)
      addEdge(b, c)
      addEdge(c, a)
    }

    const neighborOffsets = new Uint32Array(numRegions + 1)
    for (let region = 0; region < numRegions; region++)
      neighborOffsets[region + 1] = neighborOffsets[region] + adjacency[region].size

    const neighbors = new Uint32Array(neighborOffsets[numRegions])
    for (let region = 0; region < numRegions; region++) {
      const sorted = [...adjacency[region]].sort((a, b) => a - b)
      neighbors.set(sorted, neighborOffsets[region])
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
      regionLongitude[region] = Math.atan2(position[index + 2], position[index])
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
}
