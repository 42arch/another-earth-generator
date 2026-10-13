import type { Camera, Scene } from 'three'
import type { GeoJsonFeatureHit } from '@/core/data-source'
import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'

/**
 * 星球视口展示模式：3D 地球仪视角或 2D 投影平面地图视角
 */
export type WorldViewMode = 'globe' | 'map'

/**
 * 球面 3D 地球视角与平面 2D 投影地图视角的对等抽象接口
 */
export interface IPlanetaryView {
  readonly scene: Scene
  readonly camera: Camera

  setWorld: (mesh: SphericalMesh, data: WorldSimulationState, params: WorldConfig) => void
  updateAppearance: (params: WorldConfig) => void
  setActive: (active: boolean) => void
  update: () => void
  resize: (width: number, height: number) => void
  resetCamera: () => void
  selectRegion: (region: number) => void
  clearSelection: () => void
  pick: (event: PointerEvent) => number | null
  pickSettlement: (event: PointerEvent) => number | null
  pickGeoJsonFeature: (event: PointerEvent) => GeoJsonFeatureHit | null
  destroy: () => void
}
