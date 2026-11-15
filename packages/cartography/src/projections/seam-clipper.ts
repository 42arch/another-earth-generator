import type { LonLatTuple } from '#projections/spherical-math'
import {
  cartesianToLonLatDeg,
  lonLatDegToCartesian,
  sphericalAngleRad,
  unwrapLongitudeDegNear,
  wrapLongitudeDeg,
} from '#projections/spherical-math'

export interface ClippedPolylineSegment {
  readonly coordinates: readonly LonLatTuple[]
  readonly cumulativeDistances: readonly number[]
}

export interface ClippedPolygonPart {
  readonly exterior: readonly LonLatTuple[]
  readonly holes: readonly (readonly LonLatTuple[])[]
}

/**
 * Computes the latitude in degrees where the great-circle segment between `a` and `b`
 * crosses the `±180°` antimeridian (`x = 0, z < 0` on the Y-up unit sphere).
 */
export function computeAntimeridianCrossingLatitudeDeg(
  a: LonLatTuple,
  b: LonLatTuple,
): number {
  const va = lonLatDegToCartesian(a[0], a[1])
  const vb = lonLatDegToCartesian(b[0], b[1])
  const dx = vb[0] - va[0]
  if (Math.abs(dx) > 1e-10) {
    const t = Math.max(0, Math.min(1, -va[0] / dx))
    const ix = 0
    const iy = va[1] + (vb[1] - va[1]) * t
    const iz = va[2] + (vb[2] - va[2]) * t
    if (iz < 0 && Math.hypot(iy, iz) > 1e-8) {
      const [, latDeg] = cartesianToLonLatDeg(ix, iy, iz)
      return latDeg
    }
  }
  const uLonA = a[0]
  const uLonB = unwrapLongitudeDegNear(b[0], uLonA)
  const targetLon = uLonB >= uLonA ? 180 : -180
  const span = uLonB - uLonA
  const ratio = Math.abs(span) > 1e-9 ? Math.max(0, Math.min(1, (targetLon - uLonA) / span)) : 0.5
  return a[1] + (b[1] - a[1]) * ratio
}

/**
 * Splits a continuous geographic polyline (`[lonDeg, latDeg][]`) across the `±180°` antimeridian:
 * - No output segment has `|lon_{i+1} - lon_i| > 180°` (zero map-spanning horizontal artifacts).
 * - Each split sub-polyline preserves monotonic `cumulativeDistances` (in radians on the unit sphere)
 *   inherited from the preceding sub-polyline so dashed lines (`line-dasharray`) maintain continuous phase across `±180°`.
 */
export function clipPolylineAtAntimeridian(
  coordinates: readonly LonLatTuple[],
  initialDistanceRad = 0,
): ClippedPolylineSegment[] {
  if (coordinates.length < 2)
    return []

  const results: ClippedPolylineSegment[] = []
  let currentCoords: LonLatTuple[] = [[wrapLongitudeDeg(coordinates[0][0]), coordinates[0][1]]]
  let currentDists: number[] = [initialDistanceRad]
  let runningDist = initialDistanceRad

  for (let i = 0; i < coordinates.length - 1; i++) {
    const a: LonLatTuple = currentCoords.at(-1)!
    const rawB = coordinates[i + 1]
    const bLon = wrapLongitudeDeg(rawB[0])
    const bLat = Math.max(-90, Math.min(90, rawB[1]))
    const b: LonLatTuple = [bLon, bLat]

    const va = lonLatDegToCartesian(a[0], a[1])
    const vb = lonLatDegToCartesian(b[0], b[1])
    const segArc = sphericalAngleRad(va, vb)

    const deltaLon = b[0] - a[0]
    if (Math.abs(deltaLon) > 180 && Math.abs(Math.abs(a[0]) - 180) > 1e-7 && Math.abs(Math.abs(b[0]) - 180) > 1e-7) {
      const crossLat = computeAntimeridianCrossingLatitudeDeg(a, b)
      const exitLon = deltaLon > 0 ? -180 : 180
      const enterLon = -exitLon
      const vCross = lonLatDegToCartesian(180, crossLat)
      const firstHalfArc = Math.min(segArc, sphericalAngleRad(va, vCross))
      const secondHalfArc = Math.max(0, segArc - firstHalfArc)

      const midDist = runningDist + firstHalfArc
      currentCoords.push([exitLon, crossLat])
      currentDists.push(midDist)
      if (currentCoords.length >= 2) {
        results.push({
          coordinates: currentCoords,
          cumulativeDistances: currentDists,
        })
      }

      runningDist = midDist + secondHalfArc
      currentCoords = [
        [enterLon, crossLat],
        b,
      ]
      currentDists = [midDist, runningDist]
    }
    else {
      runningDist += segArc
      // Avoid zero-length duplicate points
      if (Math.abs(b[0] - a[0]) > 1e-7 || Math.abs(b[1] - a[1]) > 1e-7) {
        currentCoords.push(b)
        currentDists.push(runningDist)
      }
    }
  }

  if (currentCoords.length >= 2) {
    results.push({
      coordinates: currentCoords,
      cumulativeDistances: currentDists,
    })
  }

  return results
}

function clip2DRingByHalfPlane(
  ring: readonly [number, number][],
  isInside: (pt: readonly [number, number]) => boolean,
  intersect: (a: readonly [number, number], b: readonly [number, number]) => [number, number],
): [number, number][] {
  if (ring.length < 3)
    return []
  const output: [number, number][] = []
  for (let i = 0; i < ring.length; i++) {
    const curr = ring[i]
    const prev = ring[(i - 1 + ring.length) % ring.length]
    const currIn = isInside(curr)
    const prevIn = isInside(prev)
    if (currIn !== prevIn) {
      output.push(intersect(prev, curr))
    }
    if (currIn) {
      output.push([curr[0], curr[1]])
    }
  }
  return output
}

/**
 * Clips a 2D `[lon, lat]` polygon ring against the rectangular geographic box
 * `[minLon, maxLon] × [minLat, maxLat]` using Sutherland-Hodgman clipping.
 */
export function clipRingToGeographicBox(
  ring: readonly [number, number][],
  minLon: number,
  maxLon: number,
  minLat = -90,
  maxLat = 90,
): [number, number][] {
  let current: [number, number][] = ring.map(([x, y]) => [x, y])

  // x >= minLon
  current = clip2DRingByHalfPlane(
    current,
    pt => pt[0] >= minLon - 1e-9,
    (a, b) => {
      const dx = b[0] - a[0]
      const t = Math.abs(dx) > 1e-12 ? (minLon - a[0]) / dx : 0.5
      return [minLon, a[1] + (b[1] - a[1]) * Math.max(0, Math.min(1, t))]
    },
  )
  // x <= maxLon
  current = clip2DRingByHalfPlane(
    current,
    pt => pt[0] <= maxLon + 1e-9,
    (a, b) => {
      const dx = b[0] - a[0]
      const t = Math.abs(dx) > 1e-12 ? (maxLon - a[0]) / dx : 0.5
      return [maxLon, a[1] + (b[1] - a[1]) * Math.max(0, Math.min(1, t))]
    },
  )
  // y >= minLat
  current = clip2DRingByHalfPlane(
    current,
    pt => pt[1] >= minLat - 1e-9,
    (a, b) => {
      const dy = b[1] - a[1]
      const t = Math.abs(dy) > 1e-12 ? (minLat - a[1]) / dy : 0.5
      return [a[0] + (b[0] - a[0]) * Math.max(0, Math.min(1, t)), minLat]
    },
  )
  // y <= maxLat
  current = clip2DRingByHalfPlane(
    current,
    pt => pt[1] <= maxLat + 1e-9,
    (a, b) => {
      const dy = b[1] - a[1]
      const t = Math.abs(dy) > 1e-12 ? (maxLat - a[1]) / dy : 0.5
      return [a[0] + (b[0] - a[0]) * Math.max(0, Math.min(1, t)), maxLat]
    },
  )

  // Deduplicate consecutive identical vertices
  const deduped: [number, number][] = []
  for (const pt of current) {
    const prev = deduped.at(-1)
    if (!prev || Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) > 1e-7) {
      deduped.push(pt)
    }
  }
  if (deduped.length >= 2) {
    const first = deduped[0]
    const last = deduped.at(-1)!
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-7) {
      deduped.pop()
    }
  }
  return deduped
}

function unwrapRingContinuously(
  ring: readonly LonLatTuple[],
  referenceLon?: number,
): { points: [number, number][], minLon: number, maxLon: number } {
  const rawCount = ring.length
  if (rawCount < 3) {
    return { points: [], minLon: 0, maxLon: 0 }
  }
  const closed = Math.abs(ring[0][0] - ring[rawCount - 1][0]) < 1e-7
    && Math.abs(ring[0][1] - ring[rawCount - 1][1]) < 1e-7
  const count = closed ? rawCount - 1 : rawCount
  if (count < 3) {
    return { points: [], minLon: 0, maxLon: 0 }
  }

  const points: [number, number][] = []
  const firstLon = referenceLon !== undefined
    ? unwrapLongitudeDegNear(ring[0][0], referenceLon)
    : wrapLongitudeDeg(ring[0][0])
  points.push([firstLon, ring[0][1]])
  let minLon = firstLon
  let maxLon = firstLon

  for (let i = 1; i < count; i++) {
    const prevLon = points[i - 1][0]
    const uLon = unwrapLongitudeDegNear(ring[i][0], prevLon)
    const lat = ring[i][1]
    points.push([uLon, lat])
    if (uLon < minLon)
      minLon = uLon
    if (uLon > maxLon)
      maxLon = uLon
  }

  return { points, minLon, maxLon }
}

function signedAreaLonLat(ring: readonly LonLatTuple[]): number {
  let area = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1])
  }
  return area * 0.5
}

function closeRingWithOrientation(
  ring: readonly [number, number][],
  ccw: boolean,
): LonLatTuple[] {
  if (ring.length < 3)
    return []
  const area = signedAreaLonLat(ring)
  if (Math.abs(area) < 1e-9)
    return []
  const ordered = (ccw ? area < 0 : area > 0) ? [...ring].reverse() : [...ring]
  const first = ordered[0]
  ordered.push([first[0], first[1]])
  return ordered
}

/**
 * Clips a GeoJSON Polygon (`[exterior, ...holes]`) across the `±180°` antimeridian and polar latitude limits:
 * - Unwraps rings continuously so polygons crossing `±180°` are cleanly sliced into `[-180, 180]` parts
 *   without any horizontal segment spanning across the map (`|Δlon| <= 180°`).
 * - When a concave bay or meander crosses `±180°` multiple times (exiting and re-entering the same
 *   `[-180, 180]` window), pairs each exit/entry along the `±180°` boundary into separate disjoint simple
 *   rings instead of connecting them with a long vertical bridge along `±180°` (which would cause `earcut`
 *   to self-intersect and shoot horizontal spikes across the map).
 */
function clipUnwrappedRingToLongitudeWindow(
  ring: readonly [number, number][],
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number,
  ccw: boolean,
): LonLatTuple[][] {
  if (ring.length < 3)
    return []

  // First clip latitude [minLat, maxLat]
  let latClipped: [number, number][] = ring.map(([x, y]) => [x, y])
  latClipped = clip2DRingByHalfPlane(
    latClipped,
    pt => pt[1] >= minLat - 1e-9,
    (a, b) => {
      const dy = b[1] - a[1]
      const t = Math.abs(dy) > 1e-12 ? (minLat - a[1]) / dy : 0.5
      return [a[0] + (b[0] - a[0]) * Math.max(0, Math.min(1, t)), minLat]
    },
  )
  latClipped = clip2DRingByHalfPlane(
    latClipped,
    pt => pt[1] <= maxLat + 1e-9,
    (a, b) => {
      const dy = b[1] - a[1]
      const t = Math.abs(dy) > 1e-12 ? (maxLat - a[1]) / dy : 0.5
      return [a[0] + (b[0] - a[0]) * Math.max(0, Math.min(1, t)), maxLat]
    },
  )
  if (latClipped.length < 3)
    return []

  // Orient latClipped to match desired winding before half-plane splitting
  if ((ccw && signedAreaLonLat(latClipped) < 0) || (!ccw && signedAreaLonLat(latClipped) > 0)) {
    latClipped.reverse()
  }

  // Split a single simple ring against a vertical line x >= bound (if isLowerBound) or x <= bound
  const splitRingAtVerticalBoundary = (
    inputRing: readonly [number, number][],
    boundX: number,
    keepGreaterOrEqual: boolean,
  ): [number, number][][] => {
    const n = inputRing.length
    if (n < 3)
      return []

    const inside = new Uint8Array(n)
    let allInside = true
    let allOutside = true
    for (let i = 0; i < n; i++) {
      const x = inputRing[i][0]
      const isIn = keepGreaterOrEqual ? x >= boundX - 1e-9 : x <= boundX + 1e-9
      inside[i] = isIn ? 1 : 0
      if (isIn)
        allOutside = false
      else
        allInside = false
    }

    if (allOutside)
      return []
    if (allInside)
      return [inputRing.map(([x, y]) => [x, y])]

    // Extract open chains that lie inside the half-plane, starting at an entry crossing and ending at an exit crossing
    interface OpenChain {
      readonly entryY: number
      readonly exitY: number
      readonly points: [number, number][]
    }
    const chains: OpenChain[] = []

    // Find an index that is outside so we can trace each inside interval cleanly
    let firstOutside = -1
    for (let i = 0; i < n; i++) {
      if (!inside[i]) {
        firstOutside = i
        break
      }
    }
    if (firstOutside < 0)
      return [inputRing.map(([x, y]) => [x, y])]

    const intersectVertical = (a: readonly [number, number], b: readonly [number, number]): [number, number] => {
      const dx = b[0] - a[0]
      const t = Math.abs(dx) > 1e-12 ? Math.max(0, Math.min(1, (boundX - a[0]) / dx)) : 0.5
      return [boundX, a[1] + (b[1] - a[1]) * t]
    }

    let currentChain: [number, number][] | null = null
    let currentEntryY = 0
    for (let step = 0; step < n; step++) {
      const currIdx = (firstOutside + step + 1) % n
      const prevIdx = (currIdx - 1 + n) % n
      const prevIn = inside[prevIdx] === 1
      const currIn = inside[currIdx] === 1
      const prevPt = inputRing[prevIdx]
      const currPt = inputRing[currIdx]

      if (!prevIn && currIn) {
        const hit = intersectVertical(prevPt, currPt)
        currentEntryY = hit[1]
        currentChain = [hit, [currPt[0], currPt[1]]]
      }
      else if (prevIn && currIn) {
        currentChain?.push([currPt[0], currPt[1]])
      }
      else if (prevIn && !currIn) {
        const hit = intersectVertical(prevPt, currPt)
        if (currentChain) {
          currentChain.push(hit)
          chains.push({
            entryY: currentEntryY,
            exitY: hit[1],
            points: currentChain,
          })
          currentChain = null
        }
      }
    }

    if (chains.length === 0)
      return []
    if (chains.length === 1)
      return [chains[0].points]

    // When multiple inside chains exist on the boundary x = boundX:
    // Sort all boundary endpoints (2 * chains.length) along the boundary in the interior-on-left direction:
    // - For x >= minLon (interior is to the right, +x), CCW exterior has interior on left -> boundary goes DOWN (-y) for CCW, UP (+y) for CW.
    // - For x <= maxLon (interior is to the left, -x), CCW exterior has interior on left -> boundary goes UP (+y) for CCW, DOWN (-y) for CW.
    const boundaryDirectionUp = keepGreaterOrEqual ? !ccw : ccw
    interface BoundaryEvent {
      readonly y: number
      readonly kind: 'exit' | 'entry'
      readonly chainIndex: number
    }
    const events: BoundaryEvent[] = []
    for (let c = 0; c < chains.length; c++) {
      events.push({ y: chains[c].exitY, kind: 'exit', chainIndex: c })
      events.push({ y: chains[c].entryY, kind: 'entry', chainIndex: c })
    }
    events.sort((a, b) => boundaryDirectionUp ? a.y - b.y : b.y - a.y)

    // Pair consecutive events (2k, 2k+1) along the boundary line so no two boundary segments ever overlap!
    const nextChainAfterExit = new Int32Array(chains.length).fill(-1)
    for (let e = 0; e + 1 < events.length; e += 2) {
      const first = events[e]
      const second = events[e + 1]
      if (first.kind === 'exit' && second.kind === 'entry') {
        nextChainAfterExit[first.chainIndex] = second.chainIndex
      }
      else if (first.kind === 'entry' && second.kind === 'exit') {
        nextChainAfterExit[second.chainIndex] = first.chainIndex
      }
    }

    // Fallback if non-alternating degeneracy occurred: pair each exit i with entry i
    for (let c = 0; c < chains.length; c++) {
      if (nextChainAfterExit[c] < 0)
        nextChainAfterExit[c] = c
    }

    const used = new Uint8Array(chains.length)
    const closedRings: [number, number][][] = []
    for (let start = 0; start < chains.length; start++) {
      if (used[start])
        continue
      const assembled: [number, number][] = []
      let curr = start
      for (let guard = 0; guard < chains.length; guard++) {
        if (curr < 0 || used[curr])
          break
        used[curr] = 1
        for (const pt of chains[curr].points) {
          const prev = assembled.at(-1)
          if (!prev || Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) > 1e-7) {
            assembled.push(pt)
          }
        }
        curr = nextChainAfterExit[curr]
        if (curr === start)
          break
      }
      if (assembled.length >= 2) {
        const first = assembled[0]
        const last = assembled.at(-1)!
        if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-7)
          assembled.pop()
      }
      if (assembled.length >= 3)
        closedRings.push(assembled)
    }
    return closedRings
  }

  const afterMin = splitRingAtVerticalBoundary(latClipped, minLon, true)
  const finalRings: LonLatTuple[][] = []
  for (const r of afterMin) {
    const afterMax = splitRingAtVerticalBoundary(r, maxLon, false)
    for (const part of afterMax) {
      const closed = closeRingWithOrientation(part, ccw)
      if (closed.length >= 4)
        finalRings.push(closed)
    }
  }
  return finalRings
}

function pointInClosedLonLatRing(point: LonLatTuple, ring: readonly LonLatTuple[]): boolean {
  const [x, y] = point
  let inside = false
  const n = ring.length - 1
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi) {
      inside = !inside
    }
  }
  return inside
}

export function clipPolygonAtAntimeridian(
  coordinates: readonly (readonly LonLatTuple[])[],
  maxLatitudeDegrees = 90,
): ClippedPolygonPart[] {
  if (coordinates.length === 0)
    return []

  const unwrappedExterior = unwrapRingContinuously(coordinates[0])
  if (unwrappedExterior.points.length < 3)
    return []

  const refLon = unwrappedExterior.points[0][0]
  const unwrappedHoles = coordinates
    .slice(1)
    .map(hole => unwrapRingContinuously(hole, refLon))
    .filter(h => h.points.length >= 3)

  // Determine which 360-degree longitude windows [-180 + 360*k, 180 + 360*k] overlap the unwrapped exterior
  const minK = Math.floor((unwrappedExterior.minLon + 180) / 360)
  const maxK = Math.floor((unwrappedExterior.maxLon + 180 - 1e-9) / 360)

  const parts: ClippedPolygonPart[] = []
  for (let k = minK; k <= maxK; k++) {
    const shiftLon = k * 360
    const shiftedExt: [number, number][] = unwrappedExterior.points.map(([lon, lat]) => [lon - shiftLon, lat])
    const closedExteriors = clipUnwrappedRingToLongitudeWindow(
      shiftedExt,
      -180,
      180,
      -maxLatitudeDegrees,
      maxLatitudeDegrees,
      true,
    )
    if (closedExteriors.length === 0)
      continue

    const candidateHoles: LonLatTuple[][] = []
    for (const hole of unwrappedHoles) {
      for (const hShift of [shiftLon - 360, shiftLon, shiftLon + 360]) {
        const shiftedHole: [number, number][] = hole.points.map(([lon, lat]) => [lon - hShift, lat])
        const splitHoles = clipUnwrappedRingToLongitudeWindow(
          shiftedHole,
          -180,
          180,
          -maxLatitudeDegrees,
          maxLatitudeDegrees,
          false,
        )
        candidateHoles.push(...splitHoles)
      }
    }

    if (closedExteriors.length === 1) {
      parts.push({
        exterior: closedExteriors[0],
        holes: candidateHoles,
      })
    }
    else {
      // Assign each hole to the split exterior ring that contains it
      const holesByExt: LonLatTuple[][][] = closedExteriors.map(() => [])
      for (const hole of candidateHoles) {
        const probe = hole[0]
        for (let e = 0; e < closedExteriors.length; e++) {
          if (pointInClosedLonLatRing(probe, closedExteriors[e])) {
            holesByExt[e].push(hole)
            break
          }
        }
      }
      for (let e = 0; e < closedExteriors.length; e++) {
        parts.push({
          exterior: closedExteriors[e],
          holes: holesByExt[e],
        })
      }
    }
  }

  return parts
}
