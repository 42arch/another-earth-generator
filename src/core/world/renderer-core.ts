import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjectionId } from '@/core/projections/map-projection'
import type { WorldViewMode } from '@/core/rendering'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { WorldViewport } from '@/core/rendering'

export class RendererCore {
  private readonly viewport: WorldViewport

  constructor(
    canvas: HTMLCanvasElement,
    config: WorldConfig,
    onRegionSelected: (region: number, settlementId?: number, routeId?: number) => void,
  ) {
    this.viewport = new WorldViewport(canvas, config, onRegionSelected)
  }

  setWorld(mesh: SphericalMesh, data: WorldSimulationState, config: WorldConfig) {
    this.viewport.setWorld(mesh, data, config)
  }

  updateAppearance(config: WorldConfig) {
    this.viewport.updateAppearance(config)
  }

  setViewMode(mode: WorldViewMode): void {
    this.viewport.setViewMode(mode)
  }

  setMapProjection(id: MapProjectionId): void {
    this.viewport.setMapProjection(id)
  }

  resetCamera(): void {
    this.viewport.resetCamera()
  }

  selectRegion(region: number): void {
    this.viewport.selectRegion(region)
  }

  destroy(): void {
    this.viewport.destroy()
  }

  get enableRegionPicking(): boolean {
    return this.viewport.enableRegionPicking
  }

  set enableRegionPicking(enabled: boolean) {
    this.viewport.enableRegionPicking = enabled
  }
}
