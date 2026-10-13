import type { GeoJsonFeatureCollection } from '@/core/data-source'
import type { SphericalPoint, SphericalStrokePath } from '@/core/math/polyline'
import { BufferAttribute, BufferGeometry } from 'three'
import { geographicToCartesian } from '@/core/projections/projection-math'
import { elevationKmToDisplayCoordinate } from '@/core/simulation/geography/elevation-units'

const RIVER_COLOR = [0.1, 0.62, 0.92] as const

/** Builds width-aware river strokes and a globe-ready ribbon mesh. */
export class RiverGeometry {
  createFromPaths(paths: readonly SphericalStrokePath[], radius: number): BufferGeometry {
    const positions: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    for (const path of paths)
      this.appendRibbon(path, radius, positions, colors, indices)
    return this.createGeometry(positions, colors, indices)
  }

  private appendRibbon(
    path: SphericalStrokePath,
    radius: number,
    positions: number[],
    colors: number[],
    indices: number[],
  ): void {
    const base = positions.length / 3
    for (let index = 0; index < path.points.length; index++) {
      const point = path.points[index]
      const center = this.normalize(point.position)
      const previous = path.points[Math.max(0, index - 1)].position
      const next = path.points[Math.min(path.points.length - 1, index + 1)].position
      if (!center)
        return
      const direction = this.subtract(next, previous)
      const tangent = this.normalize(this.subtract(
        direction,
        this.scale(center, this.dot(direction, center)),
      ))
      const side = tangent && this.normalize(this.cross(center, tangent))
      if (!side)
        return
      const halfWidth = point.width * 0.5
      const pointRadius = radius + (point.surfaceOffset ?? 0)
      const left = this.normalize(this.add(center, this.scale(side, halfWidth)))
      const right = this.normalize(this.subtract(center, this.scale(side, halfWidth)))
      if (!left || !right)
        return

      positions.push(
        left[0] * pointRadius,
        left[1] * pointRadius,
        left[2] * pointRadius,
        right[0] * pointRadius,
        right[1] * pointRadius,
        right[2] * pointRadius,
      )
      const color = point.color ?? RIVER_COLOR
      colors.push(...color, ...color)
      if (index > 0) {
        const previousPair = base + (index - 1) * 2
        const currentPair = base + index * 2
        indices.push(
          previousPair,
          previousPair + 1,
          currentPair + 1,
          previousPair,
          currentPair + 1,
          currentPair,
        )
      }
    }
  }

  private createGeometry(
    positions: number[],
    colors: number[],
    indices: number[],
  ): BufferGeometry {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
    if (indices.length > 0)
      geometry.setIndex(indices)
    geometry.computeBoundingSphere()
    return geometry
  }

  private add(a: SphericalPoint, b: SphericalPoint): SphericalPoint {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
  }

  private subtract(a: SphericalPoint, b: SphericalPoint): SphericalPoint {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  }

  private scale(point: SphericalPoint, factor: number): SphericalPoint {
    return [point[0] * factor, point[1] * factor, point[2] * factor]
  }

  private cross(a: SphericalPoint, b: SphericalPoint): SphericalPoint {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ]
  }

  private dot(a: SphericalPoint, b: SphericalPoint): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  }

  private normalize(point: SphericalPoint): SphericalPoint | null {
    const length = Math.hypot(point[0], point[1], point[2])
    return length > 1e-8
      ? [point[0] / length, point[1] / length, point[2] / length]
      : null
  }
}

/** Compiles any river LineString source to the shared 2D/3D ribbon input. */
export function riverStrokePaths(
  source: GeoJsonFeatureCollection,
  colorForFlow: (flowAccumulation: number, order: number) => readonly [number, number, number],
  terrainVerticalScale = 0,
  styleWidth = 1,
): SphericalStrokePath[] {
  const paths: SphericalStrokePath[] = []
  for (const feature of source.features) {
    const lines = feature.geometry.type === 'LineString'
      ? [feature.geometry.coordinates]
      : feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : []
    const widths = Array.isArray(feature.properties.widths) ? feature.properties.widths : []
    const floorScales = Array.isArray(feature.properties.widthFloorScales) ? feature.properties.widthFloorScales : []
    const flows = Array.isArray(feature.properties.flows) ? feature.properties.flows : []
    let firstIndex = 0
    for (const line of lines) {
      if (line.length < 2)
        continue
      const points = line.map((coordinate, localIndex) => {
        const index = firstIndex + localIndex
        const flowAccumulation = Number(flows[index] ?? feature.properties.flowAccumulation ?? 0)
        const order = Math.floor(Math.log2(Math.max(1, flowAccumulation)))
        return {
          position: [...geographicToCartesian(coordinate[0] * Math.PI / 180, coordinate[1] * Math.PI / 180)] as [number, number, number],
          width: Number(widths[index] ?? 0.001) * styleWidth,
          widthFloorScale: Number(floorScales[index] ?? 1),
          color: colorForFlow(flowAccumulation, order),
          surfaceOffset: terrainVerticalScale
            ? elevationKmToDisplayCoordinate((coordinate[2] ?? 0) / 1000) * terrainVerticalScale
            : undefined,
        }
      })
      paths.push({ points, closed: false })
      firstIndex += line.length
    }
  }
  return paths
}
