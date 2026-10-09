import type { Material, Object3D } from 'three'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection, MapProjectionId } from '@/core/projections/map-projection'
import type { SphericalRegionTopology } from '@/core/rendering/shared/spherical-region-topology'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
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
  RingGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { getMapProjection } from '@/core/projections/d3-map-projection'
import { cartesianToGeographic, FULL_LONGITUDE, unwrapLongitudeNear, wrapLongitude } from '@/core/projections/projection-math'
import { MapLineGeometry } from '@/core/rendering/map/line-geometry'
import { MapPicker } from '@/core/rendering/map/picker'
import { MapRibbonGeometry } from '@/core/rendering/map/ribbon-geometry'
import { MapRibbonMaterial } from '@/core/rendering/map/ribbon-material'
import { MapSurfaceGeometry } from '@/core/rendering/map/surface-geometry'
import { SphericalCellBoundaryGeometry } from '@/core/rendering/shared/cell-boundary-geometry'
import { createClimateVectorGeometry } from '@/core/rendering/shared/climate-vector-geometry'
import { CLOUD_FRAGMENT_SHADER, CLOUD_MAP_VERTEX_SHADER } from '@/core/rendering/shared/cloud-shaders'
import { SphericalGraticuleGeometry } from '@/core/rendering/shared/graticule-geometry'
import {
  createPolityBorderPaths,
  createPolityRegionIds,
  createPolitySmoothedCornerPositions,
} from '@/core/rendering/shared/polity-border-geometry'
import { RiverGeometry } from '@/core/rendering/shared/river-geometry'
import { SphericalRegionTopologyBuilder } from '@/core/rendering/shared/spherical-region-topology'
import { createMapMarkerMaterial } from '@/core/rendering/shared/settlement-marker-material'
import { createTransportLineGeometry } from '@/core/rendering/shared/transport-line-geometry'
import { WorldColorizer } from '@/core/rendering/shared/world-colorizer'

interface MapLayerResource {
  objects: Object3D[]
  geometry: BufferGeometry | BufferGeometry[]
  material: Material
}

export class MapView {
  readonly scene = new Scene()
  readonly camera = new OrthographicCamera(-Math.PI, Math.PI, Math.PI / 2, -Math.PI / 2, 0.1, 100)
  private readonly colorizer = new WorldColorizer()
  private readonly controls: MapControls
  private readonly geometryBuilder = new MapSurfaceGeometry()
  private readonly cellBoundaryGeometryBuilder = new SphericalCellBoundaryGeometry()
  private readonly regionTopologyBuilder = new SphericalRegionTopologyBuilder()
  private readonly graticuleGeometryBuilder = new SphericalGraticuleGeometry()
  private readonly riverGeometryBuilder = new RiverGeometry()
  private readonly riverRibbonGeometryBuilder = new MapRibbonGeometry()
  private readonly lineGeometryBuilder = new MapLineGeometry()
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
  private overlayResources: MapLayerResource[] = []
  private mesh: SphericalMesh | null = null
  private data: WorldSimulationState | null = null
  private params: WorldConfig
  private centralMeridian = 0
  private active = false
  private surfaceDirty = false
  private overlaysDirty = false
  private selectedRegion = -1
  private regionTopology: SphericalRegionTopology | null = null
  private smoothedRegionCorners: Float32Array | null = null
  private viewportWidth = 1
  private viewportHeight = 1

  private readonly canvas: HTMLCanvasElement

  constructor(
    canvas: HTMLCanvasElement,
    params: WorldConfig,
  ) {
    this.canvas = canvas
    this.params = { ...params }
    this.viewportWidth = Math.max(1, canvas.clientWidth)
    this.viewportHeight = Math.max(1, canvas.clientHeight)
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

  setWorld(mesh: SphericalMesh, data: WorldSimulationState, params: WorldConfig): void {
    this.mesh = mesh
    this.data = data
    this.params = { ...params }
    this.prepareRegionSmoothing()
    this.centralMeridian = this.chooseCentralMeridian(mesh, data)
    this.disposeSurface()
    this.disposeOverlays()
    this.surfaceDirty = true
    this.overlaysDirty = true
    this.selectedRegion = -1
    this.selectionGroup.visible = false
    this.ensureSurface()
    this.ensureOverlays()
  }

  updateAppearance(params: WorldConfig): void {
    const previousMode = this.params.appearance.baseMap
    const modeChanged = previousMode !== params.appearance.baseMap
    const satelliteTransition = modeChanged && (previousMode === 'satellite' || params.appearance.baseMap === 'satellite')
    const regionSmoothingChanged = this.getRegionSmoothingMode(this.params)
      !== this.getRegionSmoothingMode(params)
    const monthChanged = this.params.appearance.climateMonth !== params.appearance.climateMonth
    const oldOverlays = this.params.appearance.overlays
    const newOverlays = params.appearance.overlays

    this.params = { ...params }
    if (regionSmoothingChanged) {
      this.prepareRegionSmoothing()
      this.surfaceDirty = true
      this.overlaysDirty = true
    }
    const elevationColorModeChanged = modeChanged
      && (this.isElevationColorMode(previousMode) || this.isElevationColorMode(params.appearance.baseMap))
    if (satelliteTransition || elevationColorModeChanged)
      this.surfaceDirty = true

    this.ensureSurface()
    if (!this.surface || !this.data)
      return
    if ((modeChanged || monthChanged) && !satelliteTransition && !this.isElevationColorMode(params.appearance.baseMap)
      && params.appearance.baseMap !== 'satellite') {
      this.geometryBuilder.updateColors(
        this.surface.geometry,
        this.colorizer.build(this.data, params.appearance.baseMap, this.mesh ?? undefined),
      )
    }

    if (JSON.stringify(oldOverlays) !== JSON.stringify(newOverlays)) {
      this.overlaysDirty = true
    }
    if (modeChanged || monthChanged) {
      this.overlaysDirty = true
    }

    if (this.overlaysDirty) {
      this.rebuildOverlays()
    }
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
    this.disposeOverlays()
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
    const mode = this.params.appearance.baseMap
    const colors = this.colorizer.build(this.data, mode, this.mesh, mode === 'satellite')
    const cornerColors = mode === 'dem'
      ? this.colorizer.buildDEMCorners(this.mesh, this.data.geography.elevation, this.data.geography.landMask)
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
      this.smoothedRegionCorners ?? undefined,
    )
    const material = new MeshBasicMaterial({
      vertexColors: true,
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
  }

  private rebuildOverlays(): void {
    this.disposeOverlays()
    if (!this.mesh || !this.data)
      return

    this.addCellBoundaries()
    this.addPolityBorders()
    this.addGraticule()
    this.addClimateVectors()
    this.addClouds()
    this.addRivers()
    this.addSettlements()
    this.addSacredSites()
    this.addRoutes()
    this.overlaysDirty = false
  }

  private addRoutes(): void {
    if (!this.params.appearance.overlays.routes || !this.mesh || !this.data?.society?.transport)
      return
    this.addProjectedSourceGeometry(
      createTransportLineGeometry(this.mesh, this.data),
      0xFFFFFF,
      0.85,
      0.4,
      7.5,
      true,
    )
  }

  private addSettlements(): void {
    if (!this.params.appearance.overlays.cities || !this.mesh || !this.data?.society)
      return
    const positions: number[] = []
    const colors: number[] = []
    const markerLevels: number[] = []
    const palette = { village: 0xB7E4B3, town: 0xF4D777, city: 0xFFAE59, metropolis: 0xFF665C }
    const level = { village: 0, town: 1, city: 2, metropolis: 3 }
    for (const settlement of this.data.society.settlements) {
      const projected = this.projection.project(
        this.mesh.regionLongitude[settlement.region],
        this.mesh.regionLatitude[settlement.region],
        this.centralMeridian,
      )
      if (!projected)
        continue
      positions.push(projected.x, projected.y, 0.5)
      const color = new Color(palette[settlement.rank])
      colors.push(color.r, color.g, color.b)
      markerLevels.push(level[settlement.rank])
    }
    if (positions.length === 0)
      return
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
    geometry.setAttribute('markerLevel', new BufferAttribute(new Float32Array(markerLevels), 1))
    const material = createMapMarkerMaterial(false)
    const layer = new Points(geometry, material)
    layer.renderOrder = 8
    this.addWrappedLayer(layer, geometry, material)
  }

  private addSacredSites(): void {
    if (!this.params.appearance.overlays['sacred-sites'] || !this.mesh || !this.data?.society?.religions)
      return
    const positions: number[] = []
    const colors: number[] = []
    const markerLevels: number[] = []
    const color = new Color(0xEAC2FF)
    for (const site of this.data.society.religions.sacredSites) {
      const projected = this.projection.project(
        this.mesh.regionLongitude[site.region],
        this.mesh.regionLatitude[site.region],
        this.centralMeridian,
      )
      if (projected) {
        positions.push(projected.x, projected.y, 0.56)
        colors.push(color.r, color.g, color.b)
        markerLevels.push(2)
      }
    }
    if (positions.length === 0)
      return
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
    geometry.setAttribute('markerLevel', new BufferAttribute(new Float32Array(markerLevels), 1))
    const material = createMapMarkerMaterial(false)
    const layer = new Points(geometry, material)
    layer.renderOrder = 9
    this.addWrappedLayer(layer, geometry, material)
  }

  private addClouds(): void {
    if (!this.params.appearance.overlays.clouds || !this.mesh)
      return
    const geometry = this.geometryBuilder.create(
      this.mesh,
      new Float32Array(this.mesh.numRegions * 3),
      this.projection,
      this.centralMeridian,
      undefined,
      undefined,
      true,
    )
    geometry.translate(0, 0, 0.002)
    const material = new ShaderMaterial({
      vertexShader: CLOUD_MAP_VERTEX_SHADER,
      fragmentShader: CLOUD_FRAGMENT_SHADER,
      uniforms: {
        uSeed: { value: this.params.core.seed },
        uCoverage: { value: 0.66 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    })
    const layer = new Mesh(geometry, material)
    layer.renderOrder = 6
    this.addWrappedLayer(layer, geometry, material)
  }

  private addRivers(): void {
    if (
      !this.params.appearance.overlays.rivers
      || !this.mesh
      || !this.data?.hydrology
    ) {
      return
    }
    const geometry = this.riverRibbonGeometryBuilder.create(
      this.riverGeometryBuilder.createStrokePaths(
        this.mesh,
        this.data,
        undefined,
        this.smoothedRegionCorners ?? undefined,
      ),
      this.projection,
      this.centralMeridian,
      0.3,
    )
    if ((geometry.getAttribute('position')?.count ?? 0) === 0) {
      geometry.dispose()
      return
    }
    const material = new MapRibbonMaterial(
      0xFFFFFF,
      0.6,
      this.viewportWidth,
      this.viewportHeight,
    )
    // Width scale is updated dynamically in update() based on camera zoom.
    const layer = new Mesh(geometry, material)
    layer.renderOrder = 7
    this.addWrappedLayer(layer, geometry, material)
  }

  private addClimateVectors(): void {
    const mode = this.params.appearance.baseMap
    const vectors = this.data?.climate?.displayVector
    if (!this.mesh || !this.data || (mode !== 'wind' && mode !== 'ocean-current') || vectors?.kind !== mode)
      return
    const geometry = createClimateVectorGeometry(this.mesh, vectors, this.data.geography.landMask, 1)
    this.addProjectedSourceGeometry(geometry, mode === 'wind' ? 0xA9FFF1 : 0xFFFFFF, 0.94, 0.4, 5, mode === 'ocean-current')
  }

  private addCellBoundaries(): void {
    if (!this.params.appearance.overlays.wireframe || !this.mesh)
      return
    // Surface polygons use straight projected edges. Keep the overlay on the
    // same endpoint segments so non-linear map projections cannot introduce
    // a visible offset between the fill boundary and the cell line.
    const geometry = this.cellBoundaryGeometryBuilder.create(
      this.mesh,
      1,
      Number.POSITIVE_INFINITY,
      undefined,
      0,
      1,
      undefined,
      undefined,
      this.smoothedRegionCorners ?? undefined,
    )
    this.addProjectedSourceGeometry(
      geometry,
      0xB8D6E8,
      0.5,
      0.24,
      2,
    )
  }

  private addPolityBorders(): void {
    if (!this.params.appearance.overlays['nation-borders'] || !this.mesh || !this.data?.society?.polities)
      return
    const smoothedCorners = this.getRegionSmoothingMode(this.params) === 'polities' && this.smoothedRegionCorners
      ? this.smoothedRegionCorners
      : createPolitySmoothedCornerPositions(this.mesh, this.data, this.regionTopologyBuilder)
    const paths = createPolityBorderPaths(this.mesh, this.data, 1, 0, 1, smoothedCorners)
    const group = new Group()
    const geometries: BufferGeometry[] = []
    const material = new LineMaterial({
      color: 0x747A80,
      linewidth: 3.4,
      dashed: true,
      dashSize: 0.05,
      gapSize: 0.035,
      resolution: new Vector2(this.viewportWidth, this.viewportHeight),
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    })

    for (const path of paths) {
      const geographic = path.points.map((point) => {
        const location = cartesianToGeographic(point[0], point[1], point[2])
        return {
          longitude: wrapLongitude(location.longitude - this.centralMeridian),
          latitude: location.latitude,
        }
      })
      for (let index = 1; index < geographic.length; index++) {
        geographic[index].longitude = unwrapLongitudeNear(
          geographic[index].longitude,
          geographic[index - 1].longitude,
        )
      }
      if (path.closed) {
        const first = geographic[0]
        geographic.push({
          ...first,
          longitude: unwrapLongitudeNear(first.longitude, geographic[geographic.length - 1].longitude),
        })
      }

      const fragments: [number, number, number][][] = []
      for (const worldOffset of [-FULL_LONGITUDE, 0, FULL_LONGITUDE]) {
        let current: [number, number, number][] = []
        for (let index = 1; index < geographic.length; index++) {
          const start = { ...geographic[index - 1], longitude: geographic[index - 1].longitude + worldOffset }
          const end = { ...geographic[index], longitude: geographic[index].longitude + worldOffset }
          const clipped = clipBorderSegment(
            start,
            end,
            -Math.PI,
            Math.PI,
            this.projection.minimumLatitude,
            this.projection.maximumLatitude,
          )
          if (!clipped) {
            if (current.length >= 2)
              fragments.push(current)
            current = []
            continue
          }
          const projectedStart = this.projection.projectRelative(clipped[0].longitude, clipped[0].latitude)
          const projectedEnd = this.projection.projectRelative(clipped[1].longitude, clipped[1].latitude)
          if (!projectedStart || !projectedEnd) {
            if (current.length >= 2)
              fragments.push(current)
            current = []
            continue
          }
          const start3: [number, number, number] = [projectedStart.x, projectedStart.y, 0.35]
          const end3: [number, number, number] = [projectedEnd.x, projectedEnd.y, 0.35]
          const last = current[current.length - 1]
          if (last && Math.hypot(last[0] - start3[0], last[1] - start3[1]) > 1e-6) {
            if (current.length >= 2)
              fragments.push(current)
            current = []
          }
          if (current.length === 0)
            current.push(start3)
          current.push(end3)
        }
        if (current.length >= 2)
          fragments.push(current)
      }

      for (const fragment of fragments) {
        const geometry = new LineGeometry().setPositions(fragment.flatMap(point => point))
        const line = new Line2(geometry, material)
        line.computeLineDistances()
        line.renderOrder = 6
        group.add(line)
        geometries.push(geometry)
      }
    }

    if (geometries.length === 0) {
      material.dispose()
      return
    }
    this.addWrappedLayer(group, geometries, material)
  }

  private buildDisplayRegionIds(): Int32Array {
    const regionIds = new Int32Array(this.mesh!.numRegions)
    const mode = this.getRegionSmoothingMode(this.params)
    if (mode === 'polities')
      return createPolityRegionIds(this.mesh!, this.data!)
    for (let region = 0; region < regionIds.length; region++) {
      if (this.data!.geography.landMask[region] === 0
        && (mode === 'ethnicity' || mode === 'languages' || mode === 'religions')) {
        regionIds[region] = -2147483648
      }
      else if (mode === 'ethnicity') {
        regionIds[region] = this.data!.society?.ethnicity?.dominantGroup[region] ?? -1
      }
      else if (mode === 'languages') {
        regionIds[region] = this.data!.society?.ethnicity?.dominantLanguage[region] ?? -1
      }
      else if (mode === 'religions') {
        regionIds[region] = this.data!.society?.religions?.dominantAffiliation[region] ?? -1
      }
      else if (mode === 'plates') {
        regionIds[region] = this.data!.geology.regionSuperPlate[region]
      }
      else if (mode === 'biome') {
        regionIds[region] = this.data!.biome?.biomeClass[region] ?? -1
      }
      else if (mode === 'koppen') {
        regionIds[region] = this.data!.climate?.koppen?.climateClass[region] ?? -1
      }
      else {
        regionIds[region] = this.data!.geography.landMask[region] === 0
          ? -2
          : this.data!.geography.visibleContinentId[region]
      }
    }
    return regionIds
  }

  private isRegionSmoothingEnabled(params: WorldConfig): boolean {
    return this.getRegionSmoothingMode(params) !== null
  }

  private getRegionSmoothingMode(params: WorldConfig): string | null {
    const mode = params.appearance.baseMap
    if (mode === 'plates-smoothed')
      return 'plates'
    if (mode === 'continents-smoothed')
      return 'continents'
    if (mode === 'biome-smoothed')
      return 'biome'
    if (mode === 'koppen-smoothed')
      return 'koppen'
    if (mode === 'ethnicity' || mode === 'ethnicity-smoothed')
      return 'ethnicity'
    if (mode === 'languages' || mode === 'languages-smoothed')
      return 'languages'
    if (mode === 'polities' || mode === 'polities-smoothed')
      return 'polities'
    if (mode === 'religions' || mode === 'religions-smoothed')
      return 'religions'
    return null
  }

  private prepareRegionSmoothing(): void {
    this.regionTopology = null
    this.smoothedRegionCorners = null
    if (!this.mesh || !this.data || !this.isRegionSmoothingEnabled(this.params))
      return
    const regionIds = this.buildDisplayRegionIds()
    this.regionTopology = this.regionTopologyBuilder.build(this.mesh, regionIds)
    this.smoothedRegionCorners = this.regionTopologyBuilder.buildSmoothedCornerPositions(
      this.mesh,
      this.regionTopology,
    )
  }

  private addGraticule(): void {
    if (!this.params.appearance.overlays.graticule)
      return
    const geometry = this.graticuleGeometryBuilder.create(1)
    this.addProjectedSourceGeometry(geometry, 0xB8D6E8, 0.36, 0.28, 3)
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
    if (source.userData.areaPolygons)
      geometry.userData.areaPolygons = source.userData.areaPolygons
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
    geometry: BufferGeometry | BufferGeometry[],
    material: Material,
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
    this.overlayResources.push({ objects, geometry, material })
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
    if (!this.params.appearance.overlays.cities || !this.mesh || !this.data?.society)
      return null
    const rect = this.canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const position = new Vector3()
    let nearest = 10 * 10
    let chosen: number | null = null
    for (const settlement of this.data.society.settlements) {
      const projected = this.projection.project(
        this.mesh.regionLongitude[settlement.region],
        this.mesh.regionLatitude[settlement.region],
        this.centralMeridian,
      )
      if (!projected)
        continue
      for (const offset of this.projection.wrapX ? [-this.projection.worldWidth, 0, this.projection.worldWidth] : [0]) {
        position.set(projected.x + offset, projected.y, 0.5).project(this.camera)
        const dx = (position.x + 1) * rect.width / 2 - x
        const dy = (1 - position.y) * rect.height / 2 - y
        const distance = dx * dx + dy * dy
        if (distance < nearest) {
          nearest = distance
          chosen = settlement.id
        }
      }
    }
    return chosen
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
    for (const resource of this.overlayResources) {
      if (resource.material instanceof MapRibbonMaterial)
        resource.material.setResolution(this.viewportWidth, this.viewportHeight)
      else if (resource.material instanceof LineMaterial)
        resource.material.resolution.set(this.viewportWidth, this.viewportHeight)
    }
  }

  update(): void {
    this.controls.update()
    for (const resource of this.overlayResources) {
      if (resource.material instanceof MapRibbonMaterial) {
        // Base scale 100 multiplied by zoom ensures rivers shrink when zooming out
        // and grow proportionally when zooming in.
        resource.material.setWidthScale(100 * this.camera.zoom)
      }
      else if (resource.material instanceof LineMaterial) {
        resource.material.linewidth = Math.max(1.2, 3.4 / Math.sqrt(this.camera.zoom))
      }
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
  }

  private isElevationColorMode(mode: string): mode is 'dem' | 'heightmap' {
    return mode === 'dem' || mode === 'heightmap'
  }

  private ensureOverlays(): void {
    if (this.overlaysDirty)
      this.rebuildOverlays()
  }

  private disposeOverlays(): void {
    for (const resource of this.overlayResources) {
      for (const object of resource.objects)
        this.scene.remove(object)
      for (const geometry of Array.isArray(resource.geometry) ? resource.geometry : [resource.geometry])
        geometry.dispose()
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

function clipBorderSegment(
  start: { longitude: number, latitude: number },
  end: { longitude: number, latitude: number },
  minimumLongitude: number,
  maximumLongitude: number,
  minimumLatitude: number,
  maximumLatitude: number,
): readonly [{ longitude: number, latitude: number }, { longitude: number, latitude: number }] | null {
  let minimumAmount = 0
  let maximumAmount = 1
  const axes = [
    [start.longitude, end.longitude - start.longitude, minimumLongitude, maximumLongitude],
    [start.latitude, end.latitude - start.latitude, minimumLatitude, maximumLatitude],
  ] as const
  for (const [origin, difference, minimum, maximum] of axes) {
    if (Math.abs(difference) <= Number.EPSILON) {
      if (origin < minimum || origin > maximum)
        return null
      continue
    }
    const amountA = (minimum - origin) / difference
    const amountB = (maximum - origin) / difference
    minimumAmount = Math.max(minimumAmount, Math.min(amountA, amountB))
    maximumAmount = Math.min(maximumAmount, Math.max(amountA, amountB))
    if (minimumAmount > maximumAmount)
      return null
  }
  if (maximumAmount - minimumAmount <= 1e-12)
    return null
  const interpolate = (amount: number) => ({
    longitude: start.longitude + (end.longitude - start.longitude) * amount,
    latitude: start.latitude + (end.latitude - start.latitude) * amount,
  })
  return [interpolate(minimumAmount), interpolate(maximumAmount)]
}
