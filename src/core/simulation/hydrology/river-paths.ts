import type { SphericalPoint, SphericalStrokePath, SphericalStrokePoint } from '@/core/math/polyline'
import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldSimulationState } from '@/core/simulation/state'
import { sampleSmoothSphericalStrokePath } from '@/core/math/polyline'

function add(a: SphericalPoint, b: SphericalPoint): SphericalPoint {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function subtract(a: SphericalPoint, b: SphericalPoint): SphericalPoint {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function scale(point: SphericalPoint, factor: number): SphericalPoint {
  return [point[0] * factor, point[1] * factor, point[2] * factor]
}

function normalize(point: SphericalPoint): SphericalPoint | null {
  const length = Math.hypot(point[0], point[1], point[2])
  return length > 1e-8
    ? [point[0] / length, point[1] / length, point[2] / length]
    : null
}

function regionPoint(mesh: SphericalMesh, region: number): SphericalPoint {
  const offset = region * 3
  return [
    mesh.regionPosition[offset],
    mesh.regionPosition[offset + 1],
    mesh.regionPosition[offset + 2],
  ]
}

function coastPoint(
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
    const srcPositions = mesh.voronoi.cornerPosition
    return normalize([
      srcPositions[a] + srcPositions[b],
      srcPositions[a + 1] + srcPositions[b + 1],
      srcPositions[a + 2] + srcPositions[b + 2],
    ])
  }
  return null
}

export function widthForFlow(flow: number, maximumFlow: number): number {
  const ratio = Math.sqrt(Math.max(0, Math.min(1, flow / maximumFlow)))
  // Width is a fraction of the unit sphere. The globe scales it by radius;
  // the map ribbon converts it to screen pixels.
  return 0.00055 + ratio * 0.00345
}

/**
 * 沿地表水系流向图拓扑追踪具有宽度的河流几何路径，并进行平滑插值。
 */
export function extractRiverStrokePaths(
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
      const sourcePosition = regionPoint(mesh, region)
      const sourceWidth = widthForFlow(hydrology.flowAccumulation[region], maximumFlow)
      const isPathSource = points.length === 0
      points.push({
        position: sourcePosition,
        width: isPathSource ? sourceWidth * 0.7 : sourceWidth,
        flowAccumulation: hydrology.flowAccumulation[region],
        surfaceOffset: surfaceOffsets?.[region],
        widthFloorScale: isPathSource ? 0.7 : 1,
      })

      if (hydrology.outletMask[region] !== 0) {
        const coast = coastPoint(mesh, region, target)
          ?? normalize(add(sourcePosition, regionPoint(mesh, target)))
        if (coast) {
          const coastOffset = surfaceOffsets
            ? (surfaceOffsets[region] + surfaceOffsets[target]) * 0.5
            : undefined
          points.push({
            position: coast,
            width: sourceWidth * 1.18,
            flowAccumulation: hydrology.flowAccumulation[region],
            surfaceOffset: coastOffset,
          })
        }
        break
      }

      if (hydrology.riverMask[target] === 0 || mainIncoming[target] !== region || used[target] !== 0) {
        const targetPosition = regionPoint(mesh, target)
        let finalPosition = targetPosition
        if (hydrology.riverMask[target] !== 0) {
          const targetWidth = widthForFlow(hydrology.flowAccumulation[target], maximumFlow)
          const direction = normalize(subtract(sourcePosition, targetPosition))
          if (direction) {
            const offset = targetWidth * 0.4
            finalPosition = add(targetPosition, scale(direction, offset)) ?? targetPosition
          }
        }
        points.push({
          position: finalPosition,
          width: sourceWidth,
          flowAccumulation: hydrology.flowAccumulation[target],
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
  // Routing cycle defensive guard
  for (let region = 0; region < mesh.numRegions; region++) {
    if (hydrology.riverMask[region] !== 0 && used[region] === 0)
      appendPath(region)
  }
  return paths
}
