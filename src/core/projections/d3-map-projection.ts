import type { GeoProjection } from 'd3-geo'
import type {
  GeographicPoint,
  MapProjection,
  MapProjectionId,
  ProjectedPoint,
} from '@/core/projections/map-projection'
import { geoEqualEarth, geoMercator, geoPath } from 'd3-geo'
import { wrapLongitude } from '@/core/projections/projection-math'

const RADIANS_TO_DEGREES = 180 / Math.PI
const DEGREES_TO_RADIANS = Math.PI / 180
const MERCATOR_MAXIMUM_LATITUDE = Math.atan(Math.sinh(Math.PI))
const INVERSE_EPSILON = 1e-7

interface D3ProjectionOptions {
  id: MapProjectionId
  wrapX: boolean
  minimumLatitude: number
  maximumLatitude: number
}

class D3MapProjection implements MapProjection {
  readonly id: MapProjectionId
  readonly wrapX: boolean
  readonly worldWidth: number
  readonly worldHeight: number
  readonly minimumLatitude: number
  readonly maximumLatitude: number
  private readonly minimumX: number
  private readonly maximumX: number
  private readonly minimumY: number
  private readonly maximumY: number

  private readonly projection: GeoProjection
  constructor(projection: GeoProjection, options: D3ProjectionOptions) {
    this.projection = projection
    this.id = options.id
    this.wrapX = options.wrapX
    this.minimumLatitude = options.minimumLatitude
    this.maximumLatitude = options.maximumLatitude

    const bounds = geoPath(this.projection).bounds({ type: 'Sphere' })
    this.minimumX = bounds[0][0]
    this.minimumY = bounds[0][1]
    this.maximumX = bounds[1][0]
    this.maximumY = bounds[1][1]
    this.worldWidth = this.maximumX - this.minimumX
    this.worldHeight = this.maximumY - this.minimumY
  }

  project(
    longitude: number,
    latitude: number,
    centralMeridian: number,
  ): ProjectedPoint | null {
    return this.projectRelative(
      wrapLongitude(longitude - centralMeridian),
      latitude,
    )
  }

  projectRelative(relativeLongitude: number, latitude: number): ProjectedPoint | null {
    if (
      relativeLongitude < -Math.PI - Number.EPSILON
      || relativeLongitude > Math.PI + Number.EPSILON
      || latitude < this.minimumLatitude - Number.EPSILON
      || latitude > this.maximumLatitude + Number.EPSILON
    ) {
      return null
    }
    const projected = this.projection([
      relativeLongitude * RADIANS_TO_DEGREES,
      latitude * RADIANS_TO_DEGREES,
    ])
    if (!projected || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1]))
      return null
    return { x: projected[0], y: projected[1] }
  }

  unproject(
    x: number,
    y: number,
    centralMeridian: number,
  ): GeographicPoint | null {
    const projectedX = this.wrapX
      ? ((x - this.minimumX) % this.worldWidth + this.worldWidth)
      % this.worldWidth + this.minimumX
      : x
    if (
      projectedX < this.minimumX - INVERSE_EPSILON
      || projectedX > this.maximumX + INVERSE_EPSILON
      || y < this.minimumY - INVERSE_EPSILON
      || y > this.maximumY + INVERSE_EPSILON
    ) {
      return null
    }
    const inverted = this.projection.invert?.([projectedX, y])
    if (!inverted || !Number.isFinite(inverted[0]) || !Number.isFinite(inverted[1]))
      return null
    if (Math.abs(inverted[0]) > 180 + INVERSE_EPSILON || Math.abs(inverted[1]) > 90 + INVERSE_EPSILON)
      return null

    // Equal Earth 的外框是曲线。D3 的 raw invert 在外框外仍可能返回数值，
    // 因此通过正反投影闭环拒绝轮廓外的拾取点。
    const reprojected = this.projection(inverted)
    if (
      !reprojected
      || Math.hypot(reprojected[0] - projectedX, reprojected[1] - y) > INVERSE_EPSILON
    ) {
      return null
    }

    const latitude = inverted[1] * DEGREES_TO_RADIANS
    if (
      latitude < this.minimumLatitude - INVERSE_EPSILON
      || latitude > this.maximumLatitude + INVERSE_EPSILON
    ) {
      return null
    }
    return {
      longitude: wrapLongitude(
        inverted[0] * DEGREES_TO_RADIANS + centralMeridian,
      ),
      latitude,
    }
  }
}

function configure(projection: GeoProjection): GeoProjection {
  return projection
    .scale(1)
    .translate([0, 0])
    .reflectY(true)
    .precision(0.1)
}

export const WEB_MERCATOR_PROJECTION: MapProjection = new D3MapProjection(
  configure(geoMercator()),
  {
    id: 'mercator',
    wrapX: true,
    minimumLatitude: -MERCATOR_MAXIMUM_LATITUDE,
    maximumLatitude: MERCATOR_MAXIMUM_LATITUDE,
  },
)

export const EQUAL_EARTH_PROJECTION: MapProjection = new D3MapProjection(
  configure(geoEqualEarth()),
  {
    id: 'equal-earth',
    wrapX: false,
    minimumLatitude: -Math.PI / 2,
    maximumLatitude: Math.PI / 2,
  },
)

const MAP_PROJECTIONS: Record<MapProjectionId, MapProjection> = {
  'mercator': WEB_MERCATOR_PROJECTION,
  'equal-earth': EQUAL_EARTH_PROJECTION,
}

export function getMapProjection(id: MapProjectionId): MapProjection {
  return MAP_PROJECTIONS[id]
}
