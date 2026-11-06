import { describe, expect, it } from 'vitest'
import { classifyKoppenSeries, KOPPEN_CODES } from './koppen-classifier'

describe('equal-bin Köppen classification', () => {
  it('classifies wet tropical, hot desert and polar fixtures', () => {
    expect(KOPPEN_CODES[classifyKoppenSeries(new Float32Array(12).fill(26), new Float32Array(12).fill(200), false)]).toBe('Af')
    expect(KOPPEN_CODES[classifyKoppenSeries(new Float32Array(12).fill(25), new Float32Array(12), false)]).toBe('BWh')
    expect(KOPPEN_CODES[classifyKoppenSeries(new Float32Array(12).fill(-15), new Float32Array(12).fill(10), false)]).toBe('EF')
  })

  it('rejects incomplete or invalid monthly series', () => {
    expect(() => classifyKoppenSeries(new Float32Array(11), new Float32Array(12), false)).toThrow()
    const rain = new Float32Array(12).fill(10)
    rain[3] = -1
    expect(() => classifyKoppenSeries(new Float32Array(12), rain, false)).toThrow()
  })
})
