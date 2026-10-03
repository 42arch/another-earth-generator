declare module 'd3-geo-voronoi' {
  export interface GeoDelaunayResult {
    triangles: number[][]
  }

  export function geoDelaunay(points: [number, number][]): GeoDelaunayResult
}
