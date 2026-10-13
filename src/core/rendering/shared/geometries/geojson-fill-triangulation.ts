import type { GeoProjection, GeoStream } from 'd3-geo'
import type { GeoJsonFeature, GeoJsonPosition } from '@/core/data-source'
import type { GeographicFillTriangle } from '@/core/rendering/shared/geometries/surface-geometry-helpers'
import { geoGnomonic, geoStream } from 'd3-geo'
import { ShapeUtils, Vector2, Vector3 } from 'three'
import { cartesianToGeographic, geographicToCartesian } from '@/core/projections/projection-math'

type Position = readonly [number, number]

const FACE_CENTERS: readonly Position[] = [
  [0, 0],
  [90, 0],
  [180, 0],
  [-90, 0],
  [0, 90],
  [0, -90],
]
const DEFAULT_MAX_TRIANGLE_ARC = 0.18

interface ProjectedRing {
  vertices: Vector2[]
  area: number
  sample: Vector2
  parent: number
  depth: number
}

function ringArea(vertices: readonly Vector2[]): number {
  let area = 0
  for (let index = 0; index < vertices.length; index++) {
    const a = vertices[index]
    const b = vertices[(index + 1) % vertices.length]
    area += a.x * b.y - b.x * a.y
  }
  return area * 0.5
}

function contains(vertices: readonly Vector2[], point: Vector2): boolean {
  let inside = false
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index++) {
    const a = vertices[index]
    const b = vertices[previous]
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

function interiorPoint(vertices: Vector2[]): Vector2 {
  const triangle = ShapeUtils.triangulateShape(vertices, [])[0]
  if (triangle)
    return vertices[triangle[0]].clone().add(vertices[triangle[1]]).add(vertices[triangle[2]]).multiplyScalar(1 / 3)
  return vertices[0]
}

function projectedPolygons(polygon: GeoJsonPosition[][], projection: GeoProjection): Vector2[][][] {
  const polygons: Vector2[][][] = []
  let rings: Vector2[][] = []
  let current: Vector2[] = []
  const collector: GeoStream = {
    polygonStart: () => { rings = [] },
    polygonEnd: () => {
      if (rings.length > 0)
        polygons.push(rings)
    },
    lineStart: () => { current = [] },
    lineEnd: () => {
      if (current.length > 1 && current[0].distanceToSquared(current[current.length - 1]) < 1e-16)
        current.pop()
      if (current.length >= 3 && Math.abs(ringArea(current)) > 1e-12)
        rings.push(current)
    },
    point: (x, y) => {
      if (Number.isFinite(x) && Number.isFinite(y)
        && (current.length === 0 || current[current.length - 1].distanceToSquared(new Vector2(x, y)) > 1e-16)) {
        current.push(new Vector2(x, y))
      }
    },
  }
  // D3's spherical stream uses clockwise exterior rings; generated GeoJSON uses RFC 7946 winding.
  geoStream({ type: 'Polygon', coordinates: polygon.map(ring => [...ring].reverse()) }, projection.stream(collector))
  return polygons
}

function cartesian(position: Position): Vector3 {
  return new Vector3(...geographicToCartesian(position[0] * Math.PI / 180, position[1] * Math.PI / 180))
}

function midpoint(a: Vector3, b: Vector3): Vector3 {
  return a.clone().add(b).normalize()
}

function geographic(position: Vector3): Position {
  const point = cartesianToGeographic(position.x, position.y, position.z)
  return [point.longitude * 180 / Math.PI, point.latitude * 180 / Math.PI]
}

function appendTriangle(
  target: GeographicFillTriangle[],
  a: Vector3,
  b: Vector3,
  c: Vector3,
  color: readonly [number, number, number],
  featureIndex: number,
  maxTriangleArc: number,
  depth = 0,
): void {
  const ab = a.angleTo(b)
  const bc = b.angleTo(c)
  const ca = c.angleTo(a)
  if (depth < 12 && Math.max(ab, bc, ca) > maxTriangleArc) {
    if (ab >= bc && ab >= ca) {
      const center = midpoint(a, b)
      appendTriangle(target, a, center, c, color, featureIndex, maxTriangleArc, depth + 1)
      appendTriangle(target, center, b, c, color, featureIndex, maxTriangleArc, depth + 1)
    }
    else if (bc >= ca) {
      const center = midpoint(b, c)
      appendTriangle(target, a, b, center, color, featureIndex, maxTriangleArc, depth + 1)
      appendTriangle(target, a, center, c, color, featureIndex, maxTriangleArc, depth + 1)
    }
    else {
      const center = midpoint(c, a)
      appendTriangle(target, a, b, center, color, featureIndex, maxTriangleArc, depth + 1)
      appendTriangle(target, center, b, c, color, featureIndex, maxTriangleArc, depth + 1)
    }
    return
  }
  target.push({ vertices: [geographic(a), geographic(b), geographic(c)], color, featureIndex })
}

function triangulateProjectedPolygon(
  target: GeographicFillTriangle[],
  polygon: Vector2[][],
  projection: GeoProjection,
  color: readonly [number, number, number],
  featureIndex: number,
  maxTriangleArc: number,
): void {
  const rings: ProjectedRing[] = polygon.map(vertices => ({
    vertices,
    area: Math.abs(ringArea(vertices)),
    sample: interiorPoint(vertices),
    parent: -1,
    depth: 0,
  })).sort((a, b) => b.area - a.area)

  for (let index = 0; index < rings.length; index++) {
    for (let candidate = index - 1; candidate >= 0; candidate--) {
      if (contains(rings[candidate].vertices, rings[index].sample)) {
        rings[index].parent = candidate
        rings[index].depth = rings[candidate].depth + 1
        break
      }
    }
  }

  for (const [index, ring] of rings.entries()) {
    if (ring.depth % 2 !== 0)
      continue
    const holes = rings.filter(item => item.parent === index && item.depth % 2 === 1).map(item => item.vertices)
    const vertices = [...ring.vertices, ...holes.flat()]
    for (const [a, b, c] of ShapeUtils.triangulateShape(ring.vertices, holes)) {
      const first = projection.invert?.([vertices[a].x, vertices[a].y])
      const second = projection.invert?.([vertices[b].x, vertices[b].y])
      const third = projection.invert?.([vertices[c].x, vertices[c].y])
      if (first && second && third)
        appendTriangle(target, cartesian(first), cartesian(second), cartesian(third), color, featureIndex, maxTriangleArc)
    }
  }
}

/** Clips a spherical GeoJSON polygon to six gnomonic cube faces before triangulation. */
export function triangulateGeoJsonFeature(
  feature: GeoJsonFeature,
  featureIndex: number,
  color: readonly [number, number, number],
  maxTriangleArc = DEFAULT_MAX_TRIANGLE_ARC,
): GeographicFillTriangle[] {
  const geometry = feature.geometry
  const polygons = geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
  const triangles: GeographicFillTriangle[] = []
  for (const [longitude, latitude] of FACE_CENTERS) {
    const projection = geoGnomonic()
      .rotate([-longitude, -latitude])
      .scale(1)
      .translate([0, 0])
      .clipAngle(60)
      .clipExtent([[-1, -1], [1, 1]])
      .precision(0)
    for (const polygon of polygons) {
      for (const clipped of projectedPolygons(polygon, projection))
        triangulateProjectedPolygon(triangles, clipped, projection, color, featureIndex, maxTriangleArc)
    }
  }
  return triangles
}
