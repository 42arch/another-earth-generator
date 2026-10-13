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
 * exterior rings. The derived GeoJSON fill uses these same shared outlines.
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
      const [startA, endA] = this.orientForRegion(mesh, regionA, regionB, cornerA, cornerB)
      this.addEdge(edgesByRegion, labelA, startA, endA, edge)
      this.addEdge(edgesByRegion, labelB, endA, startA, edge)
    }

    const polygons = [...edgesByRegion]
      .map(([regionId, edges]) => ({ regionId, rings: this.buildRings(mesh, regionId, edges) }))
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
    neighbor: number,
    cornerA: number,
    cornerB: number,
  ): readonly [number, number] {
    // Each Voronoi corner is a Delaunay triangle. Its vertex order tells us
    // which of the two dual edges enters and leaves this region at the corner.
    // Geometric sorting of a cell's corners can disagree with that adjacency
    // at degenerate triangles and leave an otherwise closed border open.
    const offset = cornerA * 3
    for (let index = 0; index < 3; index++) {
      if (mesh.triangles[offset + index] !== region)
        continue
      if (mesh.triangles[offset + (index + 1) % 3] === neighbor)
        return [cornerB, cornerA]
      if (mesh.triangles[offset + (index + 2) % 3] === neighbor)
        return [cornerA, cornerB]
    }
    throw new Error(`Voronoi edge ${region}:${neighbor} is not incident to triangle ${cornerA}`)
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

  private buildRings(mesh: SphericalMesh, regionId: number, edges: readonly DirectedBoundaryEdge[]): SphericalAreaRing[] {
    const incoming = new Map<number, number[]>()
    const outgoing = new Map<number, number[]>()
    for (let edge = 0; edge < edges.length; edge++) {
      const ends = incoming.get(edges[edge].end)
      if (ends)
        ends.push(edge)
      else
        incoming.set(edges[edge].end, [edge])

      const starts = outgoing.get(edges[edge].start)
      if (starts)
        starts.push(edge)
      else
        outgoing.set(edges[edge].start, [edge])
    }

    // Resolve every corner's incoming/outgoing pairing up front. Choosing the
    // next unused edge while tracing rings can make two paths claim the same
    // successor at a junction, leaving the remaining edges as open fragments.
    const successors = new Int32Array(edges.length).fill(-1)
    for (const [corner, incomingEdges] of incoming) {
      const outgoingEdges = outgoing.get(corner) ?? []
      if (incomingEdges.length !== outgoingEdges.length)
        throw new Error(`Unbalanced area boundary for region ${regionId} at corner ${corner}`)

      if (incomingEdges.length === 1) {
        successors[incomingEdges[0]] = outgoingEdges[0]
        continue
      }

      const costs = incomingEdges.map((incomingEdge) => {
        const edge = edges[incomingEdge]
        return outgoingEdges.map((outgoingEdge) => {
          const next = edges[outgoingEdge]
          return this.clockwiseTurn(mesh, edge.start, corner, next.end)
        })
      })
      const assignments = this.minimumCostAssignment(costs)
      for (let index = 0; index < incomingEdges.length; index++) {
        const outgoingIndex = assignments[index]
        successors[incomingEdges[index]] = outgoingEdges[outgoingIndex]
      }
    }

    const used = new Uint8Array(edges.length)
    const rings: SphericalAreaRing[] = []
    for (let firstEdge = 0; firstEdge < edges.length; firstEdge++) {
      if (used[firstEdge])
        continue

      const ring: number[] = []
      const ringEdges: number[] = []
      let edgeIndex = firstEdge
      for (let step = 0; step <= edges.length; step++) {
        if (edgeIndex < 0 || used[edgeIndex]) {
          if (edgeIndex === firstEdge && ring.length >= 3) {
            rings.push({
              corners: new Uint32Array(ring),
              edgeIndices: new Uint32Array(ringEdges),
            })
          }
          break
        }
        used[edgeIndex] = 1
        const edge = edges[edgeIndex]
        ringEdges.push(edge.edgeIndex)
        ring.push(edge.start)
        edgeIndex = successors[edgeIndex]
      }
    }
    const closedEdgeCount = rings.reduce((sum, ring) => sum + ring.edgeIndices.length, 0)
    if (closedEdgeCount !== edges.length)
      throw new Error(`Incomplete area boundary for region ${regionId}: ${closedEdgeCount}/${edges.length} edges closed`)
    return rings
  }

  private clockwiseTurn(
    mesh: SphericalMesh,
    previous: number,
    current: number,
    next: number,
  ): number {
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

    const nextOffset = next * 3
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
    return signedTurn <= 0 ? -signedTurn : 2 * Math.PI - signedTurn
  }

  /** Finds a deterministic one-to-one pairing for the edges meeting at a corner. */
  private minimumCostAssignment(costs: readonly (readonly number[])[]): Int32Array {
    const size = costs.length
    const rowPotential = new Float64Array(size + 1)
    const columnPotential = new Float64Array(size + 1)
    const matchedRow = new Int32Array(size + 1)
    const previousColumn = new Int32Array(size + 1)

    for (let row = 1; row <= size; row++) {
      matchedRow[0] = row
      let column = 0
      const minimumCost = new Float64Array(size + 1).fill(Number.POSITIVE_INFINITY)
      const visited = new Uint8Array(size + 1)

      do {
        visited[column] = 1
        const activeRow = matchedRow[column]
        let delta = Number.POSITIVE_INFINITY
        let nextColumn = 0
        for (let candidate = 1; candidate <= size; candidate++) {
          if (visited[candidate])
            continue
          const reducedCost = costs[activeRow - 1][candidate - 1]
            - rowPotential[activeRow]
            - columnPotential[candidate]
          if (reducedCost < minimumCost[candidate]) {
            minimumCost[candidate] = reducedCost
            previousColumn[candidate] = column
          }
          if (minimumCost[candidate] < delta) {
            delta = minimumCost[candidate]
            nextColumn = candidate
          }
        }

        for (let candidate = 0; candidate <= size; candidate++) {
          if (visited[candidate]) {
            rowPotential[matchedRow[candidate]] += delta
            columnPotential[candidate] -= delta
          }
          else {
            minimumCost[candidate] -= delta
          }
        }
        column = nextColumn
      } while (matchedRow[column] !== 0)

      do {
        const nextColumn = previousColumn[column]
        matchedRow[column] = matchedRow[nextColumn]
        column = nextColumn
      } while (column !== 0)
    }

    const assignments = new Int32Array(size).fill(-1)
    for (let column = 1; column <= size; column++) {
      if (matchedRow[column] > 0)
        assignments[matchedRow[column] - 1] = column - 1
    }
    return assignments
  }
}
