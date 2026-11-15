import type { SphericalMesh } from '#mesh/spherical-mesh'
import { expect, it } from 'vitest'
import { summarizeHypsometry } from '../../../../../benchmarks/terrain-hypsometry-summary'
import { summarizeRoughnessProtection, summarizeTerrain } from '../../../../../benchmarks/terrain-quality'

it('accounts for area in elevation/relief bins and reports unfilled candidate depressions', () => {
  const mesh = {
    regionCount: 3,
    physicalRadiusKm: 6371,
    areaKm2: new Float64Array([1, 3, 2]),
    centers: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    neighborOffsets: new Uint32Array([0, 1, 3, 4]),
    neighbors: new Uint32Array([1, 0, 2, 1]),
    neighborEdges: new Uint32Array([0, 0, 1, 1]),
    edgeAngularDistances: new Float64Array([0.1, 0.1]),
  } as SphericalMesh
  const height = new Float32Array([0.01, 0.5, -0.2])
  const protection = summarizeRoughnessProtection(mesh, height, new Float32Array([0, 0, 0]))
  expect(protection.fullyProtectedLandAreaKm2).toBe(4)
  expect(protection.largestProtectedLandAreaKm2).toBe(4)
  expect(protection.protectedComponents).toBe(1)
  expect(summarizeRoughnessProtection(mesh, height, new Float32Array([0, 1, 0])).fullyProtectedLandAreaKm2).toBe(1)
  const before = height.slice()
  const summary = summarizeTerrain(mesh, height, new Uint8Array([1, 1, 1]))
  expect(summary.landAreaKm2).toBe(4)
  expect(summary.landCoverage).toBeCloseTo(2 / 3)
  expect(summary.candidateBelowSeaAreaKm2).toBe(2)
  expect(summary.legacyFillEligibleAreaKm2).toBe(2)
  expect(summary.elevationAreaKm2[0]).toBe(1)
  expect(summary.elevationAreaKm2[3]).toBe(3)
  expect(summary.elevationByAdjacentReliefAreaKm2.flat().reduce((a, b) => a + b, 0)).toBe(4)
  expect(summary.landElevationQuantilesKm.find(q => q.quantile === 0.5)?.elevationKm).toBe(0.5)
  expect(summary.windows.every(window => window.underResolved === 2)).toBe(true)
  expect(height).toEqual(before)
  expect(summarizeTerrain(mesh, height, new Uint8Array([1, 1, 0])).legacyFillEligibleAreaKm2).toBe(0)
  const ocean = summarizeTerrain(mesh, new Float32Array([-1, -2, -3]))
  expect(ocean.landAreaKm2).toBe(0)
  expect(ocean.meanLandHeightKm).toBeNull()
  const bands = summarizeHypsometry(mesh, new Float32Array([0.2, 3, -5]))
  expect(bands.landAreaPct).toBeCloseTo(200 / 3)
  expect(bands.landUnder03Pct).toBe(25)
  expect(bands.landOver25Pct).toBe(75)
  expect(bands.oceanOver4KmDepthPct).toBe(100)
  expect(bands.minimumElevationKm).toBe(-5)
  expect(() => summarizeHypsometry(mesh, new Float32Array(1))).toThrow('mesh mismatch')
  expect(() => summarizeHypsometry(mesh, new Float32Array([-1, -2, -3]))).toThrow('both land and ocean')
})
