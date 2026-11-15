import type { LonLatTuple, Vec3Tuple } from '#projections/spherical-math'
import type { MapMeshReader } from '@another-earth/world-core'
import {
  cartesianToLonLatDeg,
  normalizeVec3,
  signedPlanarUnwrappedRingArea,
  signedSphericalRingArea,
  unwrapLongitudeDegNear,
} from '#projections/spherical-math'

interface DirectedBoundaryEdge {
  readonly start: number
  readonly end: number
  readonly edgeId: number
  readonly interiorRegion: number
}

export interface TracedCornerRing {
  readonly corners: Uint32Array
  readonly edgeIds: Uint32Array
  readonly interiorRegions: Uint32Array
  readonly sampleInteriorRegion: number
}

export interface TracedGroupTopology {
  readonly groupId: number
  readonly rings: readonly TracedCornerRing[]
}

export interface TracedClassificationTopology {
  readonly boundaryEdgeIds: Uint32Array
  readonly cornerPositions: Float64Array
  readonly groups: readonly TracedGroupTopology[]
}

function orientDualEdgeForRegion(
  mesh: MapMeshReader,
  region: number,
  neighbor: number,
  fallbackCornerA: number,
  fallbackCornerB: number,
): readonly [startCorner: number, endCorner: number] {
  let start = fallbackCornerA
  let end = fallbackCornerB
  let found = false
  mesh.forEachRegionNeighbor(region, (nb, cA, cB) => {
    if (!found && nb === neighbor) {
      start = cA
      end = cB
      found = true
    }
  })
  return [start, end]
}

function clockwiseTurnCost(
  cornerPositions: Float64Array,
  previous: number,
  current: number,
  next: number,
): number {
  const prevOffset = 3 * previous
  const currOffset = 3 * current
  const nextOffset = 3 * next
  const px = cornerPositions[prevOffset]
  const py = cornerPositions[prevOffset + 1]
  const pz = cornerPositions[prevOffset + 2]
  const cx = cornerPositions[currOffset]
  const cy = cornerPositions[currOffset + 1]
  const cz = cornerPositions[currOffset + 2]
  const nx = cornerPositions[nextOffset]
  const ny = cornerPositions[nextOffset + 1]
  const nz = cornerPositions[nextOffset + 2]

  const prevDot = px * cx + py * cy + pz * cz
  let fromX = px - prevDot * cx
  let fromY = py - prevDot * cy
  let fromZ = pz - prevDot * cz
  const fromLen = Math.hypot(fromX, fromY, fromZ) || 1
  fromX /= fromLen
  fromY /= fromLen
  fromZ /= fromLen

  const nextDot = nx * cx + ny * cy + nz * cz
  let toX = nx - nextDot * cx
  let toY = ny - nextDot * cy
  let toZ = nz - nextDot * cz
  const toLen = Math.hypot(toX, toY, toZ) || 1
  toX /= toLen
  toY /= toLen
  toZ /= toLen

  const crossX = fromY * toZ - fromZ * toY
  const crossY = fromZ * toX - fromX * toZ
  const crossZ = fromX * toY - fromY * toX
  const signedTurn = Math.atan2(
    cx * crossX + cy * crossY + cz * crossZ,
    fromX * toX + fromY * toY + fromZ * toZ,
  )
  return signedTurn <= 0 ? -signedTurn : 2 * Math.PI - signedTurn
}

function minimumCostAssignment(costs: readonly (readonly number[])[]): Int32Array {
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

function buildGroupRings(
  cornerPositions: Float64Array,
  groupId: number,
  edges: readonly DirectedBoundaryEdge[],
): TracedCornerRing[] {
  const incoming = new Map<number, number[]>()
  const outgoing = new Map<number, number[]>()
  for (let i = 0; i < edges.length; i++) {
    const inList = incoming.get(edges[i].end)
    if (inList)
      inList.push(i)
    else
      incoming.set(edges[i].end, [i])

    const outList = outgoing.get(edges[i].start)
    if (outList)
      outList.push(i)
    else
      outgoing.set(edges[i].start, [i])
  }

  const successors = new Int32Array(edges.length).fill(-1)
  for (const [corner, incomingEdges] of incoming) {
    const outgoingEdges = outgoing.get(corner) ?? []
    if (incomingEdges.length !== outgoingEdges.length)
      throw new Error(`Unbalanced boundary for group ${groupId} at corner ${corner}`)

    if (incomingEdges.length === 1) {
      successors[incomingEdges[0]] = outgoingEdges[0]
      continue
    }

    const costs = incomingEdges.map((inIdx) => {
      const inEdge = edges[inIdx]
      return outgoingEdges.map((outIdx) => {
        const outEdge = edges[outIdx]
        return clockwiseTurnCost(cornerPositions, inEdge.start, corner, outEdge.end)
      })
    })
    const assignments = minimumCostAssignment(costs)
    for (let i = 0; i < incomingEdges.length; i++)
      successors[incomingEdges[i]] = outgoingEdges[assignments[i]]
  }

  const used = new Uint8Array(edges.length)
  const rings: TracedCornerRing[] = []
  for (let firstEdge = 0; firstEdge < edges.length; firstEdge++) {
    if (used[firstEdge])
      continue
    const corners: number[] = []
    const edgeIds: number[] = []
    const interiorRegions: number[] = []
    let edgeIndex = firstEdge
    const sampleInteriorRegion = edges[firstEdge].interiorRegion
    for (let step = 0; step <= edges.length; step++) {
      if (edgeIndex < 0 || used[edgeIndex]) {
        if (edgeIndex === firstEdge && corners.length >= 3) {
          rings.push({
            corners: Uint32Array.from(corners),
            edgeIds: Uint32Array.from(edgeIds),
            interiorRegions: Uint32Array.from(interiorRegions),
            sampleInteriorRegion,
          })
        }
        break
      }
      used[edgeIndex] = 1
      const edge = edges[edgeIndex]
      corners.push(edge.start)
      edgeIds.push(edge.edgeId)
      interiorRegions.push(edge.interiorRegion)
      edgeIndex = successors[edgeIndex]
    }
  }

  return rings
}

export function extractCornerPositions(mesh: MapMeshReader): Float64Array {
  const cornerCount = mesh.cornerCount
  const positions = new Float64Array(3 * cornerCount)
  const out = { x: 0, y: 0, z: 0 }
  for (let c = 0; c < cornerCount; c++) {
    mesh.getCornerPosition(c, out)
    positions[3 * c] = out.x
    positions[3 * c + 1] = out.y
    positions[3 * c + 2] = out.z
  }
  return positions
}

/**
 * Traces closed boundary rings for each group label (`groupIds[region] >= 0`).
 * Cells with `groupIds[region] < 0` are ignored as exterior/unassigned background.
 */
export function traceClassificationRings(
  mesh: MapMeshReader,
  groupIds: Int32Array,
  existingCornerPositions?: Float64Array,
): TracedClassificationTopology {
  if (groupIds.length !== mesh.regionCount)
    throw new Error('Classification groupIds length must match mesh.regionCount')

  const cornerPositions = existingCornerPositions ?? extractCornerPositions(mesh)
  const edgesByGroup = new Map<number, DirectedBoundaryEdge[]>()
  const boundaryEdgeIds: number[] = []

  const addDirectedEdge = (
    groupId: number,
    start: number,
    end: number,
    edgeId: number,
    interiorRegion: number,
  ): void => {
    if (groupId < 0)
      return
    let list = edgesByGroup.get(groupId)
    if (!list) {
      list = []
      edgesByGroup.set(groupId, list)
    }
    list.push({ start, end, edgeId, interiorRegion })
  }

  mesh.forEachEdge((edgeId, regionA, regionB, cornerA, cornerB) => {
    const groupA = groupIds[regionA]
    const groupB = groupIds[regionB]
    if (groupA === groupB)
      return
    boundaryEdgeIds.push(edgeId)
    const [startA, endA] = orientDualEdgeForRegion(mesh, regionA, regionB, cornerA, cornerB)
    addDirectedEdge(groupA, startA, endA, edgeId, regionA)
    addDirectedEdge(groupB, endA, startA, edgeId, regionB)
  })

  const groups: TracedGroupTopology[] = [...edgesByGroup.entries()]
    .sort(([a], [b]) => a - b)
    .map(([groupId, edges]) => ({
      groupId,
      rings: buildGroupRings(cornerPositions, groupId, edges),
    }))
    .filter(item => item.rings.length > 0)

  return {
    boundaryEdgeIds: Uint32Array.from(boundaryEdgeIds),
    cornerPositions,
    groups,
  }
}

export function ringPointsToClosedLonLat(
  points: readonly Vec3Tuple[],
  targetWinding: 'ccw' | 'cw',
  referenceNormal?: Vec3Tuple,
  preserveDirectedOrder = false,
): LonLatTuple[] {
  if (points.length < 3)
    return []
  const ordered = [...points]
  if (!preserveDirectedOrder) {
    const sphericalSign = signedSphericalRingArea(ordered, referenceNormal)
    if ((targetWinding === 'ccw' && sphericalSign < 0) || (targetWinding === 'cw' && sphericalSign > 0))
      ordered.reverse()
  }

  const coords: LonLatTuple[] = ordered.map(pt => cartesianToLonLatDeg(pt[0], pt[1], pt[2]))
  // Deduplicate consecutive identical points
  const deduped: LonLatTuple[] = []
  for (const pt of coords) {
    const prev = deduped.at(-1)
    if (!prev || prev[0] !== pt[0] || prev[1] !== pt[1])
      deduped.push(pt)
  }
  if (deduped.length > 1) {
    const first = deduped[0]
    const last = deduped.at(-1)!
    if (first[0] === last[0] && first[1] === last[1])
      deduped.pop()
  }
  if (deduped.length < 3)
    return []

  const closed: LonLatTuple[] = [...deduped, [deduped[0][0], deduped[0][1]]]
  if (!preserveDirectedOrder) {
    const planarArea = signedPlanarUnwrappedRingArea(closed)
    if ((targetWinding === 'ccw' && planarArea < -1e-9) || (targetWinding === 'cw' && planarArea > 1e-9))
      closed.reverse()
  }
  return closed
}

function pointInUnwrappedRing(lonDeg: number, latDeg: number, ring: readonly LonLatTuple[]): boolean {
  const n = ring.length
  if (n < 4)
    return false
  const unwrappedX = new Float64Array(n)
  unwrappedX[0] = ring[0][0]
  for (let i = 1; i < n; i++)
    unwrappedX[i] = unwrapLongitudeDegNear(ring[i][0], unwrappedX[i - 1])

  let sumX = 0
  for (let i = 0; i < n - 1; i++)
    sumX += unwrappedX[i]
  const meanX = sumX / (n - 1)
  const testX = unwrapLongitudeDegNear(lonDeg, meanX)
  const testY = latDeg

  let inside = false
  for (let i = 0, j = n - 2; i < n - 1; j = i++) {
    const xi = unwrappedX[i]
    const yi = ring[i][1]
    const xj = unwrappedX[j]
    const yj = ring[j][1]
    const intersects = ((yi > testY) !== (yj > testY))
      && (testX < (xj - xi) * (testY - yi) / (yj - yi) + xi)
    if (intersects)
      inside = !inside
  }
  return inside
}

/**
 * Classifies traced rings into exterior CCW rings and interior CW holes,
 * returning GeoJSON Polygon/MultiPolygon coordinate arrays (`LonLatTuple[][][]`).
 */
export function assemblePolygonsWithHoles(
  mesh: MapMeshReader,
  rings: readonly {
    readonly points: readonly Vec3Tuple[]
    readonly interiorRegions?: Uint32Array
    readonly sampleInteriorRegion: number
  }[],
): (readonly (readonly LonLatTuple[])[])[] {
  if (rings.length === 0)
    return []

  const centerOut = { x: 0, y: 0, z: 0 }
  const outerRings: {
    coords: LonLatTuple[]
    absArea: number
    center: Vec3Tuple
  }[] = []
  const holeRings: {
    coords: LonLatTuple[]
    samplePoint: LonLatTuple
    center: Vec3Tuple
  }[] = []

  for (const ring of rings) {
    if (ring.points.length < 3)
      continue
    let sumX = 0
    let sumY = 0
    let sumZ = 0
    if (ring.interiorRegions && ring.interiorRegions.length > 0) {
      for (let i = 0; i < ring.interiorRegions.length; i++) {
        mesh.getRegionCenter(ring.interiorRegions[i], centerOut)
        sumX += centerOut.x
        sumY += centerOut.y
        sumZ += centerOut.z
      }
    }
    else {
      for (const pt of ring.points) {
        sumX += pt[0]
        sumY += pt[1]
        sumZ += pt[2]
      }
    }
    mesh.getRegionCenter(ring.sampleInteriorRegion, centerOut)
    const interiorCenter = normalizeVec3(centerOut.x, centerOut.y, centerOut.z)
    const ringNormal = Math.hypot(sumX, sumY, sumZ) > 1e-5
      ? normalizeVec3(sumX, sumY, sumZ)
      : interiorCenter

    const signed = signedSphericalRingArea(ring.points, ringNormal)
    if (signed >= 0) {
      const coords = ringPointsToClosedLonLat(ring.points, 'ccw', ringNormal)
      if (coords.length >= 4) {
        outerRings.push({
          coords,
          absArea: Math.abs(signedPlanarUnwrappedRingArea(coords)),
          center: ringNormal,
        })
      }
    }
    else {
      const coords = ringPointsToClosedLonLat(ring.points, 'cw', ringNormal)
      if (coords.length >= 4) {
        holeRings.push({
          coords,
          samplePoint: coords[0],
          center: ringNormal,
        })
      }
    }
  }

  // Fallback if all rings had negative sign due to hemisphere-spanning ring centroid
  if (outerRings.length === 0 && holeRings.length > 0) {
    const largestIdx = holeRings.reduce(
      (best, item, idx) => item.coords.length > holeRings[best].coords.length ? idx : best,
      0,
    )
    const promoted = holeRings.splice(largestIdx, 1)[0]
    const ccwCoords = [...promoted.coords].reverse()
    outerRings.push({
      coords: ccwCoords,
      absArea: Math.abs(signedPlanarUnwrappedRingArea(ccwCoords)),
      center: promoted.center,
    })
  }

  // Sort outer rings from smallest planar area to largest so holes bind to the tightest enclosing outer ring
  outerRings.sort((a, b) => a.absArea - b.absArea)
  const polygons: LonLatTuple[][][] = outerRings.map(outer => [outer.coords])

  for (const hole of holeRings) {
    let assignedIndex = -1
    for (let i = 0; i < outerRings.length; i++) {
      if (pointInUnwrappedRing(hole.samplePoint[0], hole.samplePoint[1], outerRings[i].coords)) {
        assignedIndex = i
        break
      }
    }
    if (assignedIndex < 0 && outerRings.length > 0) {
      // Spherical nearest-outer fallback for polar or antimeridian-straddling rings
      let bestDot = -Infinity
      for (let i = 0; i < outerRings.length; i++) {
        const d = hole.center[0] * outerRings[i].center[0]
          + hole.center[1] * outerRings[i].center[1]
          + hole.center[2] * outerRings[i].center[2]
        if (d > bestDot) {
          bestDot = d
          assignedIndex = i
        }
      }
    }
    if (assignedIndex >= 0) {
      polygons[assignedIndex].push(hole.coords)
    }
  }

  // Restore largest-first ordering for deterministic output
  polygons.sort((a, b) => Math.abs(signedPlanarUnwrappedRingArea(b[0])) - Math.abs(signedPlanarUnwrappedRingArea(a[0])))
  return polygons
}
