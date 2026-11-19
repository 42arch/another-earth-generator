import type { SeasonalCirculationData } from './climate-data'
import { describe, expect, it } from 'vitest'
import { projectSeasonalCirculation, tangentTransportRotation } from './circulation-projection'

function point(lon: number, lat = 0): number[] {
  const longitude = lon * Math.PI / 180
  const latitude = lat * Math.PI / 180
  return [Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude), Math.cos(latitude) * Math.cos(longitude)]
}

function mesh(longitudes: number[]) {
  return {
    regionCount: longitudes.length,
    centers: Float64Array.from(longitudes.flatMap(lon => point(lon))),
    neighborOffsets: Uint32Array.from(longitudes.map((_, i) => i * (longitudes.length - 1)).concat(longitudes.length * (longitudes.length - 1))),
    neighbors: Uint32Array.from(longitudes.flatMap((_, i) => longitudes.map((_, j) => j).filter(j => j !== i))),
  }
}

function circulation(count: number): SeasonalCirculationData {
  return {
    regionCount: count,
    solarDeclination: new Float32Array(4),
    itczLatitude: new Float32Array(4 * 72),
    pressureHpa: new Float32Array(4 * count),
    windEast: Float32Array.from({ length: 4 * count }, (_, i) => 1 + i % count),
    windNorth: new Float32Array(4 * count),
    monsoonEast: new Float32Array(4 * count),
    oceanEast: Float32Array.from({ length: 4 * count }, (_, i) => 1 + i % count),
    oceanNorth: new Float32Array(4 * count),
    oceanWarmth: new Float32Array(4 * count).fill(0.5),
  }
}

describe('spherical circulation resampling', () => {
  it('preserves coincident sources and interpolates detail inside a nearest-source region', () => {
    const reference = mesh([-10, 10])
    const output = mesh([-10, -5, 0])
    const water = { mapping: new Int32Array([0, 0, 0]), component: new Int32Array(3), owner: new Int32Array(2) }
    const source = circulation(2)
    const result = projectSeasonalCirculation(output, reference, new Uint8Array(3), new Uint8Array(2), new Uint32Array(3), water, source)
    expect(result.windEast[0]).toBe(1)
    expect(result.windEast[1]).toBeGreaterThan(1)
    expect(result.windEast[1]).toBeLessThan(1.5)
    expect(result.windEast[2]).toBeCloseTo(1.5)
    expect(result.oceanEast[2]).toBeCloseTo(1.5)
    expect(result.oceanWarmth[2]).toBeCloseTo(0.5)
    expect(source.windEast[0]).toBe(1)
    expect(result).toEqual(projectSeasonalCirculation(output, reference, new Uint8Array(3), new Uint8Array(2), new Uint32Array(3), water, source))
  })

  it('excludes land and foreign water bodies and keeps unavailable water distinct from calm', () => {
    const reference = mesh([-10, 10, 20])
    const output = mesh([0, 1, 2])
    const source = circulation(3)
    source.oceanEast.fill(0)
    for (let season = 0; season < 4; season++) {
      source.oceanEast[season * 3 + 1] = 100
      source.oceanEast[season * 3 + 2] = 200
    }
    const water = { mapping: new Int32Array([0, -1, -1]), component: new Int32Array([0, -1, 2]), owner: new Int32Array([0, -1, 2]) }
    const result = projectSeasonalCirculation(output, reference, new Uint8Array([0, 1, 0]), new Uint8Array([0, 1, 0]), new Uint32Array(3), water, source)
    expect(result.oceanEast.every(value => value === 0)).toBe(true)
    expect(result.oceanNorth.every(value => value === 0)).toBe(true)
    expect(result.oceanWarmth[0]).toBe(0.5)
    expect(result.oceanWarmth[1]).toBe(0)
    expect(result.oceanWarmth[2]).toBe(0)
    expect(water.mapping[0]).toBe(0)
    expect(water.mapping[2]).toBe(-1)
  })

  it('does not interpolate a current across a reference land barrier', () => {
    const reference = { ...mesh([-10, 0, 10]), neighborOffsets: new Uint32Array([0, 1, 3, 4]), neighbors: new Uint32Array([1, 0, 2, 1]) }
    const output = mesh([-5])
    const water = { mapping: new Int32Array([0]), component: new Int32Array([0]), owner: new Int32Array([0, -1, 0]) }
    const result = projectSeasonalCirculation(output, reference, new Uint8Array(1), new Uint8Array([0, 1, 0]), new Uint32Array(1), water, circulation(3))
    expect(result.oceanEast[0]).toBeCloseTo(1)
  })

  it('parallel-transports directions over the seam and poles without losing magnitude', () => {
    for (const [a, b] of [[point(179, 60), point(-179, 60)], [point(0, 80), [0, 1, 0]], [point(0), point(180)]]) {
      const rotation = tangentTransportRotation(Float64Array.from(a), 0, Float64Array.from(b), 0)
      expect(rotation.cos ** 2 + rotation.sin ** 2).toBeCloseTo(1, 10)
      const east = rotation.cos * 3 - rotation.sin * 4
      const north = rotation.sin * 3 + rotation.cos * 4
      expect(Math.hypot(east, north)).toBeCloseTo(5, 10)
    }
    // Eastward at longitude zero becomes southward after crossing the north pole to longitude 90°.
    const rotation = tangentTransportRotation(Float64Array.from(point(0, 80)), 0, Float64Array.from(point(90, 80)), 0)
    expect(rotation.sin).toBeLessThan(0)
  })
})
