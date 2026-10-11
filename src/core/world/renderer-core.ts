import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjectionId } from '@/core/projections/map-projection'
import type { WorldViewMode } from '@/core/rendering/view-mode'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { GlobeView } from '@/core/rendering/globe/view'

export class RendererCore {
  private readonly globeView: GlobeView

  constructor(
    canvas: HTMLCanvasElement,
    config: WorldConfig,
    onRegionSelected: (region: number, settlementId?: number, routeId?: number) => void,
  ) {
    this.globeView = new GlobeView(canvas, config, onRegionSelected)
  }

  setWorld(mesh: SphericalMesh, data: WorldSimulationState, config: WorldConfig) {
    this.globeView.setWorld(mesh, data, config)
  }

  updateAppearance(config: WorldConfig) {
    this.globeView.updateAppearance(config)
  }

  setViewMode(mode: WorldViewMode): void {
    this.globeView.setViewMode(mode)
  }

  setMapProjection(id: MapProjectionId): void {
    this.globeView.setMapProjection(id)
  }

  resetCamera(): void {
    this.globeView.resetCamera()
  }

  selectRegion(region: number): void {
    this.globeView.selectRegion(region)
  }

  destroy(): void {
    this.globeView.destroy()
  }

  get enableRegionPicking(): boolean {
    return this.globeView.enableRegionPicking
  }

  set enableRegionPicking(enabled: boolean) {
    this.globeView.enableRegionPicking = enabled
  }
}
