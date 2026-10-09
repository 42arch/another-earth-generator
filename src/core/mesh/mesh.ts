import type { SphericalMeshData } from '@/core/mesh/icosphere-builder'
import type { SphericalVoronoiData } from '@/core/mesh/voronoi'
import { clamp, dot3 } from '@/core/math/math'
import { SphericalVoronoi, SphericalVoronoiBuilder } from '@/core/mesh/voronoi'

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
  private _neighborDistances?: Float64Array
  private _neighborDx?: Float32Array
  private _neighborDy?: Float32Array
  private _neighborDz?: Float32Array

  constructor(data: SphericalMeshData & { voronoi?: SphericalVoronoiData }) {
    this.numRegions = data.numRegions
    this.numTriangles = data.numTriangles
    this.regionPosition = data.regionPosition
    this.regionLatitude = data.regionLatitude
    this.regionLongitude = data.regionLongitude
    this.neighborOffsets = data.neighborOffsets
    this.neighbors = data.neighbors
    this.triangles = data.triangles
    // Worker snapshots already contain the complete Voronoi topology and physical areas.
    this.voronoi = data.voronoi instanceof SphericalVoronoi
      ? data.voronoi
      : new SphericalVoronoi(data.voronoi ?? new SphericalVoronoiBuilder().build(data))
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

  get neighborDistances(): Float64Array {
    if (!this._neighborDistances) {
      this._neighborDistances = new Float64Array(this.neighbors.length)
      for (let region = 0; region < this.numRegions; region++) {
        const start = this.neighborOffsets[region]
        const end = this.neighborOffsets[region + 1]
        for (let j = start; j < end; j++) {
           this._neighborDistances[j] = this.distanceBetweenRegions(region, this.neighbors[j])
        }
      }
    }
    return this._neighborDistances
  }

  get neighborDx(): Float32Array {
    this.ensureNeighborVectors()
    return this._neighborDx!
  }

  get neighborDy(): Float32Array {
    this.ensureNeighborVectors()
    return this._neighborDy!
  }

  get neighborDz(): Float32Array {
    this.ensureNeighborVectors()
    return this._neighborDz!
  }

  private ensureNeighborVectors(): void {
    if (this._neighborDx) return
    const length = this.neighbors.length
    this._neighborDx = new Float32Array(length)
    this._neighborDy = new Float32Array(length)
    this._neighborDz = new Float32Array(length)
    for (let region = 0; region < this.numRegions; region++) {
      const idx = region * 3
      const start = this.neighborOffsets[region]
      const end = this.neighborOffsets[region + 1]
      for (let j = start; j < end; j++) {
        const other = this.neighbors[j] * 3
        this._neighborDx[j] = this.regionPosition[idx] - this.regionPosition[other]
        this._neighborDy[j] = this.regionPosition[idx + 1] - this.regionPosition[other + 1]
        this._neighborDz[j] = this.regionPosition[idx + 2] - this.regionPosition[other + 2]
      }
    }
  }
}
