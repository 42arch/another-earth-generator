import { describe, expect, it } from 'vitest'
import { cartesianToLonLatDeg, lonLatDegToCartesian, rotateAroundPolarAxis } from '#projections/spherical-math'
import { computeSunDirectionForMonth, planetSpinStepRadians } from './globe-view'

describe('planet spin', () => {
  it('turns a point eastward around the polar axis and leaves latitude unchanged', () => {
    const quarterTurn = Math.PI / 2
    const primeMeridian = lonLatDegToCartesian(0, 20)
    const spun = rotateAroundPolarAxis(primeMeridian, quarterTurn)
    const [longitude, latitude] = cartesianToLonLatDeg(spun[0], spun[1], spun[2])

    expect(longitude).toBeCloseTo(90, 6)
    expect(latitude).toBeCloseTo(20, 6)
    expect(rotateAroundPolarAxis(spun, -quarterTurn)).toEqual([
      expect.closeTo(primeMeridian[0], 8),
      expect.closeTo(primeMeridian[1], 8),
      expect.closeTo(primeMeridian[2], 8),
    ])
  })

  it('keeps the seasonal sun fixed while the surface longitude changes', () => {
    const before = lonLatDegToCartesian(30, 10)
    const after = rotateAroundPolarAxis(before, 0.4)
    const sun = computeSunDirectionForMonth(5, 23.44)

    const litBefore = before[0] * sun.x + before[1] * sun.y + before[2] * sun.z
    const litAfter = after[0] * sun.x + after[1] * sun.y + after[2] * sun.z
    expect(litAfter).not.toBeCloseTo(litBefore, 4)
    expect([sun.x, sun.y, sun.z]).toEqual(computeSunDirectionForMonth(5, 23.44).toArray())
  })

  it('scales one second of spin by the requested speed and clamps the range', () => {
    expect(planetSpinStepRadians(1000, 0.6)).toBeCloseTo(0.6 * Math.PI / 180, 8)
    expect(planetSpinStepRadians(1000, 30)).toBeCloseTo(30 * Math.PI / 180, 8)
    expect(planetSpinStepRadians(1000, -5)).toBe(0)
    expect(planetSpinStepRadians(1000, 120)).toBeCloseTo(90 * Math.PI / 180, 8)
  })
})
