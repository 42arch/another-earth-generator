import { describe, expect, it } from 'vitest'
import { classifyKoppenSeries, KOPPEN_CODES } from '@/core/climate/koppen-climate-classifier'

function classify(temperature: number[], precipitation: number[], southern = false): string {
  return KOPPEN_CODES[classifyKoppenSeries(temperature, precipitation, southern)]
}

describe('monthly Köppen–Geiger classification', () => {
  it('distinguishes tropical rainforest and monsoon rainfall', () => {
    expect(classify(Array.from({ length: 12 }).fill(26), Array.from({ length: 12 }).fill(100))).toBe('Af')
    expect(classify(Array.from({ length: 12 }).fill(26), [55, ...Array.from({ length: 11 }).fill(110)])).toBe('Am')
  })

  it('gives aridity precedence over temperature groups', () => {
    expect(classify(Array.from({ length: 12 }).fill(30), Array.from({ length: 12 }).fill(5))).toBe('BWh')
    expect(classify(Array.from({ length: 12 }).fill(20), Array.from({ length: 12 }).fill(25))).toBe('BSh')
  })

  it('uses local summer and winter for the two hemispheres', () => {
    const temperature = [10, 11, 13, 16, 20, 24, 27, 27, 23, 18, 14, 11]
    const precipitation = [120, 120, 120, 5, 5, 5, 5, 5, 5, 120, 120, 120]
    expect(classify(temperature, precipitation)).toBe('Csa')
    expect(classify(temperature, precipitation, true)).toBe('Cwa')
  })

  it('separates subarctic and ice-cap conditions', () => {
    expect(classify([-25, -22, -12, 0, 8, 14, 16, 14, 8, -2, -12, -22], Array.from({ length: 12 }).fill(100))).toBe('Dfc')
    expect(classify(Array.from({ length: 12 }).fill(-5), Array.from({ length: 12 }).fill(10))).toBe('EF')
  })
})
