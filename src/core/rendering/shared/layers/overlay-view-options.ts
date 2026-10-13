import type { MapProjection } from '@/core/projections/map-projection'

export type OverlayViewOptions
  = | {
    view: 'globe'
    planetRadius: number
    terrainVerticalScale: number
    usesElevationGeometry: boolean
  }
  | {
    view: 'map'
    projection: MapProjection
    centralMeridian: number
  }
