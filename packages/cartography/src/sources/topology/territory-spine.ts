import type { LonLatTuple, Vec3Tuple } from '#projections/spherical-math'
import type { TerritorySpineMetadata } from '#sources/types'
import type { MapMeshReader } from '@another-earth/world-core'
import {
  buildTangentBasis,
  cartesianToLonLatDeg,
  dotVec3,
  normalizeVec3,
  sphericalAngleRad,
} from '#projections/spherical-math'
import { evaluateSphericalCatmullRomWithTangent } from './spherical-smooth'

export const SPINE_ELONGATION_THRESHOLD = 1.35

export interface TerritoryInput {
  readonly featureId: string
  readonly displayName: string
  readonly kind: 'continent' | 'ocean'
  readonly areaKm2: number
  readonly memberRegions: readonly number[]
}

/**
 * Finds an interior member cell maximizing distance from exterior non-member neighbors
 * (discrete spherical Pole of Inaccessibility) blended with closeness to the area-weighted centroid.
 * Never returns a region outside `memberRegions`.
 */
export function selectInteriorAnchorRegion(
  mesh: MapMeshReader,
  memberRegions: readonly number[],
  memberSet: ReadonlySet<number>,
  weightedCentroid: Vec3Tuple,
): number {
  if (memberRegions.length === 0)
    throw new Error('Cannot select anchor for empty territory')
  if (memberRegions.length === 1)
    return memberRegions[0]

  // Multi-source BFS hop-depth from territory boundary
  const depthByRegion = new Map<number, number>()
  const queue: number[] = []
  for (const r of memberRegions) {
    let isBoundary = false
    mesh.forEachRegionNeighbor(r, (nb) => {
      if (!memberSet.has(nb))
        isBoundary = true
    })
    if (isBoundary) {
      depthByRegion.set(r, 0)
      queue.push(r)
    }
  }

  let head = 0
  let maxDepth = 0
  while (head < queue.length) {
    const current = queue[head++]
    const nextDepth = (depthByRegion.get(current) ?? 0) + 1
    mesh.forEachRegionNeighbor(current, (nb) => {
      if (memberSet.has(nb) && !depthByRegion.has(nb)) {
        depthByRegion.set(nb, nextDepth)
        if (nextDepth > maxDepth)
          maxDepth = nextDepth
        queue.push(nb)
      }
    })
  }

  const centerOut = { x: 0, y: 0, z: 0 }
  let bestRegion = memberRegions[0]
  let bestScore = -Infinity

  for (const r of memberRegions) {
    mesh.getRegionCenter(r, centerOut)
    const pt = normalizeVec3(centerOut.x, centerOut.y, centerOut.z)
    const centroidAlignment = dotVec3(pt, weightedCentroid)
    const normalizedDepth = maxDepth > 0 ? (depthByRegion.get(r) ?? maxDepth) / maxDepth : 1
    const score = normalizedDepth * 0.55 + centroidAlignment * 0.45
    if (score > bestScore) {
      bestScore = score
      bestRegion = r
    }
  }

  return bestRegion
}

/**
 * Computes area-weighted tangent-plane PCA for a named geographic territory.
 * When `elongation >= 1.35`, extracts 3–5 spherical spline control points (`spinePoints`);
 * otherwise falls back to an interior point anchor (`spinePoints: []`).
 */
export function computeTerritorySpine(
  mesh: MapMeshReader,
  territory: TerritoryInput,
): TerritorySpineMetadata {
  const { memberRegions } = territory
  if (memberRegions.length === 0)
    throw new Error(`Territory ${territory.featureId} has no member regions`)

  const memberSet = new Set(memberRegions)
  const centerOut = { x: 0, y: 0, z: 0 }
  let sumX = 0
  let sumY = 0
  let sumZ = 0
  let totalArea = 0
  let largestRegion = memberRegions[0]
  let largestArea = -1

  for (const r of memberRegions) {
    const area = Math.max(1e-6, mesh.getRegionAreaKm2(r))
    mesh.getRegionCenter(r, centerOut)
    sumX += centerOut.x * area
    sumY += centerOut.y * area
    sumZ += centerOut.z * area
    totalArea += area
    if (area > largestArea) {
      largestArea = area
      largestRegion = r
    }
  }

  let centroid: Vec3Tuple
  if (Math.hypot(sumX, sumY, sumZ) > 1e-6) {
    centroid = normalizeVec3(sumX, sumY, sumZ)
  }
  else {
    mesh.getRegionCenter(largestRegion, centerOut)
    centroid = normalizeVec3(centerOut.x, centerOut.y, centerOut.z)
  }

  const anchorRegion = selectInteriorAnchorRegion(mesh, memberRegions, memberSet, centroid)
  mesh.getRegionCenter(anchorRegion, centerOut)
  const anchorPosition = normalizeVec3(centerOut.x, centerOut.y, centerOut.z)
  const anchorCoordinates = cartesianToLonLatDeg(anchorPosition[0], anchorPosition[1], anchorPosition[2])

  const { east, north } = buildTangentBasis(centroid)
  const uCoords = new Float64Array(memberRegions.length)
  const vCoords = new Float64Array(memberRegions.length)
  const weights = new Float64Array(memberRegions.length)
  let meanU = 0
  let meanV = 0

  for (let i = 0; i < memberRegions.length; i++) {
    const r = memberRegions[i]
    const w = Math.max(1e-6, mesh.getRegionAreaKm2(r))
    mesh.getRegionCenter(r, centerOut)
    const dx = centerOut.x - centroid[0]
    const dy = centerOut.y - centroid[1]
    const dz = centerOut.z - centroid[2]
    const u = dx * east[0] + dy * east[1] + dz * east[2]
    const v = dx * north[0] + dy * north[1] + dz * north[2]
    uCoords[i] = u
    vCoords[i] = v
    weights[i] = w
    meanU += u * w
    meanV += v * w
  }
  meanU /= totalArea
  meanV /= totalArea

  let covUU = 0
  let covVV = 0
  let covUV = 0
  for (let i = 0; i < memberRegions.length; i++) {
    const du = uCoords[i] - meanU
    const dv = vCoords[i] - meanV
    const w = weights[i]
    covUU += w * du * du
    covVV += w * dv * dv
    covUV += w * du * dv
  }
  covUU /= totalArea
  covVV /= totalArea
  covUV /= totalArea

  const trace = covUU + covVV
  const det = covUU * covVV - covUV * covUV
  const discr = Math.sqrt(Math.max(0, trace * trace * 0.25 - det))
  const lambda1 = Math.max(1e-10, trace * 0.5 + discr)
  const lambda2 = Math.max(1e-10, trace * 0.5 - discr)
  const elongation = Math.sqrt(lambda1 / lambda2)

  if (memberRegions.length < 4 || elongation < SPINE_ELONGATION_THRESHOLD) {
    return Object.freeze({
      featureId: territory.featureId,
      displayName: territory.displayName,
      kind: territory.kind,
      areaKm2: territory.areaKm2,
      anchorRegion,
      anchorPosition,
      anchorCoordinates,
      elongation,
      isCurved: false,
      spinePoints: Object.freeze([]),
      spineCoordinates: Object.freeze([]),
    })
  }

  let axisU = 1
  let axisV = 0
  if (Math.abs(covUV) > 1e-9) {
    axisU = lambda1 - covVV
    axisV = covUV
  }
  else if (covVV > covUU) {
    axisU = 0
    axisV = 1
  }
  const axisLen = Math.hypot(axisU, axisV) || 1
  axisU /= axisLen
  axisV /= axisLen

  // Orient principal axis generally West -> East (left-to-right reading order)
  if (axisU < -0.15 || (Math.abs(axisU) <= 0.15 && axisV < 0)) {
    axisU = -axisU
    axisV = -axisV
  }

  const projections = new Float64Array(memberRegions.length)
  let sMin = Infinity
  let sMax = -Infinity
  for (let i = 0; i < memberRegions.length; i++) {
    const s = (uCoords[i] - meanU) * axisU + (vCoords[i] - meanV) * axisV
    projections[i] = s
    if (s < sMin)
      sMin = s
    if (s > sMax)
      sMax = s
  }

  const span = sMax - sMin
  if (span < 0.08) {
    return Object.freeze({
      featureId: territory.featureId,
      displayName: territory.displayName,
      kind: territory.kind,
      areaKm2: territory.areaKm2,
      anchorRegion,
      anchorPosition,
      anchorCoordinates,
      elongation,
      isCurved: false,
      spinePoints: Object.freeze([]),
      spineCoordinates: Object.freeze([]),
    })
  }

  const sliceCount = 5
  const sliceStep = span / sliceCount
  const spinePoints: Vec3Tuple[] = []

  for (let sIdx = 0; sIdx < sliceCount; sIdx++) {
    const sStart = sMin + sIdx * sliceStep
    const sEnd = sStart + sliceStep
    let sx = 0
    let sy = 0
    let sz = 0
    let sw = 0
    for (let i = 0; i < memberRegions.length; i++) {
      const s = projections[i]
      if (s >= sStart && (s < sEnd || (sIdx === sliceCount - 1 && s <= sEnd + 1e-9))) {
        const r = memberRegions[i]
        const w = weights[i]
        mesh.getRegionCenter(r, centerOut)
        sx += centerOut.x * w
        sy += centerOut.y * w
        sz += centerOut.z * w
        sw += w
      }
    }
    if (sw > 0 && Math.hypot(sx, sy, sz) > 1e-6) {
      const sliceCentroid = normalizeVec3(sx, sy, sz)
      // Snap slice control point to the closest member cell so spine stays strictly inside the territory
      let bestMember = anchorRegion
      let bestDot = -Infinity
      for (const r of memberRegions) {
        mesh.getRegionCenter(r, centerOut)
        const d = centerOut.x * sliceCentroid[0] + centerOut.y * sliceCentroid[1] + centerOut.z * sliceCentroid[2]
        if (d > bestDot) {
          bestDot = d
          bestMember = r
        }
      }
      mesh.getRegionCenter(bestMember, centerOut)
      const snapped = normalizeVec3(centerOut.x, centerOut.y, centerOut.z)
      // Blend 65% slice centroid + 35% interior member cell for smooth curve that respects concave shapes
      const blended = normalizeVec3(
        sliceCentroid[0] * 0.65 + snapped[0] * 0.35,
        sliceCentroid[1] * 0.65 + snapped[1] * 0.35,
        sliceCentroid[2] * 0.65 + snapped[2] * 0.35,
      )
      const prev = spinePoints.at(-1)
      if (!prev || sphericalAngleRad(prev, blended) > 1e-4)
        spinePoints.push(blended)
    }
  }

  if (spinePoints.length < 3) {
    return Object.freeze({
      featureId: territory.featureId,
      displayName: territory.displayName,
      kind: territory.kind,
      areaKm2: territory.areaKm2,
      anchorRegion,
      anchorPosition,
      anchorCoordinates,
      elongation,
      isCurved: false,
      spinePoints: Object.freeze([]),
      spineCoordinates: Object.freeze([]),
    })
  }

  const spineCoordinates = spinePoints.map(pt => cartesianToLonLatDeg(pt[0], pt[1], pt[2]))
  return Object.freeze({
    featureId: territory.featureId,
    displayName: territory.displayName,
    kind: territory.kind,
    areaKm2: territory.areaKm2,
    anchorRegion,
    anchorPosition,
    anchorCoordinates,
    elongation,
    isCurved: true,
    spinePoints: Object.freeze(spinePoints),
    spineCoordinates: Object.freeze(spineCoordinates),
  })
}

export interface SampledSpineGlyphAnchor {
  readonly char: string
  readonly index: number
  readonly position: Vec3Tuple
  readonly tangent: Vec3Tuple
  readonly coordinates: LonLatTuple
}

export interface SampleSpineGlyphOptions {
  /**
   * Desired spherical angular step (radians) between adjacent glyph centers.
   * When omitted, defaults to `0.036` radians (`~2.06°`).
   */
  readonly glyphStepRad?: number
}

/**
 * Samples evenly spaced glyph anchors along a territory's `spinePoints` spline,
 * automatically reversing character order when `viewRightVector` indicates upside-down/right-to-left orientation
 * so Chinese text always reads left-to-right.
 */
export function sampleSpineGlyphAnchors(
  spine: TerritorySpineMetadata,
  text: string = spine.displayName,
  viewRightVector?: Vec3Tuple,
  options: SampleSpineGlyphOptions = {},
): SampledSpineGlyphAnchor[] {
  const chars = Array.from(text)
  if (chars.length === 0)
    return []

  const stepRad = Math.max(0.008, options.glyphStepRad ?? 0.036)

  if (!spine.isCurved || spine.spinePoints.length < 3) {
    const { east } = buildTangentBasis(spine.anchorPosition)
    return [{
      char: text,
      index: 0,
      position: spine.anchorPosition,
      tangent: east,
      coordinates: spine.anchorCoordinates,
    }]
  }

  const startPoint = spine.spinePoints[0]
  const endPoint = spine.spinePoints.at(-1)!
  const chord: Vec3Tuple = [
    endPoint[0] - startPoint[0],
    endPoint[1] - startPoint[1],
    endPoint[2] - startPoint[2],
  ]
  const referenceRight = viewRightVector ?? buildTangentBasis(spine.anchorPosition).east
  const shouldReverse = dotVec3(chord, referenceRight) < 0

  let totalSpineArcRad = 0
  for (let i = 0; i < spine.spinePoints.length - 1; i++) {
    totalSpineArcRad += sphericalAngleRad(spine.spinePoints[i], spine.spinePoints[i + 1])
  }

  const count = chars.length
  const desiredSpanRad = Math.max(stepRad, (count - 1) * stepRad)
  const uSpan = totalSpineArcRad > 1e-4
    ? Math.min(0.72, Math.max(0.12, desiredSpanRad / totalSpineArcRad))
    : 0.5
  const uStart = 0.5 - uSpan * 0.5
  const uEnd = 0.5 + uSpan * 0.5
  const out: SampledSpineGlyphAnchor[] = []

  for (let i = 0; i < count; i++) {
    const rawT = count > 1 ? uStart + (i / (count - 1)) * (uEnd - uStart) : 0.5
    const u = shouldReverse ? 1 - rawT : rawT
    const { position, tangent } = evaluateSphericalCatmullRomWithTangent(spine.spinePoints, u)
    const orientedTangent: Vec3Tuple = shouldReverse
      ? [-tangent[0], -tangent[1], -tangent[2]]
      : tangent
    out.push({
      char: chars[i],
      index: i,
      position,
      tangent: orientedTangent,
      coordinates: cartesianToLonLatDeg(position[0], position[1], position[2]),
    })
  }

  return out
}
