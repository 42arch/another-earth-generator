import type { MapProjection } from '@/core/projections/map-projection'
import type {
  SphericalColor,
  SphericalStrokePath,
} from '@/core/spherical/geometry/spherical-polyline'
import { BufferAttribute, BufferGeometry } from 'three'
import {
  cartesianToGeographic,
  FULL_LONGITUDE,
  unwrapLongitudeNear,
  wrapLongitude,
} from '@/core/projections/projection-math'

interface GeographicStrokePoint {
  longitude: number
  latitude: number
  width: number
  color?: SphericalColor
}

interface ProjectedStrokePoint {
  x: number
  y: number
  width: number
  color: SphericalColor
}

interface RibbonAttributes {
  positions: number[]
  previous: number[]
  next: number[]
  sides: number[]
  widths: number[]
  colors: number[]
}

const WHITE: SphericalColor = [1, 1, 1]
const CLIP_EPSILON = 1e-10

/**
 * 将共享球面路径投影并在地图接缝处分段，输出由顶点着色器扩展的带状几何。
 * 几何中心线保持地图坐标，宽度属性则保持像素单位。
 */
export class MapRibbonGeometry {
  create(
    paths: readonly SphericalStrokePath[],
    projection: MapProjection,
    centralMeridian: number,
    z: number,
    widthScale = 1,
  ): BufferGeometry {
    const attributes: RibbonAttributes = {
      positions: [],
      previous: [],
      next: [],
      sides: [],
      widths: [],
      colors: [],
    }

    for (const path of paths) {
      const geographic = this.toGeographicPath(path, centralMeridian)
      if (geographic.length < 2)
        continue
      for (const fragment of this.clipAndProject(geographic, projection))
        this.appendFragment(attributes, fragment, z, widthScale)
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(attributes.positions), 3))
    geometry.setAttribute('previous', new BufferAttribute(new Float32Array(attributes.previous), 2))
    geometry.setAttribute('next', new BufferAttribute(new Float32Array(attributes.next), 2))
    geometry.setAttribute('side', new BufferAttribute(new Float32Array(attributes.sides), 1))
    geometry.setAttribute('lineWidth', new BufferAttribute(new Float32Array(attributes.widths), 1))
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(attributes.colors), 3))
    geometry.computeBoundingSphere()
    return geometry
  }

  private toGeographicPath(
    path: SphericalStrokePath,
    centralMeridian: number,
  ): GeographicStrokePoint[] {
    if (path.points.length < 2)
      return []
    const points = path.points.map((point) => {
      const geographic = cartesianToGeographic(
        point.position[0],
        point.position[1],
        point.position[2],
      )
      return {
        longitude: wrapLongitude(geographic.longitude - centralMeridian),
        latitude: geographic.latitude,
        width: point.width,
        color: point.color,
      }
    })
    for (let index = 1; index < points.length; index++) {
      points[index].longitude = unwrapLongitudeNear(
        points[index].longitude,
        points[index - 1].longitude,
      )
    }
    if (path.closed) {
      const first = points[0]
      const last = points[points.length - 1]
      points.push({
        ...first,
        longitude: unwrapLongitudeNear(first.longitude, last.longitude),
      })
    }
    return points
  }

  private clipAndProject(
    path: readonly GeographicStrokePoint[],
    projection: MapProjection,
  ): ProjectedStrokePoint[][] {
    const fragments: ProjectedStrokePoint[][] = []
    const halfLongitude = FULL_LONGITUDE * 0.5

    for (const worldOffset of [-FULL_LONGITUDE, 0, FULL_LONGITUDE]) {
      let current: GeographicStrokePoint[] = []
      for (let index = 1; index < path.length; index++) {
        const start = { ...path[index - 1], longitude: path[index - 1].longitude + worldOffset }
        const end = { ...path[index], longitude: path[index].longitude + worldOffset }
        const clipped = this.clipSegment(
          start,
          end,
          -halfLongitude,
          halfLongitude,
          projection.minimumLatitude,
          projection.maximumLatitude,
        )
        if (!clipped) {
          this.appendProjectedFragment(fragments, current, projection)
          current = []
          continue
        }

        if (
          current.length === 0
          || !this.sameGeographicPoint(current[current.length - 1], clipped[0])
        ) {
          this.appendProjectedFragment(fragments, current, projection)
          current = [clipped[0], clipped[1]]
        }
        else {
          current.push(clipped[1])
        }

        if (!this.sameGeographicPoint(clipped[1], end)) {
          this.appendProjectedFragment(fragments, current, projection)
          current = []
        }
      }
      this.appendProjectedFragment(fragments, current, projection)
    }

    return fragments
  }

  private appendProjectedFragment(
    fragments: ProjectedStrokePoint[][],
    source: readonly GeographicStrokePoint[],
    projection: MapProjection,
  ): void {
    if (source.length < 2)
      return
    const fragment: ProjectedStrokePoint[] = []
    for (const point of source) {
      const projected = projection.projectRelative(point.longitude, point.latitude)
      if (!projected)
        return
      const next: ProjectedStrokePoint = {
        x: projected.x,
        y: projected.y,
        width: point.width,
        color: point.color ?? WHITE,
      }
      const previous = fragment[fragment.length - 1]
      if (previous && Math.hypot(next.x - previous.x, next.y - previous.y) <= CLIP_EPSILON)
        fragment[fragment.length - 1] = next
      else
        fragment.push(next)
    }
    if (fragment.length >= 2)
      fragments.push(fragment)
  }

  private appendFragment(
    attributes: RibbonAttributes,
    points: readonly ProjectedStrokePoint[],
    z: number,
    widthScale: number,
  ): void {
    for (let index = 1; index < points.length; index++) {
      const startIndex = index - 1
      const endIndex = index
      this.appendVertex(attributes, points, startIndex, -1, z, widthScale)
      this.appendVertex(attributes, points, startIndex, 1, z, widthScale)
      this.appendVertex(attributes, points, endIndex, -1, z, widthScale)
      this.appendVertex(attributes, points, startIndex, 1, z, widthScale)
      this.appendVertex(attributes, points, endIndex, 1, z, widthScale)
      this.appendVertex(attributes, points, endIndex, -1, z, widthScale)
    }
  }

  private appendVertex(
    attributes: RibbonAttributes,
    points: readonly ProjectedStrokePoint[],
    index: number,
    side: number,
    z: number,
    widthScale: number,
  ): void {
    const point = points[index]
    const previous = points[Math.max(0, index - 1)]
    const next = points[Math.min(points.length - 1, index + 1)]
    attributes.positions.push(point.x, point.y, z)
    attributes.previous.push(previous.x, previous.y)
    attributes.next.push(next.x, next.y)
    attributes.sides.push(side)
    attributes.widths.push(Math.max(0.1, point.width * widthScale))
    attributes.colors.push(...point.color)
  }

  private clipSegment(
    start: GeographicStrokePoint,
    end: GeographicStrokePoint,
    minimumLongitude: number,
    maximumLongitude: number,
    minimumLatitude: number,
    maximumLatitude: number,
  ): readonly [GeographicStrokePoint, GeographicStrokePoint] | null {
    let minimumAmount = 0
    let maximumAmount = 1

    const axes = [
      [start.longitude, end.longitude - start.longitude, minimumLongitude, maximumLongitude],
      [start.latitude, end.latitude - start.latitude, minimumLatitude, maximumLatitude],
    ] as const
    for (const [origin, difference, minimum, maximum] of axes) {
      if (Math.abs(difference) <= Number.EPSILON) {
        if (origin < minimum || origin > maximum)
          return null
        continue
      }
      const amountA = (minimum - origin) / difference
      const amountB = (maximum - origin) / difference
      minimumAmount = Math.max(0, Math.min(amountA, amountB))
      maximumAmount = Math.min(1, Math.max(amountA, amountB))
      if (minimumAmount > maximumAmount)
        return null
    }
    if (maximumAmount - minimumAmount <= 1e-12)
      return null

    return [
      this.interpolate(start, end, minimumAmount),
      this.interpolate(start, end, maximumAmount),
    ]
  }

  private interpolate(
    start: GeographicStrokePoint,
    end: GeographicStrokePoint,
    amount: number,
  ): GeographicStrokePoint {
    return {
      longitude: start.longitude + (end.longitude - start.longitude) * amount,
      latitude: start.latitude + (end.latitude - start.latitude) * amount,
      width: start.width + (end.width - start.width) * amount,
      color: start.color && end.color
        ? [
            start.color[0] + (end.color[0] - start.color[0]) * amount,
            start.color[1] + (end.color[1] - start.color[1]) * amount,
            start.color[2] + (end.color[2] - start.color[2]) * amount,
          ]
        : start.color ?? end.color,
    }
  }

  private sameGeographicPoint(
    a: GeographicStrokePoint,
    b: GeographicStrokePoint,
  ): boolean {
    return Math.abs(a.longitude - b.longitude) <= CLIP_EPSILON
      && Math.abs(a.latitude - b.latitude) <= CLIP_EPSILON
  }
}
