import type { GeoJsonFeatureHit } from '@/core/data-source/geojson'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection, MapProjectionId } from '@/core/projections/map-projection'
import type { MapLayerContext } from '@/core/rendering/map/layers/map-layer-set'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import {
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  RingGeometry,
  Scene,
} from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import { subscribeMapDataSourceChanges } from '@/core/data-source/data-sources'
import { getMapProjection } from '@/core/projections/d3-map-projection'
import { FULL_LONGITUDE, wrapLongitude } from '@/core/projections/projection-math'
import { MapLayerSet } from '@/core/rendering/map/layers/map-layer-set'
import { MapPicker } from '@/core/rendering/map/picker'
import { MapSurfaceGeometry } from '@/core/rendering/map/surface-geometry'
import { RasterSurfaceRenderer } from '@/core/rendering/shared/raster-surface-renderer'
import { getMapStyleDocument, getMapStylePaint, getMapStyleZoom, getRasterStyleLayer, isMapStyleLayerVisible, resolveEffectiveSurfaceMode, usesVectorCartographicBaseMap } from '@/core/rendering/styles'

export class MapView {
  readonly scene = new Scene()
  readonly camera = new OrthographicCamera(-Math.PI, Math.PI, Math.PI / 2, -Math.PI / 2, 0.1, 100)
  private readonly surfaceRenderer = new RasterSurfaceRenderer()
  private readonly controls: MapControls
  private readonly geometryBuilder = new MapSurfaceGeometry()
  private readonly picker = new MapPicker()
  private projection: MapProjection = getMapProjection('mercator')
  private readonly selectionGroup = new Group()
  private readonly selectionGeometry = new RingGeometry(0.035, 0.052, 28)
  private readonly selectionMaterial = new MeshBasicMaterial({
    color: 0x34D399,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
  })

  private surface: Mesh | null = null
  private surfaceCopies: Mesh[] = []
  private mesh: SphericalMesh | null = null
  private data: WorldSimulationState | null = null
  private readonly layers: MapLayerSet
  private readonly unsubscribeSourceChanges: () => void
  private params: WorldConfig
  private centralMeridian = 0
  private active = false
  private surfaceDirty = false
  private overlaysDirty = false
  private selectedRegion = -1

  private viewportWidth = 1
  private viewportHeight = 1

  private readonly canvas: HTMLCanvasElement

  constructor(
    canvas: HTMLCanvasElement,
    params: WorldConfig,
  ) {
    this.canvas = canvas
    this.params = { ...params }
    this.updateBackground()
    this.layers = new MapLayerSet(this.scene, () => this.getLayerContext())
    this.unsubscribeSourceChanges = subscribeMapDataSourceChanges((id) => {
      const mode = resolveEffectiveSurfaceMode(this.params.appearance)
      const active = getRasterStyleLayer(this.params.appearance.mapStyle, mode)
      if (id !== '*' && active?.source !== id)
        return
      this.surfaceDirty = true
      this.ensureSurface()
    })
    this.viewportWidth = Math.max(1, canvas.clientWidth)
    this.viewportHeight = Math.max(1, canvas.clientHeight)
    this.camera.position.set(0, 0, 10)

    this.controls = new MapControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.enableRotate = false
    this.controls.enablePan = true
    this.controls.screenSpacePanning = true
    this.controls.zoomSpeed = 1.0
    this.controls.panSpeed = 0.8
    this.controls.minZoom = 1
    this.controls.maxZoom = 300
    this.controls.enabled = false

    this.rebuildSelectionMarkers()
    this.selectionGroup.visible = false
    this.scene.add(this.selectionGroup)
  }

  setWorld(mesh: SphericalMesh, data: WorldSimulationState, params: WorldConfig): void {
    this.mesh = mesh
    this.data = data
    this.params = { ...params }
    this.updateBackground()
    this.centralMeridian = this.chooseCentralMeridian(mesh, data)
    this.disposeSurface()
    this.layers.disposeAll()
    this.surfaceDirty = true
    this.overlaysDirty = true
    this.selectedRegion = -1
    this.selectionGroup.visible = false
    this.ensureSurface()
    this.ensureOverlays()
  }

  updateAppearance(params: WorldConfig): void {
    const previousParams = this.params
    const previousMode = resolveEffectiveSurfaceMode(previousParams.appearance)
    const currentMode = resolveEffectiveSurfaceMode(params.appearance)
    const modeChanged = previousMode !== currentMode
    const mapStyleChanged = previousParams.appearance.mapStyle !== params.appearance.mapStyle
    const satelliteTransition = modeChanged && (previousMode === 'satellite' || currentMode === 'satellite')
    const vectorCartographicChanged = usesVectorCartographicBaseMap(previousParams.appearance.mapStyle, previousMode)
      !== usesVectorCartographicBaseMap(params.appearance.mapStyle, currentMode)
    const monthChanged = previousParams.appearance.climateMonth !== params.appearance.climateMonth

    this.params = { ...params }
    this.updateBackground()
    const elevationColorModeChanged = modeChanged
      && (this.isElevationColorMode(previousMode) || this.isElevationColorMode(currentMode))
    if (satelliteTransition || elevationColorModeChanged || vectorCartographicChanged)
      this.surfaceDirty = true

    const surfaceNeedsRebuild = this.surfaceDirty || !this.surface
    this.ensureSurface()
    if (!surfaceNeedsRebuild && this.surface && this.data && (modeChanged || monthChanged || mapStyleChanged)
      && !satelliteTransition && !this.isElevationColorMode(currentMode)
      && currentMode !== 'satellite') {
      this.geometryBuilder.updateColors(
        this.surface.geometry,
        this.surfaceRenderer.render(this.data, currentMode, this.mesh ?? undefined, false, params.appearance.mapStyle),
      )
    }
    if (this.surface && !Array.isArray(this.surface.material)) {
      const material = this.surface.material as MeshBasicMaterial
      const activeRaster = getRasterStyleLayer(params.appearance.mapStyle, currentMode)
      const opacity = Number((activeRaster
        ? getMapStylePaint(params.appearance.mapStyle, activeRaster.id, 'raster-opacity', 0)
        : undefined) ?? 1)
      material.opacity = opacity
      material.transparent = opacity < 1
      material.depthWrite = opacity >= 1
    }

    if (this.overlaysDirty) {
      this.rebuildOverlays()
      return
    }

    this.layers.updateOverlayVisibility()

    const vectorMode = (mode: string) => mode === 'wind' || mode === 'ocean-current'
    if ((modeChanged && (vectorMode(previousMode) || vectorMode(currentMode)))
      || (monthChanged && vectorMode(currentMode))) {
      this.layers.rebuild('vectors')
    }

    this.layers.reconcileAppearance(previousParams, params)
  }

  setActive(active: boolean): void {
    this.active = active
    this.controls.enabled = active
    if (active) {
      this.ensureSurface()
      this.ensureOverlays()
      if (this.selectedRegion >= 0)
        this.updateSelectionMarker(this.selectedRegion)
    }
  }

  setProjection(id: MapProjectionId): void {
    const projection = getMapProjection(id)
    if (this.projection.id === projection.id)
      return

    this.disposeSurface()
    this.layers.disposeAll()
    this.projection = projection
    this.surfaceDirty = true
    this.overlaysDirty = true
    this.rebuildSelectionMarkers()
    this.resize(this.viewportWidth, this.viewportHeight)
    this.resetCamera()

    if (this.active) {
      this.rebuildSurface()
      this.rebuildOverlays()
      if (this.selectedRegion >= 0)
        this.updateSelectionMarker(this.selectedRegion)
    }
  }

  selectRegion(region: number): void {
    this.selectedRegion = region
    if (this.active)
      this.updateSelectionMarker(region)
  }

  clearSelection(): void {
    this.selectedRegion = -1
    this.selectionGroup.visible = false
  }

  private rebuildSurface(): void {
    if (!this.mesh || !this.data)
      return
    this.disposeSurface()
    const mode = resolveEffectiveSurfaceMode(this.params.appearance)
    if (usesVectorCartographicBaseMap(this.params.appearance.mapStyle, mode)) {
      this.surfaceDirty = false
      return
    }
    const colors = this.surfaceRenderer.render(this.data, mode, this.mesh, mode === 'satellite', this.params.appearance.mapStyle)
    const cornerColors = mode === 'dem'
      ? this.surfaceRenderer.buildDEMCorners(this.mesh, this.data.geography.elevation, this.data.geography.landMask)
      : undefined
    const geometry = this.geometryBuilder.create(
      this.mesh,
      colors,
      this.projection,
      this.centralMeridian,
      undefined,
      cornerColors,
      false,
      mode === 'dem' ? this.data.geography.landMask : undefined,
    )
    const activeRaster = getRasterStyleLayer(this.params.appearance.mapStyle, mode)
    const opacity = Number((activeRaster
      ? getMapStylePaint(this.params.appearance.mapStyle, activeRaster.id, 'raster-opacity', 0)
      : undefined) ?? 1)
    const material = new MeshBasicMaterial({
      vertexColors: true,
      side: DoubleSide,
      opacity,
      transparent: opacity < 1,
      depthWrite: opacity >= 1,
    })
    this.surface = new Mesh(geometry, material)
    this.surfaceCopies = this.projection.wrapX
      ? [
          this.createSurfaceCopy(this.surface, -this.projection.worldWidth),
          this.surface,
          this.createSurfaceCopy(this.surface, this.projection.worldWidth),
        ]
      : [this.surface]
    for (const surface of this.surfaceCopies)
      this.scene.add(surface)
    this.surfaceDirty = false
  }

  private chooseCentralMeridian(
    mesh: SphericalMesh,
    data: WorldSimulationState,
  ): number {
    const binCount = 180
    const landAreaByLongitude = new Float64Array(binCount)
    for (let region = 0; region < mesh.numRegions; region++) {
      if (data.geography.landMask && data.geography.landMask[region] === 0)
        continue
      const normalized = (wrapLongitude(mesh.regionLongitude[region]) + Math.PI)
        / FULL_LONGITUDE
      const bin = Math.min(binCount - 1, Math.floor(normalized * binCount))
      landAreaByLongitude[bin] += mesh.regionArea[region]
    }

    let bestBin = 0
    let bestCost = Infinity
    const corridorRadius = 3
    for (let bin = 0; bin < binCount; bin++) {
      let cost = 0
      for (let offset = -corridorRadius; offset <= corridorRadius; offset++) {
        const wrappedBin = (bin + offset + binCount) % binCount
        cost += landAreaByLongitude[wrappedBin]
          * (corridorRadius + 1 - Math.abs(offset))
      }
      if (cost < bestCost) {
        bestCost = cost
        bestBin = bin
      }
    }

    const seamLongitude = -Math.PI
      + (bestBin + 0.5) / binCount * FULL_LONGITUDE
    return wrapLongitude(seamLongitude + Math.PI)
  }

  private updateSelectionMarker(region: number): void {
    if (!this.mesh || region < 0 || region >= this.mesh.numRegions)
      return
    const projected = this.projection.project(
      this.mesh.regionLongitude[region],
      this.mesh.regionLatitude[region],
      this.centralMeridian,
    )
    if (!projected) {
      this.selectionGroup.visible = false
      return
    }
    for (const marker of this.selectionGroup.children) {
      marker.position.x = projected.x + Number(marker.userData.worldOffset ?? 0)
      marker.position.y = projected.y
    }
    this.selectionGroup.visible = true
  }

  pick(event: PointerEvent): number | null {
    if (!this.mesh)
      return null
    return this.picker.pick(
      event,
      this.canvas,
      this.camera,
      this.projection,
      this.centralMeridian,
      this.mesh,
    )
  }

  pickSettlement(event: PointerEvent): number | null {
    return this.layers.pickSettlement(event, this.canvas, this.camera)
  }

  pickGeoJsonFeature(event: PointerEvent): GeoJsonFeatureHit | null {
    return this.layers.pickGeoJsonFeature(event, this.canvas, this.camera)
  }

  resize(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width)
    this.viewportHeight = Math.max(1, height)
    const viewportAspect = width / Math.max(height, 1)
    const mapAspect = this.projection.worldWidth / this.projection.worldHeight
    if (this.projection.wrapX) {
      const halfWidth = this.projection.worldWidth * 0.5
      const halfHeight = halfWidth / viewportAspect
      this.camera.left = -halfWidth
      this.camera.right = halfWidth
      this.camera.top = halfHeight
      this.camera.bottom = -halfHeight
    }
    else if (viewportAspect >= mapAspect) {
      const halfHeight = this.projection.worldHeight * 0.5
      const halfWidth = halfHeight * viewportAspect
      this.camera.left = -halfWidth
      this.camera.right = halfWidth
      this.camera.top = halfHeight
      this.camera.bottom = -halfHeight
    }
    else {
      const halfWidth = this.projection.worldWidth * 0.5
      const halfHeight = halfWidth / viewportAspect
      this.camera.left = -halfWidth
      this.camera.right = halfWidth
      this.camera.top = halfHeight
      this.camera.bottom = -halfHeight
    }
    this.camera.updateProjectionMatrix()
    this.layers.updateViewport(this.viewportWidth, this.viewportHeight)
  }

  update(): void {
    this.controls.update()
    if (this.surface) {
      const effectiveMode = resolveEffectiveSurfaceMode(this.params.appearance)
      const styleZoom = getMapStyleZoom(this.camera.zoom)
      const activeRaster = getRasterStyleLayer(this.params.appearance.mapStyle, effectiveMode)
      const visible = usesVectorCartographicBaseMap(this.params.appearance.mapStyle, effectiveMode)
        || (activeRaster ? isMapStyleLayerVisible(this.params.appearance.mapStyle, activeRaster.id, styleZoom, 'map') : true)
      for (const surface of this.surfaceCopies)
        surface.visible = visible
    }
    this.layers.update(this.camera.zoom)
    const visibleHalfWidth = (this.camera.right - this.camera.left)
      / Math.max(this.camera.zoom * 2, Number.EPSILON)
    const maximumX = Math.max(0, this.projection.worldWidth * 0.5 - visibleHalfWidth)
    const nextX = this.projection.wrapX
      ? this.wrapProjectedX(this.controls.target.x)
      : Math.max(-maximumX, Math.min(maximumX, this.controls.target.x))
    const xShift = nextX - this.controls.target.x
    if (Math.abs(xShift) > Number.EPSILON) {
      this.controls.target.x += xShift
      this.camera.position.x += xShift
    }

    const visibleHalfHeight = (this.camera.top - this.camera.bottom)
      / Math.max(this.camera.zoom * 2, Number.EPSILON)
    const maximumY = Math.max(0, this.projection.worldHeight * 0.5 - visibleHalfHeight)
    const clampedY = Math.max(-maximumY, Math.min(maximumY, this.controls.target.y))
    const yShift = clampedY - this.controls.target.y
    if (Math.abs(yShift) > Number.EPSILON) {
      this.controls.target.y += yShift
      this.camera.position.y += yShift
    }
  }

  resetCamera(): void {
    this.camera.position.set(0, 0, 10)
    this.camera.zoom = 1
    this.controls.target.set(0, 0, 0)
    this.camera.updateProjectionMatrix()
    this.controls.update()
  }

  destroy(): void {
    this.controls.dispose()
    this.unsubscribeSourceChanges()
    this.layers.destroy()
    this.disposeSurface()
    this.selectionGroup.removeFromParent()
    this.selectionGroup.clear()
    this.selectionGeometry.dispose()
    this.selectionMaterial.dispose()
  }

  private createSurfaceCopy(source: Mesh, x: number): Mesh {
    const copy = source.clone()
    copy.position.x = x
    return copy
  }

  private rebuildSelectionMarkers(): void {
    this.selectionGroup.clear()
    const worldOffsets = this.projection.wrapX
      ? [-this.projection.worldWidth, 0, this.projection.worldWidth]
      : [0]
    for (const worldOffset of worldOffsets) {
      const marker = new Mesh(this.selectionGeometry, this.selectionMaterial)
      marker.position.set(worldOffset, 0, 2)
      marker.userData.worldOffset = worldOffset
      marker.renderOrder = 20
      this.selectionGroup.add(marker)
    }
    this.selectionGroup.visible = false
  }

  private wrapProjectedX(x: number): number {
    const halfWidth = this.projection.worldWidth * 0.5
    return ((x + halfWidth) % this.projection.worldWidth + this.projection.worldWidth)
      % this.projection.worldWidth - halfWidth
  }

  private ensureSurface(): void {
    const effectiveMode = resolveEffectiveSurfaceMode(this.params.appearance)
    if (this.surfaceDirty || (!this.surface && !usesVectorCartographicBaseMap(this.params.appearance.mapStyle, effectiveMode)))
      this.rebuildSurface()
  }

  private updateBackground(): void {
    const effectiveMode = resolveEffectiveSurfaceMode(this.params.appearance)
    this.scene.background = effectiveMode === 'cartographic'
      ? new Color(String(getMapStyleDocument(this.params.appearance.mapStyle).tokens.ocean ?? '#70C8F2'))
      : new Color(0x07101F)
  }

  private isElevationColorMode(mode: string): mode is 'dem' | 'heightmap' {
    return mode === 'dem' || mode === 'heightmap'
  }

  private ensureOverlays(): void {
    if (this.overlaysDirty)
      this.rebuildOverlays()
  }

  private rebuildOverlays(): void {
    this.layers.rebuildAll()
    this.overlaysDirty = false
  }

  private getLayerContext(): MapLayerContext | null {
    if (!this.mesh || !this.data)
      return null

    return {
      mesh: this.mesh,
      data: this.data,
      params: this.params,
      projection: this.projection,
      centralMeridian: this.centralMeridian,
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
    }
  }

  private disposeSurface(): void {
    for (const surface of this.surfaceCopies)
      this.scene.remove(surface)
    if (this.surface) {
      this.surface.geometry.dispose()
      const material = this.surface.material
      if (Array.isArray(material)) {
        for (const item of material)
          item.dispose()
      }
      else {
        material.dispose()
      }
    }
    this.surface = null
    this.surfaceCopies = []
  }
}
