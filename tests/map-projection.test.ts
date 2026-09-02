import { describe, expect, it } from 'vitest'
import {
  EQUAL_EARTH_PROJECTION,
  WEB_MERCATOR_PROJECTION,
} from '@/core/projections/d3-map-projection'

const DEGREE = Math.PI / 180

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
