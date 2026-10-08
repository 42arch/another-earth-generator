import type SphericalMesh from '@/core/mesh/mesh'

interface DirectedBoundaryEdge {
  start: number
  end: number
  edgeIndex: number
}

export interface SphericalAreaRing {
  /** Ordered Voronoi corner indices; the first corner is not repeated at the end. */
  corners: Uint32Array
  /** Shared Voronoi edge indices corresponding to each consecutive corner pair. */
  edgeIndices: Uint32Array
}

/** A contiguous border loop for one region label. A label may have many rings. */
export interface SphericalAreaPolygon {
  regionId: number
  rings: SphericalAreaRing[]
}

export interface SphericalRegionTopology {
  /** Indices into voronoi.edgeCorners, with each shared edge stored once. */
  boundaryEdges: Uint32Array
  /** Closed loops for each region label, including disconnected pieces and holes. */
  polygons: SphericalAreaPolygon[]
}

/**
 * Joins cell boundaries into shared area outlines and per-label polygon rings.
 * Rings follow the orientation of their cells, so hole rings wind opposite to
 * exterior rings. Fill geometry can continue using the cells as a robust
 * triangulation of these same regions.
 */
export class SphericalRegionTopologyBuilder {
  build(mesh: SphericalMesh, regionIds: Int32Array): SphericalRegionTopology {
    if (regionIds.length !== mesh.numRegions)
      throw new Error('Region labels must contain one value per mesh region')

    const edgesByRegion = new Map<number, DirectedBoundaryEdge[]>()
    const boundaryEdges: number[] = []
    const edgeRegions = mesh.voronoi.edgeRegions
    const edgeCorners = mesh.voronoi.edgeCorners

    for (let edge = 0; edge < edgeRegions.length / 2; edge++) {
      const offset = edge * 2
      const regionA = edgeRegions[offset]
      const regionB = edgeRegions[offset + 1]
      const labelA = regionIds[regionA]
      const labelB = regionIds[regionB]
      if (labelA === labelB)
        continue

      boundaryEdges.push(edge)
      const cornerA = edgeCorners[offset]
      const cornerB = edgeCorners[offset + 1]
      const [startA, endA] = this.orientForRegion(mesh, regionA, cornerA, cornerB)
      const [startB, endB] = this.orientForRegion(mesh, regionB, cornerA, cornerB)
      this.addEdge(edgesByRegion, labelA, startA, endA, edge)
      this.addEdge(edgesByRegion, labelB, startB, endB, edge)
    }

    const polygons = [...edgesByRegion]
      .map(([regionId, edges]) => ({ regionId, rings: this.buildRings(mesh, edges) }))
      .filter(polygon => polygon.rings.length > 0)
    return {
      boundaryEdges: new Uint32Array(boundaryEdges),
      polygons,
    }
  }

  /** Smooths only shared area-border corners; junctions remain fixed. */
  buildSmoothedCornerPositions(
    mesh: SphericalMesh,
    topology: SphericalRegionTopology,
    iterations = 2,
    strength = 0.26,
  ): Float32Array {
    const original = mesh.voronoi.cornerPosition
    let positions = original.slice()
    const neighbors = new Map<number, Set<number>>()
    for (const edge of topology.boundaryEdges) {
      const offset = edge * 2
      const cornerA = mesh.voronoi.edgeCorners[offset]
      const cornerB = mesh.voronoi.edgeCorners[offset + 1]
      let adjacentA = neighbors.get(cornerA)
      if (!adjacentA) {
        adjacentA = new Set<number>()
        neighbors.set(cornerA, adjacentA)
      }
      adjacentA.add(cornerB)
      let adjacentB = neighbors.get(cornerB)
      if (!adjacentB) {
        adjacentB = new Set<number>()
        neighbors.set(cornerB, adjacentB)
      }
      adjacentB.add(cornerA)
    }

    for (let iteration = 0; iteration < iterations; iteration++) {
      const next = positions.slice()
      for (const [corner, adjacent] of neighbors) {
        // Corners where borders meet are fixed to preserve the region junction.
        if (adjacent.size !== 2)
          continue
        const [neighborA, neighborB] = adjacent
        const target = corner * 3
        const a = neighborA * 3
        const b = neighborB * 3
        const cx = positions[target]
        const cy = positions[target + 1]
        const cz = positions[target + 2]

        let x = cx * (1 - strength) + (positions[a] + positions[b]) * (strength * 0.5)
        let y = cy * (1 - strength) + (positions[a + 1] + positions[b + 1]) * (strength * 0.5)
        let z = cz * (1 - strength) + (positions[a + 2] + positions[b + 2]) * (strength * 0.5)

        const length = Math.hypot(x, y, z) || 1
        x /= length
        y /= length
        z /= length

        const da = Math.hypot(positions[a] - cx, positions[a + 1] - cy, positions[a + 2] - cz)
        const db = Math.hypot(positions[b] - cx, positions[b + 1] - cy, positions[b + 2] - cz)
        const maxDist = Math.min(da, db) * 0.45
        const moveDist = Math.hypot(x - cx, y - cy, z - cz)

        if (moveDist > maxDist && moveDist > 0) {
          const scale = maxDist / moveDist
          x = cx + (x - cx) * scale
          y = cy + (y - cy) * scale
          z = cz + (z - cz) * scale
          const newLength = Math.hypot(x, y, z) || 1
          x /= newLength
          y /= newLength
          z /= newLength
        }
        next[target] = x
        next[target + 1] = y
        next[target + 2] = z
      }
      positions = next
    }
    return positions
  }

  private orientForRegion(
    mesh: SphericalMesh,
    region: number,
    cornerA: number,
    cornerB: number,
  ): readonly [number, number] {
    const start = mesh.voronoi.cellCornerOffsets[region]
    const end = mesh.voronoi.cellCornerOffsets[region + 1]
    for (let index = start; index < end; index++) {
      const current = mesh.voronoi.cellCorners[index]
      const next = mesh.voronoi.cellCorners[index + 1 < end ? index + 1 : start]
      if (current === cornerA && next === cornerB)
        return [cornerA, cornerB]
      if (current === cornerB && next === cornerA)
        return [cornerB, cornerA]
    }

    // Degenerate Delaunay neighborhoods can leave the shared edge absent from
    // the sorted cell ring. Use the region center's side of the spherical arc
    // to keep the border direction valid without aborting rendering.
    const a = cornerA * 3
    const b = cornerB * 3
    const center = region * 3
    const ax = mesh.voronoi.cornerPosition[a]
    const ay = mesh.voronoi.cornerPosition[a + 1]
    const az = mesh.voronoi.cornerPosition[a + 2]
    const bx = mesh.voronoi.cornerPosition[b]
    const by = mesh.voronoi.cornerPosition[b + 1]
    const bz = mesh.voronoi.cornerPosition[b + 2]
    const cx = mesh.regionPosition[center]
    const cy = mesh.regionPosition[center + 1]
    const cz = mesh.regionPosition[center + 2]
    const side = (ay * bz - az * by) * cx
      + (az * bx - ax * bz) * cy
      + (ax * by - ay * bx) * cz
    return side >= 0 ? [cornerA, cornerB] : [cornerB, cornerA]
  }

  private addEdge(
    edgesByRegion: Map<number, DirectedBoundaryEdge[]>,
    regionId: number,
    start: number,
    end: number,
    edgeIndex: number,
  ): void {
    let edges = edgesByRegion.get(regionId)
    if (!edges) {
      edges = []
      edgesByRegion.set(regionId, edges)
    }
    edges.push({ start, end, edgeIndex })
  }

  private buildRings(mesh: SphericalMesh, edges: readonly DirectedBoundaryEdge[]): SphericalAreaRing[] {
    const outgoing = new Map<number, number[]>()
    for (let edge = 0; edge < edges.length; edge++) {
      const starts = outgoing.get(edges[edge].start)
      if (starts)
        starts.push(edge)
      else
        outgoing.set(edges[edge].start, [edge])
    }

    const used = new Uint8Array(edges.length)
    const rings: SphericalAreaRing[] = []
    for (let firstEdge = 0; firstEdge < edges.length; firstEdge++) {
      if (used[firstEdge])
        continue

      const ring: number[] = []
      const ringEdges: number[] = []
      const start = edges[firstEdge].start
      let edgeIndex = firstEdge
      for (let step = 0; step <= edges.length; step++) {
        if (used[edgeIndex])
          break
        used[edgeIndex] = 1
        const edge = edges[edgeIndex]
        ringEdges.push(edge.edgeIndex)
        if (ring.length === 0)
          ring.push(edge.start)
        if (edge.end === start) {
          if (ring.length >= 3) {
            rings.push({
              corners: new Uint32Array(ring),
              edgeIndices: new Uint32Array(ringEdges),
            })
          }
          break
        }
        ring.push(edge.end)
        const nextEdge = this.chooseNextEdge(
          mesh,
          edges,
          outgoing.get(edge.end) ?? [],
          edge.start,
          edge.end,
          used,
        )
        if (nextEdge === undefined)
          break
        edgeIndex = nextEdge
      }
    }
    return rings
  }

  private chooseNextEdge(
    mesh: SphericalMesh,
    edges: readonly DirectedBoundaryEdge[],
    candidates: readonly number[],
    previous: number,
    current: number,
    used: Uint8Array,
  ): number | undefined {
    const currentOffset = current * 3
    const previousOffset = previous * 3
    const px = mesh.voronoi.cornerPosition[previousOffset]
    const py = mesh.voronoi.cornerPosition[previousOffset + 1]
    const pz = mesh.voronoi.cornerPosition[previousOffset + 2]
    const cx = mesh.voronoi.cornerPosition[currentOffset]
    const cy = mesh.voronoi.cornerPosition[currentOffset + 1]
    const cz = mesh.voronoi.cornerPosition[currentOffset + 2]
    const previousDot = px * cx + py * cy + pz * cz
    let fromX = px - previousDot * cx
    let fromY = py - previousDot * cy
    let fromZ = pz - previousDot * cz
    const fromLength = Math.hypot(fromX, fromY, fromZ) || 1
    fromX /= fromLength
    fromY /= fromLength
    fromZ /= fromLength

    let bestEdge: number | undefined
    let bestClockwiseTurn = Number.POSITIVE_INFINITY
    for (const candidate of candidates) {
      if (used[candidate])
        continue
      const nextOffset = edges[candidate].end * 3
      const nx = mesh.voronoi.cornerPosition[nextOffset]
      const ny = mesh.voronoi.cornerPosition[nextOffset + 1]
      const nz = mesh.voronoi.cornerPosition[nextOffset + 2]
      const nextDot = nx * cx + ny * cy + nz * cz
      let toX = nx - nextDot * cx
      let toY = ny - nextDot * cy
      let toZ = nz - nextDot * cz
      const toLength = Math.hypot(toX, toY, toZ) || 1
      toX /= toLength
      toY /= toLength
      toZ /= toLength
      const crossX = fromY * toZ - fromZ * toY
      const crossY = fromZ * toX - fromX * toZ
      const crossZ = fromX * toY - fromY * toX
      const signedTurn = Math.atan2(
        cx * crossX + cy * crossY + cz * crossZ,
        fromX * toX + fromY * toY + fromZ * toZ,
      )
      const clockwiseTurn = signedTurn <= 0 ? -signedTurn : 2 * Math.PI - signedTurn
      if (clockwiseTurn < bestClockwiseTurn) {
        bestClockwiseTurn = clockwiseTurn
        bestEdge = candidate
      }
    }
    return bestEdge
  }
}
