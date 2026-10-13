import type { Vector2, Vector3 } from 'three'
import type SphericalMesh from '@/core/mesh/mesh'

/**
 * 将指针事件坐标转换为标准 NDC (归一化设备坐标: [-1, 1])
 */
export function getNormalizedDeviceCoordinates(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  target: Vector2 | Vector3,
): void {
  const bounds = canvas.getBoundingClientRect()
  target.x = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1
  target.y = -((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 + 1
}

/**
 * 根据三维单位球面方向向量，在整个网格中查找最近的区域（点积最大）
 */
export function findNearestMeshRegion(
  mesh: SphericalMesh,
  dirX: number,
  dirY: number,
  dirZ: number,
): number {
  let selected = -1
  let bestDot = -Infinity
  for (let region = 0; region < mesh.numRegions; region++) {
    const offset = region * 3
    const dot = dirX * mesh.regionPosition[offset]
      + dirY * mesh.regionPosition[offset + 1]
      + dirZ * mesh.regionPosition[offset + 2]
    if (dot > bestDot) {
      bestDot = dot
      selected = region
    }
  }
  return selected >= 0 ? selected : 0
}

/**
 * 在局部候选区域列表中查找与方向向量最近的区域（点积最大）
 */
export function findNearestCandidateRegion(
  mesh: SphericalMesh,
  dirX: number,
  dirY: number,
  dirZ: number,
  candidates: readonly number[],
): number {
  let selected = candidates[0] ?? 0
  let bestDot = -Infinity
  for (const region of candidates) {
    const offset = region * 3
    const dot = dirX * mesh.regionPosition[offset]
      + dirY * mesh.regionPosition[offset + 1]
      + dirZ * mesh.regionPosition[offset + 2]
    if (dot > bestDot) {
      bestDot = dot
      selected = region
    }
  }
  return selected
}
