import type { AlgorithmMesh } from '#generation/nature/common/algorithm-mesh'
import { expect, it } from 'vitest'
import { TerrainFinalizer } from './terrain-finalizer'

it('restores reference hypsometry and fills sub-threshold negative water components', () => {
  const mesh = {
    numRegions: 5,
    regionArea: new Float64Array(5).fill(0.000001),
    forEachNeighborOfRegion(region: number) {
      return region === 0 ? [1] : region === 1 ? [0, 2] : region === 2 ? [1, 3] : region === 3 ? [2, 4] : [3]
    },
  } as unknown as AlgorithmMesh
  const input = new Float32Array([-0.4, 0.1, -0.1, 0.8, 0.4])
  const original = input.slice()
  const result = new TerrainFinalizer().generate(mesh, input)
  expect(input).toEqual(original)
  expect(result.elevation[0]).toBeCloseTo(0.005)
  expect(result.fields.topologyChanged[0]).toBe(1)
  expect(result.elevation[2]).toBeCloseTo(0.005)
  expect(result.fields.topologyChanged[2]).toBe(1)
  expect(result.landMask[2]).toBe(1)
  expect(result.elevation[3]).toBeGreaterThan(result.elevation[4])
  expect(result.fields.shapingDelta.some(v => v !== 0)).toBe(true)
})

it('breaches enclosed coastal fills to the ocean while leaving natural inland basins untouched', () => {
  // 0: large open ocean, 1: coastal ridge, 2-3: sub-sea coastal pocket, 4: high rim, 5: natural inland pit, 6: inland rim
  const areas = Float64Array.from([0.1, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6])
  const mesh = {
    numRegions: 7,
    regionArea: areas,
    forEachNeighborOfRegion(region: number) {
      if (region === 0)
        return [1]
      if (region === 6)
        return [5]
      return [region - 1, region + 1]
    },
  } as unknown as AlgorithmMesh
  const elevation = Float32Array.from([-0.5, 0.04, -0.02, -0.01, 0.3, 0.15, 0.35])
  const before = elevation.slice()
  const topologyDelta = new Float32Array(7)
  const topologyChanged = new Uint8Array(7)

  new TerrainFinalizer().repairSeaConnectivity(mesh, elevation, topologyDelta, topologyChanged)

  expect(elevation[0]).toBe(-0.5)
  expect(topologyChanged[2]).toBe(1)
  expect(topologyChanged[3]).toBe(1)
  // Breached coastal sill and repaired pocket form a strictly rising land ramp from the ocean.
  expect(elevation[1]).toBeGreaterThan(0)
  expect(elevation[1]).toBeLessThan(before[1])
  expect(elevation[2]).toBeGreaterThan(elevation[1])
  expect(elevation[3]).toBeGreaterThan(elevation[2])
  // Unrelated inland depression (region 5 between rims 4 and 6) is untouched.
  expect(elevation[4]).toBe(before[4])
  expect(elevation[5]).toBe(before[5])
  expect(elevation[6]).toBe(before[6])
  for (let region = 0; region < elevation.length; region++)
    expect(topologyDelta[region]).toBeCloseTo(elevation[region] - before[region], 6)
})
