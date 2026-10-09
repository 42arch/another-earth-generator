import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjectionId } from '@/core/projections/map-projection'
import type { WorldViewMode } from '@/core/rendering/view-mode'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { GlobeRenderer } from '@/core/rendering/globe/renderer'

export class RendererCore {
  private readonly globeRenderer: GlobeRenderer

  constructor(
    canvas: HTMLCanvasElement,
    config: WorldConfig,
    onRegionSelected: (region: number, settlementId?: number, routeId?: number) => void,
  ) {
    this.globeRenderer = new GlobeRenderer(canvas, config, onRegionSelected)
  }

  setWorld(mesh: SphericalMesh, data: WorldSimulationState, config: WorldConfig) {
    this.globeRenderer.setWorld(mesh, data, config)
  }

  updateAppearance(config: WorldConfig) {
    this.globeRenderer.updateAppearance(config)
  }

  setViewMode(mode: WorldViewMode): void {
    this.globeRenderer.setViewMode(mode)
  }

  setMapProjection(id: MapProjectionId): void {
    this.globeRenderer.setMapProjection(id)
  }

  resetCamera(): void {
    this.globeRenderer.resetCamera()
  }

  selectRegion(region: number): void {
    this.globeRenderer.selectRegion(region)
  }

  destroy(): void {
    this.globeRenderer.destroy()
  }

  get enableRegionPicking(): boolean {
    return this.globeRenderer.enableRegionPicking
  }

  set enableRegionPicking(enabled: boolean) {
    this.globeRenderer.enableRegionPicking = enabled
  }
}
