import type { GeoJsonFeatureHit } from '@/core/data-source'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjectionId } from '@/core/projections/map-projection'
import type { IPlanetaryView, WorldViewMode } from '@/core/rendering/planetary-view'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { SRGBColorSpace, WebGLRenderer } from 'three'
import { GlobeView } from '@/core/rendering/globe/view'
import { MapView } from '@/core/rendering/map/view'

/**
 * 视口总控协调器 (WorldViewport)
 * 职责：
 * 1. 管理单一 WebGL 渲染管线、画布尺寸监听与全局 requestAnimationFrame 循环；
 * 2. 对等持有 3D 地球视角 (GlobeView) 与 2D 地图视角 (MapView)；
 * 3. 负责视图模式切换 (Globe vs Map) 及画布指针事件分发 (点击拾取)。
 */
export class WorldViewport {
  private readonly renderer: WebGLRenderer
  private readonly globeView: GlobeView
  private readonly mapView: MapView
  private readonly resizeObserver: ResizeObserver
  private readonly canvas: HTMLCanvasElement
  private readonly onRegionSelected: (region: number, settlementId?: number, routeId?: number) => void

  private viewMode: WorldViewMode = 'globe'
  private params: WorldConfig
  private mesh: SphericalMesh | null = null
  private data: WorldSimulationState | null = null

  private pointerStartX = 0
  private pointerStartY = 0
  public enableRegionPicking = false

  constructor(
    canvas: HTMLCanvasElement,
    params: WorldConfig,
    onRegionSelected: (region: number, settlementId?: number, routeId?: number) => void,
  ) {
    this.canvas = canvas
    this.params = { ...params }
    this.onRegionSelected = onRegionSelected

    this.renderer = new WebGLRenderer({ canvas, antialias: true })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    this.globeView = new GlobeView(canvas, params)
    this.mapView = new MapView(canvas, params)

    const isGlobe = this.viewMode === 'globe'
    this.globeView.setActive(isGlobe)
    this.mapView.setActive(!isGlobe)

    this.resizeObserver = new ResizeObserver(this.handleResize)
    this.resizeObserver.observe(canvas)
    canvas.addEventListener('pointerdown', this.handlePointerDown)
    canvas.addEventListener('pointerup', this.handlePointerUp)
    this.handleResize()

    this.renderer.setAnimationLoop(this.render)
  }

  setWorld(mesh: SphericalMesh, data: WorldSimulationState, params: WorldConfig): void {
    this.mesh = mesh
    this.data = data
    this.params = { ...params }

    this.globeView.setWorld(mesh, data, params)
    this.mapView.setWorld(mesh, data, params)
  }

  updateAppearance(params: WorldConfig): void {
    this.params = { ...params }
    this.globeView.updateAppearance(params)
    this.mapView.updateAppearance(params)
  }

  setViewMode(mode: WorldViewMode): void {
    if (this.viewMode === mode)
      return
    this.viewMode = mode
    const isGlobe = mode === 'globe'
    this.globeView.setActive(isGlobe)
    this.mapView.setActive(!isGlobe)
  }

  setMapProjection(id: MapProjectionId): void {
    this.mapView.setProjection(id)
  }

  resetCamera(): void {
    this.getActiveView().resetCamera()
  }

  selectRegion(region: number): void {
    this.globeView.selectRegion(region)
    this.mapView.selectRegion(region)
  }

  clearSelection(): void {
    this.globeView.clearSelection()
    this.mapView.clearSelection()
  }

  pickGeoJsonFeature(event: PointerEvent): GeoJsonFeatureHit | null {
    return this.getActiveView().pickGeoJsonFeature(event)
  }

  destroy(): void {
    this.renderer.setAnimationLoop(null)
    this.resizeObserver.disconnect()
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown)
    this.canvas.removeEventListener('pointerup', this.handlePointerUp)
    this.globeView.destroy()
    this.mapView.destroy()
    this.renderer.dispose()
  }

  private getActiveView(): IPlanetaryView {
    return this.viewMode === 'map' ? this.mapView : this.globeView
  }

  private render = () => {
    const activeView = this.getActiveView()
    activeView.update()
    this.renderer.render(activeView.scene, activeView.camera)
  }

  private handleResize = () => {
    const width = Math.max(1, this.canvas.clientWidth)
    const height = Math.max(1, this.canvas.clientHeight)
    this.renderer.setSize(width, height, false)
    this.globeView.resize(width, height)
    this.mapView.resize(width, height)
  }

  private handlePointerDown = (event: PointerEvent) => {
    this.pointerStartX = event.clientX
    this.pointerStartY = event.clientY
  }

  private handlePointerUp = (event: PointerEvent) => {
    if (
      Math.hypot(event.clientX - this.pointerStartX, event.clientY - this.pointerStartY) > 4
      || !this.mesh
    ) {
      return
    }

    const activeView = this.getActiveView()

    // 优先拾取城市聚落要素
    const settlementId = activeView.pickSettlement(event)
    if (settlementId !== null && this.data?.civilization) {
      const region = this.data.civilization.settlements[settlementId].region
      this.onRegionSelected(region, settlementId)
      return
    }

    // 区域与交通航线拾取判定
    if (!this.enableRegionPicking && !this.params.appearance.overlays.routes)
      return

    const region = activeView.pick(event)
    if (region === null)
      return

    const routeId = this.params.appearance.overlays.routes
      ? this.data?.civilization?.transport?.routeByRegion[region] ?? -1
      : -1
    if (routeId >= 0) {
      this.onRegionSelected(region, undefined, routeId)
      return
    }

    if (!this.enableRegionPicking)
      return

    this.onRegionSelected(region)
  }
}
