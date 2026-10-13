import type { Object3D } from 'three'
import type { MapProjection } from '@/core/projections/map-projection'

/**
 * 为二维地图图层对象生成跨日界线 (WrapX) 的左右平移副本并挂载到宿主容器
 */
export function addWrappedCopies<T extends Object3D>(
  hostGroup: Object3D,
  baseLayer: T,
  projection: MapProjection,
): void {
  hostGroup.add(baseLayer)
  if (!projection.wrapX)
    return

  const leftCopy = baseLayer.clone()
  leftCopy.position.x = -projection.worldWidth
  hostGroup.add(leftCopy)

  const rightCopy = baseLayer.clone()
  rightCopy.position.x = projection.worldWidth
  hostGroup.add(rightCopy)
}
