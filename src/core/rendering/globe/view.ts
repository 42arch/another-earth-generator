import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjectionId } from '@/core/projections/map-projection'
import type { WorldViewMode } from '@/core/rendering/view-mode'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import {
  AmbientLight,
  BufferGeometry,
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
import { elevationKmToDisplayCoordinate } from '@/core/geography/elevation-units'
import type { GlobeLayerContext } from '@/core/rendering/globe/layers/globe-layer-set'
import { GlobeLayerSet } from '@/core/rendering/globe/layers/globe-layer-set'
import { GlobePicker } from '@/core/rendering/globe/picker'
import { Stars } from '@/core/rendering/globe/stars'
import { GlobeSurfaceGeometry } from '@/core/rendering/globe/surface-geometry'
import { MapView } from '@/core/rendering/map/view'
import { buildSmoothedRegionCorners, getRegionSmoothingMode } from '@/core/rendering/shared/region-display'
import { SphericalRegionTopologyBuilder } from '@/core/rendering/shared/spherical-region-topology'
import { WorldColorizer } from '@/core/rendering/shared/world-colorizer'

const TERRAIN_VERTICAL_SCALE = 0.04
const OCEAN_DEPTH_SCALE = 0.3

export class GlobeView {
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(45, 1, 5, 2500)
  private readonly controls: OrbitControls
  private readonly mapView: MapView
  private readonly colorizer = new WorldColorizer()
  private readonly regionTopologyBuilder = new SphericalRegionTopologyBuilder()
  private readonly geometryBuilder = new GlobeSurfaceGeometry()
  private readonly picker = new GlobePicker()
  private readonly resizeObserver: ResizeObserver
  private readonly selectionMarker: Mesh<SphereGeometry, MeshBasicMaterial>
  private readonly ambientLight: AmbientLight
  private readonly sunlight: DirectionalLight

  private surface: Mesh<BufferGeometry, MeshLambertMaterial> | null = null
  private starsLayer: Stars | null = null

  private mesh: SphericalMesh | null = null
  private data: WorldSimulationState | null = null
  private readonly layers: GlobeLayerSet
  private params: WorldConfig
  private pointerStartX = 0
  private pointerStartY = 0
  private viewMode: WorldViewMode = 'globe'

  private readonly canvas: HTMLCanvasElement
  private readonly onRegionSelected: (region: number, settlementId?: number, routeId?: number) => void
  private smoothedRegionCorners: Float32Array | null = null

  constructor(
    canvas: HTMLCanvasElement,
    params: WorldConfig,
    onRegionSelected: (region: number, settlementId?: number, routeId?: number) => void,
  ) {
    this.canvas = canvas
    this.onRegionSelected = onRegionSelected
    this.params = { ...params }
    this.layers = new GlobeLayerSet(this.scene, () => this.getLayerContext())
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
    this.prepareRegionSmoothing()
    this.disposeSurface()
    const colors = this.colorizer.build(data, params.appearance.baseMap, mesh)
    const usesElevation = this.usesElevationGeometry(params)
    const cornerColors = params.appearance.baseMap === 'dem'
      ? this.colorizer.buildDEMCorners(mesh, data.geography.elevation, data.geography.landMask)
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
        params.appearance.baseMap === 'dem' ? data.geography.landMask : undefined,
        this.smoothedRegionCorners ?? undefined,
      ),
    )
    this.scene.add(this.surface)
    this.mapView.setWorld(mesh, data, params)
    this.selectionMarker.visible = false
    this.updateLighting(params)
    this.layers.rebuildAll()
  }

  updateAppearance(params: WorldConfig): void {
    const previousParams = this.params
    const previousMode = previousParams.appearance.baseMap
    const modeChanged = previousMode !== params.appearance.baseMap
    const satelliteTransition = modeChanged && (previousMode === 'satellite' || params.appearance.baseMap === 'satellite')
    const elevationColorModeChanged = modeChanged
      && (this.isElevationColorMode(previousMode) || this.isElevationColorMode(params.appearance.baseMap))

    const elevationDisplacementChanged = previousParams.appearance.elevationDisplacement !== params.appearance.elevationDisplacement
    const regionSmoothingChanged = getRegionSmoothingMode(previousParams.appearance.baseMap)
      !== getRegionSmoothingMode(params.appearance.baseMap)
    const monthChanged = previousParams.appearance.climateMonth !== params.appearance.climateMonth
    const oldOverlays = previousParams.appearance.overlays
    const newOverlays = params.appearance.overlays
    const dayNightChanged = oldOverlays['day-night'] !== newOverlays['day-night']
    const overlayLightingChanged = dayNightChanged || (monthChanged && newOverlays['day-night'])

    this.params = { ...params }
    this.controls.autoRotate = params.appearance.autoRotate

    if ((satelliteTransition || elevationColorModeChanged || elevationDisplacementChanged || regionSmoothingChanged) && this.mesh && this.data) {
      this.setWorld(this.mesh, this.data, params)
      return
    }

    if ((modeChanged || monthChanged) && this.surface && this.data && !this.isElevationColorMode(params.appearance.baseMap) && params.appearance.baseMap !== 'satellite') {
      this.geometryBuilder.updateColors(
        this.surface.geometry,
        this.colorizer.build(this.data, params.appearance.baseMap, this.mesh ?? undefined),
      )
    }

    this.mapView.updateAppearance(params)
    this.updateLighting(params)

    if (oldOverlays.atmosphere !== newOverlays.atmosphere) {
      this.layers.rebuild('atmosphere')
      this.layers.rebuild('water')
    }

    if (oldOverlays.clouds !== newOverlays.clouds)
      this.layers.rebuild('clouds')
    if (oldOverlays.graticule !== newOverlays.graticule)
      this.layers.rebuild('graticule')
    if (oldOverlays.rivers !== newOverlays.rivers)
      this.layers.rebuild('rivers')
    if (oldOverlays.routes !== newOverlays.routes || overlayLightingChanged)
      this.layers.rebuild('routes')
    if (oldOverlays['nation-borders'] !== newOverlays['nation-borders'] || overlayLightingChanged)
      this.layers.rebuild('polity-borders')
    if (oldOverlays.wireframe !== newOverlays.wireframe)
      this.layers.rebuild('cell-boundaries')
    const vectorMode = (mode: string) => mode === 'wind' || mode === 'ocean-current'
    if ((modeChanged && (vectorMode(previousMode) || vectorMode(params.appearance.baseMap)))
      || (monthChanged && vectorMode(params.appearance.baseMap))) {
      this.layers.rebuild('vectors')
    }

    if (oldOverlays['sacred-sites'] !== newOverlays['sacred-sites'] || overlayLightingChanged)
      this.layers.rebuild('sacred-sites')
    if (oldOverlays.cities !== newOverlays.cities || overlayLightingChanged) {
      this.layers.rebuild('settlement-markers')
      this.layers.rebuild('settlement-labels')
    }
    const labelOverlaysChanged = oldOverlays['nation-labels'] !== newOverlays['nation-labels']
      || oldOverlays['religion-labels'] !== newOverlays['religion-labels']
      || oldOverlays['ethnicity-labels'] !== newOverlays['ethnicity-labels']
      || oldOverlays['language-labels'] !== newOverlays['language-labels']
    if (labelOverlaysChanged || modeChanged)
      this.layers.rebuild('labels')
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
    this.layers.disposeAll()
    if (this.starsLayer)
      this.starsLayer.dispose()
    this.starsLayer = null
    this.selectionMarker.geometry.dispose()
    this.selectionMarker.material.dispose()
    this.renderer.dispose()
  }

  private updateLighting(params: WorldConfig): void {
    if (params.appearance.overlays['day-night']) {
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
    if (!this.params.appearance.overlays.cities || !this.mesh || !this.data?.society)
      return null
    return this.layers.pickSettlement(event, this.canvas, this.camera)
  }

  private prepareRegionSmoothing(): void {
    this.smoothedRegionCorners = null
    if (!this.mesh || !this.data)
      return
    this.smoothedRegionCorners = buildSmoothedRegionCorners(
      this.mesh,
      this.data,
      this.params.appearance.baseMap,
      this.regionTopologyBuilder,
    )
  }

  private getLayerContext(): GlobeLayerContext | null {
    if (!this.mesh || !this.data)
      return null

    return {
      mesh: this.mesh,
      data: this.data,
      params: this.params,
      smoothedRegionCorners: this.smoothedRegionCorners,
      regionTopologyBuilder: this.regionTopologyBuilder,
      canvas: this.canvas,
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
  ): Mesh<BufferGeometry, MeshLambertMaterial> {
    return new Mesh(geometry, new MeshLambertMaterial({
      vertexColors: true,
    }))
  }

  private getTerrainVerticalScale(planetRadius: number): number {
    return planetRadius * TERRAIN_VERTICAL_SCALE
  }

  private usesElevationGeometry(params: WorldConfig): boolean {
    return params.appearance.elevationDisplacement
      && (params.appearance.baseMap === 'dem'
        || params.appearance.baseMap === 'heightmap'
        || params.appearance.baseMap === 'satellite')
  }

  private isElevationColorMode(mode: string): mode is 'dem' | 'heightmap' {
    return mode === 'dem' || mode === 'heightmap'
  }

  private handleResize = () => {
    const width = Math.max(1, this.canvas.clientWidth)
    const height = Math.max(1, this.canvas.clientHeight)
    this.renderer.setSize(width, height, false)
    this.layers.updateViewport(width, height)
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
    if (settlementId !== null && this.data?.society) {
      this.onRegionSelected(this.data.society.settlements[settlementId].region, settlementId)
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
      ? this.data?.society?.transport?.routeByRegion[region] ?? -1
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
    this.layers.updateSettlementLOD(distance)
    this.renderer.render(this.scene, this.camera)
  }
}
