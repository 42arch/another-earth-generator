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

  it('keeps the missing rare subtypes reachable from qualifying monthly series', () => {
    const hotContinental = Float32Array.from([-5, -3, 4, 12, 20, 24, 26, 25, 18, 10, 2, -3])
    const extremeContinental = Float32Array.from([-40, -35, -25, -10, 2, 12, 14, 12, 0, -15, -30, -39])
    const coolTemperate = Float32Array.from([1, 2, 4, 7, 9, 11, 15, 12, 9, 6, 3, 1])
    const dryWinter = Float32Array.from([5, 5, 70, 100, 120, 180, 180, 160, 120, 80, 20, 5])
    const drySummer = Float32Array.from([100, 100, 100, 10, 10, 10, 10, 10, 10, 100, 100, 100])
    const uniformRain = new Float32Array(12).fill(100)

    expect(KOPPEN_CODES[classifyKoppenSeries(hotContinental, dryWinter, false)]).toBe('Dwa')
    expect(KOPPEN_CODES[classifyKoppenSeries(coolTemperate, dryWinter, false)]).toBe('Cwc')
    expect(KOPPEN_CODES[classifyKoppenSeries(extremeContinental, drySummer, false)]).toBe('Dsd')
    expect(KOPPEN_CODES[classifyKoppenSeries(extremeContinental, dryWinter, false)]).toBe('Dwd')
    expect(KOPPEN_CODES[classifyKoppenSeries(extremeContinental, uniformRain, false)]).toBe('Dfd')
  })
})
