import type { WorldMapReader } from '@another-earth/world-core'
import type { PickableMapLayer } from '#picking/map-picker'
import type { MapProjection, MapProjectionId } from '#projections/map-projections'
import type { GlobeLayerFilterState } from '#rendering/globe-view'
import type { GpuResourceTracker } from '#rendering/gpu-resource-tracker'
import type { CircleLayer } from '#rendering/layers/circle-layer'
import type { FillLayer } from '#rendering/layers/fill-layer'
import type { LineLayer } from '#rendering/layers/line-layer'
import type { SymbolLayer } from '#rendering/layers/symbol-layer'
import type { MapSourceRegistry } from '#sources/registry'
import type { CompiledMapStyle, CompiledMapStyleLayer } from '#styles/compiler'
import * as THREE from 'three'
import {
  buildProjectionSilhouettePoints,
  computeAtlasStyleZoom,
  computeAtlasVisibleWorldHeight,
  EQUAL_EARTH_PROJECTION,
  getMapProjection,
} from '#projections/map-projections'
import { LAYER_STACK, layerRenderOrder } from '#rendering/layer-stack'
import { createCircleLayerFromRegistry } from '#rendering/layers/circle-layer'
import { createFillLayerFromRegistry } from '#rendering/layers/fill-layer'
import { createLineLayerFromRegistry } from '#rendering/layers/line-layer'
import { RasterLayer } from '#rendering/layers/raster-layer'
import { SelectionLayer } from '#rendering/layers/selection-layer'
import { CollisionGrid, createSymbolLayerFromRegistry } from '#rendering/layers/symbol-layer'
import { readStyleBackgroundColor } from '#styles/spec'

export type AtlasLayerFilterState = GlobeLayerFilterState

interface ManagedAtlasRuntimeLayer {
  readonly type: 'raster' | 'fill' | 'line' | 'circle' | 'symbol'
  readonly compiled: CompiledMapStyleLayer
  readonly instance: RasterLayer | FillLayer | LineLayer | CircleLayer | SymbolLayer
  readonly isMonthly: boolean
  readonly wrapClones: THREE.Object3D[]
}

function createProjectionSilhouetteMesh(
  projection: MapProjection,
  tracker?: GpuResourceTracker,
): {
  readonly backdrop: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>
  readonly borderLine: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>
} {
  const pts = buildProjectionSilhouettePoints(projection, 72)
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
  const geom = new THREE.ShapeGeometry(shape)
  tracker?.trackGeometry(geom)

  const mat = new THREE.MeshBasicMaterial({
    color: '#0a2342',
    depthTest: true,
    depthWrite: true,
  })
  tracker?.trackMaterial(mat)

  const backdrop = new THREE.Mesh(geom, mat)
  backdrop.name = `AtlasOceanBackdrop:${projection.id}`
  backdrop.position.z = -0.002
  backdrop.renderOrder = -1

  const borderPositions = new Float32Array(pts.length * 3)
  for (let i = 0; i < pts.length; i++) {
    borderPositions[i * 3] = pts[i][0]
    borderPositions[i * 3 + 1] = pts[i][1]
    borderPositions[i * 3 + 2] = 0.0075
  }
  const borderGeom = new THREE.BufferGeometry()
  borderGeom.setAttribute('position', new THREE.BufferAttribute(borderPositions, 3))
  tracker?.trackGeometry(borderGeom)

  const borderMat = new THREE.LineBasicMaterial({
    color: '#334155',
    transparent: true,
    opacity: 0.65,
    depthTest: false,
    depthWrite: false,
  })
  tracker?.trackMaterial(borderMat)

  const borderLine = new THREE.LineLoop(borderGeom, borderMat)
  borderLine.name = `AtlasBorder:${projection.id}`
  borderLine.renderOrder = 90

  return { backdrop, borderLine }
}

/**
 * 2D `AtlasView` scene controller:
 * - Orthographic camera with pan/zoom interaction and unified logarithmic `styleZoom` (`0..12`).
 * - Supports real-time switching among `equirectangular`, `equal-earth`, and `mercator` projections.
 * - Mounts horizontal wraparound clones (`[-worldWidth, +worldWidth]`) sharing GPU buffers & materials
 *   for cylindrical projections (`supportsHorizontalWrap === true`), wrapping camera X seamlessly across `±180°`.
 */
export class AtlasView {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.OrthographicCamera(-Math.PI, Math.PI, Math.PI * 0.5, -Math.PI * 0.5, -10, 10)
  readonly collisionGrid = new CollisionGrid(32)
  selectionLayer: SelectionLayer

  private readonly reader: WorldMapReader
  private readonly registry: MapSourceRegistry
  private readonly tracker?: GpuResourceTracker
  private readonly primaryGroup = new THREE.Group()
  private readonly leftWrapGroup = new THREE.Group()
  private readonly rightWrapGroup = new THREE.Group()
  private readonly cleanupDomListeners: (() => void)[] = []

  private projection: MapProjection = EQUAL_EARTH_PROJECTION
  private oceanBackdrop!: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>
  private borderLine!: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private leftBackdropClone: THREE.Mesh | null = null
  private rightBackdropClone: THREE.Mesh | null = null

  private runtimeLayers = new Map<string, ManagedAtlasRuntimeLayer>()
  private compiledStyle: CompiledMapStyle | null = null
  private filterState: AtlasLayerFilterState = {
    activeThematicId: null,
    surfaceEnabled: true,
    enabledOverlayIds: ['rivers', 'lakes', 'coastlines', 'labels'],
    climateMonth: 0,
    globeEffects: {
      rotate: false,
      rotateSpeedDegreesPerSecond: 0.6,
      atmosphere: true,
      dayNight: false,
      polarIce: true,
    },
    selection: {
      regionId: null,
      featureId: null,
    },
  }

  private centerX = 0
  private centerY = 0
  private styleZoom = 0.25
  private viewportWidth = 1280
  private viewportHeight = 720
  private pixelRatio = 1
  private lastMonth = -1
  private disposed = false

  constructor(
    reader: WorldMapReader,
    registry: MapSourceRegistry,
    options: {
      readonly projectionId?: MapProjectionId
      readonly domElement?: HTMLElement | null
      readonly tracker?: GpuResourceTracker
    } = {},
  ) {
    this.reader = reader
    this.registry = registry
    this.tracker = options.tracker
    this.projection = getMapProjection(options.projectionId ?? 'equal-earth')

    this.scene.background = new THREE.Color('#060913')
    this.camera.position.set(0, 0, 5)
    this.camera.lookAt(0, 0, 0)

    this.primaryGroup.name = 'AtlasPrimaryWorld'
    this.leftWrapGroup.name = 'AtlasLeftWrapWorld'
    this.rightWrapGroup.name = 'AtlasRightWrapWorld'
    this.scene.add(this.primaryGroup)
    this.scene.add(this.leftWrapGroup)
    this.scene.add(this.rightWrapGroup)

    this.selectionLayer = new SelectionLayer(reader, options.tracker, {
      projection: this.projection,
    })
    this.primaryGroup.add(this.selectionLayer.group)

    this.rebuildProjectionBackdrop()
    this.updateCameraFrustum()

    if (options.domElement) {
      this.attachPanZoomControls(options.domElement)
    }
  }

  private attachPanZoomControls(domElement: HTMLElement): void {
    let dragging = false
    let lastClientX = 0
    let lastClientY = 0

    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0)
        return
      dragging = true
      lastClientX = e.clientX
      lastClientY = e.clientY
    }

    const onPointerMove = (e: PointerEvent): void => {
      if (!dragging)
        return
      const dxPx = e.clientX - lastClientX
      const dyPx = e.clientY - lastClientY
      lastClientX = e.clientX
      lastClientY = e.clientY
      this.panByPixels(dxPx, dyPx)
    }

    const onPointerUp = (): void => {
      dragging = false
    }

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const zoomDelta = -e.deltaY * 0.0018
      this.setStyleZoom(this.styleZoom + zoomDelta)
    }

    domElement.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    domElement.addEventListener('wheel', onWheel, { passive: false })

    this.cleanupDomListeners.push(() => {
      domElement.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      domElement.removeEventListener('wheel', onWheel)
    })
  }

  panByPixels(dxCssPx: number, dyCssPx: number): void {
    if (this.disposed)
      return
    const visibleHeight = this.camera.top - this.camera.bottom
    const visibleWidth = this.camera.right - this.camera.left
    const worldDx = -(dxCssPx / Math.max(1, this.viewportWidth)) * visibleWidth
    const worldDy = (dyCssPx / Math.max(1, this.viewportHeight)) * visibleHeight
    this.setPlanarCenter(this.centerX + worldDx, this.centerY + worldDy)
  }

  setPlanarCenter(worldX: number, worldY: number): void {
    const halfW = this.projection.worldWidth * 0.5
    const halfH = this.projection.worldHeight * 0.5
    if (this.projection.supportsHorizontalWrap) {
      this.centerX = (((worldX + halfW) % this.projection.worldWidth) + this.projection.worldWidth) % this.projection.worldWidth - halfW
    }
    else {
      this.centerX = Math.max(-halfW, Math.min(halfW, worldX))
    }
    this.centerY = Math.max(-halfH, Math.min(halfH, worldY))
    this.updateCameraFrustum()
  }

  getProjection(): MapProjection {
    return this.projection
  }

  setProjection(projectionId: MapProjectionId): void {
    if (this.disposed || this.projection.id === projectionId)
      return

    const prevPose = this.getCenterCoordinates()
    this.projection = getMapProjection(projectionId)

    // Rebuild backdrop and all projection-dependent geometries
    this.rebuildProjectionBackdrop()
    this.selectionLayer.dispose()
    this.selectionLayer = new SelectionLayer(this.reader, this.tracker, {
      projection: this.projection,
    })
    this.primaryGroup.add(this.selectionLayer.group)

    if (this.compiledStyle) {
      this.rebuildStyleLayers(this.compiledStyle, this.filterState)
    }

    this.setCenterCoordinates(prevPose.longitudeDegrees, prevPose.latitudeDegrees, prevPose.styleZoom)
    this.syncVisualState()
  }

  private rebuildProjectionBackdrop(): void {
    if (this.oceanBackdrop) {
      this.primaryGroup.remove(this.oceanBackdrop)
      this.oceanBackdrop.geometry.dispose()
      this.oceanBackdrop.material.dispose()
    }
    if (this.borderLine) {
      this.primaryGroup.remove(this.borderLine)
      this.borderLine.geometry.dispose()
      this.borderLine.material.dispose()
    }
    if (this.leftBackdropClone) {
      this.leftWrapGroup.remove(this.leftBackdropClone)
      this.leftBackdropClone = null
    }
    if (this.rightBackdropClone) {
      this.rightWrapGroup.remove(this.rightBackdropClone)
      this.rightBackdropClone = null
    }

    const { backdrop, borderLine } = createProjectionSilhouetteMesh(this.projection, this.tracker)
    this.oceanBackdrop = backdrop
    this.borderLine = borderLine
    this.primaryGroup.add(this.oceanBackdrop)
    this.primaryGroup.add(this.borderLine)

    const supportsWrap = this.projection.supportsHorizontalWrap
    this.leftWrapGroup.visible = supportsWrap
    this.rightWrapGroup.visible = supportsWrap
    this.leftWrapGroup.position.set(-this.projection.worldWidth, 0, 0)
    this.rightWrapGroup.position.set(this.projection.worldWidth, 0, 0)

    if (supportsWrap) {
      this.leftBackdropClone = new THREE.Mesh(this.oceanBackdrop.geometry, this.oceanBackdrop.material)
      this.leftBackdropClone.position.copy(this.oceanBackdrop.position)
      this.leftBackdropClone.renderOrder = this.oceanBackdrop.renderOrder
      this.leftWrapGroup.add(this.leftBackdropClone)

      this.rightBackdropClone = new THREE.Mesh(this.oceanBackdrop.geometry, this.oceanBackdrop.material)
      this.rightBackdropClone.position.copy(this.oceanBackdrop.position)
      this.rightBackdropClone.renderOrder = this.oceanBackdrop.renderOrder
      this.rightWrapGroup.add(this.rightBackdropClone)
    }
  }

  getStyleZoom(): number {
    return computeAtlasStyleZoom(this.camera.top - this.camera.bottom, this.projection)
  }

  setStyleZoom(nextZoom: number): void {
    this.styleZoom = Math.max(0, Math.min(12, nextZoom))
    this.updateCameraFrustum()
  }

  getCenterCoordinates(): { longitudeDegrees: number, latitudeDegrees: number, styleZoom: number } {
    const inverted = this.projection.invert(this.centerX, this.centerY)
    if (!inverted) {
      const clampedX = Math.max(-this.projection.worldWidth * 0.499, Math.min(this.projection.worldWidth * 0.499, this.centerX))
      const clampedY = Math.max(-this.projection.worldHeight * 0.499, Math.min(this.projection.worldHeight * 0.499, this.centerY))
      const fallback = this.projection.invert(clampedX, clampedY) ?? [0, 0]
      return {
        longitudeDegrees: fallback[0],
        latitudeDegrees: fallback[1],
        styleZoom: this.getStyleZoom(),
      }
    }
    return {
      longitudeDegrees: inverted[0],
      latitudeDegrees: inverted[1],
      styleZoom: this.getStyleZoom(),
    }
  }

  setCenterCoordinates(longitudeDegrees: number, latitudeDegrees: number, styleZoom?: number): void {
    if (styleZoom !== undefined) {
      this.styleZoom = Math.max(0, Math.min(12, styleZoom))
    }
    const [x, y] = this.projection.project(longitudeDegrees, latitudeDegrees)
    this.setPlanarCenter(x, y)
  }

  resetCamera(): void {
    this.styleZoom = 0.25
    this.setPlanarCenter(0, 0)
  }

  private updateCameraFrustum(): void {
    const aspect = this.viewportWidth / Math.max(1, this.viewportHeight)
    const visibleHeight = computeAtlasVisibleWorldHeight(this.styleZoom, this.projection)
    const visibleWidth = visibleHeight * aspect

    this.camera.left = -visibleWidth * 0.5
    this.camera.right = visibleWidth * 0.5
    this.camera.top = visibleHeight * 0.5
    this.camera.bottom = -visibleHeight * 0.5
    this.camera.position.set(this.centerX, this.centerY, 5)
    this.camera.lookAt(this.centerX, this.centerY, 0)
    this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld()
  }

  resize(widthCssPx: number, heightCssPx: number, pixelRatio = 1): void {
    if (this.disposed)
      return
    this.viewportWidth = Math.max(1, widthCssPx)
    this.viewportHeight = Math.max(1, heightCssPx)
    this.pixelRatio = Math.min(Math.max(1, pixelRatio), 2)
    this.updateCameraFrustum()

    for (const entry of this.runtimeLayers.values()) {
      if (entry.type === 'line' || entry.type === 'circle' || entry.type === 'symbol') {
        ;(entry.instance as LineLayer | CircleLayer | SymbolLayer).setViewport(
          this.viewportWidth,
          this.viewportHeight,
          this.pixelRatio,
        )
      }
    }
  }

  applyStyleAndState(
    compiledStyle: CompiledMapStyle,
    state: AtlasLayerFilterState,
  ): void {
    if (this.disposed)
      return

    const styleChanged = this.compiledStyle?.id !== compiledStyle.id
      || this.compiledStyle !== compiledStyle
    const monthChanged = this.lastMonth !== state.climateMonth

    this.compiledStyle = compiledStyle
    this.filterState = state
    this.lastMonth = state.climateMonth

    this.oceanBackdrop.material.color.set(readStyleBackgroundColor(compiledStyle.raw.tokens))

    if (styleChanged) {
      this.rebuildStyleLayers(compiledStyle, state)
    }
    else if (monthChanged) {
      this.rebuildMonthlyVectorLayers(compiledStyle, state)
    }

    this.syncVisualState()
  }

  private isLayerSlotEnabled(compiledLayer: CompiledMapStyleLayer, state: AtlasLayerFilterState): boolean {
    if (!compiledLayer.views.includes('atlas'))
      return false
    if (compiledLayer.slot === 'base')
      return state.surfaceEnabled
    if (compiledLayer.slot === 'thematic') {
      return state.activeThematicId !== null
        && state.activeThematicId !== 'none'
        && compiledLayer.thematicId === state.activeThematicId
    }
    if (compiledLayer.slot === 'overlay') {
      if (!compiledLayer.overlayId)
        return true
      if (state.enabledOverlayIds.includes(compiledLayer.overlayId))
        return true
      if (compiledLayer.overlayId === 'geographic-labels' && state.enabledOverlayIds.includes('labels'))
        return true
      if (compiledLayer.overlayId === 'labels' && state.enabledOverlayIds.includes('geographic-labels'))
        return true
      return false
    }
    return true
  }

  private clearRuntimeLayers(): void {
    for (const existing of this.runtimeLayers.values()) {
      this.primaryGroup.remove(existing.instance.mesh)
      for (const clone of existing.wrapClones) {
        this.leftWrapGroup.remove(clone)
        this.rightWrapGroup.remove(clone)
      }
      existing.instance.dispose()
    }
    this.runtimeLayers.clear()
  }

  private rebuildStyleLayers(compiledStyle: CompiledMapStyle, state: AtlasLayerFilterState): void {
    this.clearRuntimeLayers()
    compiledStyle.layers.forEach((compiledLayer, index) => {
      this.ensureLayerConstructed(compiledLayer, index, state)
    })
  }

  private rebuildMonthlyVectorLayers(compiledStyle: CompiledMapStyle, state: AtlasLayerFilterState): void {
    compiledStyle.layers.forEach((compiledLayer, index) => {
      const existing = this.runtimeLayers.get(compiledLayer.id)
      if (existing && existing.isMonthly && existing.type !== 'raster') {
        this.primaryGroup.remove(existing.instance.mesh)
        for (const clone of existing.wrapClones) {
          this.leftWrapGroup.remove(clone)
          this.rightWrapGroup.remove(clone)
        }
        existing.instance.dispose()
        this.runtimeLayers.delete(compiledLayer.id)
      }
      this.ensureLayerConstructed(compiledLayer, index, state)
    })
  }

  private attachWrapClones(primaryMesh: THREE.Mesh): THREE.Object3D[] {
    if (!this.projection.supportsHorizontalWrap)
      return []
    const leftClone = new THREE.Mesh(primaryMesh.geometry, primaryMesh.material)
    leftClone.position.copy(primaryMesh.position)
    leftClone.renderOrder = primaryMesh.renderOrder
    leftClone.frustumCulled = false
    this.leftWrapGroup.add(leftClone)

    const rightClone = new THREE.Mesh(primaryMesh.geometry, primaryMesh.material)
    rightClone.position.copy(primaryMesh.position)
    rightClone.renderOrder = primaryMesh.renderOrder
    rightClone.frustumCulled = false
    this.rightWrapGroup.add(rightClone)

    return [leftClone, rightClone]
  }

  private ensureLayerConstructed(
    compiledLayer: CompiledMapStyleLayer,
    orderIndex: number,
    state: AtlasLayerFilterState,
  ): ManagedAtlasRuntimeLayer | null {
    const existing = this.runtimeLayers.get(compiledLayer.id)
    if (existing)
      return existing

    if (!this.isLayerSlotEnabled(compiledLayer, state))
      return null

    const isMonthly = compiledLayer.source === 'climate-monthly' || compiledLayer.source === 'circulation-vectors'
    const renderOrder = layerRenderOrder(compiledLayer.slot, orderIndex)
    const thematicRaster = compiledLayer.slot === 'thematic'

    if (compiledLayer.type === 'raster') {
      const inst = new RasterLayer(compiledLayer.id, this.reader, {
        renderOrder,
        polygonOffsetFactor: 0,
        polygonOffsetUnits: thematicRaster ? -2 : 4,
        projection: this.projection,
        zOffset: thematicRaster ? LAYER_STACK.thematicRasterOffset : 0,
        tracker: this.tracker,
      })
      this.primaryGroup.add(inst.mesh)
      const wrapClones = this.attachWrapClones(inst.mesh)
      const entry: ManagedAtlasRuntimeLayer = { type: 'raster', compiled: compiledLayer, instance: inst, isMonthly, wrapClones }
      this.runtimeLayers.set(compiledLayer.id, entry)
      return entry
    }

    if (compiledLayer.type === 'fill') {
      const surfaceOffset = compiledLayer.source === 'lake-polygons' || compiledLayer.source === 'river-polygons'
        ? LAYER_STACK.hydroFillOffset
        : compiledLayer.slot === 'base'
          ? LAYER_STACK.baseFillOffset
          : compiledLayer.slot === 'thematic'
            ? LAYER_STACK.thematicFillOffset
            : LAYER_STACK.symbolOffset + orderIndex * 0.00002
      const inst = createFillLayerFromRegistry(compiledLayer, this.registry, state.climateMonth, {
        renderOrder,
        surfaceOffset,
        projection: this.projection,
        reader: this.reader,
        tracker: this.tracker,
      })
      if (!inst)
        return null
      this.primaryGroup.add(inst.mesh)
      const wrapClones = this.attachWrapClones(inst.mesh)
      const entry: ManagedAtlasRuntimeLayer = { type: 'fill', compiled: compiledLayer, instance: inst, isMonthly, wrapClones }
      this.runtimeLayers.set(compiledLayer.id, entry)
      return entry
    }

    if (compiledLayer.type === 'line') {
      const inst = createLineLayerFromRegistry(compiledLayer, this.registry, state.climateMonth, {
        renderOrder,
        surfaceOffset: LAYER_STACK.lineOffset + orderIndex * 0.00002,
        projection: this.projection,
        tracker: this.tracker,
      })
      if (!inst)
        return null
      inst.setViewport(this.viewportWidth, this.viewportHeight, this.pixelRatio)
      this.primaryGroup.add(inst.mesh)
      const wrapClones = this.attachWrapClones(inst.mesh)
      const entry: ManagedAtlasRuntimeLayer = { type: 'line', compiled: compiledLayer, instance: inst, isMonthly, wrapClones }
      this.runtimeLayers.set(compiledLayer.id, entry)
      return entry
    }

    if (compiledLayer.type === 'circle') {
      const inst = createCircleLayerFromRegistry(compiledLayer, this.registry, state.climateMonth, {
        renderOrder,
        surfaceOffset: LAYER_STACK.circleOffset + orderIndex * 0.00002,
        projection: this.projection,
        tracker: this.tracker,
      })
      if (!inst)
        return null
      inst.setViewport(this.viewportWidth, this.viewportHeight, this.pixelRatio)
      this.primaryGroup.add(inst.mesh)
      const wrapClones = this.attachWrapClones(inst.mesh)
      const entry: ManagedAtlasRuntimeLayer = { type: 'circle', compiled: compiledLayer, instance: inst, isMonthly, wrapClones }
      this.runtimeLayers.set(compiledLayer.id, entry)
      return entry
    }

    if (compiledLayer.type === 'symbol') {
      const inst = createSymbolLayerFromRegistry(compiledLayer, this.registry, state.climateMonth, {
        renderOrder,
        surfaceOffset: 0.005 + orderIndex * 0.00002,
        projection: this.projection,
        tracker: this.tracker,
      })
      if (!inst)
        return null
      inst.setViewport(this.viewportWidth, this.viewportHeight, this.pixelRatio)
      this.primaryGroup.add(inst.mesh)
      const wrapClones = this.attachWrapClones(inst.mesh)
      const entry: ManagedAtlasRuntimeLayer = { type: 'symbol', compiled: compiledLayer, instance: inst, isMonthly, wrapClones }
      this.runtimeLayers.set(compiledLayer.id, entry)
      return entry
    }

    return null
  }

  syncVisualState(): void {
    if (this.disposed || !this.compiledStyle)
      return

    const state = this.filterState
    const styleZoom = this.getStyleZoom()
    const flatNormalDir = new THREE.Vector3(0, 0, 1)

    this.collisionGrid.clear()

    this.compiledStyle.layers.forEach((compiledLayer, index) => {
      const enabled = this.isLayerSlotEnabled(compiledLayer, state)
      let runtime = this.runtimeLayers.get(compiledLayer.id) ?? null
      if (enabled && !runtime) {
        runtime = this.ensureLayerConstructed(compiledLayer, index, state)
      }
      if (!runtime)
        return

      if (!enabled) {
        runtime.instance.mesh.visible = false
        for (const clone of runtime.wrapClones) {
          clone.visible = false
        }
        return
      }

      if (runtime.type === 'raster') {
        const inst = runtime.instance as RasterLayer
        inst.updateStyleAndSource(
          compiledLayer,
          this.registry,
          styleZoom,
          state.climateMonth,
          this.compiledStyle!.id,
          state.globeEffects.polarIce,
        )
        inst.setLighting(false, flatNormalDir, false)
      }
      else if (runtime.type === 'fill') {
        const inst = runtime.instance as FillLayer
        inst.updateStyle(compiledLayer, styleZoom)
        inst.setLighting(false, flatNormalDir)
      }
      else if (runtime.type === 'line') {
        ;(runtime.instance as LineLayer).updateStyle(compiledLayer, styleZoom)
      }
      else if (runtime.type === 'circle') {
        ;(runtime.instance as CircleLayer).updateStyle(compiledLayer, styleZoom)
      }
      else if (runtime.type === 'symbol') {
        const inst = runtime.instance as SymbolLayer
        inst.updateStyle(compiledLayer, styleZoom)
        inst.updatePlacement(this.camera, this.collisionGrid)
      }

      for (const clone of runtime.wrapClones) {
        clone.visible = runtime.instance.mesh.visible
      }
    })

    this.selectionLayer.updateSelection(state.selection, this.registry, state.climateMonth)
  }

  updateFrame(): void {
    if (this.disposed)
      return
    this.syncVisualState()
  }

  getPickableLayersInStyleOrder(): PickableMapLayer[] {
    if (!this.compiledStyle)
      return []
    const out: PickableMapLayer[] = []
    for (const compiledLayer of this.compiledStyle.layers) {
      const runtime = this.runtimeLayers.get(compiledLayer.id)
      if (!runtime || !runtime.instance.mesh.visible)
        continue
      if (runtime.type === 'circle') {
        out.push({ kind: 'circle', layer: runtime.instance as CircleLayer })
      }
      else if (runtime.type === 'symbol') {
        out.push({ kind: 'symbol', layer: runtime.instance as SymbolLayer })
      }
      else if (runtime.type === 'line') {
        out.push({ kind: 'line', layer: runtime.instance as LineLayer })
      }
      else if (runtime.type === 'fill' && (runtime.instance as FillLayer).interactive) {
        out.push({ kind: 'fill', layer: runtime.instance as FillLayer })
      }
    }
    return out
  }

  getLayerInstance(layerId: string): RasterLayer | FillLayer | LineLayer | CircleLayer | SymbolLayer | undefined {
    return this.runtimeLayers.get(layerId)?.instance
  }

  refreshSymbolGlyphAtlases(): void {
    if (this.disposed)
      return
    for (const entry of this.runtimeLayers.values()) {
      if (entry.type === 'symbol') {
        ;(entry.instance as SymbolLayer).rebuildGlyphAtlas()
      }
    }
  }

  hasHorizontalWrapClones(): boolean {
    return this.projection.supportsHorizontalWrap
      && this.leftWrapGroup.visible
      && this.rightWrapGroup.visible
  }

  dispose(): void {
    if (this.disposed)
      return
    this.disposed = true

    for (const fn of this.cleanupDomListeners)
      fn()
    this.cleanupDomListeners.length = 0

    this.clearRuntimeLayers()
    this.selectionLayer.dispose()
    this.oceanBackdrop.geometry.dispose()
    this.oceanBackdrop.material.dispose()
    this.borderLine.geometry.dispose()
    this.borderLine.material.dispose()
    this.scene.clear()
  }
}
