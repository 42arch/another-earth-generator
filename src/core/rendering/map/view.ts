import type { BufferGeometry, Material, Object3D } from 'three'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection, MapProjectionId } from '@/core/projections/map-projection'
import type { SphericalRegionTopology } from '@/core/rendering/shared/spherical-region-topology'
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
  Vector3,
} from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { getMapProjection } from '@/core/projections/d3-map-projection'
import { FULL_LONGITUDE, wrapLongitude } from '@/core/projections/projection-math'
import { MapCellBoundaryLayer } from '@/core/rendering/map/layers/map-cell-boundary-layer'
import { MapCloudLayer } from '@/core/rendering/map/layers/map-cloud-layer'
import { MapGraticuleLayer } from '@/core/rendering/map/layers/map-graticule-layer'
import { MapLabelLayer } from '@/core/rendering/map/layers/map-label-layer'
import { MapPolityBorderLayer } from '@/core/rendering/map/layers/map-polity-border-layer'
import { MapRiverLayer } from '@/core/rendering/map/layers/map-river-layer'
import { MapRouteLayer } from '@/core/rendering/map/layers/map-route-layer'
import { MapSettlementLayer } from '@/core/rendering/map/layers/map-settlement-layer'
import { MapClimateVectorLayer } from '@/core/rendering/map/layers/map-vector-layer'
import { MapPicker } from '@/core/rendering/map/picker'
import { MapSurfaceGeometry } from '@/core/rendering/map/surface-geometry'
import {
  createPolityRegionIds,
} from '@/core/rendering/shared/polity-border-geometry'
import { SphericalRegionTopologyBuilder } from '@/core/rendering/shared/spherical-region-topology'
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
  private readonly regionTopologyBuilder = new SphericalRegionTopologyBuilder()
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
  private settlementLayer: MapSettlementLayer | null = null
  private labelLayerInstance: MapLabelLayer | null = null
  private cloudLayer: MapCloudLayer | null = null
  private riverLayer: MapRiverLayer | null = null
  private vectorLayer: MapClimateVectorLayer | null = null
  private routeLayer: MapRouteLayer | null = null
  private cellBoundaryLayer: MapCellBoundaryLayer | null = null
  private polityBorderLayer: MapPolityBorderLayer | null = null
  private graticuleLayer: MapGraticuleLayer | null = null
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
    this.prepareRegionSmoothing()
    this.centralMeridian = this.chooseCentralMeridian(mesh, data)
    this.disposeSurface()
    this.settlementLayer?.dispose()
    this.labelLayerInstance?.dispose()
    this.cloudLayer?.dispose()
    this.riverLayer?.dispose()
    this.vectorLayer?.dispose()
    this.routeLayer?.dispose()
    this.cellBoundaryLayer?.dispose()
    this.polityBorderLayer?.dispose()
    this.graticuleLayer?.dispose()
    this.cloudLayer?.dispose()
    this.riverLayer?.dispose()
    this.vectorLayer?.dispose()
    this.cloudLayer?.dispose()
    this.riverLayer?.dispose()
    this.vectorLayer?.dispose()
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
    if (!this.mesh || !this.data)
      return

    this.settlementLayer?.dispose()
    this.labelLayerInstance?.dispose()
    this.cloudLayer?.dispose()
    this.riverLayer?.dispose()
    this.vectorLayer?.dispose()
    this.routeLayer?.dispose()
    this.cellBoundaryLayer?.dispose()
    this.polityBorderLayer?.dispose()
    this.graticuleLayer?.dispose()
    if (this.mesh && this.data) {
      this.settlementLayer = new MapSettlementLayer(this.mesh, this.data, this.params, this.projection, this.centralMeridian)
      this.scene.add(this.settlementLayer.group)

      this.labelLayerInstance = new MapLabelLayer(this.mesh, this.data, this.params, this.projection, this.centralMeridian)
      this.scene.add(this.labelLayerInstance.group)

      this.cloudLayer = new MapCloudLayer(this.mesh, this.data, this.params, this.projection, this.centralMeridian)
      this.scene.add(this.cloudLayer.group)

      this.riverLayer = new MapRiverLayer(this.mesh, this.data, this.params, this.projection, this.centralMeridian, this.smoothedRegionCorners, this.viewportWidth, this.viewportHeight)
      this.scene.add(this.riverLayer.group)

      this.vectorLayer = new MapClimateVectorLayer(this.mesh, this.data, this.params, this.projection, this.centralMeridian)
      this.scene.add(this.vectorLayer.group)

      this.routeLayer = new MapRouteLayer(this.mesh, this.data, this.params, this.projection, this.centralMeridian)
      this.scene.add(this.routeLayer.group)

      this.cellBoundaryLayer = new MapCellBoundaryLayer(this.mesh, this.data, this.params, this.projection, this.centralMeridian, this.smoothedRegionCorners ?? null)
      this.scene.add(this.cellBoundaryLayer.group)

      this.polityBorderLayer = new MapPolityBorderLayer(this.mesh, this.data, this.params, this.projection, this.centralMeridian, this.smoothedRegionCorners ?? null, this.regionTopologyBuilder, this.viewportWidth, this.viewportHeight)
      this.scene.add(this.polityBorderLayer.group)

      this.graticuleLayer = new MapGraticuleLayer(this.params, this.projection, this.centralMeridian)
      this.scene.add(this.graticuleLayer.group)
    }
    this.overlaysDirty = false
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
    this.riverLayer?.updateViewport(this.viewportWidth, this.viewportHeight)
    this.vectorLayer?.updateViewport(this.viewportWidth, this.viewportHeight)
    this.polityBorderLayer?.updateViewport(this.viewportWidth, this.viewportHeight)
    for (const resource of this.overlayResources) {
      if (resource.material instanceof LineMaterial)
        resource.material.resolution.set(this.viewportWidth, this.viewportHeight)
    }
  }

  update(): void {
    this.controls.update()
    this.labelLayerInstance?.updateLOD(this.camera.zoom)
    this.riverLayer?.updateWidthScale(this.camera.zoom)
    this.vectorLayer?.updateLineWidth(this.camera.zoom)
    this.polityBorderLayer?.updateLineWidth(this.camera.zoom)
    for (const resource of this.overlayResources) {
      if (resource.material instanceof LineMaterial) {
        resource.material.linewidth = Math.max(1.0, 3.4 / Math.sqrt(this.camera.zoom))
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
