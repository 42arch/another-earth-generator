import type { SphericalPoint, SphericalStrokePath } from '@/core/math/polyline'
import { describe, expect, it } from 'vitest'
import { EQUIRECTANGULAR_PROJECTION } from '@/core/projections/equirectangular'
import { geographicToCartesian } from '@/core/projections/projection-math'
import { MapRibbonGeometry } from '@/core/rendering/map/ribbon-geometry'

function sphericalPoint(longitude: number, latitude: number): SphericalPoint {
  const point = geographicToCartesian(longitude, latitude)
  return [point[0], point[1], point[2]]
}

describe('map ribbon geometry', () => {
  it('splits a variable-width stroke at the map seam', () => {
    const path: SphericalStrokePath = {
      closed: false,
      points: [
        {
          position: sphericalPoint(179 * Math.PI / 180, 0.2),
          width: 1,
          color: [0.2, 0.4, 0.8],
        },
        {
          position: sphericalPoint(-179 * Math.PI / 180, 0.22),
          width: 4,
          color: [0.4, 0.8, 1],
        },
      ],
    }
    const geometry = new MapRibbonGeometry().create(
      [path],
      EQUIRECTANGULAR_PROJECTION,
      0,
      0.5,
    )
    const positions = geometry.getAttribute('position')
    const widths = geometry.getAttribute('lineWidth')
    const colors = geometry.getAttribute('color')

    // 接缝两侧各生成一个独立四边形，而不是横跨整张地图。
    expect(positions.count).toBe(12)
    expect(widths.count).toBe(positions.count)
    expect(colors.count).toBe(positions.count)
    for (let vertex = 0; vertex < positions.count; vertex += 6) {
      expect(Math.abs(positions.getX(vertex + 2) - positions.getX(vertex)))
        .toBeLessThan(0.1)
    }
    for (let vertex = 0; vertex < widths.count; vertex++) {
      expect(widths.getX(vertex)).toBeGreaterThanOrEqual(1)
      expect(widths.getX(vertex)).toBeLessThanOrEqual(4)
    }
    geometry.dispose()
  })
})
