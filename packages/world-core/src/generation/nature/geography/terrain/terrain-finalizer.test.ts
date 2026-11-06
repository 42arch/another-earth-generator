import type { AlgorithmMesh } from '#generation/nature/common/algorithm-mesh'
import { expect, it } from 'vitest'
import { TerrainFinalizer } from './terrain-finalizer'

it('restores reference hypsometry and fills land-enclosed negative cells', () => {
  const mesh = {
    numRegions: 5,
    forEachNeighborOfRegion(region: number) {
      return region === 0 ? [1] : region === 1 ? [0, 2] : region === 2 ? [1, 3] : region === 3 ? [2, 4] : [3]
    },
  } as AlgorithmMesh
  const input = new Float32Array([-0.4, 0.1, -0.1, 0.8, 0.4])
  const original = input.slice()
  const result = new TerrainFinalizer().generate(mesh, input, new Uint8Array([0, 1, 1, 1, 1]))
  expect(input).toEqual(original)
  expect(result.elevation[2]).toBeCloseTo(0.005)
  expect(result.fields.topologyChanged[2]).toBe(1)
  expect(result.landMask[2]).toBe(1)
  expect(result.elevation[3]).toBeGreaterThan(result.elevation[4])
  expect(result.fields.shapingDelta.some(v => v !== 0)).toBe(true)
})
