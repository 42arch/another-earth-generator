export interface GeographicPoint {
  longitude: number
  latitude: number
}

export interface ProjectedPoint {
  x: number
  y: number
}

export type MapProjectionId = 'mercator' | 'equal-earth'

export interface MapProjection {
  readonly id: string
  readonly wrapX: boolean
  readonly worldWidth: number
  readonly worldHeight: number
  readonly minimumLatitude: number
  readonly maximumLatitude: number

  project: (
    longitude: number,
    latitude: number,
    centralMeridian: number,
  ) => ProjectedPoint | null

  /**
   * Project an already-unwrapped longitude relative to the central meridian.
   * This is used after seam clipping so coordinates outside the primary world
   * can be shifted and clipped without being wrapped a second time.
   */
  projectRelative: (
    relativeLongitude: number,
    latitude: number,
  ) => ProjectedPoint | null

  unproject: (
    x: number,
    y: number,
    centralMeridian: number,
  ) => GeographicPoint | null
}
