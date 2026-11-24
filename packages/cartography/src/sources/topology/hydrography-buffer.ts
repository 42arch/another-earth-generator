import type { MapMeshReader, WorldMapReader } from '@another-earth/world-core'
import type { LonLatTuple, Vec3Tuple } from '#projections/spherical-math'
import {
  cartesianToLonLatDeg,
  crossVec3,
  dotVec3,
  normalizeVec3,
  sphericalAngleRad,
} from '#projections/spherical-math'
import { ringPointsToClosedLonLat } from './ring-tracer'
import { catmullRomSmoothOpenPath, offsetSphericalPoint } from './spherical-smooth'

/** Centerlines and ribbons below this Strahler order stay in the source but are not drawn. */
export const DISPLAYED_RIVER_MIN_STRAHLER = 2

const RIVER_CENTERLINE_SUBDIVISIONS = 4

export interface DerivedRiverFeature {
  readonly id: string
  readonly strahlerOrder: number
  readonly annualMeanDischargeM3s: number
  readonly endorheic: boolean
  readonly areaKm2: number
  readonly centerline3D: readonly Vec3Tuple[]
  readonly centerlineCoords: readonly LonLatTuple[]
  /** Source-to-mouth region ids. Parallel to `centerlineVertexIndex`. */
  readonly regionIds: readonly number[]
  /** Index into `centerlineCoords` for each region center in `regionIds`. */
  readonly centerlineVertexIndex: readonly number[]
  /** Next river cell the centerline is extended toward, or -1. */
  readonly downstreamRegionId: number
  /** Index into `centerlineCoords` for `downstreamRegionId`, or -1. */
  readonly downstreamVertexIndex: number
  /** Polygon or MultiPolygon outer rings (main channel ribbon + optional confluence cap). */
  readonly polygonsCoords: readonly (readonly (readonly LonLatTuple[])[])[]
}

function sharedBoundaryMidpoint(
  mesh: MapMeshReader,
  regionA: number,
  regionB: number,
): Vec3Tuple | undefined {
  let cornerA = -1
  let cornerB = -1
  mesh.forEachRegionNeighbor(regionA, (neighbor, cA, cB) => {
    if (neighbor === regionB) {
      cornerA = cA
      cornerB = cB
    }
  })
  if (cornerA < 0 || cornerB < 0)
    return undefined
  const posA = { x: 0, y: 0, z: 0 }
  const posB = { x: 0, y: 0, z: 0 }
  mesh.getCornerPosition(cornerA, posA)
  mesh.getCornerPosition(cornerB, posB)
  return normalizeVec3(posA.x + posB.x, posA.y + posB.y, posA.z + posB.z)
}

function buildSphericalCapRing(
  center: Vec3Tuple,
  radiusRad: number,
  sides = 12,
): LonLatTuple[] {
  const ref: Vec3Tuple = Math.abs(center[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const tangentA = normalizeVec3(...crossVec3(center, ref))
  const tangentB = normalizeVec3(...crossVec3(center, tangentA))
  const points: Vec3Tuple[] = []
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2
    const dir = normalizeVec3(
      Math.cos(angle) * tangentA[0] + Math.sin(angle) * tangentB[0],
      Math.cos(angle) * tangentA[1] + Math.sin(angle) * tangentB[1],
      Math.cos(angle) * tangentA[2] + Math.sin(angle) * tangentB[2],
    )
    points.push(offsetSphericalPoint(center, dir, radiusRad))
  }
  return ringPointsToClosedLonLat(points, 'ccw', center)
}

function buildRibbonOuterRing(
  centerline: readonly Vec3Tuple[],
  halfWidthsRad: readonly number[],
): LonLatTuple[] {
  const n = centerline.length
  if (n < 2)
    return []

  const leftBank: Vec3Tuple[] = []
  const rightBank: Vec3Tuple[] = []
  let meanX = 0
  let meanY = 0
  let meanZ = 0

  for (let i = 0; i < n; i++) {
    const current = centerline[i]
    meanX += current[0]
    meanY += current[1]
    meanZ += current[2]
    const prev = centerline[Math.max(0, i - 1)]
    const next = centerline[Math.min(n - 1, i + 1)]
    const dx = next[0] - prev[0]
    const dy = next[1] - prev[1]
    const dz = next[2] - prev[2]
    const proj = dx * current[0] + dy * current[1] + dz * current[2]
    let tx = dx - current[0] * proj
    let ty = dy - current[1] * proj
    let tz = dz - current[2] * proj
    if (Math.hypot(tx, ty, tz) < 1e-8) {
      const fallback = crossVec3(current, Math.abs(current[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])
      tx = fallback[0]
      ty = fallback[1]
      tz = fallback[2]
    }
    const tangent = normalizeVec3(tx, ty, tz)
    const leftNormal = normalizeVec3(...crossVec3(current, tangent))
    const rightNormal: Vec3Tuple = [-leftNormal[0], -leftNormal[1], -leftNormal[2]]
    const halfW = Math.max(1e-5, halfWidthsRad[i])
    leftBank.push(offsetSphericalPoint(current, leftNormal, halfW))
    rightBank.push(offsetSphericalPoint(current, rightNormal, halfW))
  }

  // Semicircular start/end caps so each river segment forms a smooth closed water polygon
  const ring3D: Vec3Tuple[] = [...leftBank]
  const endCenter = centerline[n - 1]
  const endPrev = centerline[n - 2]
  const endForward = normalizeVec3(
    endCenter[0] - endPrev[0] - endCenter[0] * dotVec3([endCenter[0] - endPrev[0], endCenter[1] - endPrev[1], endCenter[2] - endPrev[2]], endCenter),
    endCenter[1] - endPrev[1] - endCenter[1] * dotVec3([endCenter[0] - endPrev[0], endCenter[1] - endPrev[1], endCenter[2] - endPrev[2]], endCenter),
    endCenter[2] - endPrev[2] - endCenter[2] * dotVec3([endCenter[0] - endPrev[0], endCenter[1] - endPrev[1], endCenter[2] - endPrev[2]], endCenter),
  )
  ring3D.push(offsetSphericalPoint(endCenter, endForward, Math.max(1e-5, halfWidthsRad[n - 1])))
  for (let i = n - 1; i >= 0; i--)
    ring3D.push(rightBank[i])

  const startCenter = centerline[0]
  const startNext = centerline[1]
  const startBackward = normalizeVec3(
    startCenter[0] - startNext[0] - startCenter[0] * dotVec3([startCenter[0] - startNext[0], startCenter[1] - startNext[1], startCenter[2] - startNext[2]], startCenter),
    startCenter[1] - startNext[1] - startCenter[1] * dotVec3([startCenter[0] - startNext[0], startCenter[1] - startNext[1], startCenter[2] - startNext[2]], startCenter),
    startCenter[2] - startNext[2] - startCenter[2] * dotVec3([startCenter[0] - startNext[0], startCenter[1] - startNext[1], startCenter[2] - startNext[2]], startCenter),
  )
  ring3D.push(offsetSphericalPoint(startCenter, startBackward, Math.max(1e-5, halfWidthsRad[0])))

  const refNormal = Math.hypot(meanX, meanY, meanZ) > 1e-6
    ? normalizeVec3(meanX, meanY, meanZ)
    : centerline[Math.floor(n / 2)]
  return ringPointsToClosedLonLat(ring3D, 'ccw', refNormal)
}

function smoothstep01(value: number): number {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

/**
 * Derives smoothed river centerlines and variable-width buffered polygons from `WorldMapReader`.
 * Half-width scales monotonically as a power-law function of `accumulatedAnnualFlowM3s`,
 * extends seamlessly to lake boundaries / coastal shared dual edges, and adds circular confluence caps.
 */
export function buildHydrographyRivers(reader: WorldMapReader): DerivedRiverFeature[] {
  const rivers = reader.rivers()
  if (rivers.length === 0)
    return []

  const { mesh, planet } = reader
  const count = mesh.regionCount
  const landMask = reader.field('landMask')
  const downstreamField = reader.field('downstreamRegion')
  const flowField = reader.field('accumulatedAnnualFlowM3s')
  const riverIndexField = reader.field('riverIndex')
  const lakeIndexField = reader.field('lakeIndex')

  const baseCellAngleRad = Math.sqrt((4 * Math.PI) / Math.max(1, count))
  let maximumFlow = 0
  for (let r = 0; r < count; r++) {
    if (riverIndexField.get(r) >= 0)
      maximumFlow = Math.max(maximumFlow, flowField.get(r))
  }

  // Match the legacy reference river width formula while staying strictly monotonic with flow
  const halfWidthForFlow = (flowM3s: number): number => {
    const positiveFlow = Math.max(0, flowM3s)
    if (maximumFlow <= 0 || positiveFlow <= 0)
      return baseCellAngleRad * 0.008
    const share = Math.sqrt(Math.log1p(positiveFlow) / Math.log1p(maximumFlow))
    const halfWidth = baseCellAngleRad * 0.008 + baseCellAngleRad * 0.068 * (share ** 1.65)
    return Math.min(baseCellAngleRad * 0.08, halfWidth)
  }

  const upstreamRiverCount = new Uint8Array(count)
  for (let r = 0; r < count; r++) {
    if (riverIndexField.get(r) < 0)
      continue
    const down = downstreamField.get(r)
    if (down >= 0 && down < count && riverIndexField.get(down) >= 0)
      upstreamRiverCount[down]++
  }

  const centerOut = { x: 0, y: 0, z: 0 }
  const regionCenter3D = (region: number): Vec3Tuple => {
    mesh.getRegionCenter(region, centerOut)
    return normalizeVec3(centerOut.x, centerOut.y, centerOut.z)
  }

  const features: DerivedRiverFeature[] = []
  const placedConfluenceCap = new Set<number>()

  for (let riverIdx = 0; riverIdx < rivers.length; riverIdx++) {
    const summary = rivers[riverIdx]
    const pathRegions: number[] = []
    reader.forEachRiverRegion(riverIdx, (region) => {
      pathRegions.push(region)
    })
    if (pathRegions.length === 0)
      continue

    const controlPoints: Vec3Tuple[] = pathRegions.map(regionCenter3D)
    const regionControlIndex = pathRegions.map((_, index) => index)
    const controlFlows: number[] = pathRegions.map(r => Math.max(summary.annualMeanDischargeM3s * 0.25, flowField.get(r)))
    for (let i = 1; i < controlFlows.length; i++) {
      // Ensure non-decreasing flow along a single river segment from source to mouth
      controlFlows[i] = Math.max(controlFlows[i - 1], controlFlows[i])
    }

    const sourceRegion = pathRegions[0]
    let fromLakeSpill = false
    // If upstream is a lake spill cell, prepend the shared lake-shore boundary midpoint
    if (lakeIndexField.get(sourceRegion) < 0) {
      mesh.forEachRegionNeighbor(sourceRegion, (nb) => {
        if (lakeIndexField.get(nb) >= 0 && downstreamField.get(nb) === sourceRegion) {
          const shoreMid = sharedBoundaryMidpoint(mesh, nb, sourceRegion)
          if (shoreMid) {
            fromLakeSpill = true
            controlPoints.unshift(shoreMid)
            controlFlows.unshift(controlFlows[0])
            for (let index = 0; index < regionControlIndex.length; index++)
              regionControlIndex[index]++
          }
        }
      })
    }

    // Extend mouth to downstream river confluence, lake shore or ocean coastline midpoint
    const mouthRegion = summary.mouthRegion
    const downstream = downstreamField.get(mouthRegion)
    let extendedSingleRegion = false
    let downstreamRegionId = -1
    let downstreamControlIndex = -1
    if (downstream >= 0 && downstream < count) {
      if (riverIndexField.get(downstream) >= 0) {
        downstreamRegionId = downstream
        downstreamControlIndex = controlPoints.length
        controlPoints.push(regionCenter3D(downstream))
        controlFlows.push(Math.max(controlFlows.at(-1)!, flowField.get(downstream)))
      }
      else if (lakeIndexField.get(downstream) >= 0) {
        const lakeEdgeMid = sharedBoundaryMidpoint(mesh, mouthRegion, downstream)
        if (lakeEdgeMid) {
          controlPoints.push(lakeEdgeMid)
          controlFlows.push(controlFlows.at(-1)!)
        }
        controlPoints.push(regionCenter3D(downstream))
        controlFlows.push(controlFlows.at(-1)!)
      }
      else if (landMask.get(mouthRegion) !== 0 && landMask.get(downstream) === 0) {
        const coastMid = sharedBoundaryMidpoint(mesh, mouthRegion, downstream)
        if (coastMid) {
          controlPoints.push(coastMid)
          controlFlows.push(controlFlows.at(-1)!)
        }
      }
    }

    // Legacy map-overlay-data.ts skipped isolated 1-cell endorheic river fragments with no downstream connection
    if (controlPoints.length === 1) {
      if (rivers.length > 8)
        continue
      extendedSingleRegion = true
      const c = controlPoints[0]
      const ref: Vec3Tuple = Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
      const dir = normalizeVec3(...crossVec3(c, ref))
      controlPoints.unshift(offsetSphericalPoint(c, [-dir[0], -dir[1], -dir[2]], baseCellAngleRad * 0.25))
      controlPoints.push(offsetSphericalPoint(c, dir, baseCellAngleRad * 0.25))
      controlFlows.unshift(controlFlows[0])
      controlFlows.push(controlFlows[0])
      for (let index = 0; index < regionControlIndex.length; index++)
        regionControlIndex[index]++
    }

    const isHeadwater = !fromLakeSpill && !extendedSingleRegion && upstreamRiverCount[sourceRegion] === 0
    const smoothed = catmullRomSmoothOpenPath(controlPoints, controlFlows, RIVER_CENTERLINE_SUBDIVISIONS)
    let distFromSourceRad = 0
    const halfWidthsRad = smoothed.scalars.map((flow, idx) => {
      if (idx > 0) {
        distFromSourceRad += sphericalAngleRad(smoothed.points[idx - 1], smoothed.points[idx])
      }
      const targetHalfWidth = halfWidthForFlow(flow)
      if (!isHeadwater)
        return targetHalfWidth
      const growth = smoothstep01(distFromSourceRad / (baseCellAngleRad * 2.5))
      return targetHalfWidth * (0.45 + 0.55 * growth)
    })

    // Estimate physical area (km^2) = R^2 * integral(2 * halfWidth * ds)
    let sphericalRibbonAreaSteradians = 0
    for (let i = 0; i < smoothed.points.length - 1; i++) {
      const ds = sphericalAngleRad(smoothed.points[i], smoothed.points[i + 1])
      const avgWidth = halfWidthsRad[i] + halfWidthsRad[i + 1]
      sphericalRibbonAreaSteradians += ds * avgWidth
    }
    const areaKm2 = sphericalRibbonAreaSteradians * planet.radiusKm * planet.radiusKm

    const ribbonRing = buildRibbonOuterRing(smoothed.points, halfWidthsRad)
    if (ribbonRing.length < 4)
      continue

    const polygonsCoords: (readonly (readonly LonLatTuple[])[])[] = [[ribbonRing]]

    // Add circular confluence cap at downstream junction or internal multi-tributary nodes
    const candidateConfluences = [...pathRegions]
    if (downstream >= 0 && downstream < count && riverIndexField.get(downstream) >= 0)
      candidateConfluences.push(downstream)

    for (const node of candidateConfluences) {
      if (upstreamRiverCount[node] >= 2 && !placedConfluenceCap.has(node)) {
        placedConfluenceCap.add(node)
        const center = regionCenter3D(node)
        const capRadius = halfWidthForFlow(flowField.get(node)) * 1.08
        const capRing = buildSphericalCapRing(center, capRadius, 12)
        if (capRing.length >= 4)
          polygonsCoords.push([capRing])
      }
    }

    const centerlineCoords = smoothed.points.map(pt => cartesianToLonLatDeg(pt[0], pt[1], pt[2]))
    const centerlineVertexIndex = regionControlIndex.map(index => index * RIVER_CENTERLINE_SUBDIVISIONS)
    const downstreamVertexIndex = downstreamControlIndex >= 0
      ? downstreamControlIndex * RIVER_CENTERLINE_SUBDIVISIONS
      : -1
    features.push({
      id: summary.id,
      strahlerOrder: summary.strahlerOrder,
      annualMeanDischargeM3s: summary.annualMeanDischargeM3s,
      endorheic: summary.endorheic,
      areaKm2,
      centerline3D: smoothed.points,
      centerlineCoords,
      regionIds: pathRegions,
      centerlineVertexIndex,
      downstreamRegionId,
      downstreamVertexIndex,
      polygonsCoords,
    })
  }

  return features
}
