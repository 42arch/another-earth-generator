import type { WorldFieldName, WorldMapReader, WorldMonthlyFieldName } from '@another-earth/world-core'
import { describe, expect, it } from 'vitest'
import { applyCellHillshadeRgba8, applyPolarIceToRgba8, landIceCover, oceanSpecularOpacity, seaIceCoverForMonths, writeSatelliteCellColorsRgba8 } from './satellite-shader'

interface SurfaceCell {
  readonly land: boolean
  readonly elevationKm: number
  readonly months: readonly number[]
  readonly hillshade?: number
  readonly precipitationMm?: number
  readonly aridity?: number
}

function months(value: number): number[] {
  return Array.from({ length: 12 }, () => value)
}

function readerFor(cells: readonly SurfaceCell[]): WorldMapReader {
  const field = (name: WorldFieldName) => ({
    get(region: number) {
      const cell = cells[region]
      switch (name) {
        case 'landMask': return cell.land ? 1 : 0
        case 'elevationKm': return cell.elevationKm
        case 'annualMeanTemperatureC': return cell.months.reduce((sum, value) => sum + value, 0) / 12
        case 'annualPrecipitationMm': return cell.precipitationMm ?? 900
        case 'aridityIndex': return cell.aridity ?? 0.7
        case 'surfaceDetail': return 0
        case 'hillshade': return cell.hillshade ?? 1
        default: return 0
      }
    },
  })
  return {
    identity: { regionCount: cells.length },
    field,
    monthlyField: (_name: WorldMonthlyFieldName, month: number) => ({
      get: (region: number) => cells[region].months[month],
    }),
  } as unknown as WorldMapReader
}

function luminance(rgba: Uint8Array, region: number): number {
  const offset = region * 4
  return rgba[offset] * 0.2126 + rgba[offset + 1] * 0.7152 + rgba[offset + 2] * 0.0722
}

describe('polar ice cover', () => {
  it('keeps a full land ice sheet through a warmest month of 0°C and clears it by 2°C', () => {
    expect(landIceCover(-12)).toBe(1)
    expect(landIceCover(0)).toBe(1)
    expect(landIceCover(1)).toBeGreaterThan(0.4)
    expect(landIceCover(1)).toBeLessThan(0.6)
    expect(landIceCover(2)).toBe(0)
    expect(landIceCover(18)).toBe(0)
  })

  it('keeps sea ice inside the warmest-month freezing line', () => {
    expect(seaIceCoverForMonths(months(-8))).toBe(1)
    expect(seaIceCoverForMonths(months(-1.8))).toBe(1)
    const fringe = seaIceCoverForMonths(months(-0.9))
    expect(fringe).toBeGreaterThan(0.4)
    expect(fringe).toBeLessThan(0.6)
    expect(seaIceCoverForMonths(months(0))).toBe(0)
    expect(seaIceCoverForMonths(months(4))).toBe(0)
    expect(seaIceCoverForMonths([...months(-12).slice(0, 8), ...months(6).slice(0, 4)])).toBe(0)

    const covers = []
    for (let temperature = -1.8; temperature <= 0; temperature += 0.3)
      covers.push(seaIceCoverForMonths(months(temperature)))
    for (let index = 1; index < covers.length; index++) {
      const drop = covers[index - 1] - covers[index]
      expect(drop).toBeGreaterThanOrEqual(-1e-6)
      expect(drop).toBeLessThan(0.45)
    }
  })

  it('colors cold land and polar ocean as ice while leaving warm plains and open water bare', () => {
    const rgba = new Uint8Array(6 * 4)
    writeSatelliteCellColorsRgba8(readerFor([
      { land: true, elevationKm: 0.2, months: months(-8) },
      { land: true, elevationKm: 0.2, months: months(18) },
      { land: true, elevationKm: 6, months: months(20) },
      { land: false, elevationKm: -3, months: months(-6) },
      { land: false, elevationKm: -3, months: months(-0.9) },
      { land: false, elevationKm: -3, months: [...months(-12).slice(0, 8), ...months(6).slice(0, 4)] },
    ]), rgba, { hillshadeStrength: 0 })

    const iceSheet = luminance(rgba, 0)
    const warmPlain = luminance(rgba, 1)
    const hotPeak = luminance(rgba, 2)
    const perennialSeaIce = luminance(rgba, 3)
    const fringeSeaIce = luminance(rgba, 4)
    const summerOcean = luminance(rgba, 5)

    expect(iceSheet).toBeGreaterThan(200)
    expect(rgba[0]).toBeGreaterThan(200)
    expect(rgba[2]).toBeGreaterThan(rgba[0])
    expect(warmPlain).toBeLessThan(iceSheet - 70)
    expect(hotPeak).toBeLessThan(iceSheet - 40)
    expect(perennialSeaIce).toBeGreaterThan(180)
    expect(fringeSeaIce).toBeGreaterThan(summerOcean + 40)
    expect(fringeSeaIce).toBeLessThan(perennialSeaIce - 30)
  })

  it('leaves summer-warm ocean uncovered even when winter is far below freezing', () => {
    const rgba = new Uint8Array(2 * 4)
    rgba.set([61, 98, 52, 255, 16, 61, 99, 255])
    applyPolarIceToRgba8(readerFor([
      { land: true, elevationKm: 0.2, months: months(-6) },
      { land: false, elevationKm: -3, months: [...months(-12).slice(0, 8), ...months(6).slice(0, 4)] },
    ]), rgba)

    expect(rgba[0]).toBeGreaterThan(200)
    expect(rgba[2]).toBeGreaterThan(rgba[0])
    expect(rgba[4]).toBe(16)
    expect(rgba[5]).toBe(61)
    expect(rgba[6]).toBe(99)
  })

  it('lays the sea-level hillshade on sea ice and leaves open water flat', () => {
    const rgba = new Uint8Array(3 * 4)
    rgba.fill(200)
    applyCellHillshadeRgba8(readerFor([
      { land: true, elevationKm: 0.2, months: months(-8), hillshade: 0.7 },
      { land: false, elevationKm: -3, months: months(-8), hillshade: 0.7 },
      { land: false, elevationKm: -3, months: months(8), hillshade: 0.7 },
    ]), rgba, 1, true)

    expect(rgba[0]).toBeLessThan(200)
    expect(rgba[4]).toBe(rgba[0])
    expect(rgba[8]).toBe(200)
    expect(rgba[9]).toBe(200)
    expect(rgba[10]).toBe(200)
  })

  it('paints warm wet land greener than warm dry land', () => {
    const rgba = new Uint8Array(2 * 4)
    writeSatelliteCellColorsRgba8(readerFor([
      { land: true, elevationKm: 0.2, months: months(22), precipitationMm: 1800, aridity: 0.9 },
      { land: true, elevationKm: 0.2, months: months(22), precipitationMm: 80, aridity: 0.1 },
    ]), rgba, { hillshadeStrength: 0, polarIce: false })

    expect(rgba[1] - rgba[0]).toBeGreaterThan(rgba[5] - rgba[4])
  })

  it('clears the ocean sheen as sea ice thickens and restores it when polar ice is hidden', () => {
    expect(oceanSpecularOpacity(0, true)).toBeCloseTo(0.55)
    expect(oceanSpecularOpacity(1, true)).toBe(0)
    expect(oceanSpecularOpacity(0.5, true)).toBeCloseTo(0.275)
    expect(oceanSpecularOpacity(1, false)).toBeCloseTo(0.55)
  })
})
