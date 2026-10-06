import type { BufferGeometry, Material, Object3D } from 'three'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection, MapProjectionId } from '@/core/projections/map-projection'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import {
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  RingGeometry,
  Scene,
  ShaderMaterial,
} from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import { getMapProjection } from '@/core/projections/d3-map-projection'
import { FULL_LONGITUDE, wrapLongitude } from '@/core/projections/projection-math'
import { MapLineGeometry } from '@/core/rendering/map/line-geometry'
import { MapPicker } from '@/core/rendering/map/picker'
import { MapRibbonGeometry } from '@/core/rendering/map/ribbon-geometry'
import { MapRibbonMaterial } from '@/core/rendering/map/ribbon-material'
import { MapSurfaceGeometry } from '@/core/rendering/map/surface-geometry'
import { SphericalCellBoundaryGeometry } from '@/core/rendering/shared/cell-boundary-geometry'
import { createClimateVectorGeometry } from '@/core/rendering/shared/climate-vector-geometry'
import { CLOUD_FRAGMENT_SHADER, CLOUD_MAP_VERTEX_SHADER } from '@/core/rendering/shared/cloud-shaders'
import { SphericalGraticuleGeometry } from '@/core/rendering/shared/graticule-geometry'
import { RiverGeometry } from '@/core/rendering/shared/river-geometry'
import { WorldColorizer } from '@/core/rendering/shared/world-colorizer'

interface MapLayerResource {
  objects: Object3D[]
  geometry: BufferGeometry
  material: Material
}

export class MapView {
  readonly scene = new Scene()
  readonly camera = new OrthographicCamera(-Math.PI, Math.PI, Math.PI / 2, -Math.PI / 2, 0.1, 100)
  private readonly colorizer = new WorldColorizer()
  private readonly controls: MapControls
  private readonly geometryBuilder = new MapSurfaceGeometry()
  private readonly cellBoundaryGeometryBuilder = new SphericalCellBoundaryGeometry()
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
    this.centralMeridian = this.chooseCentralMeridian(mesh, data)
    this.disposeSurface()
    this.disposeOverlays()
    this.surfaceDirty = true
    this.overlaysDirty = true
    this.selectedRegion = -1
    this.selectionGroup.visible = false
    if (this.active) {
      this.rebuildSurface()
      this.rebuildOverlays()
    }
  }

  updateAppearance(params: WorldConfig): void {
    const previousMode = this.params.appearance.displayMode
    const modeChanged = previousMode !== params.appearance.displayMode
    const satelliteTransition = modeChanged && (previousMode === 'satellite' || params.appearance.displayMode === 'satellite')
    this.params = { ...params }
    if (satelliteTransition)
      this.surfaceDirty = true
    if (!this.active) {
      if (this.surface && this.data && !satelliteTransition
        && params.appearance.displayMode !== 'heightmap'
        && params.appearance.displayMode !== 'satellite') {
        this.geometryBuilder.updateColors(
          this.surface.geometry,
          this.colorizer.build(this.data, params.appearance.displayMode, this.mesh ?? undefined),
        )
      }
      this.overlaysDirty = true
      return
    }
    this.ensureSurface()
    if (!this.surface || !this.data)
      return
    if (!satelliteTransition && params.appearance.displayMode !== 'heightmap'
      && params.appearance.displayMode !== 'satellite') {
      this.geometryBuilder.updateColors(
        this.surface.geometry,
        this.colorizer.build(this.data, params.appearance.displayMode, this.mesh ?? undefined),
      )
    }
    this.rebuildOverlays()
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
    const mode = this.params.appearance.displayMode
    const colors = this.colorizer.build(this.data, mode, this.mesh, mode === 'satellite')
    const cornerColors = mode === 'heightmap'
      ? this.colorizer.buildHeightmapCornerColors(this.mesh, this.data.geography.elevation)
      : undefined
    const geometry = this.geometryBuilder.create(
      this.mesh,
      colors,
      this.projection,
      this.centralMeridian,
      undefined,
      cornerColors,
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
    this.addGraticule()
    this.addClimateVectors()
    this.addClouds()
    this.addRivers()
    this.overlaysDirty = false
  }

  private addClouds(): void {
    if (!this.params.appearance.showClouds || !this.mesh)
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
      !this.params.appearance.showRivers
      || !this.mesh
      || !this.data?.hydrology
    ) {
      return
    }
    const geometry = this.riverRibbonGeometryBuilder.create(
      this.riverGeometryBuilder.createStrokePaths(this.mesh, this.data),
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
    const mode = this.params.appearance.displayMode
    const vectors = this.data?.climate?.displayVector
    if (!this.mesh || !this.data || (mode !== 'wind' && mode !== 'ocean-current') || vectors?.kind !== mode)
      return
    const geometry = createClimateVectorGeometry(this.mesh, vectors, this.data.geography.landMask, 1)
    this.addProjectedSourceGeometry(geometry, mode === 'wind' ? 0xFFE6A0 : 0xFFFFFF, 0.94, 0.4, 5, mode === 'ocean-current')
  }

  private addCellBoundaries(): void {
    if (!this.params.appearance.wireframe || !this.mesh)
      return
    // Surface polygons use straight projected edges. Keep the overlay on the
    // same endpoint segments so non-linear map projections cannot introduce
    // a visible offset between the fill boundary and the cell line.
    const geometry = this.cellBoundaryGeometryBuilder.create(
      this.mesh,
      1,
      Number.POSITIVE_INFINITY,
    )
    this.addProjectedSourceGeometry(geometry, 0xB8D6E8, 0.5, 0.24, 2)
  }

  private addGraticule(): void {
    if (!this.params.appearance.showGraticule)
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

  private ensureOverlays(): void {
    if (this.overlaysDirty)
      this.rebuildOverlays()
  }

  private disposeOverlays(): void {
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
