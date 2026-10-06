import type { SphericalPoint, SphericalStrokePath, SphericalStrokePoint } from '@/core/math/polyline'
import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldSimulationState } from '@/core/simulation/state'
import { BufferAttribute, BufferGeometry } from 'three'
import { sampleSmoothSphericalStrokePath } from '@/core/math/polyline'

const RIVER_COLOR = [0.1, 0.62, 0.92] as const

/** Builds width-aware river strokes and a globe-ready ribbon mesh. */
export class RiverGeometry {
  create(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    radius: number,
    surfaceOffsets?: Float32Array,
  ): BufferGeometry {
    const positions: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    const paths = this.createStrokePaths(mesh, data, surfaceOffsets)

    for (const path of paths)
      this.appendRibbon(path, radius, positions, colors, indices)

    return this.createGeometry(positions, colors, indices)
  }

  createStrokePaths(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    surfaceOffsets?: Float32Array,
  ): SphericalStrokePath[] {
    const hydrology = data.hydrology
    if (!hydrology)
      return []

    let maximumFlow = 0
    for (let region = 0; region < mesh.numRegions; region++) {
      if (hydrology.riverMask[region] !== 0)
        maximumFlow = Math.max(maximumFlow, hydrology.flowAccumulation[region])
    }
    if (maximumFlow <= 0)
      return []

    const mainIncoming = new Int32Array(mesh.numRegions).fill(-1)
    for (let region = 0; region < mesh.numRegions; region++) {
      if (hydrology.riverMask[region] === 0)
        continue
      const target = hydrology.downstream[region]
      if (target < 0 || target >= mesh.numRegions || hydrology.riverMask[target] === 0)
        continue

      const previous = mainIncoming[target]
      if (
        previous < 0
        || hydrology.flowAccumulation[region] > hydrology.flowAccumulation[previous]
        || (hydrology.flowAccumulation[region] === hydrology.flowAccumulation[previous] && region < previous)
      ) {
        mainIncoming[target] = region
      }
    }

    const paths: SphericalStrokePath[] = []
    const used = new Uint8Array(mesh.numRegions)
    const appendPath = (start: number): void => {
      const points: SphericalStrokePoint[] = []
      let region = start
      for (let step = 0; step < mesh.numRegions && used[region] === 0; step++) {
        const target = hydrology.downstream[region]
        if (target < 0 || target >= mesh.numRegions)
          break
        used[region] = 1
        const sourcePosition = this.regionPoint(mesh, region)
        const sourceWidth = this.widthForFlow(hydrology.flowAccumulation[region], maximumFlow)
        const isPathSource = points.length === 0
        points.push({
          position: sourcePosition,
          width: isPathSource ? sourceWidth * 0.7 : sourceWidth,
          color: RIVER_COLOR,
          surfaceOffset: surfaceOffsets?.[region],
          widthFloorScale: isPathSource ? 0.7 : 1,
        })

        if (hydrology.outletMask[region] !== 0) {
          const coast = this.coastPoint(mesh, region, target)
            ?? this.normalize(this.add(sourcePosition, this.regionPoint(mesh, target)))
          if (coast) {
            const coastOffset = surfaceOffsets
              ? (surfaceOffsets[region] + surfaceOffsets[target]) * 0.5
              : undefined
            points.push({
              position: coast,
              width: sourceWidth * 1.18,
              color: RIVER_COLOR,
              surfaceOffset: coastOffset,
            })
          }
          break
        }

        if (hydrology.riverMask[target] === 0 || mainIncoming[target] !== region || used[target] !== 0) {
          const targetPosition = this.regionPoint(mesh, target)
          let finalPosition = targetPosition
          if (hydrology.riverMask[target] !== 0) {
            const targetWidth = this.widthForFlow(hydrology.flowAccumulation[target], maximumFlow)
            const direction = this.normalize(this.subtract(sourcePosition, targetPosition))
            if (direction) {
              const offset = targetWidth * 0.4
              finalPosition = this.add(targetPosition, this.scale(direction, offset)) ?? targetPosition
            }
          }
          points.push({
            position: finalPosition,
            width: sourceWidth,
            color: RIVER_COLOR,
            surfaceOffset: surfaceOffsets?.[target],
          })
          break
        }
        region = target
      }
      if (points.length >= 4) {
        paths.push(sampleSmoothSphericalStrokePath(
          { points, closed: false },
          0.92,
          6,
        ))
      }
    }

    for (let region = 0; region < mesh.numRegions; region++) {
      if (hydrology.riverMask[region] !== 0 && mainIncoming[region] < 0)
        appendPath(region)
    }
    // A routing cycle should never occur, but preserve any unvisited edges if
    // a future hydrology pass changes the downstream ordering.
    for (let region = 0; region < mesh.numRegions; region++) {
      if (hydrology.riverMask[region] !== 0 && used[region] === 0)
        appendPath(region)
    }
    return paths
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

  private regionPoint(mesh: SphericalMesh, region: number): SphericalPoint {
    const offset = region * 3
    return [
      mesh.regionPosition[offset],
      mesh.regionPosition[offset + 1],
      mesh.regionPosition[offset + 2],
    ]
  }

  private coastPoint(
    mesh: SphericalMesh,
    landRegion: number,
    oceanRegion: number,
  ): SphericalPoint | null {
    const targetCorners = new Set<number>()
    const targetStart = mesh.voronoi.cellCornerOffsets[oceanRegion]
    const targetEnd = mesh.voronoi.cellCornerOffsets[oceanRegion + 1]
    for (let index = targetStart; index < targetEnd; index++)
      targetCorners.add(mesh.voronoi.cellCorners[index])

    const sourceStart = mesh.voronoi.cellCornerOffsets[landRegion]
    const sourceEnd = mesh.voronoi.cellCornerOffsets[landRegion + 1]
    for (let index = sourceStart; index < sourceEnd; index++) {
      const cornerA = mesh.voronoi.cellCorners[index]
      const cornerB = mesh.voronoi.cellCorners[index + 1 < sourceEnd ? index + 1 : sourceStart]
      if (!targetCorners.has(cornerA) || !targetCorners.has(cornerB))
        continue
      const a = cornerA * 3
      const b = cornerB * 3
      return this.normalize([
        mesh.voronoi.cornerPosition[a] + mesh.voronoi.cornerPosition[b],
        mesh.voronoi.cornerPosition[a + 1] + mesh.voronoi.cornerPosition[b + 1],
        mesh.voronoi.cornerPosition[a + 2] + mesh.voronoi.cornerPosition[b + 2],
      ])
    }
    return null
  }

  private widthForFlow(flow: number, maximumFlow: number): number {
    const ratio = Math.sqrt(Math.max(0, Math.min(1, flow / maximumFlow)))
    // Width is a fraction of the unit sphere. The globe scales it by radius;
    // the map ribbon converts it to screen pixels.
    return 0.00055 + ratio * 0.00345
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
