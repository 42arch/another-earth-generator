import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection, MapProjectionId } from '@/core/projections/map-projection'
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
import { getMapProjection } from '@/core/projections/d3-map-projection'
import { FULL_LONGITUDE, wrapLongitude } from '@/core/projections/projection-math'
import { SceneLayerManager } from '@/core/rendering/scene-layer-manager'
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
import { buildSmoothedRegionCorners, getRegionSmoothingMode } from '@/core/rendering/shared/region-display'
import { SphericalRegionTopologyBuilder } from '@/core/rendering/shared/spherical-region-topology'
import { WorldColorizer } from '@/core/rendering/shared/world-colorizer'

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
  private mesh: SphericalMesh | null = null
  private data: WorldSimulationState | null = null
  private readonly layerManager: SceneLayerManager
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
    this.layerManager = new SceneLayerManager(this.scene, () => Boolean(this.mesh && this.data))
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
    const regionSmoothingChanged = getRegionSmoothingMode(this.params.appearance.baseMap)
      !== getRegionSmoothingMode(params.appearance.baseMap)
    const politySmoothingChanged = (getRegionSmoothingMode(this.params.appearance.baseMap) === 'polities')
      !== (getRegionSmoothingMode(params.appearance.baseMap) === 'polities')
    const monthChanged = this.params.appearance.climateMonth !== params.appearance.climateMonth
    const oldOverlays = this.params.appearance.overlays
    const newOverlays = params.appearance.overlays

    this.params = { ...params }
    if (regionSmoothingChanged) {
      this.prepareRegionSmoothing()
      this.surfaceDirty = true
    }
    const elevationColorModeChanged = modeChanged
      && (this.isElevationColorMode(previousMode) || this.isElevationColorMode(params.appearance.baseMap))
    if (satelliteTransition || elevationColorModeChanged)
      this.surfaceDirty = true

    const surfaceNeedsRebuild = this.surfaceDirty || !this.surface
    this.ensureSurface()
    if (!surfaceNeedsRebuild && this.surface && this.data && (modeChanged || monthChanged)
      && !satelliteTransition && !this.isElevationColorMode(params.appearance.baseMap)
      && params.appearance.baseMap !== 'satellite') {
      this.geometryBuilder.updateColors(
        this.surface.geometry,
        this.colorizer.build(this.data, params.appearance.baseMap, this.mesh ?? undefined),
      )
    }

    if (this.overlaysDirty) {
      this.rebuildOverlays()
      return
    }

    const settlementOverlaysChanged = oldOverlays.cities !== newOverlays.cities
      || oldOverlays['sacred-sites'] !== newOverlays['sacred-sites']
    if (settlementOverlaysChanged)
      this.rebuildSettlementLayer()

    const labelsChanged = modeChanged
      || settlementOverlaysChanged
      || oldOverlays['nation-labels'] !== newOverlays['nation-labels']
      || oldOverlays['religion-labels'] !== newOverlays['religion-labels']
      || oldOverlays['ethnicity-labels'] !== newOverlays['ethnicity-labels']
      || oldOverlays['language-labels'] !== newOverlays['language-labels']
    if (labelsChanged)
      this.rebuildLabelLayer()

    if (oldOverlays.clouds !== newOverlays.clouds)
      this.rebuildCloudLayer()
    if (oldOverlays.rivers !== newOverlays.rivers || regionSmoothingChanged)
      this.rebuildRiverLayer()
    if (oldOverlays.routes !== newOverlays.routes)
      this.rebuildRouteLayer()
    if (oldOverlays.wireframe !== newOverlays.wireframe || regionSmoothingChanged)
      this.rebuildCellBoundaryLayer()
    if (oldOverlays['nation-borders'] !== newOverlays['nation-borders'] || politySmoothingChanged)
      this.rebuildPolityBorderLayer()
    if (oldOverlays.graticule !== newOverlays.graticule)
      this.rebuildGraticuleLayer()

    const vectorMode = (mode: string) => mode === 'wind' || mode === 'ocean-current'
    if ((modeChanged && (vectorMode(previousMode) || vectorMode(params.appearance.baseMap)))
      || (monthChanged && vectorMode(params.appearance.baseMap))) {
      this.rebuildVectorLayer()
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

    this.rebuildSettlementLayer()
    this.rebuildLabelLayer()
    this.rebuildCloudLayer()
    this.rebuildRiverLayer()
    this.rebuildVectorLayer()
    this.rebuildRouteLayer()
    this.rebuildCellBoundaryLayer()
    this.rebuildPolityBorderLayer()
    this.rebuildGraticuleLayer()
    this.overlaysDirty = false
  }

  private rebuildSettlementLayer(): void {
    this.settlementLayer = this.layerManager.replace(
      this.settlementLayer,
      () => new MapSettlementLayer(this.mesh!, this.data!, this.params, this.projection, this.centralMeridian),
    )
  }

  private rebuildLabelLayer(): void {
    this.labelLayerInstance = this.layerManager.replace(
      this.labelLayerInstance,
      () => new MapLabelLayer(this.mesh!, this.data!, this.params, this.projection, this.centralMeridian),
    )
  }

  private rebuildCloudLayer(): void {
    this.cloudLayer = this.layerManager.replace(
      this.cloudLayer,
      () => new MapCloudLayer(this.mesh!, this.data!, this.params, this.projection, this.centralMeridian),
    )
  }

  private rebuildRiverLayer(): void {
    this.riverLayer = this.layerManager.replace(
      this.riverLayer,
      () => new MapRiverLayer(
        this.mesh!, this.data!, this.params, this.projection, this.centralMeridian,
        this.smoothedRegionCorners, this.viewportWidth, this.viewportHeight,
      ),
    )
  }

  private rebuildVectorLayer(): void {
    this.vectorLayer = this.layerManager.replace(
      this.vectorLayer,
      () => new MapClimateVectorLayer(this.mesh!, this.data!, this.params, this.projection, this.centralMeridian),
    )
  }

  private rebuildRouteLayer(): void {
    this.routeLayer = this.layerManager.replace(
      this.routeLayer,
      () => new MapRouteLayer(this.mesh!, this.data!, this.params, this.projection, this.centralMeridian),
    )
  }

  private rebuildCellBoundaryLayer(): void {
    this.cellBoundaryLayer = this.layerManager.replace(
      this.cellBoundaryLayer,
      () => new MapCellBoundaryLayer(
        this.mesh!, this.data!, this.params, this.projection, this.centralMeridian,
        this.smoothedRegionCorners ?? null,
      ),
    )
  }

  private rebuildPolityBorderLayer(): void {
    this.polityBorderLayer = this.layerManager.replace(
      this.polityBorderLayer,
      () => new MapPolityBorderLayer(
        this.mesh!, this.data!, this.params, this.projection, this.centralMeridian,
        this.smoothedRegionCorners ?? null, this.regionTopologyBuilder,
        this.viewportWidth, this.viewportHeight,
      ),
    )
  }

  private rebuildGraticuleLayer(): void {
    this.graticuleLayer = this.layerManager.replace(
      this.graticuleLayer,
      () => new MapGraticuleLayer(this.params, this.projection, this.centralMeridian),
    )
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
  }

  update(): void {
    this.controls.update()
    this.labelLayerInstance?.updateLOD(this.camera.zoom)
    this.riverLayer?.updateWidthScale(this.camera.zoom)
    this.vectorLayer?.updateLineWidth(this.camera.zoom)
    this.polityBorderLayer?.updateLineWidth(this.camera.zoom)
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
    this.layerManager.disposeAll()
    this.settlementLayer = null
    this.labelLayerInstance = null
    this.cloudLayer = null
    this.riverLayer = null
    this.vectorLayer = null
    this.routeLayer = null
    this.cellBoundaryLayer = null
    this.polityBorderLayer = null
    this.graticuleLayer = null
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
