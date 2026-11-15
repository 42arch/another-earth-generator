import type { ClimateMesh } from './climate-mesh'
import { describe, expect, it } from 'vitest'
import { transportOceanWarmth } from './ocean-heat-transport'

describe('ocean warmth transport', () => {
  it('carries an anomaly downstream, reverses with the current, and stops at land', () => {
    const longitude = Float32Array.of(-0.1, 0, 0.1)
    const x = longitude.map(Math.sin)
    const z = longitude.map(Math.cos)
    const mesh: ClimateMesh = {
      numRegions: 3,
      regionPosition: Float32Array.from(Array.from(longitude).flatMap((_, r) => [x[r], 0, z[r]])),
      regionLatitude: new Float32Array(3),
      regionLongitude: longitude,
      regionArea: Float64Array.of(1, 1, 1),
      neighborOffsets: Uint32Array.of(0, 1, 3, 4),
      neighbors: Uint32Array.of(1, 0, 2, 1),
      neighborDx: Float32Array.of(x[0] - x[1], x[1] - x[0], x[1] - x[2], x[2] - x[1]),
      neighborDy: new Float32Array(4),
      neighborDz: Float32Array.of(z[0] - z[1], z[1] - z[0], z[1] - z[2], z[2] - z[1]),
      physicalRadiusKm: 6371,
    }
    const ocean = Uint8Array.of(1, 1, 1)
    const zero = new Float32Array(3)
    const eastward = Float32Array.of(0, 1, 0)
    const westward = new Float32Array(eastward)
    transportOceanWarmth(mesh, ocean, new Float32Array(3).fill(1), zero, eastward, 10)
    transportOceanWarmth(mesh, ocean, new Float32Array(3).fill(-1), zero, westward, 10)
    expect(eastward[2]).toBeGreaterThan(0)
    expect(eastward[0]).toBe(0)
    expect(westward[0]).toBeCloseTo(eastward[2])
    expect(westward[2]).toBe(0)
    expect([...eastward, ...westward].every(value => value >= 0 && value <= 1)).toBe(true)
    const blocked = Float32Array.of(1, 0, 0)
    transportOceanWarmth(mesh, Uint8Array.of(1, 0, 1), new Float32Array(3).fill(1), zero, blocked, 10)
    expect(blocked).toEqual(Float32Array.of(1, 0, 0))
  })
})
