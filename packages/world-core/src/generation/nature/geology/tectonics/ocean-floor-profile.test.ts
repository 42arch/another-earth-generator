import type { AlgorithmMesh } from '#generation/nature/common/algorithm-mesh'
import { referenceCellsToAngle } from '#generation/nature/common/distance-field'
import { expect, it } from 'vitest'
import { blendOceanFloorBase, oceanBoundaryRelief, oceanFloorBase, oceanShelfWidth } from './tectonic-elevation-generator'

it('changes shelf width continuously at the end of active-margin influence', () => {
  const active = oceanShelfWidth(0)
  const passive = oceanShelfWidth(Infinity)
  expect(active).toBeCloseTo(referenceCellsToAngle(2))
  expect(passive).toBeCloseTo(referenceCellsToAngle(5))

  const edge = referenceCellsToAngle(5)
  const epsilon = referenceCellsToAngle(0.001)
  const coastDistance = referenceCellsToAngle(5)
  const inside = oceanFloorBase(coastDistance, oceanShelfWidth(edge - epsilon), 0.4)
  const outside = oceanFloorBase(coastDistance, oceanShelfWidth(edge + epsilon), 0.4)
  expect(Math.abs(outside - inside)).toBeLessThan(1e-4)
})

it('fades abyssal texture in without a depth step after the continental slope', () => {
  const shelf = oceanShelfWidth(Infinity)
  const edge = shelf + referenceCellsToAngle(3.5)
  const epsilon = referenceCellsToAngle(0.001)
  const before = oceanFloorBase(edge - epsilon, shelf, 0.4)
  const after = oceanFloorBase(edge + epsilon, shelf, 0.4)
  expect(Math.abs(after - before)).toBeLessThan(1e-4)
  expect(oceanFloorBase(edge + referenceCellsToAngle(1), shelf, 0.4))
    .toBeGreaterThan(oceanFloorBase(edge + referenceCellsToAngle(1), shelf, 0))
})

it('retains deep-basin relief and rounds only the crossing of ocean backgrounds', () => {
  expect(blendOceanFloorBase(-0.6, -0.35)).toBe(-0.6)
  expect(blendOceanFloorBase(-0.2, -0.35)).toBe(-0.35)
  expect(blendOceanFloorBase(-0.35, -0.35)).toBeCloseTo(-0.36)
  const epsilon = 1e-6
  const center = blendOceanFloorBase(-0.35, -0.35)
  const leftSlope = (center - blendOceanFloorBase(-0.35 - epsilon, -0.35)) / epsilon
  const rightSlope = (blendOceanFloorBase(-0.35 + epsilon, -0.35) - center) / epsilon
  expect(leftSlope).toBeCloseTo(rightSlope, 3)
  expect(leftSlope).toBeCloseTo(0.5, 3)
  for (const base of [-0.6, -0.37, -0.35, -0.33, -0.2]) {
    expect(blendOceanFloorBase(base, -0.35)).toBeCloseTo(blendOceanFloorBase(-0.35, base), 10)
    expect(Math.min(base, -0.35) - blendOceanFloorBase(base, -0.35)).toBeLessThanOrEqual(0.010001)
  }
})

it('softens only short oceanic plate contacts without blending land or remote plate interiors', () => {
  const mesh = {
    numRegions: 2,
    physicalRadiusKm: 6371,
    neighborOffsets: new Uint32Array([0, 1, 2]),
    neighbors: new Uint32Array([1, 0]),
    neighborDistances: new Float64Array(2).fill(20 / 6371),
  } as AlgorithmMesh
  const fields = {
    subductingInfluence: new Float32Array([1, 0]),
    overridingInfluence: new Float32Array([0, 1]),
  }
  const plate = new Int16Array([0, 1])
  const ocean = new Uint8Array(2)
  const original = structuredClone(fields)
  const lower = oceanBoundaryRelief(0, mesh, fields, plate, ocean)
  const upper = oceanBoundaryRelief(1, mesh, fields, plate, ocean)
  expect(lower).toBeGreaterThan(-0.27)
  expect(upper).toBeLessThan(0.11)
  expect(upper - lower).toBeLessThan(0.38)
  expect(lower).toBeLessThan(upper)
  expect(oceanBoundaryRelief(0, mesh, fields, new Int16Array(2), ocean)).toBe(-0.27)
  expect(oceanBoundaryRelief(0, mesh, fields, plate, new Uint8Array([0, 1]))).toBe(-0.27)
  const distant = { ...mesh, neighborDistances: new Float64Array(2).fill(121 / 6371) }
  expect(oceanBoundaryRelief(0, distant, fields, plate, ocean)).toBe(-0.27)
  expect(fields).toEqual(original)
})
