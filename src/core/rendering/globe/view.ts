import type {
  BufferGeometry,
} from 'three'
import type { GeoJsonFeatureHit } from '@/core/data-source/geojson'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjectionId } from '@/core/projections/map-projection'
import type { GlobeLayerContext } from '@/core/rendering/globe/layers/globe-layer-set'
import type { WorldViewMode } from '@/core/rendering/view-mode'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { subscribeMapDataSourceChanges } from '@/core/data-source/data-sources'
import { GlobeLayerSet } from '@/core/rendering/globe/layers/globe-layer-set'
import { GlobePicker } from '@/core/rendering/globe/picker'
import { Stars } from '@/core/rendering/globe/stars'
import { GlobeSurfaceGeometry } from '@/core/rendering/globe/surface-geometry'
import { MapView } from '@/core/rendering/map/view'
import { RasterSurfaceRenderer } from '@/core/rendering/shared/raster-surface-renderer'
import { getGlobeStyleZoom, getMapStyleDocument, getMapStylePaint, getRasterStyleLayer, isMapStyleLayerVisible, resolveEffectiveSurfaceMode, usesVectorCartographicBaseMap } from '@/core/rendering/styles'
import { elevationKmToDisplayCoordinate } from '@/core/simulation/geography/elevation-units'

const TERRAIN_VERTICAL_SCALE = 0.04
const OCEAN_DEPTH_SCALE = 0.3

export class GlobeView {
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(45, 1, 5, 2500)
  private readonly controls: OrbitControls
  private readonly mapView: MapView
  private readonly surfaceRenderer = new RasterSurfaceRenderer()
  private readonly geometryBuilder = new GlobeSurfaceGeometry()
  private readonly picker = new GlobePicker()
  private readonly resizeObserver: ResizeObserver
  private readonly selectionMarker: Mesh<SphereGeometry, MeshBasicMaterial>
  private readonly ambientLight: AmbientLight
  private readonly sunlight: DirectionalLight

  private surface: Mesh<BufferGeometry, MeshBasicMaterial | MeshLambertMaterial> | null = null
  private starsLayer: Stars | null = null

  private mesh: SphericalMesh | null = null
  private data: WorldSimulationState | null = null
  private readonly layers: GlobeLayerSet
  private readonly unsubscribeSourceChanges: () => void
  private params: WorldConfig
  private pointerStartX = 0
  private pointerStartY = 0
  private viewMode: WorldViewMode = 'globe'

  private readonly canvas: HTMLCanvasElement
  private readonly onRegionSelected: (region: number, settlementId?: number, routeId?: number) => void

  constructor(
    canvas: HTMLCanvasElement,
    params: WorldConfig,
    onRegionSelected: (region: number, settlementId?: number, routeId?: number) => void,
  ) {
    this.canvas = canvas
    this.onRegionSelected = onRegionSelected
    this.params = { ...params }
    this.layers = new GlobeLayerSet(this.scene, () => this.getLayerContext())
    this.unsubscribeSourceChanges = subscribeMapDataSourceChanges((id) => {
      const mode = resolveEffectiveSurfaceMode(this.params.appearance)
      const active = getRasterStyleLayer(this.params.appearance.mapStyle, mode)
      if (usesVectorCartographicBaseMap(this.params.appearance.mapStyle, mode)
        || (id !== '*' && active?.source !== id) || !this.surface || !this.mesh || !this.data) {
        return
      }
      this.geometryBuilder.updateColors(this.surface.geometry, this.surfaceRenderer.render(
        this.data,
        mode,
        this.mesh,
        false,
        this.params.appearance.mapStyle,
      ))
    })
    this.renderer = new WebGLRenderer({ canvas, antialias: true })
    this.mapView = new MapView(canvas, params)
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.scene.background = new Color(0x030308)
    this.camera.position.set(0, 0, 320)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.enablePan = false
    this.controls.minDistance = 125
    this.controls.maxDistance = 500
    this.controls.rotateSpeed = 0.6
    this.controls.zoomSpeed = 0.8
    this.controls.autoRotate = params.appearance.autoRotate
    this.controls.enabled = true

    this.ambientLight = new AmbientLight(0xAABBCC, 3.5)
    this.scene.add(this.ambientLight)
    this.sunlight = new DirectionalLight(0xFFF8EE, 1.5)
    this.sunlight.position.set(180, 120, 220)
    this.scene.add(this.sunlight)

    this.selectionMarker = new Mesh(
      new SphereGeometry(0.7, 16, 10),
      new MeshBasicMaterial({ color: 0x34D399 }),
    )
    this.selectionMarker.visible = false
    this.scene.add(this.selectionMarker)

    this.resizeObserver = new ResizeObserver(this.handleResize)
    this.resizeObserver.observe(canvas)
    canvas.addEventListener('pointerdown', this.handlePointerDown)
    canvas.addEventListener('pointerup', this.handlePointerUp)
    this.handleResize()

    this.starsLayer = new Stars()
    this.scene.add(this.starsLayer.group)

    this.renderer.setAnimationLoop(this.render)
  }

  setWorld(mesh: SphericalMesh, data: WorldSimulationState, params: WorldConfig): void {
    this.mesh = mesh
    this.data = data
    this.params = { ...params }
    this.controls.autoRotate = params.appearance.autoRotate
    this.disposeSurface()
    const effectiveMode = resolveEffectiveSurfaceMode(params.appearance)
    if (usesVectorCartographicBaseMap(params.appearance.mapStyle, effectiveMode)) {
      this.surface = this.createOceanSurface(params)
    }
    else {
      const colors = this.surfaceRenderer.render(data, effectiveMode, mesh, false, params.appearance.mapStyle)
      const usesElevation = this.usesElevationGeometry(params)
      const cornerColors = effectiveMode === 'dem'
        ? this.surfaceRenderer.buildDEMCorners(mesh, data.geography.elevation, data.geography.landMask)
        : undefined
      this.surface = this.createSurface(
        this.geometryBuilder.create(
          mesh,
          params.core.planetRadius,
          colors,
          undefined,
          usesElevation ? data.geography.elevation : undefined,
          this.getTerrainVerticalScale(params.core.planetRadius),
          OCEAN_DEPTH_SCALE,
          cornerColors,
          effectiveMode === 'dem' ? data.geography.landMask : undefined,
        ),
        Number((getRasterStyleLayer(params.appearance.mapStyle, effectiveMode)
          ? getMapStylePaint(params.appearance.mapStyle, getRasterStyleLayer(params.appearance.mapStyle, effectiveMode)!.id, 'raster-opacity', 0)
          : undefined) ?? 1),
        effectiveMode === 'satellite',
      )
    }
    this.scene.add(this.surface)
    this.mapView.setWorld(mesh, data, params)
    this.selectionMarker.visible = false
    this.updateLighting(params)
    this.layers.rebuildAll()
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
    const elevationColorModeChanged = modeChanged
      && (this.isElevationColorMode(previousMode) || this.isElevationColorMode(currentMode))

    const elevationDisplacementChanged = previousParams.appearance.elevationDisplacement !== params.appearance.elevationDisplacement
    const monthChanged = previousParams.appearance.climateMonth !== params.appearance.climateMonth

    this.params = { ...params }
    this.controls.autoRotate = params.appearance.autoRotate

    if ((satelliteTransition || vectorCartographicChanged || elevationColorModeChanged || elevationDisplacementChanged) && this.mesh && this.data) {
      this.setWorld(this.mesh, this.data, params)
      return
    }

    const vectorCartographic = usesVectorCartographicBaseMap(params.appearance.mapStyle, currentMode)
    if (vectorCartographic && this.surface && mapStyleChanged) {
      this.surface.material.color.set(String(getMapStyleDocument(params.appearance.mapStyle).tokens.ocean ?? '#70C8F2'))
    }
    else if (!vectorCartographic && (modeChanged || monthChanged || mapStyleChanged) && this.surface && this.data && !this.isElevationColorMode(currentMode) && currentMode !== 'satellite') {
      this.geometryBuilder.updateColors(
        this.surface.geometry,
        this.surfaceRenderer.render(this.data, currentMode, this.mesh ?? undefined, false, params.appearance.mapStyle),
      )
    }
    if (this.surface && !vectorCartographic) {
      const activeRaster = getRasterStyleLayer(params.appearance.mapStyle, currentMode)
      const opacity = Number((activeRaster
        ? getMapStylePaint(params.appearance.mapStyle, activeRaster.id, 'raster-opacity', 0)
        : undefined) ?? 1)
      this.surface.material.opacity = opacity
      this.surface.material.transparent = opacity < 1
      this.surface.material.depthWrite = opacity >= 1
    }

    this.mapView.updateAppearance(params)
    this.updateLighting(params)

    this.layers.updateOverlayVisibility()

    const vectorMode = (mode: string) => mode === 'wind' || mode === 'ocean-current'
    if ((modeChanged && (vectorMode(previousMode) || vectorMode(currentMode)))
      || (monthChanged && vectorMode(currentMode))) {
      this.layers.rebuild('vectors')
    }

    this.layers.reconcileAppearance(previousParams, params)
  }

  selectRegion(region: number): void {
    if (region < 0 || !this.mesh) {
      this.selectionMarker.visible = false
      this.mapView.clearSelection()
      return
    }
    const index = region * 3
    const elevation = this.data?.geography.elevation[region] ?? 0
    const displayElevation = elevationKmToDisplayCoordinate(elevation)
    const terrainOffset = this.usesElevationGeometry(this.params)
      ? displayElevation
      * this.getTerrainVerticalScale(this.params.core.planetRadius)
      * (displayElevation > 0 ? 1 : OCEAN_DEPTH_SCALE)
      : 0
    const radius = this.params.core.planetRadius + terrainOffset + 0.9
    this.selectionMarker.position.set(
      this.mesh.regionPosition[index] * radius,
      this.mesh.regionPosition[index + 1] * radius,
      this.mesh.regionPosition[index + 2] * radius,
    )
    this.selectionMarker.visible = true
    this.mapView.selectRegion(region)
  }

  setViewMode(mode: WorldViewMode): void {
    if (this.viewMode === mode)
      return
    this.viewMode = mode
    const globeActive = mode === 'globe'
    this.controls.enabled = globeActive
    this.mapView.setActive(!globeActive)
  }

  setMapProjection(id: MapProjectionId): void {
    this.mapView.setProjection(id)
  }

  resetCamera(): void {
    if (this.viewMode === 'map') {
      this.mapView.resetCamera()
      return
    }
    this.camera.position.set(0, 0, 320)
    this.controls.target.set(0, 0, 0)
    this.controls.update()
  }

  destroy(): void {
    this.renderer.setAnimationLoop(null)
    this.resizeObserver.disconnect()
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown)
    this.canvas.removeEventListener('pointerup', this.handlePointerUp)
    this.controls.dispose()
    this.mapView.destroy()
    this.disposeSurface()
    this.unsubscribeSourceChanges()
    this.layers.destroy()
    if (this.starsLayer)
      this.starsLayer.dispose()
    this.starsLayer = null
    this.selectionMarker.geometry.dispose()
    this.selectionMarker.material.dispose()
    this.renderer.dispose()
  }

  private updateLighting(params: WorldConfig): void {
    const effectiveMode = resolveEffectiveSurfaceMode(params.appearance)
    if (effectiveMode === 'satellite' && params.appearance.overlays['day-night']) {
      // Night mode ambient (make it slightly dark, but not pitch black)
      this.ambientLight.color.setHex(0x667799)
      this.ambientLight.intensity = 1.6

      this.sunlight.color.setHex(0xFFF8EE)
      this.sunlight.intensity = 2.2

      // Calculate sun direction based on climate month
      const month = params.appearance.climateMonth
      // Approximation matching monthly-forcing.ts
      const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
      let midpoint = 0
      for (let i = 0; i < month; i++) midpoint += days[i]
      midpoint += days[month] / 2

      const orbitalPhase = 2 * Math.PI * (midpoint - 79) / 365
      const tilt = Math.max(0, Math.min(90, params.climate.axialTiltDeg)) * Math.PI / 180
      const solarDeclination = Math.asin(Math.sin(tilt) * Math.sin(orbitalPhase))

      // Assume sun is at longitude 0 initially, or fixed in world space.
      // A static direction is enough to show day/night terminator.
      // In Three.js: Y is up (north pole), Z is prime meridian, X is 90 degrees East.
      // So sun direction:
      const sunDist = 300
      this.sunlight.position.set(
        0, // X: looking straight at prime meridian
        sunDist * Math.sin(solarDeclination), // Y: declination
        sunDist * Math.cos(solarDeclination), // Z: distance
      )
    }
    else {
      this.ambientLight.color.setHex(0xAABBCC)
      this.ambientLight.intensity = 3.5

      this.sunlight.color.setHex(0xFFF8EE)
      this.sunlight.intensity = 1.5
      this.sunlight.position.set(180, 120, 220)
    }
  }

  private pickSettlement(event: PointerEvent): number | null {
    if (!this.params.appearance.overlays.cities || !this.mesh || !this.data?.civilization)
      return null
    return this.layers.pickSettlement(event, this.canvas, this.camera)
  }

  pickGeoJsonFeature(event: PointerEvent): GeoJsonFeatureHit | null {
    return this.viewMode === 'map'
      ? this.mapView.pickGeoJsonFeature(event)
      : this.layers.pickGeoJsonFeature(event, this.canvas, this.camera)
  }

  private getLayerContext(): GlobeLayerContext | null {
    if (!this.mesh || !this.data)
      return null

    return {
      mesh: this.mesh,
      data: this.data,
      params: this.params,
      sunlight: this.sunlight.position,
    }
  }

  private disposeSurface(): void {
    if (this.surface) {
      this.scene.remove(this.surface)
      this.surface.geometry.dispose()
      this.surface.material.dispose()
      this.surface = null
    }
  }

  private createSurface(
    geometry: BufferGeometry,
    opacity: number,
    lit: boolean,
  ): Mesh<BufferGeometry, MeshBasicMaterial | MeshLambertMaterial> {
    const materialOptions = {
      vertexColors: true,
      opacity,
      transparent: opacity < 1,
      depthWrite: opacity >= 1,
    }
    return new Mesh(geometry, lit
      ? new MeshLambertMaterial(materialOptions)
      : new MeshBasicMaterial(materialOptions))
  }

  private createOceanSurface(params: WorldConfig): Mesh<BufferGeometry, MeshBasicMaterial | MeshLambertMaterial> {
    const ocean = String(getMapStyleDocument(params.appearance.mapStyle).tokens.ocean ?? '#70C8F2')
    const surface = new Mesh<BufferGeometry, MeshBasicMaterial | MeshLambertMaterial>(
      new SphereGeometry(params.core.planetRadius, 128, 96),
      new MeshBasicMaterial({ color: ocean }),
    )
    surface.userData.cartographicOcean = true
    return surface
  }

  private getTerrainVerticalScale(planetRadius: number): number {
    return planetRadius * TERRAIN_VERTICAL_SCALE
  }

  private usesElevationGeometry(params: WorldConfig): boolean {
    const effectiveMode = resolveEffectiveSurfaceMode(params.appearance)
    return params.appearance.elevationDisplacement
      && (effectiveMode === 'dem'
        || effectiveMode === 'heightmap'
        || effectiveMode === 'satellite')
  }

  private isElevationColorMode(mode: string): mode is 'dem' | 'heightmap' {
    return mode === 'dem' || mode === 'heightmap'
  }

  private handleResize = () => {
    const width = Math.max(1, this.canvas.clientWidth)
    const height = Math.max(1, this.canvas.clientHeight)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.mapView.resize(width, height)
  }

  public enableRegionPicking = false

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
    const settlementId = this.viewMode === 'map'
      ? this.mapView.pickSettlement(event)
      : this.pickSettlement(event)
    if (settlementId !== null && this.data?.civilization) {
      this.onRegionSelected(this.data.civilization.settlements[settlementId].region, settlementId)
      return
    }
    if (!this.enableRegionPicking && !this.params.appearance.overlays.routes)
      return
    const region = this.viewMode === 'map'
      ? this.mapView.pick(event)
      : this.surface
        ? this.picker.pick(event, this.canvas, this.camera, this.surface, this.mesh)
        : null
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

  private render = () => {
    if (this.viewMode === 'map') {
      this.mapView.update()
      this.renderer.render(this.mapView.scene, this.mapView.camera)
      return
    }
    this.controls.update()
    const distance = this.camera.position.distanceTo(this.controls.target)
    if (this.surface) {
      const effectiveMode = resolveEffectiveSurfaceMode(this.params.appearance)
      const styleZoom = getGlobeStyleZoom(distance, this.params.core.planetRadius)
      const activeRaster = getRasterStyleLayer(this.params.appearance.mapStyle, effectiveMode)
      this.surface.visible = usesVectorCartographicBaseMap(this.params.appearance.mapStyle, effectiveMode)
        || (activeRaster ? isMapStyleLayerVisible(this.params.appearance.mapStyle, activeRaster.id, styleZoom, 'globe') : true)
    }
    this.layers.updateStyleZoom(distance)
    this.renderer.render(this.scene, this.camera)
  }
}
