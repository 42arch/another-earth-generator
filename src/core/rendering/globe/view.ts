import type {
  ShaderMaterial,
} from 'three'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjectionId } from '@/core/projections/map-projection'
import type { SphericalRegionTopology } from '@/core/rendering/shared/spherical-region-topology'
import type { WorldViewMode } from '@/core/rendering/view-mode'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Points,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { elevationKmToDisplayCoordinate } from '@/core/geography/elevation-units'
import { Atmosphere } from '@/core/rendering/globe/atmosphere'
import { GlobeCellBoundaryLayer } from '@/core/rendering/globe/layers/globe-cell-boundary-layer'
import { GlobeCloudLayer } from '@/core/rendering/globe/layers/globe-cloud-layer'
import { GlobeGraticuleLayer } from '@/core/rendering/globe/layers/globe-graticule-layer'
import { GlobePolityBorderLayer } from '@/core/rendering/globe/layers/globe-polity-border-layer'
import { GlobeRiverLayer } from '@/core/rendering/globe/layers/globe-river-layer'
import { GlobeRouteLayer } from '@/core/rendering/globe/layers/globe-route-layer'
import { GlobeClimateVectorLayer } from '@/core/rendering/globe/layers/globe-vector-layer'
import { GlobeWaterLayer } from '@/core/rendering/globe/layers/globe-water-layer'
import { GlobePicker } from '@/core/rendering/globe/picker'
import { Stars } from '@/core/rendering/globe/stars'
import { GlobeSurfaceGeometry } from '@/core/rendering/globe/surface-geometry'
import { MapView } from '@/core/rendering/map/view'
import {
  createPolityRegionIds,
} from '@/core/rendering/shared/polity-border-geometry'
import { createMapMarkerMaterial } from '@/core/rendering/shared/settlement-marker-material'
import { SphericalRegionTopologyBuilder } from '@/core/rendering/shared/spherical-region-topology'
import { WorldColorizer } from '@/core/rendering/shared/world-colorizer'
import { GlobeLabelLayer } from './globe-label-layer'
import { GlobeSettlementLayer } from './globe-settlement-layer'

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
  private settlementLayer: Points<BufferGeometry, ShaderMaterial> | null = null
  private sacredSiteLayer: Points<BufferGeometry, ShaderMaterial> | null = null
  private globeSettlementLayer: GlobeSettlementLayer | null = null
  private atmosphereLayer: Atmosphere | null = null
  private starsLayer: Stars | null = null

  private labelLayerInstance: GlobeLabelLayer | null = null
  private routeLayerInstance: GlobeRouteLayer | null = null
  private cellBoundaryLayerInstance: GlobeCellBoundaryLayer | null = null
  private polityBorderLayerInstance: GlobePolityBorderLayer | null = null
  private graticuleLayerInstance: GlobeGraticuleLayer | null = null
  private riverLayerInstance: GlobeRiverLayer | null = null
  private cloudLayerInstance: GlobeCloudLayer | null = null
  private vectorLayerInstance: GlobeClimateVectorLayer | null = null
  private waterLayerInstance: GlobeWaterLayer | null = null
  private mesh: SphericalMesh | null = null
  private data: WorldSimulationState | null = null
  private params: WorldConfig
  private pointerStartX = 0
  private pointerStartY = 0
  private viewMode: WorldViewMode = 'globe'

  private readonly canvas: HTMLCanvasElement
  private readonly onRegionSelected: (region: number, settlementId?: number, routeId?: number) => void
  private regionTopology: SphericalRegionTopology | null = null
  private smoothedRegionCorners: Float32Array | null = null

  constructor(
    canvas: HTMLCanvasElement,
    params: WorldConfig,
    onRegionSelected: (region: number, settlementId?: number, routeId?: number) => void,
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
    this.rebuildAtmosphere()
    this.mapView.setWorld(mesh, data, params)
    this.selectionMarker.visible = false
    this.updateLighting(params)
    this.rebuildOverlays()
  }

  updateAppearance(params: WorldConfig): void {
    const previousParams = this.params
    const previousMode = previousParams.appearance.baseMap
    const modeChanged = previousMode !== params.appearance.baseMap
    const satelliteTransition = modeChanged && (previousMode === 'satellite' || params.appearance.baseMap === 'satellite')
    const elevationColorModeChanged = modeChanged
      && (this.isElevationColorMode(previousMode) || this.isElevationColorMode(params.appearance.baseMap))

    const elevationDisplacementChanged = previousParams.appearance.elevationDisplacement !== params.appearance.elevationDisplacement
    const regionSmoothingChanged = this.getRegionSmoothingMode(previousParams) !== this.getRegionSmoothingMode(params)
    const monthChanged = previousParams.appearance.climateMonth !== params.appearance.climateMonth
    const overlayLightingChanged = monthChanged
      || previousParams.appearance.overlays['day-night'] !== params.appearance.overlays['day-night']

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

    const oldOverlays = previousParams.appearance.overlays
    const newOverlays = params.appearance.overlays

    if (oldOverlays.atmosphere !== newOverlays.atmosphere) {
      this.rebuildAtmosphere()
    }

    if (modeChanged || oldOverlays.clouds !== newOverlays.clouds || oldOverlays.graticule !== newOverlays.graticule || oldOverlays.rivers !== newOverlays.rivers || oldOverlays.routes !== newOverlays.routes || oldOverlays['nation-borders'] !== newOverlays['nation-borders'] || oldOverlays['cell-boundaries'] !== newOverlays['cell-boundaries'] || overlayLightingChanged) {
      this.rebuildEnvironmentLayers()
    }

    this.rebuildSettlementLayer()
    if (oldOverlays['sacred-sites'] !== newOverlays['sacred-sites'] || overlayLightingChanged)
      this.rebuildSacredSites()
    const labelOverlaysChanged = oldOverlays['nation-labels'] !== newOverlays['nation-labels']
      || oldOverlays['religion-labels'] !== newOverlays['religion-labels']
      || oldOverlays['ethnicity-labels'] !== newOverlays['ethnicity-labels']
      || oldOverlays['language-labels'] !== newOverlays['language-labels']
    if (labelOverlaysChanged || modeChanged)
      this.rebuildLabels()
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
    this.disposeSettlementLayer()
    this.disposeSacredSites()
    this.routeLayerInstance?.dispose()
    this.cellBoundaryLayerInstance?.dispose()
    this.polityBorderLayerInstance?.dispose()
    this.graticuleLayerInstance?.dispose()
    this.riverLayerInstance?.dispose()
    this.cloudLayerInstance?.dispose()
    this.vectorLayerInstance?.dispose()
    this.waterLayerInstance?.dispose()
    this.disposeLabels()
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

  private rebuildOverlays(): void {
    this.rebuildEnvironmentLayers()
    this.rebuildLabels()
    this.rebuildSettlementLayer()
    this.rebuildSacredSites()
  }

  private rebuildEnvironmentLayers(): void {
    this.riverLayerInstance?.dispose()
    this.cloudLayerInstance?.dispose()
    this.vectorLayerInstance?.dispose()
    this.waterLayerInstance?.dispose()
    this.routeLayerInstance?.dispose()
    this.cellBoundaryLayerInstance?.dispose()
    this.polityBorderLayerInstance?.dispose()
    this.graticuleLayerInstance?.dispose()

    if (this.mesh && this.data) {
      this.waterLayerInstance = new GlobeWaterLayer(this.mesh, this.data, this.params, this.usesElevationGeometry(this.params))
      this.scene.add(this.waterLayerInstance.group)
      this.vectorLayerInstance = new GlobeClimateVectorLayer(this.mesh, this.data, this.params)
      this.scene.add(this.vectorLayerInstance.group)
      this.cloudLayerInstance = new GlobeCloudLayer(this.mesh, this.data, this.params, this.getTerrainVerticalScale(this.params.core.planetRadius), this.usesElevationGeometry(this.params))
      this.scene.add(this.cloudLayerInstance.group)
      this.riverLayerInstance = new GlobeRiverLayer(this.mesh, this.data, this.params, this.smoothedRegionCorners ?? null, this.getTerrainVerticalScale(this.params.core.planetRadius), this.usesElevationGeometry(this.params))
      this.scene.add(this.riverLayerInstance.group)

      this.routeLayerInstance = new GlobeRouteLayer(this.mesh, this.data, this.params, this.getTerrainVerticalScale(this.params.core.planetRadius), this.usesElevationGeometry(this.params), this.params.appearance.overlays['day-night'] ? [this.sunlight.position.x, this.sunlight.position.y, this.sunlight.position.z] as const : undefined)
      this.scene.add(this.routeLayerInstance.group)

      this.cellBoundaryLayerInstance = new GlobeCellBoundaryLayer(this.mesh, this.data, this.params, this.getTerrainVerticalScale(this.params.core.planetRadius), this.usesElevationGeometry(this.params), this.smoothedRegionCorners ?? null)
      this.scene.add(this.cellBoundaryLayerInstance.group)

      this.polityBorderLayerInstance = new GlobePolityBorderLayer(this.mesh, this.data, this.params, this.getTerrainVerticalScale(this.params.core.planetRadius), this.usesElevationGeometry(this.params), this.smoothedRegionCorners ?? null, this.regionTopologyBuilder, this.canvas.clientWidth, this.canvas.clientHeight, this.sunlight.position)
      this.scene.add(this.polityBorderLayerInstance.group)

      this.graticuleLayerInstance = new GlobeGraticuleLayer(this.params, this.getTerrainVerticalScale(this.params.core.planetRadius), this.usesElevationGeometry(this.params))
      this.scene.add(this.graticuleLayerInstance.group)
    }
  }

  private rebuildSettlementLayer(): void {
    this.disposeSettlementLayer()
    if (!this.params.appearance.overlays.cities || !this.mesh || !this.data?.society)
      return
    const data = this.data
    const settlements = data.society!.settlements
    if (settlements.length === 0)
      return
    const positions = new Float32Array(settlements.length * 3)
    const colors = new Float32Array(settlements.length * 3)
    const markerLevels = new Float32Array(settlements.length)
    const palette = { village: 0xB7E4B3, town: 0xF4D777, city: 0xFFAE59, metropolis: 0xFF665C }
    const level = { village: 0, town: 1, city: 2, metropolis: 3 }
    for (const settlement of settlements) {
      const region = settlement.region
      const elevation = elevationKmToDisplayCoordinate(data.geography.elevation[region])
      const offset = this.usesElevationGeometry(this.params)
        ? elevation * this.getTerrainVerticalScale(this.params.core.planetRadius)
        : 0
      const radius = this.params.core.planetRadius + offset + 0.22
      const source = region * 3
      const target = settlement.id * 3
      positions[target] = this.mesh.regionPosition[source] * radius
      positions[target + 1] = this.mesh.regionPosition[source + 1] * radius
      positions[target + 2] = this.mesh.regionPosition[source + 2] * radius
      const color = new Color(palette[settlement.rank])
      colors[target] = color.r
      colors[target + 1] = color.g
      colors[target + 2] = color.b
      markerLevels[settlement.id] = level[settlement.rank]
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setAttribute('color', new BufferAttribute(colors, 3))
    geometry.setAttribute('markerLevel', new BufferAttribute(markerLevels, 1))
    this.settlementLayer = new Points(geometry, createMapMarkerMaterial(
      true,
      this.params.appearance.overlays['day-night'],
      this.sunlight.position,
    ))
    this.settlementLayer.renderOrder = 8
    this.settlementLayer.visible = false
    this.scene.add(this.settlementLayer)

    // 创建全新 3D 聚落名牌图层（内置官方 Maki 矢量图标 + 聚落名称 + 3级动态 LOD）
    this.globeSettlementLayer = new GlobeSettlementLayer(
      this.mesh,
      this.data,
      this.params,
      this.getTerrainVerticalScale(this.params.core.planetRadius),
    )
    this.scene.add(this.globeSettlementLayer.group)
  }

  private disposeSettlementLayer(): void {
    if (this.globeSettlementLayer) {
      this.scene.remove(this.globeSettlementLayer.group)
      this.globeSettlementLayer.dispose()
      this.globeSettlementLayer = null
    }
    if (!this.settlementLayer)
      return
    this.scene.remove(this.settlementLayer)
    this.settlementLayer.geometry.dispose()
    this.settlementLayer.material.dispose()
    this.settlementLayer = null
  }

  private rebuildSacredSites(): void {
    this.disposeSacredSites()
    if (!this.params.appearance.overlays['sacred-sites'] || !this.mesh || !this.data?.society?.religions)
      return
    const sites = this.data.society.religions.sacredSites
    if (sites.length === 0)
      return
    const positions = new Float32Array(sites.length * 3)
    const colors = new Float32Array(sites.length * 3)
    const markerLevels = new Float32Array(sites.length).fill(2)
    const color = new Color(0xEAC2FF)
    for (const site of sites) {
      const region = site.region
      const source = region * 3
      const elevation = elevationKmToDisplayCoordinate(this.data.geography.elevation[region])
      const offset = this.usesElevationGeometry(this.params)
        ? elevation * this.getTerrainVerticalScale(this.params.core.planetRadius)
        : 0
      const radius = this.params.core.planetRadius + offset + 0.22
      const target = site.id * 3
      positions[target] = this.mesh.regionPosition[source] * radius
      positions[target + 1] = this.mesh.regionPosition[source + 1] * radius
      positions[target + 2] = this.mesh.regionPosition[source + 2] * radius
      colors[target] = color.r
      colors[target + 1] = color.g
      colors[target + 2] = color.b
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setAttribute('color', new BufferAttribute(colors, 3))
    geometry.setAttribute('markerLevel', new BufferAttribute(markerLevels, 1))
    this.sacredSiteLayer = new Points(geometry, createMapMarkerMaterial(
      true,
      this.params.appearance.overlays['day-night'],
      this.sunlight.position,
    ))
    this.sacredSiteLayer.renderOrder = 9
    this.sacredSiteLayer.visible = false
    this.scene.add(this.sacredSiteLayer)
  }

  private disposeSacredSites(): void {
    if (!this.sacredSiteLayer)
      return
    this.scene.remove(this.sacredSiteLayer)
    this.sacredSiteLayer.geometry.dispose()
    this.sacredSiteLayer.material.dispose()
    this.sacredSiteLayer = null
  }

  private pickSettlement(event: PointerEvent): number | null {
    if (!this.settlementLayer || !this.mesh || !this.data?.society)
      return null
    const rect = this.canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const positions = this.settlementLayer.geometry.getAttribute('position')
    const point = new Vector3()
    let nearest = 10 * 10
    let chosen: number | null = null
    for (let id = 0; id < positions.count; id++) {
      point.fromBufferAttribute(positions, id)
      if (point.dot(this.camera.position) <= point.lengthSq())
        continue
      const projected = point.clone().project(this.camera)
      if (projected.z < -1 || projected.z > 1)
        continue
      const dx = (projected.x + 1) * rect.width / 2 - x
      const dy = (1 - projected.y) * rect.height / 2 - y
      const distance = dx * dx + dy * dy
      if (distance < nearest) {
        nearest = distance
        chosen = id
      }
    }
    return chosen
  }

  private rebuildLabels(): void {
    this.disposeLabels()
    if (!this.mesh || !this.data?.society)
      return

    this.labelLayerInstance = new GlobeLabelLayer(
      this.mesh,
      this.data,
      this.params,
      this.getTerrainVerticalScale(this.params.core.planetRadius),
    )
    if (this.labelLayerInstance)
      this.scene.add(this.labelLayerInstance.group)
  }

  private disposeLabels(): void {
    this.labelLayerInstance?.dispose()
    this.labelLayerInstance = null
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

  private disposeSurface(): void {
    if (this.surface) {
      this.scene.remove(this.surface)
      this.surface.geometry.dispose()
      this.surface.material.dispose()
      this.surface = null
    }
    this.disposeLabels()
    this.routeLayerInstance?.dispose()
    this.cellBoundaryLayerInstance?.dispose()
    this.polityBorderLayerInstance?.dispose()
    this.graticuleLayerInstance?.dispose()
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
    if (this.isElevationColorMode(this.params.appearance.baseMap) || !this.params.appearance.overlays.atmosphere)
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
    this.polityBorderLayerInstance?.updateViewport(width, height)
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
    if (this.globeSettlementLayer) {
      this.globeSettlementLayer.updateLOD(distance)
    }
    this.renderer.render(this.scene, this.camera)
  }
}
