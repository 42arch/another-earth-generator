export type SphericalPoint = [number, number, number]

export type SphericalColor = readonly [number, number, number]

export interface SphericalLineSegment {
  start: string
  end: string
}

export interface SphericalLinePath {
  points: SphericalPoint[]
  closed: boolean
  keys?: string[]
}

export interface SphericalStrokePoint {
  position: SphericalPoint
  width: number
  color?: SphericalColor
  /** Optional radial offset from the base sphere for draping over displaced terrain. */
  surfaceOffset?: number
  /** Scales the map ribbon's minimum screen width, allowing a tapered path start. */
  widthFloorScale?: number
}

export interface SphericalStrokePath {
  points: SphericalStrokePoint[]
  closed: boolean
}

/**
 * 将共享端点的无向线段拼接成独立的开口路径或闭环。
 * 海岸线、路线网络和同一阈值的等高线均可复用此球面拓扑步骤。
 */
export function stitchSphericalSegments(
  segments: readonly SphericalLineSegment[],
  pointByKey: ReadonlyMap<string, SphericalPoint>,
): SphericalLinePath[] {
  const adjacency = new Map<string, number[]>()
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (segment.start === segment.end)
      continue
    appendAdjacent(adjacency, segment.start, index)
    appendAdjacent(adjacency, segment.end, index)
  }

  const visited = new Uint8Array(segments.length)
  const paths: SphericalLinePath[] = []
  for (let index = 0; index < segments.length; index++) {
    if (visited[index] !== 0)
      continue

    const initial = segments[index]
    if (initial.start === initial.end)
      continue
    const start = (adjacency.get(initial.start)?.length ?? 0) !== 2
      ? initial.start
      : (adjacency.get(initial.end)?.length ?? 0) !== 2
          ? initial.end
          : initial.start

    const keys = [start]
    let currentKey = start
    let currentSegment = index
    let closed = false

    for (let guard = 0; guard <= segments.length; guard++) {
      visited[currentSegment] = 1
      const segment = segments[currentSegment]
      const nextKey = segment.start === currentKey ? segment.end : segment.start
      keys.push(nextKey)
      if (nextKey === start) {
        closed = true
        keys.pop()
        break
      }

      const nextSegment = adjacency.get(nextKey)?.find(candidate => visited[candidate] === 0)
      if (nextSegment === undefined)
        break
      currentKey = nextKey
      currentSegment = nextSegment
    }

    const points = keys
      .map(key => pointByKey.get(key))
      .filter((point): point is SphericalPoint => point !== undefined)
    if (points.length >= (closed ? 3 : 2))
      paths.push({ points, closed, keys: keys.slice() })
  }

  return paths
}

/**
 * 使用保守的 Catmull–Rom 等价三次 Bézier 曲线平滑路径。
 * 每个采样点均回投到单位球面，避免曲线落入球体内部。
 */
export function createSmoothSphericalLinePositions(
  paths: readonly SphericalLinePath[],
  radius: number,
  smoothness: number,
  samplesPerSegment: number,
): Float32Array {
  const positions: number[] = []
  for (const path of paths) {
    const sampled = sampleSmoothSphericalPath(path, smoothness, samplesPerSegment)
    const segmentCount = path.closed ? sampled.length : sampled.length - 1
    for (let index = 0; index < segmentCount; index++) {
      const start = sampled[index]
      const end = sampled[(index + 1) % sampled.length]
      positions.push(
        start[0] * radius,
        start[1] * radius,
        start[2] * radius,
        end[0] * radius,
        end[1] * radius,
        end[2] * radius,
      )
    }
  }
  return new Float32Array(positions)
}

export function sampleSmoothSphericalPath(
  path: SphericalLinePath,
  smoothness: number,
  samplesPerSegment: number,
): SphericalPoint[] {
  const result: SphericalPoint[] = []
  const segmentCount = path.closed ? path.points.length : path.points.length - 1
  const amount = Math.max(0, Math.min(1, smoothness))
  const samples = Math.max(1, Math.floor(samplesPerSegment))

  for (let index = 0; index < segmentCount; index++) {
    const previous = path.closed
      ? path.points[(index - 1 + path.points.length) % path.points.length]
      : path.points[Math.max(0, index - 1)]
    const start = path.points[index]
    const end = path.points[(index + 1) % path.points.length]
    const next = path.closed
      ? path.points[(index + 2) % path.points.length]
      : path.points[Math.min(path.points.length - 1, index + 2)]
    const control1 = add(start, scale(subtract(end, previous), amount / 6))
    const control2 = subtract(end, scale(subtract(next, start), amount / 6))

    for (let sample = 0; sample < samples; sample++) {
      result.push(normalize(evalCubicBezier(
        start,
        control1,
        control2,
        end,
        sample / samples,
      )))
    }
  }

  if (!path.closed)
    result.push(path.points[path.points.length - 1])
  return result
}

/**
 * 平滑带有宽度与颜色语义的球面路径。几何位置使用球面曲线，样式属性
 * 沿原始河段或路线插值，宽度使用缓动过渡，供 2D/3D 渲染器生成最终几何。
 */
export function sampleSmoothSphericalStrokePath(
  path: SphericalStrokePath,
  smoothness: number,
  samplesPerSegment: number,
): SphericalStrokePath {
  const linePath: SphericalLinePath = {
    points: path.points.map(point => point.position),
    closed: path.closed,
  }
  const positions = sampleSmoothSphericalPath(linePath, smoothness, samplesPerSegment)
  const samples = Math.max(1, Math.floor(samplesPerSegment))
  const points: SphericalStrokePoint[] = positions.map((position, sampledIndex) => {
    if (!path.closed && sampledIndex === positions.length - 1) {
      const last = path.points[path.points.length - 1]
      return {
        position,
        width: last.width,
        color: last.color,
        surfaceOffset: last.surfaceOffset,
        widthFloorScale: last.widthFloorScale,
      }
    }
    const segment = Math.min(
      path.closed ? path.points.length - 1 : path.points.length - 2,
      Math.floor(sampledIndex / samples),
    )
    const amount = sampledIndex % samples / samples
    return interpolateStrokePoint(
      path.points[segment],
      path.points[(segment + 1) % path.points.length],
      position,
      amount,
    )
  })
  return { points, closed: path.closed }
}

function interpolateStrokePoint(
  start: SphericalStrokePoint,
  end: SphericalStrokePoint,
  position: SphericalPoint,
  amount: number,
): SphericalStrokePoint {
  const easedAmount = amount * amount * (3 - 2 * amount)
  return {
    position,
    width: start.width + (end.width - start.width) * easedAmount,
    surfaceOffset: start.surfaceOffset !== undefined && end.surfaceOffset !== undefined
      ? start.surfaceOffset + (end.surfaceOffset - start.surfaceOffset) * amount
      : start.surfaceOffset ?? end.surfaceOffset,
    widthFloorScale: start.widthFloorScale !== undefined && end.widthFloorScale !== undefined
      ? start.widthFloorScale + (end.widthFloorScale - start.widthFloorScale) * easedAmount
      : start.widthFloorScale ?? end.widthFloorScale,
    color: start.color && end.color
      ? [
          start.color[0] + (end.color[0] - start.color[0]) * amount,
          start.color[1] + (end.color[1] - start.color[1]) * amount,
          start.color[2] + (end.color[2] - start.color[2]) * amount,
        ]
      : start.color ?? end.color,
  }
}

function appendAdjacent(adjacency: Map<string, number[]>, key: string, segment: number): void {
  const existing = adjacency.get(key)
  if (existing)
    existing.push(segment)
  else
    adjacency.set(key, [segment])
}

function evalCubicBezier(
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

function normalize(value: SphericalPoint): SphericalPoint {
  const length = Math.hypot(...value) || 1
  return [value[0] / length, value[1] / length, value[2] / length]
}

function add(a: SphericalPoint, b: SphericalPoint): SphericalPoint {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function subtract(a: SphericalPoint, b: SphericalPoint): SphericalPoint {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function scale(value: SphericalPoint, amount: number): SphericalPoint {
  return [value[0] * amount, value[1] * amount, value[2] * amount]
}
