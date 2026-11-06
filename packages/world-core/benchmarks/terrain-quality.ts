import type { SphericalMesh } from '../src/mesh/spherical-mesh'

/** O(N+E), offline diagnostic of geological protection, not final landforms. */
export function summarizeRoughnessProtection(mesh: SphericalMesh, elevationKm: Float32Array, weight: Float32Array) {
  let fullyProtectedLandAreaKm2 = 0
  let largestProtectedLandAreaKm2 = 0
  let protectedComponents = 0
  const visited = new Uint8Array(mesh.regionCount)
  const queue = new Uint32Array(mesh.regionCount)
  for (let root = 0; root < mesh.regionCount; root++) {
    if (visited[root] || elevationKm[root] <= 0 || weight[root] !== 0)
      continue
    protectedComponents++
    let area = 0
    let head = 0
    let tail = 1
    queue[0] = root
    visited[root] = 1
    while (head < tail) {
      const r = queue[head++]
      area += mesh.areaKm2[r]
      for (let n = mesh.neighborOffsets[r]; n < mesh.neighborOffsets[r + 1]; n++) {
        const other = mesh.neighbors[n]
        if (!visited[other] && elevationKm[other] > 0 && weight[other] === 0) {
          visited[other] = 1
          queue[tail++] = other
        }
      }
    }
    fullyProtectedLandAreaKm2 += area
    largestProtectedLandAreaKm2 = Math.max(largestProtectedLandAreaKm2, area)
  }
  return { fullyProtectedLandAreaKm2, largestProtectedLandAreaKm2, protectedComponents }
}

/** Offline only. Fixed diagnostic windows, not biome/landform thresholds.
 * Histograms/flood: O(N+E); weighted quantiles: O(N log N).
 * At most 32 deterministic land samples scan the grid: O(32N), no NxN table.
 * Samples with fewer than 4 land cells are reported as under-resolved.
 */
export function summarizeTerrain(mesh: SphericalMesh, elevationKm: Float32Array, candidateLandMask?: Uint8Array) {
  let landAreaKm2 = 0
  let landHeightIntegral = 0
  let adjacentDifferenceIntegral = 0
  let slopeIntegral = 0
  let totalAreaKm2 = 0
  // Diagnostic bins only; the adjacent-relief axis depends on mesh resolution.
  const elevationUpperBoundsKm = [0.05, 0.2, 0.5, 1, 2, 4]
  const adjacentReliefUpperBoundsKm = [0.025, 0.1, 0.3, 1]
  const elevationAreaKm2 = Array.from({ length: elevationUpperBoundsKm.length + 1 }, () => 0)
  const elevationByAdjacentReliefAreaKm2 = elevationAreaKm2.map(() => Array.from({ length: adjacentReliefUpperBoundsKm.length + 1 }, () => 0))
  const bin = (value: number, bounds: number[]) => {
    const index = bounds.findIndex(bound => value < bound)
    return index < 0 ? bounds.length : index
  }
  let candidateBelowSeaAreaKm2 = 0
  const land: number[] = []
  for (let r = 0; r < mesh.regionCount; r++) {
    totalAreaKm2 += mesh.areaKm2[r]
    if (candidateLandMask?.[r] && elevationKm[r] <= 0)
      candidateBelowSeaAreaKm2 += mesh.areaKm2[r]
    if (elevationKm[r] <= 0)
      continue
    land.push(r)
    const area = mesh.areaKm2[r]
    landAreaKm2 += area
    landHeightIntegral += elevationKm[r] * area
    let difference = 0
    let slope = 0
    for (let n = mesh.neighborOffsets[r]; n < mesh.neighborOffsets[r + 1]; n++) {
      const neighbor = mesh.neighbors[n]
      const delta = Math.abs(elevationKm[r] - elevationKm[neighbor])
      difference = Math.max(difference, delta)
      const km = mesh.edgeAngularDistances[mesh.neighborEdges[n]] * mesh.physicalRadiusKm
      if (km > 0)
        slope = Math.max(slope, Math.atan(delta / km))
    }
    adjacentDifferenceIntegral += difference * area
    slopeIntegral += slope * area
    const heightBin = bin(elevationKm[r], elevationUpperBoundsKm)
    elevationAreaKm2[heightBin] += area
    elevationByAdjacentReliefAreaKm2[heightBin][bin(difference, adjacentReliefUpperBoundsKm)] += area
  }
  // Reproduce the old fill eligibility for diagnosis, without changing terrain
  // or asserting that a below-sea depression contains water.
  let legacyFillEligibleAreaKm2: number | null = null
  if (candidateLandMask) {
    const reached = new Uint8Array(mesh.regionCount)
    const queue = new Uint32Array(mesh.regionCount)
    let head = 0
    let tail = 0
    for (let r = 0; r < mesh.regionCount; r++) {
      if (candidateLandMask[r] === 0) {
        reached[r] = 1
        queue[tail++] = r
      }
    }
    while (head < tail) {
      const r = queue[head++]
      for (let n = mesh.neighborOffsets[r]; n < mesh.neighborOffsets[r + 1]; n++) {
        const other = mesh.neighbors[n]
        if (!reached[other] && elevationKm[other] <= 0) {
          reached[other] = 1
          queue[tail++] = other
        }
      }
    }
    legacyFillEligibleAreaKm2 = 0
    for (let r = 0; r < mesh.regionCount; r++) {
      if (candidateLandMask[r] && !reached[r] && elevationKm[r] <= 0)
        legacyFillEligibleAreaKm2 += mesh.areaKm2[r]
    }
  }
  const orderedLand = land.slice().sort((a, b) => elevationKm[a] - elevationKm[b])
  const landElevationQuantilesKm = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map((q) => {
    if (orderedLand.length === 0)
      return { quantile: q, elevationKm: null }
    let cumulative = 0
    for (const r of orderedLand) {
      cumulative += mesh.areaKm2[r]
      if (cumulative >= q * landAreaKm2)
        return { quantile: q, elevationKm: elevationKm[r] }
    }
    return { quantile: q, elevationKm: elevationKm[orderedLand[orderedLand.length - 1]] }
  })
  const sampleCount = Math.min(32, land.length)
  const windows = [250, 500].map((radiusKm) => {
    const samples = []
    let underResolved = 0
    const cosine = Math.cos(Math.min(Math.PI, radiusKm / mesh.physicalRadiusKm))
    for (let sample = 0; sample < sampleCount; sample++) {
      const center = land[Math.floor(sample * land.length / sampleCount)]
      const heights = []
      for (const r of land) {
        const dot = mesh.centers[3 * center] * mesh.centers[3 * r]
          + mesh.centers[3 * center + 1] * mesh.centers[3 * r + 1]
          + mesh.centers[3 * center + 2] * mesh.centers[3 * r + 2]
        if (dot >= cosine)
          heights.push(elevationKm[r])
      }
      if (heights.length < 4) {
        underResolved++
        continue
      }
      heights.sort((a, b) => a - b)
      samples.push({ region: center, count: heights.length, p90MinusP10Km: heights[Math.floor((heights.length - 1) * 0.9)] - heights[Math.floor((heights.length - 1) * 0.1)] })
    }
    return { radiusKm, underResolved, samples }
  })
  return {
    landCoverage: landAreaKm2 / totalAreaKm2,
    landAreaKm2,
    candidateBelowSeaAreaKm2: candidateLandMask ? candidateBelowSeaAreaKm2 : null,
    legacyFillEligibleAreaKm2,
    landElevationQuantilesKm,
    elevationUpperBoundsKm,
    adjacentReliefUpperBoundsKm,
    elevationAreaKm2,
    elevationByAdjacentReliefAreaKm2,
    meanLandHeightKm: landAreaKm2 > 0 ? landHeightIntegral / landAreaKm2 : null,
    meanMaximumAdjacentDifferenceKm: landAreaKm2 > 0 ? adjacentDifferenceIntegral / landAreaKm2 : null,
    meanMaximumSlopeRadians: landAreaKm2 > 0 ? slopeIntegral / landAreaKm2 : null,
    windows,
  }
}
