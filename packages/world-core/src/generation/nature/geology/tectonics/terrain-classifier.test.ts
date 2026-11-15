import { describe, expect, it } from 'vitest'
import { surfaceRoughnessWeight } from './terrain-classifier'

describe('geological surface roughness weight', () => {
  it('protects both quiet basins and quiet cratons while releasing active terrain', () => {
    expect(surfaceRoughnessWeight(0, 0.7, 0.3, 0.1)).toBe(0)
    expect(surfaceRoughnessWeight(0, 0.3, 0.7, 0.1)).toBe(0)
    expect(surfaceRoughnessWeight(0.25, 0.7, 0.3, 0.1)).toBe(1)
    expect(surfaceRoughnessWeight(0, 0.7, 0.3, 0.9)).toBe(1)
  })

  it('has bounded smooth transitions and broad protected cores without a plain-area quota', () => {
    const weights = Array.from({ length: 101 }, (_, i) => surfaceRoughnessWeight(0, 0.6, 0.4, i / 100))
    expect(weights.slice(0, 20).every(v => v === 0)).toBe(true)
    expect(weights.slice(80).every(v => v === 1)).toBe(true)
    expect(weights.some(v => v > 0 && v < 1)).toBe(true)
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]).toBeGreaterThanOrEqual(weights[i - 1])
      expect(weights[i] - weights[i - 1]).toBeLessThan(0.06)
    }
  })
})
