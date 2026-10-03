import type { SphericalMeshData } from '@/core/mesh/icosphere-builder'
import { sphericalTriangleArea } from '@/core/math/math'

export interface SphericalVoronoiData {
  cornerPosition: Float32Array
  cellCornerOffsets: Uint32Array
  cellCorners: Uint32Array
  cellArea: Float32Array
  edgeRegions: Uint32Array
  edgeCorners: Uint32Array
}

// Derived lookup tables stay local and are never copied by Worker structured cloning.
const edgeLookupCache = new WeakMap<SphericalVoronoi, Map<string, number>>()

export class SphericalVoronoi {
  readonly cornerPosition: Float32Array
  readonly cellCornerOffsets: Uint32Array
  readonly cellCorners: Uint32Array
  readonly cellArea: Float32Array
  readonly edgeRegions: Uint32Array
  readonly edgeCorners: Uint32Array

  constructor(data: SphericalVoronoiData) {
    this.cornerPosition = data.cornerPosition
    this.cellCornerOffsets = data.cellCornerOffsets
    this.cellCorners = data.cellCorners
    this.cellArea = data.cellArea
    this.edgeRegions = data.edgeRegions
    this.edgeCorners = data.edgeCorners
  }

  * forEachCornerOfRegion(region: number): IterableIterator<number> {
    const start = this.cellCornerOffsets[region]
    const end = this.cellCornerOffsets[region + 1]
    for (let index = start; index < end; index++)
      yield this.cellCorners[index]
  }

  getSharedBoundaryCorners(regionA: number, regionB: number): readonly [number, number] | null {
    let lookup = edgeLookupCache.get(this)
    if (!lookup) {
      lookup = new Map<string, number>()
      for (let edge = 0; edge < this.edgeRegions.length / 2; edge++) {
        const index = edge * 2
        lookup.set(this.getEdgeKey(this.edgeRegions[index], this.edgeRegions[index + 1]), edge)
      }
      edgeLookupCache.set(this, lookup)
    }
    const edge = lookup.get(this.getEdgeKey(regionA, regionB))
    if (edge === undefined)
      return null
    const index = edge * 2
    return [this.edgeCorners[index], this.edgeCorners[index + 1]]
  }

  private getEdgeKey(a: number, b: number): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`
  }
}

interface EdgeRecord {
  regionA: number
  regionB: number
  cornerA: number
  cornerB: number
}

export class SphericalVoronoiBuilder {
  build(mesh: SphericalMeshData): SphericalVoronoiData {
    const cornerPosition = this.buildCornerPositions(mesh)
    const { cellCornerOffsets, cellCorners } = this.buildCells(mesh, cornerPosition)
    const cellArea = this.buildCellAreas(mesh, cornerPosition, cellCornerOffsets, cellCorners)
    const { edgeRegions, edgeCorners } = this.buildEdges(mesh)
    return {
      cornerPosition,
      cellCornerOffsets,
      cellCorners,
      cellArea,
      edgeRegions,
      edgeCorners,
    }
  }

  private buildCornerPositions(mesh: SphericalMeshData): Float32Array {
    const corners = new Float32Array(mesh.numTriangles * 3)
    for (let triangle = 0; triangle < mesh.numTriangles; triangle++) {
      const side = triangle * 3
      const a = mesh.triangles[side] * 3
      const b = mesh.triangles[side + 1] * 3
      const c = mesh.triangles[side + 2] * 3
      const abX = mesh.regionPosition[b] - mesh.regionPosition[a]
      const abY = mesh.regionPosition[b + 1] - mesh.regionPosition[a + 1]
      const abZ = mesh.regionPosition[b + 2] - mesh.regionPosition[a + 2]
      const acX = mesh.regionPosition[c] - mesh.regionPosition[a]
      const acY = mesh.regionPosition[c + 1] - mesh.regionPosition[a + 1]
      const acZ = mesh.regionPosition[c + 2] - mesh.regionPosition[a + 2]
      let x = abY * acZ - abZ * acY
      let y = abZ * acX - abX * acZ
      let z = abX * acY - abY * acX
      const centroidX = mesh.regionPosition[a] + mesh.regionPosition[b] + mesh.regionPosition[c]
      const centroidY = mesh.regionPosition[a + 1] + mesh.regionPosition[b + 1] + mesh.regionPosition[c + 1]
      const centroidZ = mesh.regionPosition[a + 2] + mesh.regionPosition[b + 2] + mesh.regionPosition[c + 2]
      if (x * centroidX + y * centroidY + z * centroidZ < 0) {
        x = -x
        y = -y
        z = -z
      }
      const length = Math.hypot(x, y, z) || 1
      const target = triangle * 3
      corners[target] = x / length
      corners[target + 1] = y / length
      corners[target + 2] = z / length
    }
    return corners
  }

  private buildCells(mesh: SphericalMeshData, cornerPosition: Float32Array) {
    const incident = Array.from({ length: mesh.numRegions }, () => [] as number[])
    for (let triangle = 0; triangle < mesh.numTriangles; triangle++) {
      const side = triangle * 3
      incident[mesh.triangles[side]].push(triangle)
      incident[mesh.triangles[side + 1]].push(triangle)
      incident[mesh.triangles[side + 2]].push(triangle)
    }

    const cellCornerOffsets = new Uint32Array(mesh.numRegions + 1)
    for (let region = 0; region < mesh.numRegions; region++)
      cellCornerOffsets[region + 1] = cellCornerOffsets[region] + incident[region].length

    const cellCorners = new Uint32Array(cellCornerOffsets[mesh.numRegions])
    for (let region = 0; region < mesh.numRegions; region++) {
      const position = region * 3
      const nx = mesh.regionPosition[position]
      const ny = mesh.regionPosition[position + 1]
      const nz = mesh.regionPosition[position + 2]
      const referenceX = Math.abs(ny) < 0.9 ? 0 : 1
      const referenceY = Math.abs(ny) < 0.9 ? 1 : 0
      let eastX = referenceY * nz
      let eastY = -referenceX * nz
      let eastZ = referenceX * ny - referenceY * nx
      const eastLength = Math.hypot(eastX, eastY, eastZ) || 1
      eastX /= eastLength
      eastY /= eastLength
      eastZ /= eastLength
      const northX = ny * eastZ - nz * eastY
      const northY = nz * eastX - nx * eastZ
      const northZ = nx * eastY - ny * eastX

      incident[region].sort((a, b) => {
        const ai = a * 3
        const bi = b * 3
        const angleA = Math.atan2(
          cornerPosition[ai] * northX + cornerPosition[ai + 1] * northY + cornerPosition[ai + 2] * northZ,
          cornerPosition[ai] * eastX + cornerPosition[ai + 1] * eastY + cornerPosition[ai + 2] * eastZ,
        )
        const angleB = Math.atan2(
          cornerPosition[bi] * northX + cornerPosition[bi + 1] * northY + cornerPosition[bi + 2] * northZ,
          cornerPosition[bi] * eastX + cornerPosition[bi + 1] * eastY + cornerPosition[bi + 2] * eastZ,
        )
        return angleA - angleB
      })
      cellCorners.set(incident[region], cellCornerOffsets[region])
    }
    return { cellCornerOffsets, cellCorners }
  }

  private buildCellAreas(
    mesh: SphericalMeshData,
    cornerPosition: Float32Array,
    cellCornerOffsets: Uint32Array,
    cellCorners: Uint32Array,
  ): Float32Array {
    const cellArea = new Float32Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      const center = region * 3
      const start = cellCornerOffsets[region]
      const end = cellCornerOffsets[region + 1]
      for (let index = start; index < end; index++) {
        const cornerA = cellCorners[index] * 3
        const cornerB = cellCorners[index + 1 < end ? index + 1 : start] * 3
        cellArea[region] += sphericalTriangleArea(
          mesh.regionPosition[center],
          mesh.regionPosition[center + 1],
          mesh.regionPosition[center + 2],
          cornerPosition[cornerA],
          cornerPosition[cornerA + 1],
          cornerPosition[cornerA + 2],
          cornerPosition[cornerB],
          cornerPosition[cornerB + 1],
          cornerPosition[cornerB + 2],
        )
      }
    }
    return cellArea
  }

  private buildEdges(mesh: SphericalMeshData) {
    const edges = new Map<string, EdgeRecord>()
    const addEdge = (regionA: number, regionB: number, corner: number) => {
      const low = Math.min(regionA, regionB)
      const high = Math.max(regionA, regionB)
      const key = `${low}:${high}`
      const existing = edges.get(key)
      if (existing) {
        existing.cornerB = corner
        return
      }
      edges.set(key, { regionA: low, regionB: high, cornerA: corner, cornerB: corner })
    }

    for (let triangle = 0; triangle < mesh.numTriangles; triangle++) {
      const side = triangle * 3
      const a = mesh.triangles[side]
      const b = mesh.triangles[side + 1]
      const c = mesh.triangles[side + 2]
      addEdge(a, b, triangle)
      addEdge(b, c, triangle)
      addEdge(c, a, triangle)
    }

    const sorted = [...edges.values()].sort((a, b) => (
      a.regionA - b.regionA || a.regionB - b.regionB
    ))
    const edgeRegions = new Uint32Array(sorted.length * 2)
    const edgeCorners = new Uint32Array(sorted.length * 2)
    for (let edge = 0; edge < sorted.length; edge++) {
      const target = edge * 2
      edgeRegions[target] = sorted[edge].regionA
      edgeRegions[target + 1] = sorted[edge].regionB
      edgeCorners[target] = sorted[edge].cornerA
      edgeCorners[target + 1] = sorted[edge].cornerB
    }
    return { edgeRegions, edgeCorners }
  }
}
