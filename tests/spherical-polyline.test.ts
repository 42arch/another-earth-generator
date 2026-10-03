import type { SphericalPoint } from '@/core/math/polyline'
import { describe, expect, it } from 'vitest'
import {
  createSmoothSphericalLinePositions,
  stitchSphericalSegments,
} from '@/core/math/polyline'

describe('spherical polyline smoothing', () => {
  it('stitches a closed boundary and keeps every sampled point on its sphere', () => {
    const points = new Map<string, SphericalPoint>([
      ['a', [1, 0, 0]],
      ['b', [0, 1, 0]],
      ['c', [-1, 0, 0]],
      ['d', [0, -1, 0]],
    ])
    const paths = stitchSphericalSegments([
      { start: 'a', end: 'b' },
      { start: 'c', end: 'd' },
      { start: 'b', end: 'c' },
      { start: 'd', end: 'a' },
    ], points)

    expect(paths).toHaveLength(1)
    expect(paths[0].closed).toBe(true)
    expect(paths[0].points).toHaveLength(4)

    const radius = 100.18
    const positions = createSmoothSphericalLinePositions(paths, radius, 0.7, 3)
    expect(positions.length).toBe(4 * 3 * 2 * 3)
    for (let index = 0; index < positions.length; index += 3) {
      expect(Math.hypot(
        positions[index],
        positions[index + 1],
        positions[index + 2],
      )).toBeCloseTo(radius, 4)
    }
  })
})
