import type { SphericalVoronoiData } from '@/core/spherical/mesh/spherical-voronoi'
import type { SphericalMeshData } from '@/core/spherical/mesh/icosphere-builder'
import { clamp, dot3 } from '@/core/spherical/geometry/spherical-math'
import { SphericalVoronoi, SphericalVoronoiBuilder } from '@/core/spherical/mesh/spherical-voronoi'

export default class SphericalMesh implements SphericalMeshData {
  readonly kind = 'sphere'
  readonly numRegions: number
  readonly numTriangles: number
  readonly regionPosition: Float32Array
  readonly regionLatitude: Float32Array
  readonly regionLongitude: Float32Array
  readonly regionArea: Float32Array
  readonly neighborOffsets: Uint32Array
  readonly neighbors: Uint32Array
  readonly triangles: Uint32Array
  readonly voronoi: SphericalVoronoi

  constructor(data: SphericalMeshData, voronoi?: SphericalVoronoiData) {
    this.numRegions = data.numRegions
    this.numTriangles = data.numTriangles
    this.regionPosition = data.regionPosition
    this.regionLatitude = data.regionLatitude
    this.regionLongitude = data.regionLongitude
    this.neighborOffsets = data.neighborOffsets
    this.neighbors = data.neighbors
    this.triangles = data.triangles
    this.voronoi = new SphericalVoronoi(voronoi ?? new SphericalVoronoiBuilder().build(data))
    this.regionArea = this.voronoi.cellArea
  }

  * forEachNeighborOfRegion(region: number): IterableIterator<number> {
    const start = this.neighborOffsets[region]
    const end = this.neighborOffsets[region + 1]
    for (let index = start; index < end; index++)
      yield this.neighbors[index]
  }

  dotBetweenRegions(a: number, b: number): number {
    const ai = a * 3
    const bi = b * 3
    return dot3(
      this.regionPosition[ai],
      this.regionPosition[ai + 1],
      this.regionPosition[ai + 2],
      this.regionPosition[bi],
      this.regionPosition[bi + 1],
      this.regionPosition[bi + 2],
    )
  }

  distanceBetweenRegions(a: number, b: number): number {
    return Math.acos(clamp(this.dotBetweenRegions(a, b), -1, 1))
  }
}
