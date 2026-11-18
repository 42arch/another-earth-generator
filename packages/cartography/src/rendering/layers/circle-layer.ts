import type { MapProjection } from '#projections/map-projections'
import type { LonLatTuple } from '#projections/spherical-math'
import type { GpuResourceTracker } from '#rendering/gpu-resource-tracker'
import type { MapSourceRegistry } from '#sources/registry'
import type { GeoJsonFeature, GeoJsonSource } from '#sources/types'
import type { CompiledMapStyleLayer } from '#styles/compiler'
import * as THREE from 'three'
import { lonLatDegToCartesian, rotateAroundPolarAxis } from '#projections/spherical-math'
import { parseCssColorToRgba8 } from '#rendering/satellite-shader'

export type CircleSymbolShape = 'circle' | 'double-ring' | 'star' | 'diamond' | 'triangle'

const SHAPE_ENUM_BY_NAME: Readonly<Record<CircleSymbolShape, number>> = {
  'circle': 0,
  'double-ring': 1,
  'star': 2,
  'diamond': 3,
  'triangle': 4,
}

const CIRCLE_VERTEX_SHADER = /* glsl */`
  attribute vec3 instancePosition;
  attribute vec3 instanceNormal;
  attribute vec4 instanceColor;
  attribute vec4 instanceStrokeColor;
  attribute vec3 instanceMetrics; // x: radiusPx, y: strokeWidthPx, z: symbolShape

  uniform vec2 uViewportPx;
  uniform float uPixelRatio;
  uniform float uIsGlobe;

  varying vec2 vLocalUv;
  varying vec4 vFillColor;
  varying vec4 vStrokeColor;
  varying float vRadiusPx;
  varying float vStrokeWidthPx;
  varying float vSymbolShape;
  varying float vHorizonAlpha;

  void main() {
    vLocalUv = position.xy * 2.0; // [-1, 1]
    vFillColor = instanceColor;
    vStrokeColor = instanceStrokeColor;
    vRadiusPx = instanceMetrics.x * uPixelRatio;
    vStrokeWidthPx = instanceMetrics.y * uPixelRatio;
    vSymbolShape = instanceMetrics.z;

    if (vFillColor.a <= 0.002 && vStrokeColor.a <= 0.002) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vHorizonAlpha = 0.0;
      return;
    }

    vec3 worldPos = (modelMatrix * vec4(instancePosition, 1.0)).xyz;
    vec3 worldNormal = normalize((modelMatrix * vec4(instanceNormal, 0.0)).xyz);

    if (uIsGlobe > 0.5) {
      vec3 toCam = normalize(cameraPosition - worldPos);
      float ndotv = dot(worldNormal, toCam);
      if (ndotv <= 0.06) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        vHorizonAlpha = 0.0;
        return;
      }
      vHorizonAlpha = smoothstep(0.06, 0.22, ndotv);
    } else {
      vHorizonAlpha = 1.0;
    }

    vec4 clipCenter = projectionMatrix * modelViewMatrix * vec4(instancePosition, 1.0);
    float totalHalfExtentPx = vRadiusPx + vStrokeWidthPx + 2.0;
    vec2 halfViewport = max(uViewportPx * 0.5, vec2(1.0));
    vec2 ndcOffset = (vLocalUv * totalHalfExtentPx) / halfViewport;
    gl_Position = vec4(clipCenter.xy + ndcOffset * clipCenter.w, clipCenter.z, clipCenter.w);
  }
`

const CIRCLE_FRAGMENT_SHADER = /* glsl */`
  varying vec2 vLocalUv;
  varying vec4 vFillColor;
  varying vec4 vStrokeColor;
  varying float vRadiusPx;
  varying float vStrokeWidthPx;
  varying float vSymbolShape;
  varying float vHorizonAlpha;

  float sdEquilateralTriangle(vec2 p, float r) {
    const float k = 1.7320508;
    p.x = abs(p.x) - r;
    p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) {
      p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    }
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
  }

  float sdStar5(vec2 p, float r, float rf) {
    const vec2 k1 = vec2(0.809016994375, -0.587785252292);
    const vec2 k2 = vec2(-k1.x, k1.y);
    p.x = abs(p.x);
    p -= 2.0 * max(dot(k1, p), 0.0) * k1;
    p -= 2.0 * max(dot(k2, p), 0.0) * k2;
    p.x = abs(p.x);
    p.y -= r;
    vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
    float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
    return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
  }

  void main() {
    if (vHorizonAlpha <= 0.002) {
      discard;
    }

    float totalHalfExtentPx = vRadiusPx + vStrokeWidthPx + 2.0;
    vec2 pxCoord = vLocalUv * totalHalfExtentPx;
    int shape = int(floor(vSymbolShape + 0.5));
    float sdfPx = length(pxCoord) - vRadiusPx;

    if (shape == 1) {
      float outerRing = abs(length(pxCoord) - vRadiusPx * 0.92) - max(1.0, vRadiusPx * 0.16);
      float innerDisk = length(pxCoord) - vRadiusPx * 0.45;
      sdfPx = min(outerRing, innerDisk);
    } else if (shape == 2) {
      sdfPx = sdStar5(pxCoord, vRadiusPx, 0.44);
    } else if (shape == 3) {
      sdfPx = (abs(pxCoord.x) + abs(pxCoord.y)) / 1.41421356 - vRadiusPx * 0.78;
    } else if (shape == 4) {
      sdfPx = sdEquilateralTriangle(pxCoord, vRadiusPx * 0.85);
    }

    float aa = 1.1;
    float fillMask = 1.0 - smoothstep(-aa, aa, sdfPx);
    float strokeMask = vStrokeWidthPx > 0.05
      ? (1.0 - smoothstep(vStrokeWidthPx - aa, vStrokeWidthPx + aa, abs(sdfPx)))
      : 0.0;

    vec4 combined = mix(vFillColor * vec4(1.0, 1.0, 1.0, fillMask), vStrokeColor, strokeMask);
    combined.a *= vHorizonAlpha;
    if (combined.a <= 0.01) {
      discard;
    }

    gl_FragColor = combined;
  }
`

export interface CircleLayerOptions {
  readonly renderOrder?: number
  readonly surfaceOffset?: number
  readonly projection?: MapProjection
  readonly tracker?: GpuResourceTracker
}

interface IndexedCircleInstance {
  readonly feature: GeoJsonFeature
  readonly position: readonly [number, number, number]
  readonly normal: readonly [number, number, number]
}

/**
 * Batched GPU `CircleLayer` renderer:
 * - Single 4-vertex quad `THREE.InstancedBufferGeometry` (bypasses hardware `gl_PointSize` ceiling).
 * - Supports 5 analytical SDF symbol shapes (`circle`, `double-ring`, `star`, `diamond`, `triangle`).
 * - Performs 3D globe backface hiding (`dot(instanceNormal, viewDir) <= 0.06`) with horizon fade.
 */
export class CircleLayer {
  readonly id: string
  readonly sourceId: string
  readonly isGlobe: boolean
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
  readonly instanceCount: number

  private readonly instances: IndexedCircleInstance[] = []
  private readonly colorAttr: THREE.InstancedBufferAttribute
  private readonly strokeColorAttr: THREE.InstancedBufferAttribute
  private readonly metricsAttr: THREE.InstancedBufferAttribute
  private readonly radiusByInstance: Float32Array
  private readonly visibleByInstance: Uint8Array
  private disposed = false

  constructor(
    compiledLayer: CompiledMapStyleLayer,
    source: GeoJsonSource,
    options: CircleLayerOptions = {},
  ) {
    this.id = compiledLayer.id
    this.sourceId = compiledLayer.source
    this.isGlobe = !options.projection

    const surfaceOffset = options.surfaceOffset ?? 0.0032
    const radius = 1.0 + surfaceOffset

    for (const feature of source.data.features) {
      const points: LonLatTuple[] = feature.geometry.type === 'Point'
        ? [feature.geometry.coordinates]
        : []
      for (const [lon, lat] of points) {
        if (options.projection) {
          const [px, py] = options.projection.project(lon, lat)
          this.instances.push({
            feature,
            position: [px, py, surfaceOffset],
            normal: [0, 0, 1],
          })
        }
        else {
          const normal = lonLatDegToCartesian(lon, lat)
          this.instances.push({
            feature,
            position: [normal[0] * radius, normal[1] * radius, normal[2] * radius],
            normal,
          })
        }
      }
    }

    this.instanceCount = this.instances.length
    const allocCount = Math.max(1, this.instanceCount)
    this.radiusByInstance = new Float32Array(allocCount)
    this.visibleByInstance = new Uint8Array(allocCount)

    const quadPositions = new Float32Array([
      -0.5,
      -0.5,
      0,
      0.5,
      -0.5,
      0,
      0.5,
      0.5,
      0,
      -0.5,
      0.5,
      0,
    ])
    const quadIndices = new Uint16Array([0, 1, 2, 0, 2, 3])

    const instPositions = new Float32Array(allocCount * 3)
    const instNormals = new Float32Array(allocCount * 3)
    for (let i = 0; i < this.instanceCount; i++) {
      const inst = this.instances[i]
      const i3 = i * 3
      instPositions[i3] = inst.position[0]
      instPositions[i3 + 1] = inst.position[1]
      instPositions[i3 + 2] = inst.position[2]
      instNormals[i3] = inst.normal[0]
      instNormals[i3 + 1] = inst.normal[1]
      instNormals[i3 + 2] = inst.normal[2]
    }

    const geometry = new THREE.InstancedBufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(quadPositions, 3))
    geometry.setIndex(new THREE.BufferAttribute(quadIndices, 1))
    geometry.setAttribute('instancePosition', new THREE.InstancedBufferAttribute(instPositions, 3))
    geometry.setAttribute('instanceNormal', new THREE.InstancedBufferAttribute(instNormals, 3))

    this.colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(allocCount * 4), 4)
    this.strokeColorAttr = new THREE.InstancedBufferAttribute(new Float32Array(allocCount * 4), 4)
    this.metricsAttr = new THREE.InstancedBufferAttribute(new Float32Array(allocCount * 3), 3)

    geometry.setAttribute('instanceColor', this.colorAttr)
    geometry.setAttribute('instanceStrokeColor', this.strokeColorAttr)
    geometry.setAttribute('instanceMetrics', this.metricsAttr)
    geometry.instanceCount = this.instanceCount
    const boundRadius = options.projection
      ? Math.hypot(options.projection.worldWidth, options.projection.worldHeight)
      : radius + 0.05
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), boundRadius)
    options.tracker?.trackGeometry(geometry)

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uViewportPx: { value: new THREE.Vector2(1280, 720) },
        uPixelRatio: { value: 1 },
        uIsGlobe: { value: this.isGlobe ? 1 : 0 },
      },
      vertexShader: CIRCLE_VERTEX_SHADER,
      fragmentShader: CIRCLE_FRAGMENT_SHADER,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    options.tracker?.trackMaterial(material)

    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.name = `CircleLayer:${this.id}`
    this.mesh.renderOrder = options.renderOrder ?? 6
    this.mesh.frustumCulled = false
  }

  setViewport(widthCssPx: number, heightCssPx: number, pixelRatio = 1): void {
    if (this.disposed)
      return
    const dpr = Math.min(Math.max(1, pixelRatio), 2)
    this.mesh.material.uniforms.uViewportPx.value.set(
      Math.max(1, widthCssPx * dpr),
      Math.max(1, heightCssPx * dpr),
    )
    this.mesh.material.uniforms.uPixelRatio.value = dpr
  }

  updateStyle(compiledLayer: CompiledMapStyleLayer, styleZoom: number): void {
    if (this.disposed)
      return

    const layoutVis = compiledLayer.layout.visibility?.evaluate({ zoom: styleZoom })
    this.mesh.visible = styleZoom >= compiledLayer.minzoom && styleZoom <= compiledLayer.maxzoom && layoutVis !== 'none'
    if (!this.mesh.visible)
      return

    const colorExpr = compiledLayer.paint['circle-color']
    const radiusExpr = compiledLayer.paint['circle-radius']
    const opacityExpr = compiledLayer.paint['circle-opacity']
    const strokeColorExpr = compiledLayer.paint['circle-stroke-color']
    const strokeWidthExpr = compiledLayer.paint['circle-stroke-width']
    const shapeExpr = compiledLayer.layout['symbol-shape'] ?? compiledLayer.paint['circle-shape']
    const filterExpr = compiledLayer.filter

    for (let i = 0; i < this.instanceCount; i++) {
      const { feature } = this.instances[i]
      const props = feature.properties
      const evalInput = { zoom: styleZoom, properties: props }

      if (filterExpr && !filterExpr.evaluate(evalInput)) {
        this.colorAttr.setXYZW(i, 0, 0, 0, 0)
        this.strokeColorAttr.setXYZW(i, 0, 0, 0, 0)
        this.metricsAttr.setXYZ(i, 0, 0, 0)
        this.visibleByInstance[i] = 0
        continue
      }

      const opacity = opacityExpr ? Number(opacityExpr.evaluate(evalInput) ?? 1) : 1
      const radiusPx = radiusExpr ? Number(radiusExpr.evaluate(evalInput) ?? 4) : 4
      if (opacity <= 0.002 || radiusPx <= 0.05) {
        this.colorAttr.setXYZW(i, 0, 0, 0, 0)
        this.strokeColorAttr.setXYZW(i, 0, 0, 0, 0)
        this.metricsAttr.setXYZ(i, 0, 0, 0)
        this.visibleByInstance[i] = 0
        continue
      }

      const rawColor = colorExpr ? String(colorExpr.evaluate(evalInput) ?? '#ffae59') : '#ffae59'
      const [cr, cg, cb, ca] = parseCssColorToRgba8(rawColor)
      const strokeRaw = strokeColorExpr ? String(strokeColorExpr.evaluate(evalInput) ?? '#000000') : '#000000'
      const [sr, sg, sb, sa] = parseCssColorToRgba8(strokeRaw)
      const strokeWidthPx = strokeWidthExpr ? Number(strokeWidthExpr.evaluate(evalInput) ?? 0) : 0
      const rawShape = String(shapeExpr?.evaluate(evalInput) ?? props.symbolShape ?? 'circle') as CircleSymbolShape
      const shapeEnum = SHAPE_ENUM_BY_NAME[rawShape] ?? 0

      this.colorAttr.setXYZW(i, cr / 255, cg / 255, cb / 255, (ca / 255) * opacity)
      this.strokeColorAttr.setXYZW(i, sr / 255, sg / 255, sb / 255, (sa / 255) * opacity)
      this.metricsAttr.setXYZ(i, radiusPx, strokeWidthPx, shapeEnum)
      this.radiusByInstance[i] = radiusPx
      this.visibleByInstance[i] = 1
    }

    this.colorAttr.needsUpdate = true
    this.strokeColorAttr.needsUpdate = true
    this.metricsAttr.needsUpdate = true
  }

  pickScreenPoint(
    screenX: number,
    screenY: number,
    viewportWidth: number,
    viewportHeight: number,
    camera: THREE.Camera,
    hitTolerancePx = 6,
    worldOffsetsX: readonly number[] = [0],
    planetSpinRadians = 0,
  ): { layerId: string, sourceId: string, featureId: string, distancePx: number } | null {
    if (this.disposed || !this.mesh.visible)
      return null

    const proj = new THREE.Vector3()
    const camPos = camera.position
    let bestHit: { layerId: string, sourceId: string, featureId: string, distancePx: number } | null = null
    let bestDistSq = Infinity

    for (let i = 0; i < this.instanceCount; i++) {
      if (!this.visibleByInstance[i])
        continue
      const inst = this.instances[i]
      const spun = this.isGlobe ? rotateAroundPolarAxis(inst.position, planetSpinRadians) : inst.position
      const spunNormal = this.isGlobe ? rotateAroundPolarAxis(inst.normal, planetSpinRadians) : inst.normal
      if (this.isGlobe) {
        const toCamX = camPos.x - spun[0]
        const toCamY = camPos.y - spun[1]
        const toCamZ = camPos.z - spun[2]
        const toCamLen = Math.hypot(toCamX, toCamY, toCamZ) || 1
        const ndotv = (spunNormal[0] * toCamX + spunNormal[1] * toCamY + spunNormal[2] * toCamZ) / toCamLen
        if (ndotv <= 0.06)
          continue
      }

      const maxDist = this.radiusByInstance[i] + hitTolerancePx
      const maxDistSq = maxDist * maxDist

      for (const offsetX of worldOffsetsX) {
        proj.set(spun[0] + offsetX, spun[1], spun[2]).project(camera)
        if (proj.z < -1 || proj.z > 1)
          continue

        const sx = (proj.x + 1) * 0.5 * viewportWidth
        const sy = (1 - proj.y) * 0.5 * viewportHeight
        const dx = screenX - sx
        const dy = screenY - sy
        const distSq = dx * dx + dy * dy
        if (distSq <= maxDistSq && distSq < bestDistSq) {
          bestDistSq = distSq
          bestHit = {
            layerId: this.id,
            sourceId: this.sourceId,
            featureId: inst.feature.id,
            distancePx: Math.sqrt(distSq),
          }
        }
      }
    }

    return bestHit
  }

  dispose(): void {
    if (this.disposed)
      return
    this.disposed = true
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}

export function createCircleLayerFromRegistry(
  compiledLayer: CompiledMapStyleLayer,
  registry: MapSourceRegistry,
  month: number,
  options: CircleLayerOptions = {},
): CircleLayer | null {
  const source = registry.getSource(compiledLayer.source, { month })
  if (source.unavailable || source.kind !== 'geojson')
    return null
  return new CircleLayer(compiledLayer, source, options)
}
