import type { WorldMapReader } from '@another-earth/world-core'
import type { PickableMapLayer } from '#picking/map-picker'
import type { Vec3Tuple } from '#projections/spherical-math'
import type { GpuResourceTracker } from '#rendering/gpu-resource-tracker'
import type { CircleLayer } from '#rendering/layers/circle-layer'
import type { FillLayer } from '#rendering/layers/fill-layer'
import type { LineLayer } from '#rendering/layers/line-layer'
import type { SymbolLayer } from '#rendering/layers/symbol-layer'
import type { MapSourceRegistry } from '#sources/registry'
import type { CompiledMapStyle, CompiledMapStyleLayer } from '#styles/compiler'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { cartesianToLonLatDeg, lonLatDegToCartesian, normalizeVec3, rotateAroundPolarAxis } from '#projections/spherical-math'
import { globeLinePlacement, LAYER_STACK, layerRenderOrder } from '#rendering/layer-stack'
import { createCircleLayerFromRegistry } from '#rendering/layers/circle-layer'
import { createFillLayerFromRegistry } from '#rendering/layers/fill-layer'
import { createLineLayerFromRegistry } from '#rendering/layers/line-layer'
import { acquireGlobeCellGeometry, RasterLayer } from '#rendering/layers/raster-layer'
import { SelectionLayer } from '#rendering/layers/selection-layer'
import { CollisionGrid, createSymbolLayerFromRegistry } from '#rendering/layers/symbol-layer'
import { seaIceCoverForMonths } from '#rendering/satellite-shader'
import { readStyleBackgroundColor } from '#styles/spec'

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** Eastward planet spin used when rotation is first enabled, in degrees per second. */
export const DEFAULT_PLANET_SPIN_DEGREES_PER_SECOND = 0.6

export function planetSpinStepRadians(elapsedMs: number, degreesPerSecond: number): number {
  const speed = Math.max(0, Math.min(90, degreesPerSecond))
  return Math.max(0, elapsedMs) * 0.001 * speed * (Math.PI / 180)
}

export interface GlobeEffectsConfig {
  readonly rotate: boolean
  /** Eastward spin around the polar axis, in degrees per second. Ignored while rotation is off. */
  readonly rotateSpeedDegreesPerSecond: number
  readonly atmosphere: boolean
  readonly dayNight: boolean
  readonly polarIce: boolean
}

export interface GlobeLayerFilterState {
  readonly activeThematicId: string | null
  /** When true, the style's surface (`slot: 'base'`) layers are drawn under any thematic. */
  readonly surfaceEnabled: boolean
  readonly enabledOverlayIds: readonly string[]
  readonly climateMonth: number
  readonly globeEffects: GlobeEffectsConfig
  readonly selection: Readonly<{
    regionId: number | null
    featureId?: string | null
  }>
}

/**
 * Computes the unified `styleZoom` (`0..12`) from a 3D perspective camera distance and vertical FOV:
 * `visibleArcRadians = 2 * atan((distance - 1) * tan(fovRad / 2))`
 * `styleZoom = clamp(log2(PI / visibleArcRadians), 0, 12)`
 */
export function computeGlobeStyleZoom(
  cameraDistance: number,
  fovDegrees = 42,
  planetRadius = 1.0,
): number {
  const altitude = Math.max(0.02, cameraDistance - planetRadius)
  const halfFovRad = (fovDegrees * Math.PI / 180) * 0.5
  const visibleChordHalf = altitude * Math.tan(halfFovRad)
  const visibleArcRadians = Math.max(1e-4, Math.min(Math.PI, 2 * Math.atan(visibleChordHalf / planetRadius)))
  const rawZoom = Math.log2(Math.PI / visibleArcRadians)
  return Math.max(0, Math.min(12, rawZoom))
}

export function computeSunDirectionForMonth(
  month: number,
  axialTiltDegrees = 23.44,
): THREE.Vector3 {
  const clampedMonth = ((Math.floor(month) % 12) + 12) % 12
  let dayOfYear = MONTH_DAYS[clampedMonth] * 0.5
  for (let m = 0; m < clampedMonth; m++) {
    dayOfYear += MONTH_DAYS[m]
  }
  const seasonalAngle = ((dayOfYear - 79) / 365) * Math.PI * 2
  const tiltRad = Math.max(0, Math.min(90, axialTiltDegrees)) * (Math.PI / 180)
  const solarDeclination = Math.asin(Math.sin(tiltRad) * Math.sin(seasonalAngle))
  return new THREE.Vector3(
    0,
    Math.sin(solarDeclination),
    Math.cos(solarDeclination),
  ).normalize()
}

function createStarfield(tracker?: GpuResourceTracker): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  let state = 0x4A17E
  const random = (): number => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
  const count = 2400
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const y = random() * 2 - 1
    const theta = random() * Math.PI * 2
    const radius = 10 + random() * 5
    const ring = Math.sqrt(Math.max(0, 1 - y * y))
    positions[i * 3] = Math.cos(theta) * ring * radius
    positions[i * 3 + 1] = y * radius
    positions[i * 3 + 2] = Math.sin(theta) * ring * radius
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  tracker?.trackGeometry(geometry)

  const material = new THREE.PointsMaterial({
    color: '#ffffff',
    size: 0.02,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  })
  tracker?.trackMaterial(material)
  return new THREE.Points(geometry, material)
}

function createAtmosphereMesh(tracker?: GpuResourceTracker): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.SphereGeometry(1.075, 48, 48)
  tracker?.trackGeometry(geometry)

  const vertexShader = /* glsl */`
    varying vec3 vNormal;
    varying vec3 vPosition;
    void main() {
      vec4 modelPosition = modelMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * viewMatrix * modelPosition;
      vNormal = (modelMatrix * vec4(normal, 0.0)).xyz;
      vPosition = modelPosition.xyz;
    }
  `
  const fragmentShader = /* glsl */`
    uniform vec3 uAtmosphereColor;
    uniform float uPlanetRadius;
    varying vec3 vNormal;
    varying vec3 vPosition;
    void main() {
      vec3 viewDirection = normalize(vPosition - cameraPosition);
      vec3 normal = normalize(vNormal);
      float edgeAlpha = smoothstep(0.0, 0.32, dot(viewDirection, normal));
      float distanceFade = smoothstep(uPlanetRadius * 1.35, uPlanetRadius * 3.4, length(cameraPosition));
      float alpha = edgeAlpha * distanceFade * 0.42;
      gl_FragColor = vec4(uAtmosphereColor, alpha);
    }
  `
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uAtmosphereColor: { value: new THREE.Color('#3da5ff') },
      uPlanetRadius: { value: 1.0 },
    },
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  tracker?.trackMaterial(material)

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'GlobeAtmosphere'
  mesh.renderOrder = 120
  return mesh
}

function createSpecularOceanSphere(
  reader: WorldMapReader,
  tracker?: GpuResourceTracker,
): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const mesh = reader.mesh
  const landMask = reader.field('landMask')
  const monthlyTemperature = Array.from({ length: 12 }, (_, month) => reader.monthlyField('temperatureC', month))
  const regionCount = mesh.regionCount
  let totalVertices = 0
  let totalTriangles = 0
  for (let r = 0; r < regionCount; r++) {
    if (landMask.get(r) > 0)
      continue
    const k = mesh.getRegionDegree(r)
    if (k >= 3) {
      totalVertices += k
      totalTriangles += k - 2
    }
  }

  const positions = new Float32Array(totalVertices * 3)
  const normals = new Float32Array(totalVertices * 3)
  const iceCovers = new Float32Array(totalVertices)
  const indices = totalVertices > 65535
    ? new Uint32Array(totalTriangles * 3)
    : new Uint16Array(totalTriangles * 3)

  const cornerPositions = new Float64Array(mesh.cornerCount * 3)
  const cornerOut = { x: 0, y: 0, z: 0 }
  for (let c = 0; c < mesh.cornerCount; c++) {
    mesh.getCornerPosition(c, cornerOut)
    cornerPositions[c * 3] = cornerOut.x
    cornerPositions[c * 3 + 1] = cornerOut.y
    cornerPositions[c * 3 + 2] = cornerOut.z
  }

  const waterRadius = 1.0008
  let vertexCursor = 0
  let indexCursor = 0

  for (let r = 0; r < regionCount; r++) {
    if (landMask.get(r) > 0)
      continue
    const baseVertex = vertexCursor
    const cover = seaIceCoverForMonths(monthlyTemperature.map(field => field.get(r)))
    let k = 0
    mesh.forEachRegionNeighbor(r, (_neighbor, cornerA) => {
      const c3 = cornerA * 3
      const x = cornerPositions[c3]
      const y = cornerPositions[c3 + 1]
      const z = cornerPositions[c3 + 2]
      const len = Math.hypot(x, y, z) || 1
      const nx = x / len
      const ny = y / len
      const nz = z / len
      const vOffset = vertexCursor * 3
      positions[vOffset] = nx * waterRadius
      positions[vOffset + 1] = ny * waterRadius
      positions[vOffset + 2] = nz * waterRadius
      normals[vOffset] = nx
      normals[vOffset + 1] = ny
      normals[vOffset + 2] = nz
      iceCovers[vertexCursor] = cover
      vertexCursor++
      k++
    })

    for (let i = 1; i < k - 1; i++) {
      indices[indexCursor++] = baseVertex
      indices[indexCursor++] = baseVertex + i
      indices[indexCursor++] = baseVertex + i + 1
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('aIceCover', new THREE.BufferAttribute(iceCovers, 1))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1.02)
  tracker?.trackGeometry(geometry)

  const vertexShader = /* glsl */`
    attribute float aIceCover;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    varying float vIceCover;
    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPos.xyz;
      vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
      vIceCover = aIceCover;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `
  const fragmentShader = /* glsl */`
    uniform vec3 uSunDirection;
    uniform float uDayNightEnabled;
    uniform float uPolarIce;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    varying float vIceCover;

    vec3 linearToSrgb(vec3 linear) {
      vec3 clamped = clamp(linear, 0.0, 1.0);
      return mix(clamped * 12.92, 1.055 * pow(clamped, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), clamped));
    }

    void main() {
      vec3 N = normalize(vWorldNormal);
      vec3 L = normalize(uSunDirection);
      vec3 V = normalize(cameraPosition - vWorldPosition);
      vec3 H = normalize(L + V);
      float dotNL = max(0.0, dot(N, L));
      float dotNH = max(0.0, dot(N, H));
      float dotVH = max(0.0, dot(V, H));

      vec3 ambientIrradiance = uDayNightEnabled > 0.5
        ? vec3(0.081, 0.130, 0.199) * 1.1
        : vec3(0.402, 0.497, 0.604) * 3.5;
      vec3 sunColor = uDayNightEnabled > 0.5
        ? vec3(1.0, 0.963, 0.871) * 4.0
        : vec3(1.0, 0.940, 0.855) * 1.5;
      vec3 directIrradiance = sunColor * dotNL;

      vec3 diffuseBase = vec3(0.0037, 0.0423, 0.1560);
      vec3 specBase = vec3(0.0578, 0.2462, 0.4969);
      vec3 F = specBase + (1.0 - specBase) * pow(clamp(1.0 - dotVH, 0.0, 1.0), 5.0);
      float D = 0.318309886 * 61.0 * pow(dotNH, 120.0);
      vec3 brdfSpec = F * (0.25 * D);

      vec3 linearLit = (ambientIrradiance + directIrradiance) * (diffuseBase * 0.318309886)
        + directIrradiance * brdfSpec;
      // Same fade as oceanSpecularOpacity: full sea ice clears the sheen.
      float openWater = 1.0 - clamp(vIceCover, 0.0, 1.0) * uPolarIce;
      gl_FragColor = vec4(linearToSrgb(linearLit), 0.55 * openWater);
    }
  `
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSunDirection: { value: new THREE.Vector3(1.8, 1.2, 2.2).normalize() },
      uDayNightEnabled: { value: 0 },
      uPolarIce: { value: 1 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  })
  tracker?.trackMaterial(material)

  const meshObj = new THREE.Mesh(geometry, material)
  meshObj.name = 'GlobeOceanSpecular'
  meshObj.renderOrder = 8
  return meshObj
}

type ManagedRuntimeLayer
  = | { readonly type: 'raster', readonly compiled: CompiledMapStyleLayer, readonly instance: RasterLayer, readonly isMonthly: boolean }
    | { readonly type: 'fill', readonly compiled: CompiledMapStyleLayer, readonly instance: FillLayer, readonly isMonthly: boolean }
    | { readonly type: 'line', readonly compiled: CompiledMapStyleLayer, readonly instance: LineLayer, readonly isMonthly: boolean }
    | { readonly type: 'circle', readonly compiled: CompiledMapStyleLayer, readonly instance: CircleLayer, readonly isMonthly: boolean }
    | { readonly type: 'symbol', readonly compiled: CompiledMapStyleLayer, readonly instance: SymbolLayer, readonly isMonthly: boolean }

/**
 * 3D `GlobeView` scene controller:
 * - Perspective camera (`fov = 42`), altitude-adaptive damping `OrbitControls`, starfield,
 *   backside additive atmosphere rim, specular water highlight, and seasonal sun direction.
 * - Optional spin rotates the planet eastward around its polar axis. The camera, stars, and sun stay fixed,
 *   so the terminator does not travel with the surface.
 * - Orchestrates the 5 GPU layer types (`RasterLayer`, `FillLayer`, `LineLayer`, `CircleLayer`, `SymbolLayer`)
 *   plus `SelectionLayer` and `CollisionGrid`.
 */
export class GlobeView {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.01, 25)
  readonly controls: OrbitControls | null = null
  readonly collisionGrid = new CollisionGrid(32)
  readonly selectionLayer: SelectionLayer

  private readonly reader: WorldMapReader
  private readonly registry: MapSourceRegistry
  private readonly tracker?: GpuResourceTracker
  private readonly layerGroup = new THREE.Group()
  private readonly planetGroup = new THREE.Group()
  private readonly stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private readonly atmosphere: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  private readonly oceanSpecular: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  private readonly styleBackground: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  private readonly releaseStyleBackground: () => void

  private runtimeLayers = new Map<string, ManagedRuntimeLayer>()
  private compiledStyle: CompiledMapStyle | null = null
  private filterState: GlobeLayerFilterState = {
    activeThematicId: null,
    surfaceEnabled: true,
    enabledOverlayIds: ['rivers', 'lakes', 'coastlines', 'labels'],
    climateMonth: 0,
    globeEffects: {
      rotate: false,
      rotateSpeedDegreesPerSecond: DEFAULT_PLANET_SPIN_DEGREES_PER_SECOND,
      atmosphere: true,
      dayNight: false,
      polarIce: true,
    },
    selection: {
      regionId: null,
      featureId: null,
    },
  }

  private viewportWidth = 1280
  private viewportHeight = 720
  private pixelRatio = 1
  private lastMonth = -1
  private spinRadians = 0
  private lastFrameMs = 0
  private disposed = false

  constructor(
    reader: WorldMapReader,
    registry: MapSourceRegistry,
    options: {
      readonly domElement?: HTMLElement | null
      readonly tracker?: GpuResourceTracker
    } = {},
  ) {
    this.reader = reader
    this.registry = registry
    this.tracker = options.tracker

    this.scene.background = new THREE.Color('#030308')
    this.camera.position.set(0.5, 0.3, 3.1)
    this.camera.lookAt(0, 0, 0)
    this.camera.updateMatrixWorld()

    if (options.domElement) {
      this.controls = new OrbitControls(this.camera, options.domElement)
      this.controls.enableDamping = true
      this.controls.dampingFactor = 0.08
      this.controls.enablePan = false
      this.controls.minDistance = 1.15
      this.controls.maxDistance = 7.0
    }

    this.stars = createStarfield(options.tracker)
    this.scene.add(this.stars)

    const backgroundGeometry = acquireGlobeCellGeometry(reader.mesh, options.tracker)
    this.releaseStyleBackground = backgroundGeometry.release
    const backgroundMaterial = new THREE.MeshBasicMaterial({
      color: '#0a2342',
      depthTest: true,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: 4,
      polygonOffsetUnits: 4,
    })
    options.tracker?.trackMaterial(backgroundMaterial)
    this.styleBackground = new THREE.Mesh(backgroundGeometry.geometry, backgroundMaterial)
    this.styleBackground.name = 'GlobeStyleBackground'
    this.styleBackground.scale.setScalar(0.996)
    this.styleBackground.renderOrder = -1
    this.planetGroup.add(this.styleBackground)

    this.oceanSpecular = createSpecularOceanSphere(reader, options.tracker)
    this.planetGroup.add(this.oceanSpecular)

    this.layerGroup.name = 'GlobeStyledLayers'
    this.planetGroup.add(this.layerGroup)

    this.selectionLayer = new SelectionLayer(reader, options.tracker)
    this.planetGroup.add(this.selectionLayer.group)
    this.planetGroup.name = 'GlobePlanet'
    this.scene.add(this.planetGroup)

    this.atmosphere = createAtmosphereMesh(options.tracker)
    this.scene.add(this.atmosphere)
  }

  getStyleZoom(): number {
    return computeGlobeStyleZoom(this.camera.position.length(), this.camera.fov, 1.0)
  }

  getCenterCoordinates(): { longitudeDegrees: number, latitudeDegrees: number, styleZoom: number } {
    const dir = this.worldDirectionToPlanet(normalizeVec3(
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
    ))
    const [lon, lat] = cartesianToLonLatDeg(dir[0], dir[1], dir[2])
    return {
      longitudeDegrees: lon,
      latitudeDegrees: lat,
      styleZoom: this.getStyleZoom(),
    }
  }

  setCenterCoordinates(longitudeDegrees: number, latitudeDegrees: number, styleZoom?: number): void {
    const targetZoom = styleZoom ?? this.getStyleZoom()
    const visibleArcRad = Math.PI / (2 ** Math.max(0, Math.min(12, targetZoom)))
    const halfFovRad = (this.camera.fov * Math.PI / 180) * 0.5
    const altitude = Math.tan(visibleArcRad * 0.5) / Math.max(1e-4, Math.tan(halfFovRad))
    const distance = Math.max(1.15, Math.min(7.0, 1.0 + altitude))
    const unit = this.planetDirectionToWorld(lonLatDegToCartesian(longitudeDegrees, latitudeDegrees))
    this.camera.position.set(unit[0] * distance, unit[1] * distance, unit[2] * distance)
    this.camera.lookAt(0, 0, 0)
    this.camera.updateMatrixWorld()
    this.controls?.update()
  }

  resetCamera(): void {
    this.camera.position.set(0.5, 0.3, 3.1)
    this.camera.lookAt(0, 0, 0)
    this.camera.updateMatrixWorld()
    this.controls?.reset()
  }

  resize(widthCssPx: number, heightCssPx: number, pixelRatio = 1): void {
    if (this.disposed)
      return
    this.viewportWidth = Math.max(1, widthCssPx)
    this.viewportHeight = Math.max(1, heightCssPx)
    this.pixelRatio = Math.min(Math.max(1, pixelRatio), 2)
    this.camera.aspect = this.viewportWidth / this.viewportHeight
    this.camera.updateProjectionMatrix()

    for (const entry of this.runtimeLayers.values()) {
      if (entry.type === 'line' || entry.type === 'circle' || entry.type === 'symbol') {
        entry.instance.setViewport(this.viewportWidth, this.viewportHeight, this.pixelRatio)
      }
    }
  }

  applyStyleAndState(
    compiledStyle: CompiledMapStyle,
    state: GlobeLayerFilterState,
  ): void {
    if (this.disposed)
      return

    const styleChanged = this.compiledStyle?.id !== compiledStyle.id
      || this.compiledStyle !== compiledStyle
    const monthChanged = this.lastMonth !== state.climateMonth

    this.compiledStyle = compiledStyle
    this.filterState = state
    this.lastMonth = state.climateMonth

    this.styleBackground.material.color.set(readStyleBackgroundColor(compiledStyle.raw.tokens))

    if (styleChanged) {
      this.rebuildStyleLayers(compiledStyle, state)
    }
    else if (monthChanged) {
      this.rebuildMonthlyVectorLayers(compiledStyle, state)
    }

    this.syncVisualState()
  }

  private isLayerSlotEnabled(compiledLayer: CompiledMapStyleLayer, state: GlobeLayerFilterState): boolean {
    if (!compiledLayer.views.includes('globe'))
      return false
    if (compiledLayer.slot === 'base')
      return state.surfaceEnabled
    if (compiledLayer.slot === 'thematic') {
      return state.activeThematicId !== null
        && state.activeThematicId !== 'none'
        && compiledLayer.thematicId === state.activeThematicId
    }
    if (compiledLayer.slot === 'overlay') {
      if (!compiledLayer.overlayId)
        return true
      if (state.enabledOverlayIds.includes(compiledLayer.overlayId))
        return true
      if (compiledLayer.overlayId === 'geographic-labels' && state.enabledOverlayIds.includes('labels'))
        return true
      if (compiledLayer.overlayId === 'labels' && state.enabledOverlayIds.includes('geographic-labels'))
        return true
      return false
    }
    return true
  }

  private rebuildStyleLayers(compiledStyle: CompiledMapStyle, state: GlobeLayerFilterState): void {
    for (const existing of this.runtimeLayers.values()) {
      existing.instance.dispose()
    }
    this.runtimeLayers.clear()
    this.layerGroup.clear()

    compiledStyle.layers.forEach((compiledLayer, index) => {
      this.ensureLayerConstructed(compiledLayer, index, state)
    })
  }

  private rebuildMonthlyVectorLayers(compiledStyle: CompiledMapStyle, state: GlobeLayerFilterState): void {
    compiledStyle.layers.forEach((compiledLayer, index) => {
      const existing = this.runtimeLayers.get(compiledLayer.id)
      if (existing && existing.isMonthly && existing.type !== 'raster') {
        this.layerGroup.remove(existing.instance.mesh)
        existing.instance.dispose()
        this.runtimeLayers.delete(compiledLayer.id)
      }
      this.ensureLayerConstructed(compiledLayer, index, state)
    })
  }

  private ensureLayerConstructed(
    compiledLayer: CompiledMapStyleLayer,
    orderIndex: number,
    state: GlobeLayerFilterState,
  ): ManagedRuntimeLayer | null {
    const existing = this.runtimeLayers.get(compiledLayer.id)
    if (existing)
      return existing

    if (!this.isLayerSlotEnabled(compiledLayer, state))
      return null

    const isMonthly = compiledLayer.source === 'climate-monthly' || compiledLayer.source === 'circulation-vectors'
    const renderOrder = layerRenderOrder(compiledLayer.slot, orderIndex)
    const thematicRaster = compiledLayer.slot === 'thematic'

    if (compiledLayer.type === 'raster') {
      const inst = new RasterLayer(compiledLayer.id, this.reader, {
        renderOrder,
        polygonOffsetFactor: 0,
        polygonOffsetUnits: thematicRaster ? -2 : 4,
        radiusScale: 1 + (thematicRaster ? LAYER_STACK.thematicRasterOffset : 0),
        tracker: this.tracker,
      })
      const entry: ManagedRuntimeLayer = { type: 'raster', compiled: compiledLayer, instance: inst, isMonthly }
      this.runtimeLayers.set(compiledLayer.id, entry)
      this.layerGroup.add(inst.mesh)
      return entry
    }

    if (compiledLayer.type === 'fill') {
      const surfaceOffset = compiledLayer.source === 'lake-polygons' || compiledLayer.source === 'river-polygons'
        ? LAYER_STACK.hydroFillOffset
        : compiledLayer.slot === 'base'
          ? LAYER_STACK.baseFillOffset
          : compiledLayer.slot === 'thematic'
            ? LAYER_STACK.thematicFillOffset
            : LAYER_STACK.symbolOffset + orderIndex * 0.00002
      const inst = createFillLayerFromRegistry(compiledLayer, this.registry, state.climateMonth, {
        renderOrder,
        surfaceOffset,
        reader: this.reader,
        tracker: this.tracker,
      })
      if (!inst)
        return null
      const entry: ManagedRuntimeLayer = { type: 'fill', compiled: compiledLayer, instance: inst, isMonthly }
      this.runtimeLayers.set(compiledLayer.id, entry)
      this.layerGroup.add(inst.mesh)
      return entry
    }

    if (compiledLayer.type === 'line') {
      const placement = globeLinePlacement(compiledLayer.source, orderIndex)
      const inst = createLineLayerFromRegistry(compiledLayer, this.registry, state.climateMonth, {
        renderOrder,
        surfaceOffset: placement.surfaceOffset,
        polygonOffsetFactor: placement.polygonOffsetFactor,
        polygonOffsetUnits: placement.polygonOffsetUnits,
        tracker: this.tracker,
      })
      if (!inst)
        return null
      inst.setViewport(this.viewportWidth, this.viewportHeight, this.pixelRatio)
      const entry: ManagedRuntimeLayer = { type: 'line', compiled: compiledLayer, instance: inst, isMonthly }
      this.runtimeLayers.set(compiledLayer.id, entry)
      this.layerGroup.add(inst.mesh)
      return entry
    }

    if (compiledLayer.type === 'circle') {
      const inst = createCircleLayerFromRegistry(compiledLayer, this.registry, state.climateMonth, {
        renderOrder,
        surfaceOffset: LAYER_STACK.circleOffset + orderIndex * 0.00002,
        tracker: this.tracker,
      })
      if (!inst)
        return null
      inst.setViewport(this.viewportWidth, this.viewportHeight, this.pixelRatio)
      const entry: ManagedRuntimeLayer = { type: 'circle', compiled: compiledLayer, instance: inst, isMonthly }
      this.runtimeLayers.set(compiledLayer.id, entry)
      this.layerGroup.add(inst.mesh)
      return entry
    }

    if (compiledLayer.type === 'symbol') {
      const inst = createSymbolLayerFromRegistry(compiledLayer, this.registry, state.climateMonth, {
        renderOrder,
        surfaceOffset: LAYER_STACK.symbolOffset + orderIndex * 0.00002,
        tracker: this.tracker,
      })
      if (!inst)
        return null
      inst.setViewport(this.viewportWidth, this.viewportHeight, this.pixelRatio)
      const entry: ManagedRuntimeLayer = { type: 'symbol', compiled: compiledLayer, instance: inst, isMonthly }
      this.runtimeLayers.set(compiledLayer.id, entry)
      this.layerGroup.add(inst.mesh)
      return entry
    }

    return null
  }

  syncVisualState(): void {
    if (this.disposed || !this.compiledStyle)
      return

    const state = this.filterState
    const styleZoom = this.getStyleZoom()
    const sunDirection = computeSunDirectionForMonth(
      state.climateMonth,
      this.reader.planet.axialTiltDegrees,
    )

    if (this.controls) {
      const altitude = Math.max(0.1, this.camera.position.length() - 1.0)
      this.controls.rotateSpeed = Math.max(0.15, Math.min(0.75, altitude * 0.35))
    }

    this.atmosphere.visible = state.globeEffects.atmosphere
    const isSatelliteStyle = this.compiledStyle.id === 'satellite' && state.activeThematicId === null
    this.oceanSpecular.visible = isSatelliteStyle && state.globeEffects.atmosphere && state.globeEffects.dayNight
    const defaultSunDir = new THREE.Vector3(1.8, 1.2, 2.2).normalize()
    const activeSunDir = state.globeEffects.dayNight ? sunDirection : defaultSunDir
    this.oceanSpecular.material.uniforms.uSunDirection.value.copy(activeSunDir)
    this.oceanSpecular.material.uniforms.uDayNightEnabled.value = state.globeEffects.dayNight ? 1 : 0
    this.oceanSpecular.material.uniforms.uPolarIce.value = isSatelliteStyle && state.globeEffects.polarIce ? 1 : 0

    this.collisionGrid.clear()

    this.compiledStyle.layers.forEach((compiledLayer, index) => {
      const enabled = this.isLayerSlotEnabled(compiledLayer, state)
      let runtime = this.runtimeLayers.get(compiledLayer.id) ?? null
      if (enabled && !runtime) {
        runtime = this.ensureLayerConstructed(compiledLayer, index, state)
      }
      if (!runtime)
        return

      if (!enabled) {
        runtime.instance.mesh.visible = false
        return
      }

      if (runtime.type === 'raster') {
        runtime.instance.updateStyleAndSource(
          compiledLayer,
          this.registry,
          styleZoom,
          state.climateMonth,
          this.compiledStyle!.id,
          state.globeEffects.polarIce,
        )
        runtime.instance.setLighting(state.globeEffects.dayNight, activeSunDir)
      }
      else if (runtime.type === 'fill') {
        runtime.instance.updateStyle(compiledLayer, styleZoom)
        runtime.instance.setLighting(state.globeEffects.dayNight, activeSunDir)
      }
      else if (runtime.type === 'line') {
        runtime.instance.updateStyle(compiledLayer, styleZoom)
        if (compiledLayer.source === 'river-centerlines')
          runtime.instance.setLighting(state.globeEffects.dayNight, activeSunDir)
      }
      else if (runtime.type === 'circle') {
        runtime.instance.updateStyle(compiledLayer, styleZoom)
      }
      else if (runtime.type === 'symbol') {
        runtime.instance.updateStyle(compiledLayer, styleZoom)
        runtime.instance.updatePlacement(this.camera, this.collisionGrid, this.spinRadians)
      }
    })

    this.selectionLayer.updateSelection(state.selection, this.registry, state.climateMonth)
  }

  updateFrame(nowMs = performance.now()): void {
    if (this.disposed)
      return
    const elapsedMs = this.lastFrameMs > 0 ? Math.min(100, Math.max(0, nowMs - this.lastFrameMs)) : 0
    this.lastFrameMs = nowMs
    if (this.filterState.globeEffects.rotate && elapsedMs > 0) {
      const speed = this.filterState.globeEffects.rotateSpeedDegreesPerSecond
      this.spinRadians += planetSpinStepRadians(elapsedMs, speed)
      this.planetGroup.rotation.y = this.spinRadians
    }
    this.controls?.update()
    this.syncVisualState()
  }

  /** Current eastward spin of the planet around its polar axis, in radians. */
  getPlanetSpinRadians(): number {
    return this.spinRadians
  }

  worldDirectionToPlanet(direction: Vec3Tuple): Vec3Tuple {
    return rotateAroundPolarAxis(direction, -this.spinRadians)
  }

  planetDirectionToWorld(direction: Vec3Tuple): Vec3Tuple {
    return rotateAroundPolarAxis(direction, this.spinRadians)
  }

  getPickableLayersInStyleOrder(): PickableMapLayer[] {
    if (!this.compiledStyle)
      return []
    const out: PickableMapLayer[] = []
    for (const compiledLayer of this.compiledStyle.layers) {
      const runtime = this.runtimeLayers.get(compiledLayer.id)
      if (!runtime || !runtime.instance.mesh.visible)
        continue
      if (runtime.type === 'circle') {
        out.push({ kind: 'circle', layer: runtime.instance })
      }
      else if (runtime.type === 'symbol') {
        out.push({ kind: 'symbol', layer: runtime.instance })
      }
      else if (runtime.type === 'line') {
        out.push({ kind: 'line', layer: runtime.instance })
      }
      else if (runtime.type === 'fill' && runtime.instance.interactive) {
        out.push({ kind: 'fill', layer: runtime.instance })
      }
    }
    return out
  }

  getLayerInstance(layerId: string): RasterLayer | FillLayer | LineLayer | CircleLayer | SymbolLayer | undefined {
    return this.runtimeLayers.get(layerId)?.instance
  }

  refreshSymbolGlyphAtlases(): void {
    if (this.disposed)
      return
    for (const entry of this.runtimeLayers.values()) {
      if (entry.type === 'symbol') {
        entry.instance.rebuildGlyphAtlas()
      }
    }
  }

  dispose(): void {
    if (this.disposed)
      return
    this.disposed = true
    this.controls?.dispose()

    for (const entry of this.runtimeLayers.values()) {
      entry.instance.dispose()
    }
    this.runtimeLayers.clear()
    this.layerGroup.clear()

    this.selectionLayer.dispose()
    this.planetGroup.clear()
    this.stars.geometry.dispose()
    this.stars.material.dispose()
    this.releaseStyleBackground()
    this.styleBackground.material.dispose()
    this.oceanSpecular.geometry.dispose()
    this.oceanSpecular.material.dispose()
    this.atmosphere.geometry.dispose()
    this.atmosphere.material.dispose()
    this.scene.clear()
  }
}
