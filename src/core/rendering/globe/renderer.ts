import type { GlobeGenParams } from '@/core/spherical/config'
import type { MapProjectionId } from '@/core/projections/map-projection'
import type { WorldViewMode } from '@/core/rendering/view-mode'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type { SphericalSettlement, SphericalWorldData } from '@/core/spherical/spherical-world-data'
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GlobeCoastlineGeometry } from '@/core/rendering/globe/coastline-geometry'
import { GlobeLabelLayer } from '@/core/rendering/globe/label-layer'
import { GlobePicker } from '@/core/rendering/globe/picker'
import { GlobeRiverGeometry } from '@/core/rendering/globe/river-geometry'
import { GlobeRouteGeometry } from '@/core/rendering/globe/route-geometry'
import { GlobeSurfaceGeometry } from '@/core/rendering/globe/surface-geometry'
import { GlobeTradeRouteGeometry } from '@/core/rendering/globe/trade-route-geometry'
import { MapView } from '@/core/rendering/map/view'
import { SphericalContourGeometry } from '@/core/rendering/shared/spherical-contour-geometry'
import { SphericalGraticuleGeometry } from '@/core/rendering/shared/spherical-graticule-geometry'
import { SphericalWindGeometry } from '@/core/rendering/shared/spherical-wind-geometry'
import { WorldColorizer } from '@/core/rendering/shared/world-colorizer'
import { PLATE_BOUNDARY } from '@/core/spherical/geology/plate-boundary'
import { SphericalCoastlineSource } from '@/core/spherical/features/spherical-coastline-source'
import { SPHERICAL_BIOME } from '@/core/spherical/spherical-world-data'

const COASTLINE_LINE_WIDTH = 0.275
const TEMPERATURE_LAYER_OFFSET = 0.08
const MOISTURE_LAYER_OFFSET = 0.1
const PRECIPITATION_LAYER_OFFSET = 0.12
const FLUX_LAYER_OFFSET = 0.14
const SEA_SURFACE_TEMPERATURE_LAYER_OFFSET = 0.16
const OCEAN_CURRENT_LAYER_OFFSET = 0.42
const GRATICULE_LAYER_OFFSET = 0.75

const SETTLEMENT_MARKER_RADIUS = {
  camp: 0.3,
  village: 0.44,
  town: 0.64,
  city: 0.85,
} as const

const SETTLEMENT_MARKER_COLOR = {
  camp: 0xCFE4FF,
  village: 0xFFE5A0,
  town: 0xFFB347,
  city: 0xFF6B4A,
  port: 0x54D6C7,
} as const

export class GlobeRenderer {
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  // OrbitControls never lets the camera approach the globe closer than ~25
  // units, so a larger near plane provides substantially better depth precision.
  private readonly camera = new PerspectiveCamera(45, 1, 5, 1000)
  private readonly controls: OrbitControls
  private readonly labelLayer: GlobeLabelLayer
  private readonly mapView: MapView
  private readonly colorizer = new WorldColorizer()
  private readonly coastlineSource = new SphericalCoastlineSource()
  private readonly coastlineGeometryBuilder = new GlobeCoastlineGeometry()
  private readonly contourGeometryBuilder = new SphericalContourGeometry()
  private readonly graticuleGeometryBuilder = new SphericalGraticuleGeometry()
  private readonly geometryBuilder = new GlobeSurfaceGeometry()
  private readonly picker = new GlobePicker()
  private readonly riverGeometryBuilder = new GlobeRiverGeometry()
  private readonly routeGeometryBuilder = new GlobeRouteGeometry()
  private readonly tradeRouteGeometryBuilder = new GlobeTradeRouteGeometry()
  private readonly windGeometryBuilder = new SphericalWindGeometry()
  private readonly resizeObserver: ResizeObserver
  private readonly selectionMarker: Mesh<SphereGeometry, MeshBasicMaterial>
  private surface: Mesh<BufferGeometry, MeshStandardMaterial> | null = null
  private boundaries: LineSegments<BufferGeometry, LineBasicMaterial> | null = null
  private politicalBoundaries: LineSegments<BufferGeometry, LineBasicMaterial> | null = null
  private cultureBoundaries: LineSegments<BufferGeometry, LineBasicMaterial> | null = null
  private religionBoundaries: LineSegments<BufferGeometry, LineBasicMaterial> | null = null
  private coastlines: Mesh<BufferGeometry, MeshBasicMaterial> | null = null
  private coastSeam: Mesh<BufferGeometry, MeshStandardMaterial> | null = null
  private contours: LineSegments<BufferGeometry, LineBasicMaterial> | null = null
  private graticuleLayer: LineSegments<BufferGeometry, LineBasicMaterial> | null = null
  private temperatureLayer: Mesh<BufferGeometry, MeshBasicMaterial> | null = null
  private moistureLayer: Mesh<BufferGeometry, MeshBasicMaterial> | null = null
  private precipitationLayer: Mesh<BufferGeometry, MeshBasicMaterial> | null = null
  private fluxLayer: Mesh<BufferGeometry, MeshBasicMaterial> | null = null
  private windLayer: LineSegments<BufferGeometry, LineBasicMaterial> | null = null
  private oceanCurrentLayer: LineSegments<BufferGeometry, LineBasicMaterial> | null = null
  private seaSurfaceTemperatureLayer: Mesh<BufferGeometry, MeshBasicMaterial> | null = null
  private riverLayer: Mesh<BufferGeometry, MeshStandardMaterial> | null = null
  private roadLayer: LineSegments<BufferGeometry, LineBasicMaterial> | null = null
  private shippingRouteLayer: LineSegments<BufferGeometry, LineBasicMaterial> | null = null
  private tradeRouteLayer: LineSegments<BufferGeometry, LineBasicMaterial> | null = null
  private settlementLayers: InstancedMesh<CircleGeometry, MeshBasicMaterial>[] = []
  private holySiteLayer: InstancedMesh<RingGeometry, MeshBasicMaterial> | null = null
  private mesh: SphericalMesh | null = null
  private data: SphericalWorldData | null = null
  private params: GlobeGenParams
  private pointerStartX = 0
  private pointerStartY = 0
  private viewMode: WorldViewMode = 'globe'

  constructor(
    private readonly canvas: HTMLCanvasElement,
    params: GlobeGenParams,
    private readonly onRegionSelected: (region: number) => void,
  ) {
    this.params = { ...params }
    this.renderer = new WebGLRenderer({ canvas, antialias: true })
    this.labelLayer = new GlobeLabelLayer(canvas)
    this.mapView = new MapView(canvas, params)
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.scene.background = new Color(0x07101F)
    this.camera.position.set(0, 0, 280)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.enablePan = false
    this.controls.minDistance = 125
    this.controls.maxDistance = 500
    this.controls.rotateSpeed = 0.6
    this.controls.zoomSpeed = 0.8
    this.controls.autoRotate = params.autoRotate
    this.controls.enabled = true

    this.scene.add(new HemisphereLight(0xCFE4FF, 0x091020, 1.9))
    const sunlight = new DirectionalLight(0xFFF4DD, 2.1)
    sunlight.position.set(180, 120, 220)
    this.scene.add(sunlight)

    this.selectionMarker = new Mesh(
      new SphereGeometry(1.35, 16, 10),
      new MeshBasicMaterial({ color: 0x34D399, depthTest: false }),
    )
    this.selectionMarker.visible = false
    this.selectionMarker.renderOrder = 10
    this.scene.add(this.selectionMarker)

    this.resizeObserver = new ResizeObserver(this.handleResize)
    this.resizeObserver.observe(canvas)
    canvas.addEventListener('pointerdown', this.handlePointerDown)
    canvas.addEventListener('pointerup', this.handlePointerUp)
    this.handleResize()
    this.renderer.setAnimationLoop(this.render)
  }

  setWorld(mesh: SphericalMesh, data: SphericalWorldData, params: GlobeGenParams): void {
    this.mesh = mesh
    this.data = data
    this.params = { ...params }
    this.disposeSurface()
    const colors = this.colorizer.build(data, params.displayMode)
    this.surface = this.createSurface(
      this.geometryBuilder.create(mesh, params.planetRadius, colors),
      params.wireframe,
    )
    this.scene.add(this.surface)
    this.mapView.setWorld(mesh, data, params)
    this.selectionMarker.visible = false
    this.rebuildOverlays()
  }

  updateAppearance(params: GlobeGenParams): void {
    const displayModeChanged = this.params.displayMode !== params.displayMode
    this.params = { ...params }
    this.controls.autoRotate = params.autoRotate
    if (displayModeChanged && this.mesh && this.data) {
      this.setWorld(this.mesh, this.data, params)
      return
    }
    if (this.surface && this.data) {
      this.surface.material.wireframe = params.wireframe
      this.geometryBuilder.updateColors(
        this.surface.geometry,
        this.colorizer.build(this.data, params.displayMode),
      )
    }
    this.mapView.updateAppearance(params)
    this.rebuildOverlays()
  }

  selectRegion(region: number): void {
    if (!this.mesh)
      return
    const index = region * 3
    const radius = this.params.planetRadius + 0.9
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
    this.labelLayer.setVisible(globeActive)
  }

  setMapProjection(id: MapProjectionId): void {
    this.mapView.setProjection(id)
  }

  resetCamera(): void {
    if (this.viewMode === 'map') {
      this.mapView.resetCamera()
      return
    }
    this.camera.position.set(0, 0, 280)
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
    this.labelLayer.destroy()
    this.selectionMarker.geometry.dispose()
    this.selectionMarker.material.dispose()
    this.renderer.dispose()
  }

  private rebuildOverlays(): void {
    this.rebuildCoastlines()
    this.rebuildContours()
    this.rebuildClimateLayers()
    this.rebuildRivers()
    this.rebuildTransportRoutes()
    this.rebuildSettlements()
    this.rebuildBoundaries()
    this.rebuildCultureBoundaries()
    this.rebuildReligionBoundaries()
    this.rebuildPoliticalBoundaries()
    this.rebuildHolySites()
    this.rebuildGraticule()
    if (this.mesh && this.data)
      this.labelLayer.rebuild(this.mesh, this.data, this.params)
  }

  private rebuildGraticule(): void {
    this.disposeGraticule()
    if (!this.params.showGraticule || !this.surface)
      return
    const geometry = this.graticuleGeometryBuilder.create(
      this.params.planetRadius + GRATICULE_LAYER_OFFSET,
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

  private rebuildClimateLayers(): void {
    this.disposeClimateLayers()
    if (!this.mesh || !this.data)
      return
    const oceanMask = new Uint8Array(this.mesh.numRegions)
    for (let region = 0; region < this.mesh.numRegions; region++)
      oceanMask[region] = this.data.baseLandMask[region] === 0 ? 1 : 0

    if (this.params.showSeaSurfaceTemperature) {
      const geometry = this.geometryBuilder.create(
        this.mesh,
        this.params.planetRadius + SEA_SURFACE_TEMPERATURE_LAYER_OFFSET,
        this.colorizer.buildSeaSurfaceTemperatureColors(this.data),
        oceanMask,
      )
      this.seaSurfaceTemperatureLayer = this.createClimateSurface(geometry, 0.72)
      this.scene.add(this.seaSurfaceTemperatureLayer)
    }

    if (this.params.showTemperature) {
      const geometry = this.geometryBuilder.create(
        this.mesh,
        this.params.planetRadius + TEMPERATURE_LAYER_OFFSET,
        this.colorizer.buildTemperatureColors(this.data),
      )
      this.temperatureLayer = this.createClimateSurface(geometry, 0.68)
      this.scene.add(this.temperatureLayer)
    }

    if (this.params.showMoisture) {
      const geometry = this.geometryBuilder.create(
        this.mesh,
        this.params.planetRadius + MOISTURE_LAYER_OFFSET,
        this.colorizer.buildMoistureColors(this.data),
      )
      this.moistureLayer = this.createClimateSurface(geometry, 0.58)
      this.scene.add(this.moistureLayer)
    }

    if (this.params.showPrecipitation) {
      const geometry = this.geometryBuilder.create(
        this.mesh,
        this.params.planetRadius + PRECIPITATION_LAYER_OFFSET,
        this.colorizer.buildPrecipitationColors(this.data),
        this.data.landMask,
      )
      this.precipitationLayer = this.createClimateSurface(geometry, 0.56)
      this.scene.add(this.precipitationLayer)
    }

    if (this.params.showFlux) {
      const geometry = this.geometryBuilder.create(
        this.mesh,
        this.params.planetRadius + FLUX_LAYER_OFFSET,
        this.colorizer.buildFluxColors(this.data),
        this.data.landMask,
      )
      this.fluxLayer = this.createClimateSurface(geometry, 0.52)
      this.scene.add(this.fluxLayer)
    }

    if (this.params.showWind) {
      const geometry = this.windGeometryBuilder.create(
        this.mesh,
        this.data.climate.wind,
        this.params.planetRadius + 0.38,
      )
      this.windLayer = new LineSegments(geometry, new LineBasicMaterial({
        color: 0xD8FAFF,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
      }))
      this.windLayer.renderOrder = 5
      this.scene.add(this.windLayer)
    }

    if (this.params.showOceanCurrents) {
      const geometry = this.windGeometryBuilder.create(
        this.mesh,
        this.data.climate.oceanCurrent,
        this.params.planetRadius + OCEAN_CURRENT_LAYER_OFFSET,
        oceanMask,
      )
      this.oceanCurrentLayer = new LineSegments(geometry, new LineBasicMaterial({
        color: 0xFFE2A3,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }))
      this.oceanCurrentLayer.renderOrder = 5
      this.scene.add(this.oceanCurrentLayer)
    }
  }

  private rebuildRivers(): void {
    this.disposeRivers()
    if (!this.params.showRivers || !this.mesh || !this.data)
      return
    const hiddenRegionMask = new Uint8Array(this.mesh.numRegions)
    for (let region = 0; region < this.mesh.numRegions; region++) {
      if (this.data.climate.biome[region] === SPHERICAL_BIOME.Ice)
        hiddenRegionMask[region] = 1
    }
    const geometry = this.riverGeometryBuilder.create(
      this.mesh,
      this.data.rivers,
      this.data.landMask,
      this.params.planetRadius + 0.26,
      hiddenRegionMask,
    )
    if (geometry.getAttribute('position').count === 0) {
      geometry.dispose()
      return
    }
    const material = new MeshStandardMaterial({
      color: 0x4B8FD8,
      depthWrite: false,
      roughness: 0.9,
      metalness: 0,
    })
    this.riverLayer = new Mesh(geometry, material)
    this.riverLayer.renderOrder = 2
    this.scene.add(this.riverLayer)
  }

  private rebuildTransportRoutes(): void {
    this.disposeTransportRoutes()
    if (!this.mesh || !this.data)
      return
    const tradeMode = this.params.displayMode === 'trade'

    if (this.params.showRoads) {
      const geometry = this.routeGeometryBuilder.create(
        this.mesh,
        this.data.human.transport.routes,
        'road',
        this.params.planetRadius + 0.38,
      )
      if (geometry.getAttribute('position').count > 0) {
        this.roadLayer = new LineSegments(geometry, new LineBasicMaterial({
          color: 0x9A6846,
          transparent: true,
          opacity: tradeMode ? 0.18 : 0.78,
          depthWrite: false,
        }))
        this.roadLayer.renderOrder = 4
        this.scene.add(this.roadLayer)
      }
      else {
        geometry.dispose()
      }
    }

    if (this.params.showShippingRoutes) {
      const geometry = this.routeGeometryBuilder.create(
        this.mesh,
        this.data.human.transport.routes,
        'shipping',
        this.params.planetRadius + 0.41,
      )
      if (geometry.getAttribute('position').count > 0) {
        this.shippingRouteLayer = new LineSegments(geometry, new LineBasicMaterial({
          color: 0x8FE8FF,
          transparent: true,
          opacity: tradeMode ? 0.18 : 0.72,
          depthWrite: false,
        }))
        this.shippingRouteLayer.renderOrder = 4
        this.scene.add(this.shippingRouteLayer)
      }
      else {
        geometry.dispose()
      }
    }

    if (tradeMode) {
      const geometry = this.tradeRouteGeometryBuilder.create(
        this.mesh,
        this.data.human.transport.routes,
        this.data.human.trade.routeVolume,
        this.params.planetRadius + 0.48,
      )
      if (geometry.getAttribute('position').count > 0) {
        this.tradeRouteLayer = new LineSegments(geometry, new LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.92,
          depthWrite: false,
        }))
        this.tradeRouteLayer.renderOrder = 6
        this.scene.add(this.tradeRouteLayer)
      }
      else {
        geometry.dispose()
      }
    }
  }

  private rebuildSettlements(): void {
    this.disposeSettlements()
    if (!this.params.showSettlements || !this.mesh || !this.data)
      return

    const groups = new Map<string, SphericalSettlement[]>()
    for (const settlement of this.data.human.settlements) {
      const key = `${settlement.type}:${settlement.isPort ? 'port' : 'land'}`
      const group = groups.get(key)
      if (group)
        group.push(settlement)
      else
        groups.set(key, [settlement])
    }

    const transform = new Matrix4()
    const outward = new Vector3()
    const position = new Vector3()
    const orientation = new Quaternion()
    const scale = new Vector3()
    const circleNormal = new Vector3(0, 0, 1)
    const markerRadius = this.params.planetRadius + 0.48
    for (const [key, settlements] of groups) {
      const [type, location] = key.split(':') as [SphericalSettlement['type'], 'land' | 'port']
      const geometry = new CircleGeometry(1, 20)
      const material = new MeshBasicMaterial({
        color: location === 'port'
          ? SETTLEMENT_MARKER_COLOR.port
          : SETTLEMENT_MARKER_COLOR[type],
        depthTest: true,
        depthWrite: false,
      })
      const layer = new InstancedMesh(geometry, material, settlements.length)
      const markerSize = SETTLEMENT_MARKER_RADIUS[type] + (location === 'port' ? 0.06 : 0)
      for (let index = 0; index < settlements.length; index++) {
        const regionIndex = settlements[index].region * 3
        outward.set(
          this.mesh.regionPosition[regionIndex],
          this.mesh.regionPosition[regionIndex + 1],
          this.mesh.regionPosition[regionIndex + 2],
        ).normalize()
        orientation.setFromUnitVectors(circleNormal, outward)
        position.copy(outward).multiplyScalar(markerRadius)
        scale.setScalar(markerSize)
        transform.compose(position, orientation, scale)
        layer.setMatrixAt(index, transform)
      }
      layer.instanceMatrix.needsUpdate = true
      layer.frustumCulled = false
      layer.renderOrder = 6
      this.settlementLayers.push(layer)
      this.scene.add(layer)
    }
  }

  private rebuildCoastlines(): void {
    this.disposeCoastlines()
    if (!this.params.showCoastlines || !this.mesh || !this.data)
      return

    const { paths, edgeInfo } = this.coastlineSource.create(this.mesh, this.data.landMask)
    const radius = this.params.planetRadius + 0.18
    const colors = this.colorizer.build(this.data, this.params.displayMode)
    const geometries = this.coastlineGeometryBuilder.create(
      this.mesh,
      paths,
      edgeInfo,
      colors,
      radius,
      COASTLINE_LINE_WIDTH,
    )
    if (geometries.seam.getAttribute('position').count > 0) {
      const seamMaterial = new MeshStandardMaterial({
        vertexColors: true,
        depthWrite: false,
        roughness: 0.9,
        metalness: 0,
      })
      this.coastSeam = new Mesh(geometries.seam, seamMaterial)
      this.coastSeam.renderOrder = 2
      this.scene.add(this.coastSeam)
    }
    else {
      geometries.seam.dispose()
    }
    const material = new MeshBasicMaterial({
      color: 0x10222C,
      side: DoubleSide,
      depthWrite: false,
    })
    this.coastlines = new Mesh(geometries.line, material)
    this.coastlines.renderOrder = 3
    this.scene.add(this.coastlines)
  }

  private rebuildContours(): void {
    this.disposeContours()
    if (this.params.displayMode !== 'contours' || !this.mesh || !this.data)
      return
    const thresholds: number[] = []
    for (let value = 0.25; value <= 0.9; value += 0.05)
      thresholds.push(Number(value.toFixed(2)))
    const positions = this.contourGeometryBuilder.createLinePositions(
      this.mesh,
      this.data.elevation,
      thresholds,
      this.params.planetRadius + 0.12,
    )
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    const material = new LineBasicMaterial({ color: 0x24303A, transparent: true, opacity: 0.52 })
    this.contours = new LineSegments(geometry, material)
    this.contours.renderOrder = 2
    this.scene.add(this.contours)
  }

  private rebuildBoundaries(): void {
    this.disposeBoundaries()
    if (!this.params.showPlateBoundaries || !this.mesh || !this.data)
      return

    const positions: number[] = []
    const colors: number[] = []
    const radius = this.params.planetRadius + 0.35
    for (let edge = 0; edge < this.mesh.voronoi.edgeRegions.length / 2; edge++) {
      const edgeIndex = edge * 2
      if (this.data.tectonics.edgeBoundaryType[edge] === PLATE_BOUNDARY.None)
        continue
      const a = this.mesh.voronoi.edgeCorners[edgeIndex] * 3
      const b = this.mesh.voronoi.edgeCorners[edgeIndex + 1] * 3
      positions.push(
        this.mesh.voronoi.cornerPosition[a] * radius,
        this.mesh.voronoi.cornerPosition[a + 1] * radius,
        this.mesh.voronoi.cornerPosition[a + 2] * radius,
        this.mesh.voronoi.cornerPosition[b] * radius,
        this.mesh.voronoi.cornerPosition[b + 1] * radius,
        this.mesh.voronoi.cornerPosition[b + 2] * radius,
      )
      const type = this.data.tectonics.edgeBoundaryType[edge]
      const color = type === PLATE_BOUNDARY.Convergent
        ? [1, 0.22, 0.18]
        : type === PLATE_BOUNDARY.Divergent
          ? [0.16, 0.56, 1]
          : [1, 0.78, 0.15]
      colors.push(...color, ...color)
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
    const material = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })
    this.boundaries = new LineSegments(geometry, material)
    this.boundaries.renderOrder = 2
    this.scene.add(this.boundaries)
  }

  private rebuildPoliticalBoundaries(): void {
    this.disposePoliticalBoundaries()
    if (!this.params.showPoliticalBoundaries || !this.mesh || !this.data)
      return

    const positions: number[] = []
    const radius = this.params.planetRadius + 0.44
    for (let region = 0; region < this.mesh.numRegions; region++) {
      if (this.data.landMask[region] === 0)
        continue
      const polity = this.data.human.politics.regionPolity[region]
      for (const neighbor of this.mesh.forEachNeighborOfRegion(region)) {
        if (neighbor <= region || this.data.landMask[neighbor] === 0)
          continue
        const neighborPolity = this.data.human.politics.regionPolity[neighbor]
        if (polity === neighborPolity || (polity < 0 && neighborPolity < 0))
          continue
        const boundary = this.mesh.voronoi.getSharedBoundaryCorners(region, neighbor)
        if (!boundary)
          continue
        const a = boundary[0] * 3
        const b = boundary[1] * 3
        positions.push(
          this.mesh.voronoi.cornerPosition[a] * radius,
          this.mesh.voronoi.cornerPosition[a + 1] * radius,
          this.mesh.voronoi.cornerPosition[a + 2] * radius,
          this.mesh.voronoi.cornerPosition[b] * radius,
          this.mesh.voronoi.cornerPosition[b + 1] * radius,
          this.mesh.voronoi.cornerPosition[b + 2] * radius,
        )
      }
    }
    if (positions.length === 0)
      return
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    this.politicalBoundaries = new LineSegments(geometry, new LineBasicMaterial({
      color: 0x25152D,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    }))
    this.politicalBoundaries.renderOrder = 4
    this.scene.add(this.politicalBoundaries)
  }

  private rebuildCultureBoundaries(): void {
    this.disposeCultureBoundaries()
    if (!this.params.showCultureBoundaries || !this.mesh || !this.data)
      return
    const geometry = this.createHumanBoundaryGeometry(
      this.data.human.culture.regionCulture,
      this.params.planetRadius + 0.43,
    )
    if (!geometry)
      return
    this.cultureBoundaries = new LineSegments(geometry, new LineBasicMaterial({
      color: 0xFFF0B8,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
    }))
    this.cultureBoundaries.renderOrder = 4
    this.scene.add(this.cultureBoundaries)
  }

  private rebuildReligionBoundaries(): void {
    this.disposeReligionBoundaries()
    if (!this.params.showReligionBoundaries || !this.mesh || !this.data)
      return
    const geometry = this.createHumanBoundaryGeometry(
      this.data.human.religion.regionReligion,
      this.params.planetRadius + 0.46,
    )
    if (!geometry)
      return
    this.religionBoundaries = new LineSegments(geometry, new LineBasicMaterial({
      color: 0xE8C8FF,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }))
    this.religionBoundaries.renderOrder = 5
    this.scene.add(this.religionBoundaries)
  }

  private createHumanBoundaryGeometry(
    regionOwner: Int16Array,
    radius: number,
  ): BufferGeometry | null {
    if (!this.mesh || !this.data)
      return null
    const positions: number[] = []
    for (let region = 0; region < this.mesh.numRegions; region++) {
      if (this.data.landMask[region] === 0)
        continue
      for (const neighbor of this.mesh.forEachNeighborOfRegion(region)) {
        if (neighbor <= region || this.data.landMask[neighbor] === 0)
          continue
        const owner = regionOwner[region]
        const neighborOwner = regionOwner[neighbor]
        if (owner === neighborOwner || (owner < 0 && neighborOwner < 0))
          continue
        const boundary = this.mesh.voronoi.getSharedBoundaryCorners(region, neighbor)
        if (!boundary)
          continue
        const a = boundary[0] * 3
        const b = boundary[1] * 3
        positions.push(
          this.mesh.voronoi.cornerPosition[a] * radius,
          this.mesh.voronoi.cornerPosition[a + 1] * radius,
          this.mesh.voronoi.cornerPosition[a + 2] * radius,
          this.mesh.voronoi.cornerPosition[b] * radius,
          this.mesh.voronoi.cornerPosition[b + 1] * radius,
          this.mesh.voronoi.cornerPosition[b + 2] * radius,
        )
      }
    }
    if (positions.length === 0)
      return null
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    return geometry
  }

  private rebuildHolySites(): void {
    this.disposeHolySites()
    if (
      !this.params.showHolySites
      || !this.mesh
      || !this.data
      || this.data.human.religion.religions.length === 0
    ) {
      return
    }
    const religions = this.data.human.religion.religions
    const geometry = new RingGeometry(0.4, 0.7, 20)
    const material = new MeshBasicMaterial({
      color: 0xFFE36E,
      side: DoubleSide,
      depthWrite: false,
    })
    const layer = new InstancedMesh(geometry, material, religions.length)
    const transform = new Matrix4()
    const outward = new Vector3()
    const position = new Vector3()
    const orientation = new Quaternion()
    const scale = new Vector3(1, 1, 1)
    const circleNormal = new Vector3(0, 0, 1)
    const radius = this.params.planetRadius + 0.53
    for (let index = 0; index < religions.length; index++) {
      const regionIndex = religions[index].originRegion * 3
      outward.set(
        this.mesh.regionPosition[regionIndex],
        this.mesh.regionPosition[regionIndex + 1],
        this.mesh.regionPosition[regionIndex + 2],
      ).normalize()
      orientation.setFromUnitVectors(circleNormal, outward)
      position.copy(outward).multiplyScalar(radius)
      transform.compose(position, orientation, scale)
      layer.setMatrixAt(index, transform)
    }
    layer.instanceMatrix.needsUpdate = true
    layer.frustumCulled = false
    layer.renderOrder = 7
    this.holySiteLayer = layer
    this.scene.add(layer)
  }

  private disposeSurface(): void {
    if (this.surface) {
      this.scene.remove(this.surface)
      this.surface.geometry.dispose()
      this.surface.material.dispose()
      this.surface = null
    }
    this.disposeBoundaries()
    this.disposeCultureBoundaries()
    this.disposeReligionBoundaries()
    this.disposePoliticalBoundaries()
    this.disposeCoastlines()
    this.disposeContours()
    this.disposeClimateLayers()
    this.disposeRivers()
    this.disposeTransportRoutes()
    this.disposeSettlements()
    this.disposeHolySites()
    this.disposeGraticule()
    this.labelLayer.clear()
  }

  private createSurface(
    geometry: BufferGeometry,
    wireframe: boolean,
  ): Mesh<BufferGeometry, MeshStandardMaterial> {
    return new Mesh(geometry, new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
      wireframe,
    }))
  }

  private createClimateSurface(
    geometry: BufferGeometry,
    opacity: number,
  ): Mesh<BufferGeometry, MeshBasicMaterial> {
    const layer = new Mesh(geometry, new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }))
    layer.renderOrder = 1
    return layer
  }

  private disposeBoundaries(): void {
    if (!this.boundaries)
      return
    this.scene.remove(this.boundaries)
    this.boundaries.geometry.dispose()
    this.boundaries.material.dispose()
    this.boundaries = null
  }

  private disposePoliticalBoundaries(): void {
    if (!this.politicalBoundaries)
      return
    this.scene.remove(this.politicalBoundaries)
    this.politicalBoundaries.geometry.dispose()
    this.politicalBoundaries.material.dispose()
    this.politicalBoundaries = null
  }

  private disposeCultureBoundaries(): void {
    if (!this.cultureBoundaries)
      return
    this.scene.remove(this.cultureBoundaries)
    this.cultureBoundaries.geometry.dispose()
    this.cultureBoundaries.material.dispose()
    this.cultureBoundaries = null
  }

  private disposeReligionBoundaries(): void {
    if (!this.religionBoundaries)
      return
    this.scene.remove(this.religionBoundaries)
    this.religionBoundaries.geometry.dispose()
    this.religionBoundaries.material.dispose()
    this.religionBoundaries = null
  }

  private disposeCoastlines(): void {
    if (this.coastSeam) {
      this.scene.remove(this.coastSeam)
      this.coastSeam.geometry.dispose()
      this.coastSeam.material.dispose()
      this.coastSeam = null
    }
    if (this.coastlines) {
      this.scene.remove(this.coastlines)
      this.coastlines.geometry.dispose()
      this.coastlines.material.dispose()
      this.coastlines = null
    }
  }

  private disposeContours(): void {
    if (!this.contours)
      return
    this.scene.remove(this.contours)
    this.contours.geometry.dispose()
    this.contours.material.dispose()
    this.contours = null
  }

  private disposeClimateLayers(): void {
    if (this.temperatureLayer) {
      this.scene.remove(this.temperatureLayer)
      this.temperatureLayer.geometry.dispose()
      this.temperatureLayer.material.dispose()
      this.temperatureLayer = null
    }
    if (this.moistureLayer) {
      this.scene.remove(this.moistureLayer)
      this.moistureLayer.geometry.dispose()
      this.moistureLayer.material.dispose()
      this.moistureLayer = null
    }
    if (this.precipitationLayer) {
      this.scene.remove(this.precipitationLayer)
      this.precipitationLayer.geometry.dispose()
      this.precipitationLayer.material.dispose()
      this.precipitationLayer = null
    }
    if (this.fluxLayer) {
      this.scene.remove(this.fluxLayer)
      this.fluxLayer.geometry.dispose()
      this.fluxLayer.material.dispose()
      this.fluxLayer = null
    }
    if (this.windLayer) {
      this.scene.remove(this.windLayer)
      this.windLayer.geometry.dispose()
      this.windLayer.material.dispose()
      this.windLayer = null
    }
    if (this.oceanCurrentLayer) {
      this.scene.remove(this.oceanCurrentLayer)
      this.oceanCurrentLayer.geometry.dispose()
      this.oceanCurrentLayer.material.dispose()
      this.oceanCurrentLayer = null
    }
    if (this.seaSurfaceTemperatureLayer) {
      this.scene.remove(this.seaSurfaceTemperatureLayer)
      this.seaSurfaceTemperatureLayer.geometry.dispose()
      this.seaSurfaceTemperatureLayer.material.dispose()
      this.seaSurfaceTemperatureLayer = null
    }
  }

  private disposeRivers(): void {
    if (!this.riverLayer)
      return
    this.scene.remove(this.riverLayer)
    this.riverLayer.geometry.dispose()
    this.riverLayer.material.dispose()
    this.riverLayer = null
  }

  private disposeTransportRoutes(): void {
    if (this.roadLayer) {
      this.scene.remove(this.roadLayer)
      this.roadLayer.geometry.dispose()
      this.roadLayer.material.dispose()
      this.roadLayer = null
    }
    if (this.shippingRouteLayer) {
      this.scene.remove(this.shippingRouteLayer)
      this.shippingRouteLayer.geometry.dispose()
      this.shippingRouteLayer.material.dispose()
      this.shippingRouteLayer = null
    }
    if (this.tradeRouteLayer) {
      this.scene.remove(this.tradeRouteLayer)
      this.tradeRouteLayer.geometry.dispose()
      this.tradeRouteLayer.material.dispose()
      this.tradeRouteLayer = null
    }
  }

  private disposeSettlements(): void {
    for (const layer of this.settlementLayers) {
      this.scene.remove(layer)
      layer.geometry.dispose()
      layer.material.dispose()
    }
    this.settlementLayers = []
  }

  private disposeHolySites(): void {
    if (!this.holySiteLayer)
      return
    this.scene.remove(this.holySiteLayer)
    this.holySiteLayer.geometry.dispose()
    this.holySiteLayer.material.dispose()
    this.holySiteLayer = null
  }

  private disposeGraticule(): void {
    if (!this.graticuleLayer)
      return
    this.scene.remove(this.graticuleLayer)
    this.graticuleLayer.geometry.dispose()
    this.graticuleLayer.material.dispose()
    this.graticuleLayer = null
  }

  private handleResize = () => {
    const width = Math.max(1, this.canvas.clientWidth)
    const height = Math.max(1, this.canvas.clientHeight)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
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
      this.mapView.renderLabels(
        Math.max(1, this.canvas.clientWidth),
        Math.max(1, this.canvas.clientHeight),
      )
      return
    }
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
    this.labelLayer.render(
      this.camera,
      Math.max(1, this.canvas.clientWidth),
      Math.max(1, this.canvas.clientHeight),
    )
  }
}
