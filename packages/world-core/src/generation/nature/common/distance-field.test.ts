import type { AlgorithmMesh } from './algorithm-mesh'
import { describe, expect, it } from 'vitest'
import { computeSphericalDistanceField, computeSphericalInfluenceField, computeSphericalNearestLabels } from './distance-field'

describe('float32 graph propagation', () => {
  it.each(['distance', 'labels', 'influence'])('does not requeue an unchanged stored cost in %s propagation', (kind) => {
    // Two equal-cost paths meet at 3. A double candidate can be smaller than
    // the stored Float32 while rounding back to exactly the same value.
    let edgeReads = 0
    const distances = new Float64Array(5).fill(0.1)
    const mesh = {
      numRegions: 5,
      neighborOffsets: new Uint32Array([0, 2, 3, 4, 5, 5]),
      neighbors: new Uint32Array([1, 2, 3, 3, 4]),
      neighborDistances: new Proxy(distances, { get(target, key) {
        if (typeof key === 'string' && /^\d+$/.test(key))
          edgeReads++
        return Reflect.get(target, key, target)
      } }),
    } as AlgorithmMesh
    if (kind === 'distance') {
      const result = computeSphericalDistanceField(mesh, r => r === 0)
      expect(result).toEqual(new Float32Array([0, 0.1, 0.1, 0.2, 0.3]))
    }
    else if (kind === 'labels') {
      expect(computeSphericalNearestLabels(mesh, new Int16Array([7, -1, -1, -1, -1]))).toEqual(new Int16Array(5).fill(7))
    }
    else {
      const result = computeSphericalInfluenceField(mesh, r => r === 0 ? 1 : 0, 1)
      expect(result[4]).toBeCloseTo(Math.exp(-0.3), 6)
    }
    expect(edgeReads).toBe(5)
  })
})
