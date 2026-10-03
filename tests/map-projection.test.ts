import { describe, expect, it } from 'vitest'
import { FibonacciSphereBuilder } from '@/core/mesh/fibonacci-sphere-builder'
import {
  EQUAL_EARTH_PROJECTION,
  WEB_MERCATOR_PROJECTION,
} from '@/core/projections/d3-map-projection'
import { cartesianToGeographic, geographicToCartesian } from '@/core/projections/projection-math'

const DEGREE = Math.PI / 180

describe('spherical geographic coordinates', () => {
  it('uses +Y for north and +Z for zero longitude', () => {
    expect(geographicToCartesian(0, 0)).toEqual([0, 0, 1])
    const east = geographicToCartesian(Math.PI / 2, 0)
    expect(east[0]).toBeCloseTo(1)
    expect(east[1]).toBeCloseTo(0)
    expect(east[2]).toBeCloseTo(0)
    expect(cartesianToGeographic(1, 0, 0).longitude).toBeCloseTo(Math.PI / 2)
    expect(cartesianToGeographic(0, 1, 0).latitude).toBeCloseTo(Math.PI / 2)
    const point = geographicToCartesian(120 * DEGREE, 45 * DEGREE)
    const geographic = cartesianToGeographic(...point)
    expect(geographic.longitude).toBeCloseTo(120 * DEGREE)
    expect(geographic.latitude).toBeCloseTo(45 * DEGREE)
  })

  it('keeps generated mesh coordinates consistent with Cartesian positions', () => {
    const mesh = new FibonacciSphereBuilder().build(128, 42)
    for (let region = 0; region < mesh.numRegions; region++) {
      const index = region * 3
      const { latitude, longitude } = cartesianToGeographic(
        mesh.regionPosition[index],
        mesh.regionPosition[index + 1],
        mesh.regionPosition[index + 2],
      )
      expect(mesh.regionLatitude[region]).toBeCloseTo(latitude, 6)
      expect(mesh.regionLongitude[region]).toBeCloseTo(longitude, 6)
    }
  })
})

describe('d3 map projections', () => {
  it('round-trips Web Mercator coordinates and clips the polar caps', () => {
    const projected = WEB_MERCATOR_PROJECTION.project(120 * DEGREE, 45 * DEGREE, 20 * DEGREE)
    expect(projected).not.toBeNull()

    const geographic = WEB_MERCATOR_PROJECTION.unproject(
      projected!.x,
      projected!.y,
      20 * DEGREE,
    )
    expect(geographic?.longitude).toBeCloseTo(120 * DEGREE, 8)
    expect(geographic?.latitude).toBeCloseTo(45 * DEGREE, 8)
    const wrappedGeographic = WEB_MERCATOR_PROJECTION.unproject(
      projected!.x + WEB_MERCATOR_PROJECTION.worldWidth,
      projected!.y,
      20 * DEGREE,
    )
    expect(wrappedGeographic?.longitude).toBeCloseTo(120 * DEGREE, 8)
    expect(WEB_MERCATOR_PROJECTION.project(0, 89 * DEGREE, 0)).toBeNull()
  })

  it('round-trips Equal Earth coordinates and rejects points outside its curved outline', () => {
    const projected = EQUAL_EARTH_PROJECTION.project(-135 * DEGREE, 72 * DEGREE, 15 * DEGREE)
    expect(projected).not.toBeNull()

    const geographic = EQUAL_EARTH_PROJECTION.unproject(
      projected!.x,
      projected!.y,
      15 * DEGREE,
    )
    expect(geographic?.longitude).toBeCloseTo(-135 * DEGREE, 8)
    expect(geographic?.latitude).toBeCloseTo(72 * DEGREE, 8)
    expect(EQUAL_EARTH_PROJECTION.unproject(
      EQUAL_EARTH_PROJECTION.worldWidth * 0.49,
      EQUAL_EARTH_PROJECTION.worldHeight * 0.49,
      0,
    )).toBeNull()
  })
})
