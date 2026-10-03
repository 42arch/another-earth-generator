import alea from 'alea'
import { geoDelaunay } from 'd3-geo-voronoi'
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

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const DEFAULT_IRREGULARITY = 0.75

/** Fibonacci sites with the latitude/longitude jitter used by World Orogen. */
export class FibonacciSphereBuilder {
  build(detail: number, seed = 0, irregularity = DEFAULT_IRREGULARITY): SphericalMeshData {
    const numRegions = Math.max(4, Math.floor(detail))
    const regionPosition = this.generateSites(numRegions, seed, irregularity)
    const triangles = this.buildSphericalDelaunay(regionPosition)
    const { neighborOffsets, neighbors } = this.buildAdjacency(numRegions, triangles)
    const { regionLatitude, regionLongitude } = this.buildCoordinates(regionPosition)

    return {
      numRegions,
      numTriangles: triangles.length / 3,
      regionPosition,
      regionLatitude,
      regionLongitude,
      regionArea: this.buildAreas(regionPosition, triangles),
      neighborOffsets,
      neighbors,
      triangles,
    }
  }

  private generateSites(count: number, seed: number, irregularity: number): Float32Array {
    const positions = new Float32Array(count * 3)
    const random = alea(seed)
    const spacing = 3.6 / Math.sqrt(count)
    const deltaHeight = 2 / count
    const jitterStrength = Math.max(0, Math.min(1, irregularity))
    let longitude = 0

    for (let region = 0; region < count; region++) {
      const height = 1 - deltaHeight * (region + 0.5)
      const radius = Math.sqrt(Math.max(0, 1 - height * height))
      let latitude = Math.asin(height)
      let siteLongitude = longitude

      if (jitterStrength > 0) {
        const latitudeNoise = random() - random()
        const longitudeNoise = random() - random()
        const nextHeight = Math.max(-1, height - deltaHeight * 2 * Math.PI * radius / spacing)
        latitude += jitterStrength * latitudeNoise * (latitude - Math.asin(nextHeight))
        siteLongitude += jitterStrength * longitudeNoise * spacing / radius
      }

      const cosLatitude = Math.cos(latitude)
      const index = region * 3
      // Spiral phase places sites; geographic longitude is derived from +Z below.
      positions[index] = cosLatitude * Math.cos(siteLongitude)
      positions[index + 1] = Math.sin(latitude)
      positions[index + 2] = cosLatitude * Math.sin(siteLongitude)
      longitude += GOLDEN_ANGLE
    }

    return positions
  }

  private buildSphericalDelaunay(positions: Float32Array): Uint32Array {
    const points: [number, number][] = []
    for (let region = 0; region < positions.length / 3; region++) {
      const index = region * 3
      points.push([
        Math.atan2(positions[index], positions[index + 2]) * 180 / Math.PI,
        Math.asin(Math.min(1, Math.max(-1, positions[index + 1]))) * 180 / Math.PI,
      ])
    }

    const delaunay = geoDelaunay(points)
    const expectedTriangles = positions.length / 3 * 2 - 4
    if (delaunay.triangles.length !== expectedTriangles) {
      throw new Error(
        `Incomplete spherical Delaunay triangulation: expected ${expectedTriangles} triangles, received ${delaunay.triangles.length}`,
      )
    }

    const triangles = new Uint32Array(delaunay.triangles.length * 3)
    for (let triangle = 0; triangle < delaunay.triangles.length; triangle++) {
      const source = delaunay.triangles[triangle]
      triangles.set(source, triangle * 3)
    }
    return triangles
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
}
