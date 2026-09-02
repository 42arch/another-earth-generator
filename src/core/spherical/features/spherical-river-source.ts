import type {
  SphericalPoint,
  SphericalStrokePath,
  SphericalStrokePoint,
} from '@/core/spherical/geometry/spherical-polyline'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type { SphericalRiverData } from '@/core/spherical/spherical-world-data'
import { deterministicUnit } from '@/core/spherical/geometry/spherical-math'

export interface SphericalRiverJunction {
  position: SphericalPoint
  width: number
}

export interface SphericalRiverPathData {
  paths: SphericalStrokePath[]
  junctions: SphericalRiverJunction[]
}

const SAMPLES_PER_CURVE_SEGMENT = 6
const MIN_RIVER_WIDTH = 0.1
const MAX_RIVER_WIDTH = 0.46
const RIVER_WIDTH_EXPONENT = 1.5
const MOUTH_WIDTH_FACTOR = 1.01
const MAX_MOUTH_WIDTH = MAX_RIVER_WIDTH * 0.8
const RIVER_MEANDER_SEED = 7919
const MAX_SEASONAL_WIDTH_REDUCTION = 0.38

/**
 * 构建与渲染后端无关的河网路径。路径在单位球面上表达，width 保留河流
 * 流量、季节性与河口收束后的语义宽度，由 3D 和 2D 分别解释为世界宽度
 * 与屏幕像素宽度。
 */
export class SphericalRiverSource {
  create(
    mesh: SphericalMesh,
    rivers: SphericalRiverData,
    landMask: Uint8Array,
    hiddenRegionMask?: Uint8Array,
  ): SphericalRiverPathData {
    const outgoing = new Int32Array(mesh.numRegions).fill(-1)
    const incomingCount = new Uint16Array(mesh.numRegions)
    const primaryUpstream = new Int32Array(mesh.numRegions).fill(-1)
    const sourceMask = new Uint8Array(mesh.numRegions)

    for (const region of rivers.sourceRegions)
      sourceMask[region] = 1

    const flowScale = this.getFlowScale(rivers)
    for (let segment = 0; segment < rivers.segmentSource.length; segment++) {
      const source = rivers.segmentSource[segment]
      const target = rivers.segmentTarget[segment]
      if (hiddenRegionMask && (
        hiddenRegionMask[source] !== 0
        || hiddenRegionMask[target] !== 0
      )) {
        continue
      }
      outgoing[source] = target

      if (landMask[target] === 0)
        continue

      incomingCount[target]++
      const primary = primaryUpstream[target]
      if (
        primary < 0
        || rivers.flowAccumulation[source] > rivers.flowAccumulation[primary]
        || (
          rivers.flowAccumulation[source] === rivers.flowAccumulation[primary]
          && source < primary
        )
      ) {
        primaryUpstream[target] = source
      }
    }

    const paths: SphericalStrokePath[] = []
    for (let start = 0; start < mesh.numRegions; start++) {
      if (outgoing[start] < 0 || primaryUpstream[start] >= 0)
        continue

      const nodes = this.buildRiverPath(
        mesh,
        rivers,
        landMask,
        outgoing,
        primaryUpstream,
        start,
        flowScale,
      )
      if (nodes.length < 2)
        continue

      if (sourceMask[start] !== 0)
        nodes[0].width *= 0.2
      paths.push({
        points: this.buildSmoothPath(nodes, start),
        closed: false,
      })
    }

    const junctions: SphericalRiverJunction[] = []
    for (let region = 0; region < mesh.numRegions; region++) {
      if (incomingCount[region] < 2)
        continue
      junctions.push({
        position: this.getRegionPosition(mesh, region),
        width: this.getWidth(
          rivers.flowAccumulation[region],
          rivers.thresholdFlow,
          flowScale,
          rivers.riverSeasonality[region],
        ),
      })
    }

    return { paths, junctions }
  }

  private buildRiverPath(
    mesh: SphericalMesh,
    rivers: SphericalRiverData,
    landMask: Uint8Array,
    outgoing: Int32Array,
    primaryUpstream: Int32Array,
    start: number,
    flowScale: number,
  ): SphericalStrokePoint[] {
    const nodes: SphericalStrokePoint[] = []
    let current = start

    for (let guard = 0; guard <= mesh.numRegions; guard++) {
      nodes.push({
        position: this.getRegionPosition(mesh, current),
        width: this.getWidth(
          rivers.flowAccumulation[current],
          rivers.thresholdFlow,
          flowScale,
          rivers.riverSeasonality[current],
        ),
      })

      const target = outgoing[current]
      if (target < 0)
        break

      if (landMask[target] === 0) {
        nodes.push({
          position: this.getMouthPosition(mesh, current, target),
          width: Math.min(MAX_MOUTH_WIDTH, nodes[nodes.length - 1].width * MOUTH_WIDTH_FACTOR),
        })
        break
      }

      if (primaryUpstream[target] !== current) {
        // 支流保持自身河宽抵达汇流点，不继承汇流后的干流流量。
        nodes.push({
          position: this.getRegionPosition(mesh, target),
          width: nodes[nodes.length - 1].width,
        })
        break
      }

      current = target
    }

    return nodes
  }

  private buildSmoothPath(
    nodes: SphericalStrokePoint[],
    pathSeed: number,
  ): SphericalStrokePoint[] {
    const amended: SphericalStrokePoint[] = []

    for (let index = 0; index < nodes.length; index++) {
      const current = nodes[index]
      amended.push(current)
      if (index + 1 >= nodes.length)
        continue

      const next = nodes[index + 1]
      const oneThird = this.normalizedLerp(current.position, next.position, 1 / 3)
      const twoThirds = this.normalizedLerp(current.position, next.position, 2 / 3)
      const lateral = this.normalize(this.cross(current.position, next.position))
      const chordLength = this.distance(current.position, next.position)
      const meander = chordLength
        * (0.035 + deterministicUnit(RIVER_MEANDER_SEED, pathSeed, index) * 0.045)
      const firstSide = deterministicUnit(RIVER_MEANDER_SEED + 1, pathSeed, index) < 0.5 ? -1 : 1
      const secondSide = deterministicUnit(RIVER_MEANDER_SEED + 2, pathSeed, index) < 0.62
        ? -firstSide
        : firstSide

      amended.push({
        position: this.offsetOnSphere(oneThird, lateral, meander * firstSide),
        width: current.width + (next.width - current.width) / 3,
      })
      amended.push({
        position: this.offsetOnSphere(twoThirds, lateral, meander * secondSide),
        width: current.width + (next.width - current.width) * 2 / 3,
      })
    }

    const pathPoints: SphericalStrokePoint[] = []
    for (let segment = 0; segment < amended.length - 1; segment++) {
      const previous = segment > 0 ? amended[segment - 1] : amended[segment]
      const start = amended[segment]
      const end = amended[segment + 1]
      const next = segment + 2 < amended.length ? amended[segment + 2] : end
      const control1 = this.add(
        start.position,
        this.scale(this.subtract(end.position, previous.position), 1 / 6),
      )
      const control2 = this.subtract(
        end.position,
        this.scale(this.subtract(next.position, start.position), 1 / 6),
      )

      for (let sample = 0; sample < SAMPLES_PER_CURVE_SEGMENT; sample++) {
        const amount = sample / SAMPLES_PER_CURVE_SEGMENT
        pathPoints.push({
          position: this.normalize(this.evalCubicBezier(
            start.position,
            control1,
            control2,
            end.position,
            amount,
          )),
          width: start.width + (end.width - start.width) * amount,
        })
      }
    }

    const last = amended[amended.length - 1]
    pathPoints.push({ position: last.position, width: last.width })
    return pathPoints
  }

  private getRegionPosition(mesh: SphericalMesh, region: number): SphericalPoint {
    const index = region * 3
    return [
      mesh.regionPosition[index],
      mesh.regionPosition[index + 1],
      mesh.regionPosition[index + 2],
    ]
  }

  private getMouthPosition(
    mesh: SphericalMesh,
    landRegion: number,
    waterRegion: number,
  ): SphericalPoint {
    const boundary = mesh.voronoi.getSharedBoundaryCorners(landRegion, waterRegion)
    if (!boundary) {
      return this.normalizedLerp(
        this.getRegionPosition(mesh, landRegion),
        this.getRegionPosition(mesh, waterRegion),
        0.5,
      )
    }
    const a = boundary[0] * 3
    const b = boundary[1] * 3
    return this.normalize([
      mesh.voronoi.cornerPosition[a] + mesh.voronoi.cornerPosition[b],
      mesh.voronoi.cornerPosition[a + 1] + mesh.voronoi.cornerPosition[b + 1],
      mesh.voronoi.cornerPosition[a + 2] + mesh.voronoi.cornerPosition[b + 2],
    ])
  }

  private normalizedLerp(start: SphericalPoint, end: SphericalPoint, amount: number): SphericalPoint {
    return this.normalize([
      start[0] + (end[0] - start[0]) * amount,
      start[1] + (end[1] - start[1]) * amount,
      start[2] + (end[2] - start[2]) * amount,
    ])
  }

  private offsetOnSphere(
    position: SphericalPoint,
    direction: SphericalPoint,
    amount: number,
  ): SphericalPoint {
    return this.normalize(this.add(position, this.scale(direction, amount)))
  }

  private evalCubicBezier(
    start: SphericalPoint,
    control1: SphericalPoint,
    control2: SphericalPoint,
    end: SphericalPoint,
    amount: number,
  ): SphericalPoint {
    const inverse = 1 - amount
    const inverse2 = inverse * inverse
    const amount2 = amount * amount
    return [
      inverse2 * inverse * start[0]
      + 3 * inverse2 * amount * control1[0]
      + 3 * inverse * amount2 * control2[0]
      + amount2 * amount * end[0],
      inverse2 * inverse * start[1]
      + 3 * inverse2 * amount * control1[1]
      + 3 * inverse * amount2 * control2[1]
      + amount2 * amount * end[1],
      inverse2 * inverse * start[2]
      + 3 * inverse2 * amount * control1[2]
      + 3 * inverse * amount2 * control2[2]
      + amount2 * amount * end[2],
    ]
  }

  private add(a: SphericalPoint, b: SphericalPoint): SphericalPoint {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
  }

  private subtract(a: SphericalPoint, b: SphericalPoint): SphericalPoint {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  }

  private scale(value: SphericalPoint, amount: number): SphericalPoint {
    return [value[0] * amount, value[1] * amount, value[2] * amount]
  }

  private cross(a: SphericalPoint, b: SphericalPoint): SphericalPoint {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ]
  }

  private distance(a: SphericalPoint, b: SphericalPoint): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  }

  private normalize(value: SphericalPoint): SphericalPoint {
    const length = Math.hypot(...value) || 1
    return [value[0] / length, value[1] / length, value[2] / length]
  }

  private getFlowScale(rivers: SphericalRiverData): number {
    const flows: number[] = []
    for (const region of rivers.segmentSource)
      flows.push(rivers.flowAccumulation[region])
    if (flows.length === 0)
      return rivers.thresholdFlow
    flows.sort((a, b) => a - b)
    const percentileIndex = Math.floor((flows.length - 1) * 0.98)
    return Math.max(rivers.thresholdFlow, flows[percentileIndex])
  }

  private getWidth(
    flow: number,
    threshold: number,
    flowScale: number,
    seasonality = 0,
  ): number {
    const baseline = Math.max(threshold, Number.EPSILON)
    const range = Math.log(Math.max(flowScale, baseline) / baseline)
    const normalized = range > 0
      ? Math.log(Math.max(flow, baseline) / baseline) / range
      : 0
    const shaped = Math.max(0, Math.min(1, normalized)) ** RIVER_WIDTH_EXPONENT
    const annualWidth
      = MIN_RIVER_WIDTH + (MAX_RIVER_WIDTH - MIN_RIVER_WIDTH) * shaped
    const seasonalWidthFactor = 1
      - Math.max(0, Math.min(1, seasonality)) * MAX_SEASONAL_WIDTH_REDUCTION
    return annualWidth * seasonalWidthFactor
  }
}
