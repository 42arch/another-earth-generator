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
    const numRegions = mesh.numRegions
    const numTriangles = mesh.numTriangles
    const triangles = mesh.triangles

    const counts = new Uint32Array(numRegions)
    for (let i = 0; i < triangles.length; i++) {
      counts[triangles[i]]++
    }

    const cellCornerOffsets = new Uint32Array(numRegions + 1)
    for (let region = 0; region < numRegions; region++) {
      cellCornerOffsets[region + 1] = cellCornerOffsets[region] + counts[region]
    }

    const cellCorners = new Uint32Array(cellCornerOffsets[numRegions])
    const cursor = new Uint32Array(cellCornerOffsets)
    for (let triangle = 0; triangle < numTriangles; triangle++) {
      const side = triangle * 3
      cellCorners[cursor[triangles[side]]++] = triangle
      cellCorners[cursor[triangles[side + 1]]++] = triangle
      cellCorners[cursor[triangles[side + 2]]++] = triangle
    }

    const scratchCorners = new Uint32Array(32)
    const scratchAngles = new Float64Array(32)

    for (let region = 0; region < numRegions; region++) {
      const start = cellCornerOffsets[region]
      const end = cellCornerOffsets[region + 1]
      const deg = end - start
      if (deg <= 1) continue

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

      for (let i = 0; i < deg; i++) {
        const tri = cellCorners[start + i]
        const ti = tri * 3
        const cx = cornerPosition[ti]
        const cy = cornerPosition[ti + 1]
        const cz = cornerPosition[ti + 2]
        scratchCorners[i] = tri
        scratchAngles[i] = Math.atan2(
          cx * northX + cy * northY + cz * northZ,
          cx * eastX + cy * eastY + cz * eastZ,
        )
      }

      // Small insertion sort on degree elements (deg is ~5-7)
      for (let i = 1; i < deg; i++) {
        const c = scratchCorners[i]
        const a = scratchAngles[i]
        let j = i - 1
        while (j >= 0 && scratchAngles[j] > a) {
          scratchCorners[j + 1] = scratchCorners[j]
          scratchAngles[j + 1] = scratchAngles[j]
          j--
        }
        scratchCorners[j + 1] = c
        scratchAngles[j + 1] = a
      }

      for (let i = 0; i < deg; i++) {
        cellCorners[start + i] = scratchCorners[i]
      }
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
    const numTriangles = mesh.numTriangles
    const triangles = mesh.triangles
    const numHalfEdges = numTriangles * 3
    const halfEdges = new BigUint64Array(numHalfEdges)

    let edgeIdx = 0
    for (let triangle = 0; triangle < numTriangles; triangle++) {
      const side = triangle * 3
      const a = triangles[side]
      const b = triangles[side + 1]
      const c = triangles[side + 2]
      const tBig = BigInt(triangle)

      const abLow = a < b ? a : b
      const abHigh = a < b ? b : a
      halfEdges[edgeIdx++] = (BigInt(abLow) << 44n) | (BigInt(abHigh) << 24n) | tBig

      const bcLow = b < c ? b : c
      const bcHigh = b < c ? c : b
      halfEdges[edgeIdx++] = (BigInt(bcLow) << 44n) | (BigInt(bcHigh) << 24n) | tBig

      const caLow = c < a ? c : a
      const caHigh = c < a ? a : c
      halfEdges[edgeIdx++] = (BigInt(caLow) << 44n) | (BigInt(caHigh) << 24n) | tBig
    }

    halfEdges.sort()

    // Count unique edges
    let uniqueCount = 0
    for (let i = 0; i < numHalfEdges; i++) {
      if (i === 0 || (halfEdges[i] >> 24n) !== (halfEdges[i - 1] >> 24n)) {
        uniqueCount++
      }
    }

    const edgeRegions = new Uint32Array(uniqueCount * 2)
    const edgeCorners = new Uint32Array(uniqueCount * 2)
    let outIdx = 0

    for (let i = 0; i < numHalfEdges;) {
      const entry1 = halfEdges[i]
      const low = Number(entry1 >> 44n)
      const high = Number((entry1 >> 24n) & 0xFFFFFn)
      const cornerA = Number(entry1 & 0xFFFFFFn)
      let cornerB = cornerA

      i++
      if (i < numHalfEdges && (halfEdges[i] >> 24n) === (entry1 >> 24n)) {
        cornerB = Number(halfEdges[i] & 0xFFFFFFn)
        i++
      }

      edgeRegions[outIdx] = low
      edgeRegions[outIdx + 1] = high
      edgeCorners[outIdx] = cornerA
      edgeCorners[outIdx + 1] = cornerB
      outIdx += 2
    }

    return { edgeRegions, edgeCorners }
  }
}
