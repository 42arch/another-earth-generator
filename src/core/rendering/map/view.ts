import type { GenerationStage } from '@/core/world/generation-plan'
import type { GlobeGenParams } from '@/core/spherical/config'
import type { MapProjection, MapProjectionId } from '@/core/projections/map-projection'
import type { SphericalStrokePath } from '@/core/spherical/geometry/spherical-polyline'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type { SphericalWorldData } from '@/core/spherical/spherical-world-data'
import type { Material, Object3D } from 'three'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
} from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import { MapLabelLayer } from '@/core/rendering/map/label-layer'
import { MapLineGeometry } from '@/core/rendering/map/line-geometry'
import { MapPicker } from '@/core/rendering/map/picker'
import { MapRibbonGeometry } from '@/core/rendering/map/ribbon-geometry'
import { MapRibbonMaterial } from '@/core/rendering/map/ribbon-material'
import { MapSurfaceGeometry } from '@/core/rendering/map/surface-geometry'
import { LayerCache } from '@/core/rendering/shared/layer-cache'
import { isLayerAffected } from '@/core/rendering/shared/layer-dependencies'
import { SphericalContourGeometry } from '@/core/rendering/shared/spherical-contour-geometry'
import { SphericalGraticuleGeometry } from '@/core/rendering/shared/spherical-graticule-geometry'
import { SphericalWindGeometry } from '@/core/rendering/shared/spherical-wind-geometry'
import { WorldColorizer } from '@/core/rendering/shared/world-colorizer'
import { PLATE_BOUNDARY } from '@/core/spherical/geology/plate-boundary'
import { getMapProjection } from '@/core/projections/d3-map-projection'
import { FULL_LONGITUDE, wrapLongitude } from '@/core/projections/projection-math'
import { SphericalCoastlineSource } from '@/core/spherical/features/spherical-coastline-source'
import { SphericalRiverSource } from '@/core/spherical/features/spherical-river-source'
import { SphericalRouteSource } from '@/core/spherical/features/spherical-route-source'
import {
  sampleSmoothSphericalPath,
  sampleSmoothSphericalStrokePath,
} from '@/core/spherical/geometry/spherical-polyline'
import { SPHERICAL_BIOME } from '@/core/spherical/spherical-world-data'

interface MapLayerResource {
  objects: Object3D[]
  geometry: BufferGeometry
  material: Material
  zoomResponsiveWidth: boolean
}

const SETTLEMENT_MARKER_COLOR = {
  camp: 0xCFE4FF,
  village: 0xFFE5A0,
  town: 0xFFB347,
  city: 0xFF6B4A,
  port: 0x54D6C7,
} as const

const SETTLEMENT_MARKER_SIZE = {
  camp: 3.5,
  village: 4.5,
  town: 6,
  city: 8,
} as const

const COASTLINE_MAP_WIDTH = 1.4
const RIVER_MAP_WIDTH_SCALE = 7.2
const RIVER_REFERENCE_ZOOM = 4
const ROAD_MAP_WIDTH = 1.25
const SHIPPING_ROUTE_MAP_WIDTH = 1.15

export class MapView {
  readonly scene = new Scene()
  readonly camera = new OrthographicCamera(-Math.PI, Math.PI, Math.PI / 2, -Math.PI / 2, 0.1, 100)
  private readonly colorizer = new WorldColorizer()
  private readonly coastlineSource = new SphericalCoastlineSource()
  private readonly contourGeometryBuilder = new SphericalContourGeometry()
  private readonly controls: MapControls
  private readonly geometryBuilder = new MapSurfaceGeometry()
  private readonly graticuleGeometryBuilder = new SphericalGraticuleGeometry()
  private readonly lineGeometryBuilder = new MapLineGeometry()
  private readonly ribbonGeometryBuilder = new MapRibbonGeometry()
  private readonly labelLayer: MapLabelLayer
  private readonly picker = new MapPicker()
  private projection: MapProjection = getMapProjection('mercator')
  private readonly riverSource = new SphericalRiverSource()
  private readonly routeSource = new SphericalRouteSource()
  private readonly windGeometryBuilder = new SphericalWindGeometry()
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
  private readonly layerCache = new LayerCache<Object3D>()
  private readonly layerResources = new Map<string, MapLayerResource[]>()
  private colorsDirty = false
  private overlayResources: MapLayerResource[] = []
  private mesh: SphericalMesh | null = null
  private data: SphericalWorldData | null = null
  private params: GlobeGenParams
  private centralMeridian = 0
  private active = false
  private surfaceDirty = false
  private overlaysDirty = false
  private labelsDirty = false
  private selectedRegion = -1
  private viewportWidth = 1
  private viewportHeight = 1

  constructor(
    private readonly canvas: HTMLCanvasElement,
    params: GlobeGenParams,
  ) {
    this.params = { ...params }
    this.viewportWidth = Math.max(1, canvas.clientWidth)
    this.viewportHeight = Math.max(1, canvas.clientHeight)
    this.labelLayer = new MapLabelLayer(canvas)
    this.scene.background = new Color(0x07101F)
    this.camera.position.set(0, 0, 10)

    this.controls = new MapControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.enableRotate = false
    this.controls.enablePan = true
    this.controls.screenSpacePanning = true
    this.controls.zoomSpeed = 0.8
    this.controls.panSpeed = 0.8
    this.controls.minZoom = 1
    this.controls.maxZoom = 18
    this.controls.enabled = false

    this.rebuildSelectionMarkers()
    this.selectionGroup.visible = false
    this.scene.add(this.selectionGroup)
  }

  setWorld(mesh: SphericalMesh, data: SphericalWorldData, params: GlobeGenParams): void {
    this.mesh = mesh
    this.data = data
    this.params = { ...params }
    this.centralMeridian = this.chooseCentralMeridian(mesh, data)
    this.disposeSurface()
    this.disposeOverlays()
    this.surfaceDirty = true
    this.overlaysDirty = true
    this.labelsDirty = true
    this.selectedRegion = -1
    this.selectionGroup.visible = false
    if (this.active) {
      this.rebuildSurface()
      this.rebuildOverlays()
      this.rebuildLabels()
    }
  }

  updateWorldData(data: SphericalWorldData): void {
    this.data = data
  }

  updateAppearance(params: GlobeGenParams, dataChanged = false, stage: GenerationStage = 'world'): void {
    const previous = this.params
    this.params = { ...params }
    this.colorsDirty ||= dataChanged || previous.displayMode !== params.displayMode
    this.labelsDirty ||= dataChanged || previous.displayMode !== params.displayMode
      || previous.showMapLabels !== params.showMapLabels
      || previous.showSettlements !== params.showSettlements
    this.overlaysDirty = true
    if (dataChanged)
      this.layerCache.invalidate(key => isLayerAffected(key, stage))
    if (!this.active)
      return
    this.ensureSurface()
    this.ensureOverlays()
    this.ensureLabels()
  }

  setActive(active: boolean): void {
    this.active = active
    this.controls.enabled = active
    this.labelLayer.setVisible(active)
    if (active) {
      this.ensureSurface()
      this.ensureOverlays()
      this.ensureLabels()
      if (this.selectedRegion >= 0)
        this.updateSelectionMarker(this.selectedRegion)
    }
  }

  setProjection(id: MapProjectionId): void {
    const projection = getMapProjection(id)
    if (this.projection.id === projection.id)
      return

    this.disposeSurface()
    this.disposeOverlays()
    this.projection = projection
    this.surfaceDirty = true
    this.overlaysDirty = true
    this.labelsDirty = true
    this.rebuildSelectionMarkers()
    this.resize(this.viewportWidth, this.viewportHeight)
    this.resetCamera()

    if (this.active) {
      this.rebuildSurface()
      this.rebuildOverlays()
      this.rebuildLabels()
      if (this.selectedRegion >= 0)
        this.updateSelectionMarker(this.selectedRegion)
    }
  }

  selectRegion(region: number): void {
    this.selectedRegion = region
    if (this.active)
      this.updateSelectionMarker(region)
  }

  renderLabels(viewportWidth: number, viewportHeight: number): void {
    if (!this.active || !this.mesh)
      return
    this.labelLayer.render(
      this.mesh,
      this.camera,
      this.projection,
      this.centralMeridian,
      viewportWidth,
      viewportHeight,
    )
  }

  private rebuildSurface(): void {
    if (!this.mesh || !this.data)
      return
    this.disposeSurface()
    const geometry = this.geometryBuilder.create(
      this.mesh,
      this.colorizer.build(this.data, this.params.displayMode),
      this.projection,
      this.centralMeridian,
    )
    const material = new MeshBasicMaterial({
      vertexColors: true,
      wireframe: this.params.wireframe,
      side: DoubleSide,
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
    this.colorsDirty = false
  }

  private syncLayer(key: string, visible: boolean, build: () => void, revision: unknown = 0): void {
    this.layerCache.sync(key, visible, revision, () => {
      const old = this.layerResources.get(key) ?? []
      for (const resource of old) {
        for (const object of resource.objects)
          this.scene.remove(object)
        resource.geometry.dispose()
        resource.material.dispose()
      }
      this.overlayResources = this.overlayResources.filter(resource => !old.includes(resource))
      const start = this.overlayResources.length
      build()
      const resources = this.overlayResources.slice(start)
      this.layerResources.set(key, resources)
      return resources.flatMap(resource => resource.objects)
    })
  }

  private rebuildOverlays(): void {
    if (!this.mesh || !this.data)
      return
    const p = this.params
    for (const key of ['showTemperature', 'showMoisture', 'showPrecipitation', 'showFlux', 'showSeaSurfaceTemperature'] as const)
      this.syncLayer(key, p[key], () => this.addClimateLayers(key))
    this.syncLayer('coastlines', p.showCoastlines, () => this.addCoastlines())
    this.syncLayer('contours', p.displayMode === 'contours', () => this.addContours())
    this.syncLayer('rivers', p.showRivers, () => this.addRivers())
    this.syncLayer('roads', p.showRoads, () => this.addRoutes('road'))
    this.syncLayer('shipping', p.showShippingRoutes, () => this.addRoutes('shipping'))
    this.syncLayer('trade', p.displayMode === 'trade', () => this.addRoutes('trade'))
    for (const [key, opacity] of [['roads', p.displayMode === 'trade' ? 0.06 : 0.72], ['shipping', p.displayMode === 'trade' ? 0.06 : 0.68]] as const) {
      for (const resource of this.layerResources.get(key) ?? []) {
        if (resource.material instanceof MapRibbonMaterial)
          resource.material.uniforms.strokeOpacity.value = opacity
        else
          resource.material.opacity = opacity
      }
    }
    for (const key of ['showPlateBoundaries', 'showCultureBoundaries', 'showReligionBoundaries', 'showPoliticalBoundaries'] as const)
      this.syncLayer(key, p[key], () => this.addBoundaries(key))
    for (const key of ['showWind', 'showOceanCurrents'] as const)
      this.syncLayer(key, p[key], () => this.addVectorFields(key))
    this.syncLayer('graticule', p.showGraticule, () => this.addGraticule())
    this.syncLayer('settlements', p.showSettlements, () => this.addSettlements())
    this.syncLayer('holySites', p.showHolySites, () => this.addHolySites())
    this.overlaysDirty = false
  }

  private rebuildLabels(): void {
    if (!this.mesh || !this.data)
      return
    this.labelLayer.rebuild(this.mesh, this.data, this.params)
    this.labelsDirty = false
  }

  private addClimateLayers(key: keyof GlobeGenParams): void {
    if (!this.mesh || !this.data)
      return
    const oceanMask = new Uint8Array(this.mesh.numRegions)
    for (let region = 0; region < this.mesh.numRegions; region++)
      oceanMask[region] = this.data.baseLandMask[region] === 0 ? 1 : 0

    if (key === 'showSeaSurfaceTemperature') {
      this.addSurfaceLayer(
        this.colorizer.buildSeaSurfaceTemperatureColors(this.data),
        0.72,
        0.11,
        oceanMask,
      )
    }
    if (key === 'showTemperature') {
      this.addSurfaceLayer(
        this.colorizer.buildTemperatureColors(this.data),
        0.68,
        0.12,
      )
    }
    if (key === 'showMoisture') {
      this.addSurfaceLayer(
        this.colorizer.buildMoistureColors(this.data),
        0.58,
        0.13,
      )
    }
    if (key === 'showPrecipitation') {
      this.addSurfaceLayer(
        this.colorizer.buildPrecipitationColors(this.data),
        0.56,
        0.14,
        this.data.landMask,
      )
    }
    if (key === 'showFlux') {
      this.addSurfaceLayer(
        this.colorizer.buildFluxColors(this.data),
        0.52,
        0.15,
        this.data.landMask,
      )
    }
  }

  private addSurfaceLayer(
    colors: Float32Array,
    opacity: number,
    z: number,
    regionMask?: Uint8Array,
  ): void {
    if (!this.mesh)
      return
    const geometry = this.geometryBuilder.create(
      this.mesh,
      colors,
      this.projection,
      this.centralMeridian,
      regionMask,
    )
    const material = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    })
    const layer = new Mesh(geometry, material)
    layer.position.z = z
    layer.renderOrder = 2
    this.addWrappedLayer(layer, geometry, material)
  }

  private addCoastlines(): void {
    if (!this.params.showCoastlines || !this.mesh || !this.data)
      return
    const coastlines = this.coastlineSource.create(this.mesh, this.data.landMask)
    const paths: SphericalStrokePath[] = coastlines.paths.map(path => ({
      closed: path.closed,
      points: sampleSmoothSphericalPath(path, 0.82, 5).map(position => ({
        position,
        width: COASTLINE_MAP_WIDTH,
      })),
    }))
    this.addRibbonLayer(paths, 0x173641, 0.9, 0.32, 5)
  }

  private addContours(): void {
    if (this.params.displayMode !== 'contours' || !this.mesh || !this.data)
      return
    const thresholds: number[] = []
    for (let value = 0.25; value <= 0.9; value += 0.05)
      thresholds.push(Number(value.toFixed(2)))
    const positions = this.contourGeometryBuilder.createLinePositions(
      this.mesh,
      this.data.elevation,
      thresholds,
      1,
    )
    this.addProjectedLineLayer(positions, 0x24303A, 0.55, 0.31, 4)
  }

  private addRivers(): void {
    if (!this.params.showRivers || !this.mesh || !this.data)
      return
    const hiddenRegionMask = new Uint8Array(this.mesh.numRegions)
    for (let region = 0; region < this.mesh.numRegions; region++) {
      if (this.data.climate.biome[region] === SPHERICAL_BIOME.Ice)
        hiddenRegionMask[region] = 1
    }
    const rivers = this.riverSource.create(
      this.mesh,
      this.data.rivers,
      this.data.landMask,
      hiddenRegionMask,
    )
    this.addRibbonLayer(
      rivers.paths,
      0x4688CB,
      0.9,
      0.36,
      6,
      RIVER_MAP_WIDTH_SCALE,
      true,
    )
  }

  private addRoutes(kind: 'road' | 'shipping' | 'trade'): void {
    if (!this.mesh || !this.data)
      return
    const tradeMode = this.params.displayMode === 'trade'
    if (kind === 'road') {
      const paths = this.routeSource.createNetwork(
        this.mesh,
        this.data.human.transport.routes,
        'road',
      )
        .map(path => sampleSmoothSphericalStrokePath(path, 0.55, 3))
      this.addRibbonLayer(
        paths,
        0x9A6846,
        tradeMode ? 0.06 : 0.72,
        0.39,
        7,
        ROAD_MAP_WIDTH,
      )
    }
    if (kind === 'shipping') {
      const paths = this.routeSource.createNetwork(
        this.mesh,
        this.data.human.transport.routes,
        'shipping',
      )
        .map(path => sampleSmoothSphericalStrokePath(path, 0.55, 3))
      this.addRibbonLayer(
        paths,
        0x8FE8FF,
        tradeMode ? 0.06 : 0.68,
        0.4,
        7,
        SHIPPING_ROUTE_MAP_WIDTH,
      )
    }
    if (kind === 'trade') {
      const paths = this.routeSource.createTrade(
        this.mesh,
        this.data.human.transport.routes,
        this.data.human.trade.routeVolume,
      )
        .map(path => sampleSmoothSphericalStrokePath(path, 0.65, 3))
      this.addRibbonLayer(paths, 0xFFFFFF, 0.86, 0.44, 9)
    }
  }

  private addBoundaries(key: keyof GlobeGenParams): void {
    if (!this.mesh || !this.data)
      return
    if (key === 'showPlateBoundaries')
      this.addPlateBoundaries()
    if (key === 'showCultureBoundaries') {
      this.addHumanBoundaries(
        this.data.human.culture.regionCulture,
        0xFFF0B8,
        0.68,
        0.42,
      )
    }
    if (key === 'showReligionBoundaries') {
      this.addHumanBoundaries(
        this.data.human.religion.regionReligion,
        0xE8C8FF,
        0.72,
        0.43,
      )
    }
    if (key === 'showPoliticalBoundaries') {
      this.addHumanBoundaries(
        this.data.human.politics.regionPolity,
        0x25152D,
        0.88,
        0.41,
      )
    }
  }

  private addPlateBoundaries(): void {
    if (!this.mesh || !this.data)
      return
    const positions: number[] = []
    const colors: number[] = []
    for (let edge = 0; edge < this.mesh.voronoi.edgeRegions.length / 2; edge++) {
      const type = this.data.tectonics.edgeBoundaryType[edge]
      if (type === PLATE_BOUNDARY.None)
        continue
      this.appendVoronoiEdge(positions, edge)
      const color = type === PLATE_BOUNDARY.Convergent
        ? [1, 0.22, 0.18]
        : type === PLATE_BOUNDARY.Divergent
          ? [0.16, 0.56, 1]
          : [1, 0.78, 0.15]
      colors.push(...color, ...color)
    }
    const source = this.createSourceGeometry(positions, colors)
    this.addProjectedSourceGeometry(source, 0xFFFFFF, 0.9, 0.43, 8, true)
  }

  private addHumanBoundaries(
    owners: Int16Array,
    color: number,
    opacity: number,
    z: number,
  ): void {
    if (!this.mesh || !this.data)
      return
    const positions: number[] = []
    for (let edge = 0; edge < this.mesh.voronoi.edgeRegions.length / 2; edge++) {
      const index = edge * 2
      const regionA = this.mesh.voronoi.edgeRegions[index]
      const regionB = this.mesh.voronoi.edgeRegions[index + 1]
      if (this.data.landMask[regionA] === 0 || this.data.landMask[regionB] === 0)
        continue
      const ownerA = owners[regionA]
      const ownerB = owners[regionB]
      if (ownerA === ownerB || (ownerA < 0 && ownerB < 0))
        continue
      this.appendVoronoiEdge(positions, edge)
    }
    this.addProjectedLineLayer(positions, color, opacity, z, 8)
  }

  private addVectorFields(key: keyof GlobeGenParams): void {
    if (!this.mesh || !this.data)
      return
    if (key === 'showWind') {
      const geometry = this.windGeometryBuilder.create(
        this.mesh,
        this.data.climate.wind,
        1,
      )
      this.addProjectedSourceGeometry(geometry, 0xD8FAFF, 0.82, 0.46, 10)
    }
    if (key === 'showOceanCurrents') {
      const oceanMask = new Uint8Array(this.mesh.numRegions)
      for (let region = 0; region < this.mesh.numRegions; region++)
        oceanMask[region] = this.data.baseLandMask[region] === 0 ? 1 : 0
      const geometry = this.windGeometryBuilder.create(
        this.mesh,
        this.data.climate.oceanCurrent,
        1,
        oceanMask,
      )
      this.addProjectedSourceGeometry(geometry, 0xFFE2A3, 0.9, 0.47, 10)
    }
  }

  private addGraticule(): void {
    if (!this.params.showGraticule)
      return
    const geometry = this.graticuleGeometryBuilder.create(1)
    this.addProjectedSourceGeometry(geometry, 0xB8D6E8, 0.36, 0.28, 3)
  }

  private addSettlements(): void {
    if (!this.params.showSettlements || !this.mesh || !this.data)
      return
    const groups = new Map<string, number[]>()
    for (const settlement of this.data.human.settlements) {
      const key = `${settlement.type}:${settlement.isPort ? 'port' : 'land'}`
      const group = groups.get(key)
      if (group)
        group.push(settlement.region)
      else
        groups.set(key, [settlement.region])
    }
    for (const [key, regions] of groups) {
      const [type, location] = key.split(':') as [keyof typeof SETTLEMENT_MARKER_SIZE, 'land' | 'port']
      this.addPointLayer(
        regions,
        location === 'port' ? SETTLEMENT_MARKER_COLOR.port : SETTLEMENT_MARKER_COLOR[type],
        SETTLEMENT_MARKER_SIZE[type] + (location === 'port' ? 1 : 0),
        0.52,
        12,
      )
    }
  }

  private addHolySites(): void {
    if (!this.params.showHolySites || !this.data)
      return
    this.addPointLayer(
      this.data.human.religion.religions.map(religion => religion.originRegion),
      0xFFE36E,
      9,
      0.54,
      13,
    )
  }

  private addPointLayer(
    regions: readonly number[],
    color: number,
    size: number,
    z: number,
    renderOrder: number,
  ): void {
    if (!this.mesh || regions.length === 0)
      return
    const positions: number[] = []
    for (const region of regions) {
      const projected = this.projection.project(
        this.mesh.regionLongitude[region],
        this.mesh.regionLatitude[region],
        this.centralMeridian,
      )
      if (projected)
        positions.push(projected.x, projected.y, z)
    }
    if (positions.length === 0)
      return
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    const material = new PointsMaterial({
      color,
      size,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
    })
    const layer = new Points(geometry, material)
    layer.renderOrder = renderOrder
    this.addWrappedLayer(layer, geometry, material)
  }

  private addProjectedLineLayer(
    positions: number[] | Float32Array,
    color: number,
    opacity: number,
    z: number,
    renderOrder: number,
  ): void {
    if (positions.length === 0)
      return
    const source = this.createSourceGeometry(positions)
    this.addProjectedSourceGeometry(source, color, opacity, z, renderOrder)
  }

  private addRibbonLayer(
    paths: readonly SphericalStrokePath[],
    color: number,
    opacity: number,
    z: number,
    renderOrder: number,
    widthScale = 1,
    zoomResponsiveWidth = false,
  ): void {
    const geometry = this.ribbonGeometryBuilder.create(
      paths,
      this.projection,
      this.centralMeridian,
      z,
      widthScale,
    )
    if ((geometry.getAttribute('position')?.count ?? 0) === 0) {
      geometry.dispose()
      return
    }
    const material = new MapRibbonMaterial(
      color,
      opacity,
      this.viewportWidth,
      this.viewportHeight,
    )
    if (zoomResponsiveWidth)
      material.setWidthScale(this.getZoomResponsiveWidthScale())
    const layer = new Mesh(geometry, material)
    layer.renderOrder = renderOrder
    this.addWrappedLayer(layer, geometry, material, zoomResponsiveWidth)
  }

  private addProjectedSourceGeometry(
    source: BufferGeometry,
    color: number,
    opacity: number,
    z: number,
    renderOrder: number,
    vertexColors = false,
  ): void {
    const geometry = this.lineGeometryBuilder.create(
      source,
      this.projection,
      this.centralMeridian,
      z,
    )
    source.dispose()
    if ((geometry.getAttribute('position')?.count ?? 0) === 0) {
      geometry.dispose()
      return
    }
    const material = new LineBasicMaterial({
      color,
      vertexColors,
      transparent: opacity < 1,
      opacity,
      depthTest: false,
      depthWrite: false,
    })
    const layer = new LineSegments(geometry, material)
    layer.renderOrder = renderOrder
    this.addWrappedLayer(layer, geometry, material)
  }

  private addWrappedLayer(
    layer: Object3D,
    geometry: BufferGeometry,
    material: Material,
    zoomResponsiveWidth = false,
  ): void {
    const objects: Object3D[] = []
    const worldOffsets = this.projection.wrapX
      ? [-this.projection.worldWidth, 0, this.projection.worldWidth]
      : [0]
    for (const worldOffset of worldOffsets) {
      const object = worldOffset === 0 ? layer : layer.clone()
      object.position.x += worldOffset
      this.scene.add(object)
      objects.push(object)
    }
    this.overlayResources.push({ objects, geometry, material, zoomResponsiveWidth })
  }

  private createSourceGeometry(
    positions: number[] | Float32Array,
    colors?: number[],
  ): BufferGeometry {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    if (colors)
      geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
    return geometry
  }

  private appendVoronoiEdge(positions: number[], edge: number): void {
    if (!this.mesh)
      return
    const cornerIndex = edge * 2
    for (let side = 0; side < 2; side++) {
      const corner = this.mesh.voronoi.edgeCorners[cornerIndex + side] * 3
      positions.push(
        this.mesh.voronoi.cornerPosition[corner],
        this.mesh.voronoi.cornerPosition[corner + 1],
        this.mesh.voronoi.cornerPosition[corner + 2],
      )
    }
  }

  private chooseCentralMeridian(
    mesh: SphericalMesh,
    data: SphericalWorldData,
  ): number {
    const binCount = 180
    const landAreaByLongitude = new Float64Array(binCount)
    for (let region = 0; region < mesh.numRegions; region++) {
      if (data.baseLandMask[region] === 0)
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

  resize(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width)
    this.viewportHeight = Math.max(1, height)
    for (const resource of this.overlayResources) {
      if (resource.material instanceof MapRibbonMaterial)
        resource.material.setResolution(this.viewportWidth, this.viewportHeight)
    }
    const viewportAspect = width / Math.max(height, 1)
    const mapAspect = this.projection.worldWidth / this.projection.worldHeight
    if (this.projection.wrapX) {
      // Web 地图优先让一个横向世界刚好铺满视口。宽屏因此默认裁掉
      // 视觉膨胀最严重的高纬区域，仍可向两极平移查看。
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
  }

  update(): boolean {
    const changed = this.controls.update()
    const zoomWidthScale = this.getZoomResponsiveWidthScale()
    for (const resource of this.overlayResources) {
      if (resource.zoomResponsiveWidth && resource.material instanceof MapRibbonMaterial)
        resource.material.setWidthScale(zoomWidthScale)
    }
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
    return changed || Math.abs(xShift) > Number.EPSILON || Math.abs(yShift) > Number.EPSILON
  }

  resetCamera(): void {
    this.camera.position.set(0, 0, 10)
    this.camera.zoom = 1
    this.controls.target.set(0, 0, 0)
    this.camera.updateProjectionMatrix()
    this.controls.update()
  }

  private getZoomResponsiveWidthScale(): number {
    // Ribbon 宽度以屏幕像素表达，因此需要乘以相机缩放值，才能像地图
    // 中的地理要素一样随视角同步缩放。zoom=4 保留既有的近景河宽。
    return Math.max(1, this.camera.zoom) / RIVER_REFERENCE_ZOOM
  }

  destroy(): void {
    this.controls.dispose()
    this.labelLayer.destroy()
    this.disposeOverlays()
    this.disposeSurface()
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
    if (this.surfaceDirty || !this.surface)
      this.rebuildSurface()
    if (this.surface && this.data) {
      const material = this.surface.material as MeshBasicMaterial
      material.wireframe = this.params.wireframe
      if (this.colorsDirty)
        this.geometryBuilder.updateColors(this.surface.geometry, this.colorizer.build(this.data, this.params.displayMode))
      this.colorsDirty = false
    }
  }

  private ensureOverlays(): void {
    if (this.overlaysDirty)
      this.rebuildOverlays()
  }

  private ensureLabels(): void {
    if (this.labelsDirty)
      this.rebuildLabels()
  }

  private disposeOverlays(): void {
    this.layerCache.clear()
    this.layerResources.clear()
    for (const resource of this.overlayResources) {
      for (const object of resource.objects)
        this.scene.remove(object)
      resource.geometry.dispose()
      resource.material.dispose()
    }
    this.overlayResources = []
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
