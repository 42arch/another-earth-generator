import type { WorldMapReader } from '@another-earth/world-core'
import type { MapPickResult } from '#picking/map-picker'
import type { AtlasView } from '#rendering/atlas-view'
import type { GlobeView } from '#rendering/globe-view'
import type { MapViewportMode } from '#styles/spec'
import * as THREE from 'three'
import { isPointerClickGesture, MapPicker } from '#picking/map-picker'

export interface WorldViewportOptions {
  readonly host?: HTMLElement | null
  readonly canvas?: HTMLCanvasElement | null
  readonly renderer?: THREE.WebGLRenderer | null
  readonly width?: number
  readonly height?: number
  readonly pixelRatio?: number
  readonly onPick?: (result: MapPickResult) => void
  readonly onContextLost?: () => void
  readonly onContextRestored?: () => void
}

/**
 * Manages the single `THREE.WebGLRenderer` (`outputColorSpace = SRGBColorSpace`,
 * DPR clamped to `Math.min(devicePixelRatio, 2)`), dual `GlobeView` & `AtlasView` switching,
 * pointer click picking (`<= 4px` drag tolerance), `webglcontextlost` / `webglcontextrestored` events,
 * and frame rendering.
 */
export class WorldViewport {
  readonly renderer: THREE.WebGLRenderer | null
  readonly canvas: HTMLCanvasElement | null
  readonly picker = new MapPicker()

  private activeReader: WorldMapReader | null = null
  private activeGlobeView: GlobeView | null = null
  private activeAtlasView: AtlasView | null = null
  private activeViewMode: MapViewportMode = 'globe'
  private savedGlobePose: { longitudeDegrees: number, latitudeDegrees: number, styleZoom: number } | null = null
  private widthCssPx: number
  private heightCssPx: number
  private pixelRatio: number
  private animationFrameId: number | null = null
  private pointerDownPos: { x: number, y: number } | null = null
  private readonly onPick?: (result: MapPickResult) => void
  private readonly onContextLost?: () => void
  private readonly onContextRestored?: () => void
  private resizeObserver: ResizeObserver | null = null
  private readonly cleanupDomListeners: (() => void)[] = []
  private readonly ownsRenderer: boolean
  private disposed = false

  constructor(options: WorldViewportOptions = {}) {
    const initialHostWidth = options.host && options.host.clientWidth > 0 ? options.host.clientWidth : undefined
    const initialHostHeight = options.host && options.host.clientHeight > 0 ? options.host.clientHeight : undefined
    this.widthCssPx = Math.max(1, options.width ?? initialHostWidth ?? 1280)
    this.heightCssPx = Math.max(1, options.height ?? initialHostHeight ?? 720)
    const rawDpr = options.pixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1)
    this.pixelRatio = Math.min(Math.max(1, rawDpr || 1), 2)
    this.onPick = options.onPick
    this.onContextLost = options.onContextLost
    this.onContextRestored = options.onContextRestored

    if (options.renderer !== undefined) {
      this.renderer = options.renderer
      this.ownsRenderer = false
      this.canvas = options.renderer?.domElement ?? options.canvas ?? null
    }
    else if (typeof window !== 'undefined' && (options.host || options.canvas)) {
      const renderer = new THREE.WebGLRenderer({
        canvas: options.canvas ?? undefined,
        antialias: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      })
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.setClearColor('#030308')
      renderer.setPixelRatio(this.pixelRatio)
      renderer.setSize(this.widthCssPx, this.heightCssPx, false)
      renderer.domElement.setAttribute('aria-label', '行星制图视口')
      renderer.domElement.style.display = 'block'
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      renderer.domElement.style.touchAction = 'none'
      if (options.host && !options.canvas) {
        options.host.append(renderer.domElement)
      }
      this.renderer = renderer
      this.ownsRenderer = true
      this.canvas = renderer.domElement
    }
    else {
      this.renderer = null
      this.ownsRenderer = false
      this.canvas = options.canvas ?? null
    }

    if (this.canvas) {
      this.attachCanvasListeners(this.canvas)
    }
    if (options.host && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.disposed || !options.host)
          return
        const w = Math.max(1, options.host.clientWidth || 1)
        const h = Math.max(1, options.host.clientHeight || 1)
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1
        this.resize(w, h, dpr)
      })
      this.resizeObserver.observe(options.host)
    }
  }

  private attachCanvasListeners(canvas: HTMLCanvasElement): void {
    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0)
        return
      this.pointerDownPos = { x: e.clientX, y: e.clientY }
    }

    const onPointerUp = (e: PointerEvent): void => {
      if (e.button !== 0 || !this.pointerDownPos)
        return
      const down = this.pointerDownPos
      this.pointerDownPos = null
      if (!isPointerClickGesture(down.x, down.y, e.clientX, e.clientY))
        return

      const rect = canvas.getBoundingClientRect()
      const screenX = e.clientX - rect.left
      const screenY = e.clientY - rect.top
      const hit = this.pickAtScreenPoint(screenX, screenY)
      if (hit && this.onPick) {
        this.onPick(hit)
      }
    }

    const onLost = (e: Event): void => {
      e.preventDefault()
      this.onContextLost?.()
    }

    const onRestored = (): void => {
      this.onContextRestored?.()
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)

    this.cleanupDomListeners.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
    })
  }

  setActiveViews(
    reader: WorldMapReader | null,
    globeView: GlobeView | null,
    atlasView: AtlasView | null,
    viewMode: MapViewportMode = 'globe',
  ): void {
    this.activeReader = reader
    this.activeGlobeView = globeView
    this.activeAtlasView = atlasView
    this.activeViewMode = viewMode
    if (globeView) {
      globeView.resize(this.widthCssPx, this.heightCssPx, this.pixelRatio)
      if (globeView.controls) {
        globeView.controls.enabled = viewMode === 'globe'
      }
    }
    if (atlasView) {
      atlasView.resize(this.widthCssPx, this.heightCssPx, this.pixelRatio)
    }
  }

  setActiveGlobeView(reader: WorldMapReader | null, globeView: GlobeView | null): void {
    this.setActiveViews(reader, globeView, this.activeAtlasView, 'globe')
  }

  setViewMode(nextMode: MapViewportMode): void {
    if (this.disposed || this.activeViewMode === nextMode)
      return

    if (nextMode === 'atlas' && this.activeGlobeView && this.activeAtlasView) {
      this.savedGlobePose = this.activeGlobeView.getCenterCoordinates()
      this.activeAtlasView.frameWorld()
      if (this.activeGlobeView.controls) {
        this.activeGlobeView.controls.enabled = false
      }
    }
    else if (nextMode === 'globe' && this.activeGlobeView) {
      if (this.savedGlobePose) {
        const pose = this.savedGlobePose
        this.savedGlobePose = null
        this.activeGlobeView.setCenterCoordinates(pose.longitudeDegrees, pose.latitudeDegrees, pose.styleZoom)
      }
      if (this.activeGlobeView.controls) {
        this.activeGlobeView.controls.enabled = true
      }
    }

    this.activeViewMode = nextMode
  }

  getViewMode(): MapViewportMode {
    return this.activeViewMode
  }

  /** Drop the globe pose captured on entering the atlas, so a later return keeps the globe where it is now. */
  forgetSavedGlobePose(): void {
    this.savedGlobePose = null
  }

  getCenterCoordinates(): { longitudeDegrees: number, latitudeDegrees: number, styleZoom: number } | null {
    if (this.activeViewMode === 'atlas' && this.activeAtlasView) {
      return this.activeAtlasView.getCenterCoordinates()
    }
    if (this.activeGlobeView) {
      return this.activeGlobeView.getCenterCoordinates()
    }
    return null
  }

  setCenterCoordinates(longitudeDegrees: number, latitudeDegrees: number, styleZoom?: number): void {
    this.activeGlobeView?.setCenterCoordinates(longitudeDegrees, latitudeDegrees, styleZoom)
    this.activeAtlasView?.setCenterCoordinates(longitudeDegrees, latitudeDegrees, styleZoom)
  }

  resize(widthCssPx: number, heightCssPx: number, pixelRatio?: number): void {
    if (this.disposed)
      return
    this.widthCssPx = Math.max(1, widthCssPx)
    this.heightCssPx = Math.max(1, heightCssPx)
    if (pixelRatio !== undefined) {
      this.pixelRatio = Math.min(Math.max(1, pixelRatio), 2)
    }
    if (this.renderer) {
      this.renderer.setPixelRatio(this.pixelRatio)
      this.renderer.setSize(this.widthCssPx, this.heightCssPx, false)
    }
    this.activeGlobeView?.resize(this.widthCssPx, this.heightCssPx, this.pixelRatio)
    this.activeAtlasView?.resize(this.widthCssPx, this.heightCssPx, this.pixelRatio)
  }

  getSize(): { width: number, height: number, pixelRatio: number } {
    return {
      width: this.widthCssPx,
      height: this.heightCssPx,
      pixelRatio: this.pixelRatio,
    }
  }

  pickAtScreenPoint(screenX: number, screenY: number): MapPickResult | null {
    if (this.disposed || !this.activeReader)
      return null

    if (this.activeViewMode === 'atlas' && this.activeAtlasView) {
      return this.picker.pickAtlas({
        reader: this.activeReader,
        camera: this.activeAtlasView.camera,
        projection: this.activeAtlasView.getProjection(),
        screenX,
        screenY,
        viewportWidth: this.widthCssPx,
        viewportHeight: this.heightCssPx,
        orderedLayers: this.activeAtlasView.getPickableLayersInStyleOrder(),
      })
    }

    if (!this.activeGlobeView)
      return null

    return this.picker.pickGlobe({
      reader: this.activeReader,
      camera: this.activeGlobeView.camera,
      screenX,
      screenY,
      viewportWidth: this.widthCssPx,
      viewportHeight: this.heightCssPx,
      orderedLayers: this.activeGlobeView.getPickableLayersInStyleOrder(),
      planetSpinRadians: this.activeGlobeView.getPlanetSpinRadians(),
    })
  }

  renderFrame(): void {
    if (this.disposed)
      return
    if (this.activeViewMode === 'atlas' && this.activeAtlasView) {
      this.activeAtlasView.updateFrame()
      if (this.renderer) {
        this.renderer.render(this.activeAtlasView.scene, this.activeAtlasView.camera)
      }
      return
    }
    if (this.activeGlobeView) {
      this.activeGlobeView.updateFrame()
      if (this.renderer) {
        this.renderer.render(this.activeGlobeView.scene, this.activeGlobeView.camera)
      }
    }
  }

  startLoop(): void {
    if (this.disposed || this.animationFrameId !== null || typeof requestAnimationFrame !== 'function')
      return
    const tick = (): void => {
      if (this.disposed)
        return
      this.renderFrame()
      this.animationFrameId = requestAnimationFrame(tick)
    }
    this.animationFrameId = requestAnimationFrame(tick)
  }

  stopLoop(): void {
    if (this.animationFrameId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
  }

  dispose(): void {
    if (this.disposed)
      return
    this.disposed = true
    this.stopLoop()
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    for (const fn of this.cleanupDomListeners)
      fn()
    this.cleanupDomListeners.length = 0
    if (this.ownsRenderer && this.renderer) {
      this.renderer.dispose()
      this.renderer.domElement.remove()
    }
  }
}
