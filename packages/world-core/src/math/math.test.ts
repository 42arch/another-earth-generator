import { describe, expect, it } from 'vitest'
import { clamp, gaussian, smoothstep } from './math'

describe('math utilities', () => {
  describe('clamp', () => {
    it('restricts values within specified [min, max] bounds', () => {
      expect(clamp(0.5, 0, 1)).toBe(0.5)
      expect(clamp(-5, 0, 1)).toBe(0)
      expect(clamp(15, 0, 1)).toBe(1)
      expect(clamp(0, 0, 1)).toBe(0)
      expect(clamp(1, 0, 1)).toBe(1)
    })

    it('handles negative ranges and boundary equality', () => {
      expect(clamp(-0.8, -0.75, 1.2)).toBe(-0.75)
      expect(clamp(1.5, -0.75, 1.2)).toBe(1.2)
      expect(clamp(5, 2, 2)).toBe(2)
    })
  })

  describe('smoothstep', () => {
    it('returns 0 when value is below or at edge0, and 1 when value is at or above edge1', () => {
      expect(smoothstep(0, 1, -1)).toBe(0)
      expect(smoothstep(0, 1, 0)).toBe(0)
      expect(smoothstep(0, 1, 1)).toBe(1)
      expect(smoothstep(0, 1, 2)).toBe(1)
    })

    it('smoothly interpolates using cubic Hermite polynomial', () => {
      expect(smoothstep(0, 1, 0.5)).toBe(0.5)
      expect(smoothstep(10, 20, 15)).toBe(0.5)
      // Strictly monotonic inside the range
      expect(smoothstep(0, 1, 0.25)).toBeLessThan(smoothstep(0, 1, 0.5))
      expect(smoothstep(0, 1, 0.5)).toBeLessThan(smoothstep(0, 1, 0.75))
    })

    it('handles degenerate edges where edge0 === edge1', () => {
      expect(smoothstep(5, 5, 4.9)).toBe(0)
      expect(smoothstep(5, 5, 5)).toBe(1)
      expect(smoothstep(5, 5, 5.1)).toBe(1)
    })
  })

  describe('gaussian', () => {
    it('returns 1 at distance 0 and decays symmetrically', () => {
      expect(gaussian(0, 10)).toBe(1)
      expect(gaussian(10, 10)).toBeCloseTo(Math.exp(-0.5))
      expect(gaussian(-10, 10)).toBeCloseTo(Math.exp(-0.5))
    })

    it('handles non-finite distance gracefully', () => {
      expect(gaussian(Number.NaN, 10)).toBe(0)
      expect(gaussian(Number.POSITIVE_INFINITY, 10)).toBe(0)
      expect(gaussian(Number.NEGATIVE_INFINITY, 10)).toBe(0)
    })

    it('protects against division by zero when width is 0 or negative', () => {
      expect(gaussian(0, 0)).toBe(1)
      expect(gaussian(1, 0)).toBe(0)
      expect(gaussian(1, -5)).toBe(0)
    })
  })
})

