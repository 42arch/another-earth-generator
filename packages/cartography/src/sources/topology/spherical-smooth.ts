import type { MapMeshReader } from '@another-earth/world-core'
import type { Vec3Tuple } from '#projections/spherical-math'
import { crossVec3, dotVec3, normalizeVec3, slerpVec3 } from '#projections/spherical-math'

/**
 * Topology-preserving spherical corner relaxation for shared region boundaries.
 * Corners with valence != 2 (triple junctions) remain locked so adjacent areas never pull apart.
 */
export function smoothBoundaryCornerPositions(
  mesh: MapMeshReader,
  cornerPositions: Float64Array,
  boundaryEdgeIds: Uint32Array,
  iterations = 2,
  strength = 0.26,
  lockedCorners?: Uint8Array,
): Float64Array {
  let positions = cornerPositions.slice()
  const edgeCorners = new Uint32Array(2 * mesh.edgeCount)
  mesh.forEachEdge((edgeId, _rA, _rB, cornerA, cornerB) => {
    edgeCorners[2 * edgeId] = cornerA
    edgeCorners[2 * edgeId + 1] = cornerB
  })

  const neighbors = new Map<number, Set<number>>()
  for (let i = 0; i < boundaryEdgeIds.length; i++) {
    const edgeId = boundaryEdgeIds[i]
    const cornerA = edgeCorners[2 * edgeId]
    const cornerB = edgeCorners[2 * edgeId + 1]
    let setA = neighbors.get(cornerA)
    if (!setA) {
      setA = new Set<number>()
      neighbors.set(cornerA, setA)
    }
    setA.add(cornerB)

    let setB = neighbors.get(cornerB)
    if (!setB) {
      setB = new Set<number>()
      neighbors.set(cornerB, setB)
    }
    setB.add(cornerA)
  }

  for (let iter = 0; iter < iterations; iter++) {
    const next = positions.slice()
    for (const [corner, adj] of neighbors) {
      if (adj.size !== 2 || lockedCorners?.[corner])
        continue
      const [neighborA, neighborB] = adj
      const cOffset = 3 * corner
      const aOffset = 3 * neighborA
      const bOffset = 3 * neighborB
      const cx = positions[cOffset]
      const cy = positions[cOffset + 1]
      const cz = positions[cOffset + 2]

      let x = cx * (1 - strength) + (positions[aOffset] + positions[bOffset]) * (strength * 0.5)
      let y = cy * (1 - strength) + (positions[aOffset + 1] + positions[bOffset + 1]) * (strength * 0.5)
      let z = cz * (1 - strength) + (positions[aOffset + 2] + positions[bOffset + 2]) * (strength * 0.5)
      const [nx, ny, nz] = normalizeVec3(x, y, z)
      x = nx
      y = ny
      z = nz

      const da = Math.hypot(positions[aOffset] - cx, positions[aOffset + 1] - cy, positions[aOffset + 2] - cz)
      const db = Math.hypot(positions[bOffset] - cx, positions[bOffset + 1] - cy, positions[bOffset + 2] - cz)
      const maxDist = Math.min(da, db) * 0.45
      const moveDist = Math.hypot(x - cx, y - cy, z - cz)
      if (moveDist > maxDist && moveDist > 0) {
        const scale = maxDist / moveDist
        const clamped = normalizeVec3(
          cx + (x - cx) * scale,
          cy + (y - cy) * scale,
          cz + (z - cz) * scale,
        )
        x = clamped[0]
        y = clamped[1]
        z = clamped[2]
      }
      next[cOffset] = x
      next[cOffset + 1] = y
      next[cOffset + 2] = z
    }
    positions = next
  }

  return positions
}

/**
 * Topology-preserving subdivision and relaxation of shared classification boundary rings.
 *
 * - Triple junctions (`valence != 2` across all boundary edges) remain strictly locked.
 * - Optional `smoothEdgeMask`: if provided (`smoothEdgeMask[edgeId] === 1`), only true classification
 *   boundary edges are subdivided with spline midpoints and relaxed; internal tile-partition edges
 *   remain un-relaxed straight dual segments so internal tile seams are 100% invisible and conformal.
 * - Because both adjacent groups share the exact same corner and edge IDs (traversed in
 *   opposite directions), their smoothed boundaries remain 100% conformal with zero gaps or overlaps.
 */
export function buildSmoothedSharedBoundaryRings(
  mesh: MapMeshReader,
  cornerPositions: Float64Array,
  boundaryEdgeIds: Uint32Array,
  rings: readonly {
    readonly corners: Uint32Array
    readonly edgeIds: Uint32Array
    readonly interiorRegions?: Uint32Array
    readonly sampleInteriorRegion: number
  }[],
  options: {
    readonly cornerRelaxIterations?: number
    readonly cornerRelaxStrength?: number
    readonly edgeRelaxIterations?: number
    readonly edgeRelaxStrength?: number
    readonly smoothEdgeMask?: Uint8Array
  } = {},
): { points: Vec3Tuple[], interiorRegions?: Uint32Array, sampleInteriorRegion: number }[] {
  const cornerRelaxIterations = options.cornerRelaxIterations ?? 3
  const cornerRelaxStrength = options.cornerRelaxStrength ?? 0.34
  const edgeRelaxIterations = options.edgeRelaxIterations ?? 2
  const edgeRelaxStrength = options.edgeRelaxStrength ?? 0.36
  const smoothEdgeMask = options.smoothEdgeMask

  // Filter boundaryEdgeIds to only true classification boundary edges if smoothEdgeMask is provided
  const activeBoundaryEdgeIds = smoothEdgeMask
    ? boundaryEdgeIds.filter(edgeId => smoothEdgeMask[edgeId] !== 0)
    : boundaryEdgeIds

  // 1. Relax valence-2 corners while keeping triple junctions (valence != 2) locked
  // Notice: corners touched by internal tile-seam edges must also be locked so 3-way junctions between a seam and a true boundary never pull apart!
  const seamLockedCorners = new Uint8Array(mesh.cornerCount)
  const edgeCorners = new Uint32Array(2 * mesh.edgeCount)
  mesh.forEachEdge((edgeId, _rA, _rB, cornerA, cornerB) => {
    edgeCorners[2 * edgeId] = cornerA
    edgeCorners[2 * edgeId + 1] = cornerB
  })
  if (smoothEdgeMask) {
    for (let i = 0; i < boundaryEdgeIds.length; i++) {
      const edgeId = boundaryEdgeIds[i]
      if (smoothEdgeMask[edgeId] === 0) {
        seamLockedCorners[edgeCorners[2 * edgeId]] = 1
        seamLockedCorners[edgeCorners[2 * edgeId + 1]] = 1
      }
    }
  }

  const relaxedCorners = smoothBoundaryCornerPositions(
    mesh,
    cornerPositions,
    activeBoundaryEdgeIds,
    cornerRelaxIterations,
    cornerRelaxStrength,
    seamLockedCorners,
  )

  const cornerValence = new Map<number, number>()
  const cornerIncidentEdges = new Map<number, number[]>()
  for (let i = 0; i < activeBoundaryEdgeIds.length; i++) {
    const edgeId = activeBoundaryEdgeIds[i]
    const cA = edgeCorners[2 * edgeId]
    const cB = edgeCorners[2 * edgeId + 1]
    cornerValence.set(cA, (cornerValence.get(cA) ?? 0) + 1)
    cornerValence.set(cB, (cornerValence.get(cB) ?? 0) + 1)
    let listA = cornerIncidentEdges.get(cA)
    if (!listA) {
      listA = []
      cornerIncidentEdges.set(cA, listA)
    }
    listA.push(edgeId)
    let listB = cornerIncidentEdges.get(cB)
    if (!listB) {
      listB = []
      cornerIncidentEdges.set(cB, listB)
    }
    listB.push(edgeId)
  }

  // 3. Initialize canonical midpoint for each active classification boundary edge on the unit sphere
  const edgeMidpoints = new Map<number, Vec3Tuple>()
  for (let i = 0; i < activeBoundaryEdgeIds.length; i++) {
    const edgeId = activeBoundaryEdgeIds[i]
    const cA = edgeCorners[2 * edgeId]
    const cB = edgeCorners[2 * edgeId + 1]
    const aOff = 3 * cA
    const bOff = 3 * cB
    edgeMidpoints.set(
      edgeId,
      normalizeVec3(
        relaxedCorners[aOff] + relaxedCorners[bOff],
        relaxedCorners[aOff + 1] + relaxedCorners[bOff + 1],
        relaxedCorners[aOff + 2] + relaxedCorners[bOff + 2],
      ),
    )
  }

  // 4. Iteratively relax valence-2 corners and edge midpoints along shared boundary chains
  let currentCorners = relaxedCorners.slice()
  for (let iter = 0; iter < edgeRelaxIterations; iter++) {
    const nextCorners = currentCorners.slice()
    const nextMidpoints = new Map<number, Vec3Tuple>()

    // Update each edge midpoint using its two endpoints and adjacent valence-2 continuation corners
    for (let i = 0; i < activeBoundaryEdgeIds.length; i++) {
      const edgeId = activeBoundaryEdgeIds[i]
      const cA = edgeCorners[2 * edgeId]
      const cB = edgeCorners[2 * edgeId] === edgeCorners[2 * edgeId + 1]
        ? edgeCorners[2 * edgeId]
        : edgeCorners[2 * edgeId + 1]
      const aOff = 3 * cA
      const bOff = 3 * cB
      const p1: Vec3Tuple = [currentCorners[aOff], currentCorners[aOff + 1], currentCorners[aOff + 2]]
      const p2: Vec3Tuple = [currentCorners[bOff], currentCorners[bOff + 1], currentCorners[bOff + 2]]

      // Find continuation corner p0 before cA if cA has valence 2 and is not seam-locked
      let p0: Vec3Tuple = p1
      if (cornerValence.get(cA) === 2 && !seamLockedCorners[cA]) {
        const incA = cornerIncidentEdges.get(cA)!
        const otherEdge = incA[0] === edgeId ? incA[1] : incA[0]
        const oc0 = edgeCorners[2 * otherEdge]
        const oc1 = edgeCorners[2 * otherEdge + 1]
        const prevCorner = oc0 === cA ? oc1 : oc0
        const pOff = 3 * prevCorner
        p0 = [currentCorners[pOff], currentCorners[pOff + 1], currentCorners[pOff + 2]]
      }

      // Find continuation corner p3 after cB if cB has valence 2 and is not seam-locked
      let p3: Vec3Tuple = p2
      if (cornerValence.get(cB) === 2 && !seamLockedCorners[cB]) {
        const incB = cornerIncidentEdges.get(cB)!
        const otherEdge = incB[0] === edgeId ? incB[1] : incB[0]
        const oc0 = edgeCorners[2 * otherEdge]
        const oc1 = edgeCorners[2 * otherEdge + 1]
        const nextCorner = oc0 === cB ? oc1 : oc0
        const nOff = 3 * nextCorner
        p3 = [currentCorners[nOff], currentCorners[nOff + 1], currentCorners[nOff + 2]]
      }

      // 4-point subdivision stencil: (9*(p1+p2) - (p0+p3)) / 16 blended with chord midpoint
      const chordMid = normalizeVec3(p1[0] + p2[0], p1[1] + p2[1], p1[2] + p2[2])
      const cubicMid = evaluateSphericalCatmullRom(p0, p1, p2, p3, 0.5)
      const blended = slerpVec3(chordMid, cubicMid, edgeRelaxStrength)
      nextMidpoints.set(edgeId, blended)
    }

    // Relax valence-2 corners toward their two incident edge midpoints
    for (const [corner, valence] of cornerValence) {
      if (valence !== 2 || seamLockedCorners[corner])
        continue
      const inc = cornerIncidentEdges.get(corner)!
      const mA = nextMidpoints.get(inc[0])
      const mB = nextMidpoints.get(inc[1])
      if (!mA || !mB)
        continue
      const cOff = 3 * corner
      const cx = currentCorners[cOff]
      const cy = currentCorners[cOff + 1]
      const cz = currentCorners[cOff + 2]
      const avgMid = normalizeVec3(mA[0] + mB[0], mA[1] + mB[1], mA[2] + mB[2])
      let [rx, ry, rz] = slerpVec3([cx, cy, cz], avgMid, edgeRelaxStrength * 0.65)
      const da = Math.hypot(mA[0] - cx, mA[1] - cy, mA[2] - cz)
      const db = Math.hypot(mB[0] - cx, mB[1] - cy, mB[2] - cz)
      const maxDist = Math.min(da, db) * 0.42
      const moveDist = Math.hypot(rx - cx, ry - cy, rz - cz)
      if (moveDist > maxDist && moveDist > 0) {
        const scale = maxDist / moveDist
        ;[rx, ry, rz] = normalizeVec3(
          cx + (rx - cx) * scale,
          cy + (ry - cy) * scale,
          cz + (rz - cz) * scale,
        )
      }
      nextCorners[cOff] = rx
      nextCorners[cOff + 1] = ry
      nextCorners[cOff + 2] = rz
    }

    currentCorners = nextCorners
    for (const [edgeId, mid] of nextMidpoints) {
      edgeMidpoints.set(edgeId, mid)
    }
  }

  // 5. Assemble each ring's vertex sequence: [corner_0, midpoint(edge_0)?, corner_1, midpoint(edge_1)?, ...]
  return rings.map((ring) => {
    const points: Vec3Tuple[] = []
    const len = ring.corners.length
    for (let i = 0; i < len; i++) {
      const c = ring.corners[i]
      const cOff = 3 * c
      points.push(normalizeVec3(
        currentCorners[cOff],
        currentCorners[cOff + 1],
        currentCorners[cOff + 2],
      ))
      const edgeId = ring.edgeIds[i]
      const mid = edgeMidpoints.get(edgeId)
      if (mid) {
        points.push(mid)
      }
    }
    return {
      points,
      interiorRegions: ring.interiorRegions,
      sampleInteriorRegion: ring.sampleInteriorRegion,
    }
  })
}

/**
 * Spherical Chaikin corner-cutting for closed rings on the unit sphere.
 */
export function chaikinSmoothSphericalRing(
  points: readonly Vec3Tuple[],
  iterations = 1,
): Vec3Tuple[] {
  let current = [...points]
  for (let iter = 0; iter < iterations; iter++) {
    const n = current.length
    if (n < 3)
      break
    const next: Vec3Tuple[] = []
    for (let i = 0; i < n; i++) {
      const a = current[i]
      const b = current[(i + 1) % n]
      next.push(slerpVec3(a, b, 0.25))
      next.push(slerpVec3(a, b, 0.75))
    }
    current = next
  }
  return current
}

export function evaluateSphericalCatmullRom(
  p0: Vec3Tuple,
  p1: Vec3Tuple,
  p2: Vec3Tuple,
  p3: Vec3Tuple,
  t: number,
): Vec3Tuple {
  const t2 = t * t
  const t3 = t2 * t
  const x = 0.5 * (
    2 * p1[0]
    + (-p0[0] + p2[0]) * t
    + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
    + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
  )
  const y = 0.5 * (
    2 * p1[1]
    + (-p0[1] + p2[1]) * t
    + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
    + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
  )
  const z = 0.5 * (
    2 * p1[2]
    + (-p0[2] + p2[2]) * t
    + (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * t2
    + (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * t3
  )
  return normalizeVec3(x, y, z)
}

export function evaluateSphericalCatmullRomWithTangent(
  points: readonly Vec3Tuple[],
  u: number,
): Readonly<{ position: Vec3Tuple, tangent: Vec3Tuple }> {
  const n = points.length
  if (n < 2)
    throw new RangeError('Catmull-Rom requires at least 2 control points')
  const clamped = Math.max(0, Math.min(1, u)) * (n - 1)
  const i = Math.min(Math.floor(clamped), n - 2)
  const t = clamped - i

  const p0 = points[Math.max(0, i - 1)]
  const p1 = points[i]
  const p2 = points[i + 1]
  const p3 = points[Math.min(n - 1, i + 2)]

  const position = evaluateSphericalCatmullRom(p0, p1, p2, p3, t)
  const t2 = t * t
  const dx = 0.5 * (
    (-p0[0] + p2[0])
    + 2 * (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t
    + 3 * (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t2
  )
  const dy = 0.5 * (
    (-p0[1] + p2[1])
    + 2 * (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t
    + 3 * (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t2
  )
  const dz = 0.5 * (
    (-p0[2] + p2[2])
    + 2 * (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * t
    + 3 * (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * t2
  )
  const radialProj = dx * position[0] + dy * position[1] + dz * position[2]
  let tx = dx - radialProj * position[0]
  let ty = dy - radialProj * position[1]
  let tz = dz - radialProj * position[2]
  if (Math.hypot(tx, ty, tz) < 1e-8) {
    const chordX = p2[0] - p1[0]
    const chordY = p2[1] - p1[1]
    const chordZ = p2[2] - p1[2]
    const cProj = chordX * position[0] + chordY * position[1] + chordZ * position[2]
    tx = chordX - cProj * position[0]
    ty = chordY - cProj * position[1]
    tz = chordZ - cProj * position[2]
    if (Math.hypot(tx, ty, tz) < 1e-8) {
      const fallback = crossVec3(position, Math.abs(position[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])
      tx = fallback[0]
      ty = fallback[1]
      tz = fallback[2]
    }
  }
  return {
    position,
    tangent: normalizeVec3(tx, ty, tz),
  }
}

/**
 * Closed spherical Catmull-Rom smoothing for organic lake contours.
 */
export function catmullRomSmoothClosedRing(
  points: readonly Vec3Tuple[],
  subdivisionsPerSegment = 4,
): Vec3Tuple[] {
  const n = points.length
  if (n < 3 || subdivisionsPerSegment <= 1)
    return [...points]
  const out: Vec3Tuple[] = []
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]
    const p1 = points[i]
    const p2 = points[(i + 1) % n]
    const p3 = points[(i + 2) % n]
    for (let step = 0; step < subdivisionsPerSegment; step++) {
      out.push(evaluateSphericalCatmullRom(p0, p1, p2, p3, step / subdivisionsPerSegment))
    }
  }
  return out
}

/**
 * Open spherical Catmull-Rom smoothing for river centerlines with optional per-vertex scalar attribute.
 */
export function catmullRomSmoothOpenPath(
  points: readonly Vec3Tuple[],
  scalars?: readonly number[],
  subdivisionsPerSegment = 4,
): Readonly<{ points: Vec3Tuple[], scalars: number[] }> {
  const n = points.length
  if (n < 2) {
    return {
      points: [...points],
      scalars: scalars ? [...scalars] : points.map(() => 0),
    }
  }
  const outPoints: Vec3Tuple[] = []
  const outScalars: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(n - 1, i + 2)]
    const s1 = scalars ? scalars[i] : 0
    const s2 = scalars ? scalars[i + 1] : 0
    for (let step = 0; step < subdivisionsPerSegment; step++) {
      const t = step / subdivisionsPerSegment
      outPoints.push(evaluateSphericalCatmullRom(p0, p1, p2, p3, t))
      outScalars.push(s1 * (1 - t) + s2 * t)
    }
  }
  outPoints.push(points[n - 1])
  outScalars.push(scalars ? scalars[n - 1] : 0)
  return { points: outPoints, scalars: outScalars }
}

export function offsetSphericalPoint(
  center: Vec3Tuple,
  tangentNormal: Vec3Tuple,
  angularRadiusRad: number,
): Vec3Tuple {
  if (Math.abs(angularRadiusRad) < 1e-12)
    return center
  const cos = Math.cos(angularRadiusRad)
  const sin = Math.sin(angularRadiusRad)
  const ortho = normalizeVec3(
    tangentNormal[0] - center[0] * dotVec3(tangentNormal, center),
    tangentNormal[1] - center[1] * dotVec3(tangentNormal, center),
    tangentNormal[2] - center[2] * dotVec3(tangentNormal, center),
  )
  return normalizeVec3(
    center[0] * cos + ortho[0] * sin,
    center[1] * cos + ortho[1] * sin,
    center[2] * cos + ortho[2] * sin,
  )
}
