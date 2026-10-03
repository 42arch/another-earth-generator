import type {
  BufferGeometry,
} from 'three'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjectionId } from '@/core/projections/map-projection'
import type { WorldViewMode } from '@/core/rendering/view-mode'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import {
  AmbientLight,
  Color,
  DirectionalLight,
  DoubleSide,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  NotEqualStencilFunc,
  PerspectiveCamera,
  ReplaceStencilOp,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { elevationKmToDisplayCoordinate } from '@/core/geography/elevation-units'
import { Atmosphere } from '@/core/rendering/globe/atmosphere'
import { GlobePicker } from '@/core/rendering/globe/picker'
import { Stars } from '@/core/rendering/globe/stars'
import { GlobeSurfaceGeometry } from '@/core/rendering/globe/surface-geometry'
import { MapView } from '@/core/rendering/map/view'
import { SphericalCellBoundaryGeometry } from '@/core/rendering/shared/cell-boundary-geometry'
import { createClimateVectorGeometry } from '@/core/rendering/shared/climate-vector-geometry'
import { CLOUD_FRAGMENT_SHADER, CLOUD_GLOBE_VERTEX_SHADER } from '@/core/rendering/shared/cloud-shaders'
import { SphericalGraticuleGeometry } from '@/core/rendering/shared/graticule-geometry'
import { RiverGeometry } from '@/core/rendering/shared/river-geometry'
import { WorldColorizer } from '@/core/rendering/shared/world-colorizer'

const GRATICULE_LAYER_OFFSET = 0.75
const CELL_BOUNDARY_LAYER_OFFSET = 0.08
const WATER_SURFACE_OFFSET = 0.06
const TERRAIN_VERTICAL_SCALE = 0.04
const OCEAN_DEPTH_SCALE = 0.3
const CLOUD_LAYER_OFFSET = 0.8

export class GlobeRenderer {
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(45, 1, 5, 2500)
  private readonly controls: OrbitControls
  private readonly mapView: MapView
  private readonly colorizer = new WorldColorizer()
  private readonly cellBoundaryGeometryBuilder = new SphericalCellBoundaryGeometry()
  private readonly graticuleGeometryBuilder = new SphericalGraticuleGeometry()
  private readonly riverGeometryBuilder = new RiverGeometry()
  private readonly geometryBuilder = new GlobeSurfaceGeometry()
  private readonly picker = new GlobePicker()
  private readonly resizeObserver: ResizeObserver
  private readonly selectionMarker: Mesh<SphereGeometry, MeshBasicMaterial>
  private readonly ambientLight: AmbientLight
  private readonly sunlight: DirectionalLight

  private surface: Mesh<BufferGeometry, MeshLambertMaterial> | null = null
  private cellBoundaryLayer: LineSegments<BufferGeometry, LineBasicMaterial> | null = null
  private graticuleLayer: LineSegments<BufferGeometry, LineBasicMaterial> | null = null
  private vectorLayer: LineSegments<BufferGeometry, LineBasicMaterial> | null = null
  private riverLayer: Mesh<BufferGeometry, MeshLambertMaterial> | null = null
  private cloudLayer: Mesh<BufferGeometry, ShaderMaterial> | null = null
  private atmosphereLayer: Atmosphere | null = null
  private waterLayer: Mesh<BufferGeometry, MeshPhongMaterial> | null = null
  private starsLayer: Stars | null = null
  private mesh: SphericalMesh | null = null
  private data: WorldSimulationState | null = null
  private params: WorldConfig
  private pointerStartX = 0
  private pointerStartY = 0
  private viewMode: WorldViewMode = 'globe'

  private readonly canvas: HTMLCanvasElement
  private readonly onRegionSelected: (region: number) => void

  constructor(
    canvas: HTMLCanvasElement,
    params: WorldConfig,
    onRegionSelected: (region: number) => void,
  ) {
    this.canvas = canvas
    this.onRegionSelected = onRegionSelected
    this.params = { ...params }
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
    const colors = this.colorizer.build(data, params.appearance.displayMode, mesh)
    const usesElevation = this.usesElevationGeometry(params)
    const cornerColors = params.appearance.displayMode === 'heightmap'
      ? this.colorizer.buildHeightmapCornerColors(mesh, data.geography.elevation)
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
      ),
    )
    this.scene.add(this.surface)
    this.rebuildAtmosphere()
    this.mapView.setWorld(mesh, data, params)
    this.selectionMarker.visible = false
    this.updateLighting(params)
    this.rebuildOverlays()
  }

  updateAppearance(params: WorldConfig): void {
    const displayModeChanged = this.params.appearance.displayMode !== params.appearance.displayMode
    const elevationDisplacementChanged = this.params.appearance.elevationDisplacement !== params.appearance.elevationDisplacement
    this.params = { ...params }
    this.controls.autoRotate = params.appearance.autoRotate
    if ((displayModeChanged || elevationDisplacementChanged) && this.mesh && this.data) {
      this.setWorld(this.mesh, this.data, params)
      return
    }
    if (this.surface && this.data && params.appearance.displayMode !== 'heightmap') {
      this.geometryBuilder.updateColors(
        this.surface.geometry,
        this.colorizer.build(this.data, params.appearance.displayMode, this.mesh ?? undefined),
      )
    }
    this.mapView.updateAppearance(params)
    this.updateLighting(params)
    this.rebuildAtmosphere()
    this.rebuildOverlays()
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
    this.disposeAtmosphere()
    this.selectionMarker.geometry.dispose()
    this.selectionMarker.material.dispose()
    this.renderer.dispose()
  }

  private updateLighting(params: WorldConfig): void {
    if (params.appearance.showDayNight) {
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

  private rebuildOverlays(): void {
    this.rebuildCellBoundaries()
    this.rebuildGraticule()
    this.rebuildWaterLayer()
    this.rebuildVectorLayer()
    this.rebuildCloudLayer()
    this.rebuildRiverLayer()
  }

  private rebuildCloudLayer(): void {
    this.disposeCloudLayer()
    if (!this.params.appearance.showClouds || !this.mesh || !this.data)
      return
    const geometry = this.geometryBuilder.create(
      this.mesh,
      this.params.core.planetRadius + CLOUD_LAYER_OFFSET,
      new Float32Array(this.mesh.numRegions * 3),
      undefined,
      this.usesElevationGeometry(this.params) ? this.data.geography.elevation : undefined,
      this.getTerrainVerticalScale(this.params.core.planetRadius),
      OCEAN_DEPTH_SCALE,
    )
    this.cloudLayer = new Mesh(geometry, new ShaderMaterial({
      vertexShader: CLOUD_GLOBE_VERTEX_SHADER,
      fragmentShader: CLOUD_FRAGMENT_SHADER,
      uniforms: {
        uSeed: { value: this.params.core.seed },
        uCoverage: { value: 0.66 },
      },
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    }))
    this.cloudLayer.renderOrder = 6
    this.scene.add(this.cloudLayer)
  }

  private rebuildRiverLayer(): void {
    this.disposeRiverLayer()
    if (
      !this.params.appearance.showRivers
      || !this.mesh
      || !this.data?.hydrology
    ) {
      return
    }
    const surfaceOffsets = this.buildRiverSurfaceOffsets()
    const riverClearance = surfaceOffsets ? 0.22 : 0.05
    const geometry = this.riverGeometryBuilder.create(
      this.mesh,
      this.data,
      this.params.core.planetRadius + riverClearance,
      surfaceOffsets,
    )
    if ((geometry.getAttribute('position')?.count ?? 0) === 0) {
      geometry.dispose()
      return
    }
    this.riverLayer = new Mesh(geometry, new MeshLambertMaterial({
      color: 0xFFFFFF,
      vertexColors: true,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.6,
      side: DoubleSide,
      toneMapped: false,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: NotEqualStencilFunc,
      stencilZPass: ReplaceStencilOp,
    }))
    this.riverLayer.renderOrder = 7
    this.scene.add(this.riverLayer)
  }

  private buildRiverSurfaceOffsets(): Float32Array | undefined {
    if (!this.mesh || !this.data || !this.usesElevationGeometry(this.params))
      return undefined
    const offsets = new Float32Array(this.mesh.numRegions)
    const terrainScale = this.getTerrainVerticalScale(this.params.core.planetRadius)
    for (let region = 0; region < this.mesh.numRegions; region++) {
      const displayElevation = elevationKmToDisplayCoordinate(this.data.geography.elevation[region])
      offsets[region] = displayElevation
        * terrainScale
        * (displayElevation > 0 ? 1 : OCEAN_DEPTH_SCALE)
    }
    return offsets
  }

  private rebuildVectorLayer(): void {
    this.disposeVectorLayer()
    const mode = this.params.appearance.displayMode
    const vectors = this.data?.climate?.displayVector
    if (!this.mesh || !this.data || (mode !== 'wind' && mode !== 'ocean-current') || vectors?.kind !== mode)
      return
    const geometry = createClimateVectorGeometry(
      this.mesh,
      vectors,
      this.data.geography.landMask,
      this.params.core.planetRadius + 0.9,
    )
    if ((geometry.getAttribute('position')?.count ?? 0) === 0) {
      geometry.dispose()
      return
    }
    const material = new LineBasicMaterial({
      color: mode === 'wind' ? 0xFFE6A0 : 0xFFFFFF,
      vertexColors: mode === 'ocean-current',
      transparent: true,
      opacity: 0.92,
      depthTest: true,
      depthWrite: false,
    })
    this.vectorLayer = new LineSegments(geometry, material)
    this.vectorLayer.renderOrder = 5
    this.scene.add(this.vectorLayer)
  }

  private rebuildWaterLayer(): void {
    if (this.waterLayer) {
      this.scene.remove(this.waterLayer)
      this.waterLayer.geometry.dispose()
      this.waterLayer.material.dispose()
      this.waterLayer = null
    }

    if (
      (this.params.appearance.displayMode === 'terrain' || this.params.appearance.displayMode === 'satellite')
      && this.params.appearance.showAtmosphere
    ) {
      const planetRadius = this.params.core.planetRadius
      let geometry: BufferGeometry
      if (this.usesElevationGeometry(this.params)) {
        geometry = new SphereGeometry(planetRadius, 128, 128)
      }
      else if (this.mesh && this.data) {
        const oceanMask = Uint8Array.from(this.data.geography.landMask, land => land === 0 ? 1 : 0)
        geometry = this.geometryBuilder.create(
          this.mesh,
          planetRadius + WATER_SURFACE_OFFSET,
          new Float32Array(this.mesh.numRegions * 3),
          oceanMask,
        )
      }
      else {
        return
      }

      const material = new MeshPhongMaterial({
        color: 0x0C3A6E,
        transparent: true,
        opacity: 0.55,
        shininess: 120,
        specular: 0x4488BB,
        depthWrite: false,
      })
      this.waterLayer = new Mesh(geometry, material)
      this.scene.add(this.waterLayer)
    }
  }

  private rebuildCellBoundaries(): void {
    this.disposeCellBoundaries()
    if (!this.params.appearance.wireframe || !this.mesh || !this.surface)
      return
    const geometry = this.cellBoundaryGeometryBuilder.create(
      this.mesh,
      this.params.core.planetRadius + CELL_BOUNDARY_LAYER_OFFSET,
      Number.POSITIVE_INFINITY,
      this.usesElevationGeometry(this.params) && this.data
        ? this.data.geography.elevation
        : undefined,
      this.getTerrainVerticalScale(this.params.core.planetRadius),
      OCEAN_DEPTH_SCALE,
    )
    this.cellBoundaryLayer = new LineSegments(geometry, new LineBasicMaterial({
      color: 0xB8D6E8,
      transparent: true,
      opacity: 0.5,
      depthTest: true,
      depthWrite: false,
    }))
    this.cellBoundaryLayer.renderOrder = 3
    this.scene.add(this.cellBoundaryLayer)
  }

  private rebuildGraticule(): void {
    this.disposeGraticule()
    if (!this.params.appearance.showGraticule || !this.surface)
      return
    const terrainClearance = this.usesElevationGeometry(this.params)
      ? this.getTerrainVerticalScale(this.params.core.planetRadius)
      : 0
    const geometry = this.graticuleGeometryBuilder.create(
      this.params.core.planetRadius + GRATICULE_LAYER_OFFSET + terrainClearance,
    )
    this.graticuleLayer = new LineSegments(geometry, new LineBasicMaterial({
      color: 0xB8D6E8,
      transparent: true,
      opacity: 0.36,
      depthTest: true,
      depthWrite: false,
    }))
    this.graticuleLayer.renderOrder = 4
    this.scene.add(this.graticuleLayer)
  }

  private disposeSurface(): void {
    if (this.surface) {
      this.scene.remove(this.surface)
      this.surface.geometry.dispose()
      this.surface.material.dispose()
      this.surface = null
    }
    this.disposeCellBoundaries()
    this.disposeGraticule()
    this.disposeVectorLayer()
    this.disposeRiverLayer()
    this.disposeCloudLayer()
    this.disposeAtmosphere()
  }

  private disposeAtmosphere(): void {
    if (this.atmosphereLayer) {
      this.scene.remove(this.atmosphereLayer.group)
      this.atmosphereLayer.dispose()
      this.atmosphereLayer = null
    }
  }

  private rebuildAtmosphere(): void {
    this.disposeAtmosphere()
    if (this.params.appearance.displayMode === 'heightmap' || !this.params.appearance.showAtmosphere)
      return

    this.atmosphereLayer = new Atmosphere(this.params.core.planetRadius)
    this.scene.add(this.atmosphereLayer.group)
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
      && (params.appearance.displayMode === 'terrain'
        || params.appearance.displayMode === 'heightmap'
        || params.appearance.displayMode === 'satellite')
  }

  private disposeCellBoundaries(): void {
    if (!this.cellBoundaryLayer)
      return
    this.scene.remove(this.cellBoundaryLayer)
    this.cellBoundaryLayer.geometry.dispose()
    this.cellBoundaryLayer.material.dispose()
    this.cellBoundaryLayer = null
  }

  private disposeGraticule(): void {
    if (!this.graticuleLayer)
      return
    this.scene.remove(this.graticuleLayer)
    this.graticuleLayer.geometry.dispose()
    this.graticuleLayer.material.dispose()
    this.graticuleLayer = null
  }

  private disposeVectorLayer(): void {
    if (!this.vectorLayer)
      return
    this.scene.remove(this.vectorLayer)
    this.vectorLayer.geometry.dispose()
    this.vectorLayer.material.dispose()
    this.vectorLayer = null
  }

  private disposeRiverLayer(): void {
    if (!this.riverLayer)
      return
    this.scene.remove(this.riverLayer)
    this.riverLayer.geometry.dispose()
    this.riverLayer.material.dispose()
    this.riverLayer = null
  }

  private disposeCloudLayer(): void {
    if (!this.cloudLayer)
      return
    this.scene.remove(this.cloudLayer)
    this.cloudLayer.geometry.dispose()
    this.cloudLayer.material.dispose()
    this.cloudLayer = null
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
    if (!this.enableRegionPicking)
      return
    if (
      Math.hypot(event.clientX - this.pointerStartX, event.clientY - this.pointerStartY) > 4
      || !this.mesh
    ) {
      return
    }
    const region = this.viewMode === 'map'
      ? this.mapView.pick(event)
      : this.surface
        ? this.picker.pick(event, this.canvas, this.camera, this.surface, this.mesh)
        : null
    if (region === null)
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
    this.renderer.render(this.scene, this.camera)
  }
}
