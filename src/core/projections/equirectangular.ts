import type { MapProjection } from '@/core/projections/map-projection'
import { FULL_LONGITUDE, wrapLongitude } from '@/core/projections/projection-math'

const MINIMUM_LATITUDE = -Math.PI / 2
const MAXIMUM_LATITUDE = Math.PI / 2

export const EQUIRECTANGULAR_PROJECTION: MapProjection = {
  id: 'equirectangular',
  wrapX: true,
  worldWidth: FULL_LONGITUDE,
  worldHeight: Math.PI,
  minimumLatitude: MINIMUM_LATITUDE,
  maximumLatitude: MAXIMUM_LATITUDE,

  project(longitude, latitude, centralMeridian) {
    if (latitude < MINIMUM_LATITUDE || latitude > MAXIMUM_LATITUDE)
      return null
    return {
      x: wrapLongitude(longitude - centralMeridian),
      y: latitude,
    }
  },

  projectRelative(relativeLongitude, latitude) {
    if (latitude < MINIMUM_LATITUDE || latitude > MAXIMUM_LATITUDE)
      return null
    return { x: relativeLongitude, y: latitude }
  },

  unproject(x, y, centralMeridian) {
    if (y < MINIMUM_LATITUDE || y > MAXIMUM_LATITUDE)
      return null
    return {
      longitude: wrapLongitude(x + centralMeridian),
      latitude: y,
    }
  },
}
