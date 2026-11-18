import type { MapProjection } from '#projections/map-projections'
import type { LonLatTuple, Vec3Tuple } from '#projections/spherical-math'
import type { GpuResourceTracker } from '#rendering/gpu-resource-tracker'
import type { MapSourceRegistry } from '#sources/registry'
import type { GeoJsonFeature, GeoJsonSource } from '#sources/types'
import type { CompiledMapStyleLayer } from '#styles/compiler'
import { clipPolylineAtAntimeridian } from '#projections/seam-clipper'
import { lonLatDegToCartesian, rotateAroundPolarAxis, slerpVec3, sphericalAngleRad } from '#projections/spherical-math'
import { parseCssColorToRgba8 } from '#rendering/satellite-shader'
import * as THREE from 'three'

export type GeoJsonLineCoordinates = readonly LonLatTuple[]

export const LINE_MITER_LIMIT = 2.5
export const MAX_LINE_SEGMENT_ARC_RAD = 0.03

export interface PolylineRibbonData {
  readonly prevPositions: Float32Array
  readonly currPositions: Float32Array
  readonly nextPositions: Float32Array
  readonly sides: Float32Array
  readonly lineDistances: Float32Array
  readonly featureIndices: Float32Array
  readonly indices: Uint32Array
  readonly vertexCount: number
}

function sampleSphericalPolyline(
  coordinates: GeoJsonLineCoordinates,
  radius: number,
  maxSegmentArcRad = MAX_LINE_SEGMENT_ARC_RAD,
): { points: Vec3Tuple[], cumulativeDistances: number[] } {
  const unitPoints: Vec3Tuple[] = []
  for (let i = 0; i < coordinates.length; i++) {
    const [lon, lat] = coordinates[i]
    const pt = lonLatDegToCartesian(lon, lat)
    const prev = unitPoints.at(-1)
    if (!prev || sphericalAngleRad(prev, pt) > 1e-6) {
      unitPoints.push(pt)
    }
  }
  if (unitPoints.length < 2) {
    return { points: [], cumulativeDistances: [] }
  }

  const sampled: Vec3Tuple[] = []
  const distances: number[] = []
  let totalDist = 0

  for (let i = 0; i < unitPoints.length - 1; i++) {
    const a = unitPoints[i]
    const b = unitPoints[i + 1]
    const arc = sphericalAngleRad(a, b)
    const steps = Math.max(1, Math.ceil(arc / maxSegmentArcRad))
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      const p = slerpVec3(a, b, t)
      const scaled: Vec3Tuple = [p[0] * radius, p[1] * radius, p[2] * radius]
      if (sampled.length > 0) {
        const prev = sampled.at(-1)!
        totalDist += Math.hypot(scaled[0] - prev[0], scaled[1] - prev[1], scaled[2] - prev[2])
      }
      sampled.push(scaled)
      distances.push(totalDist)
    }
  }

  const last = unitPoints.at(-1)!
  const lastScaled: Vec3Tuple = [last[0] * radius, last[1] * radius, last[2] * radius]
  if (sampled.length > 0) {
    const prev = sampled.at(-1)!
    totalDist += Math.hypot(lastScaled[0] - prev[0], lastScaled[1] - prev[1], lastScaled[2] - prev[2])
  }
  sampled.push(lastScaled)
  distances.push(totalDist)

  return { points: sampled, cumulativeDistances: distances }
}

function sampleAtlasClippedPolylines(
  coordinates: GeoJsonLineCoordinates,
  projection: MapProjection,
  zOffset: number,
  initialDistanceRad = 0,
  maxSegmentDeg = 2.0,
): {
  segments: { points: Vec3Tuple[], cumulativeDistances: number[] }[]
  endDistanceRad: number
} {
  const clipped = clipPolylineAtAntimeridian(coordinates, initialDistanceRad)
  if (clipped.length === 0) {
    return { segments: [], endDistanceRad: initialDistanceRad }
  }

  const segments: { points: Vec3Tuple[], cumulativeDistances: number[] }[] = []
  let endDistanceRad = initialDistanceRad

  for (const seg of clipped) {
    const pts: Vec3Tuple[] = []
    const dists: number[] = []
    const coords = seg.coordinates
    const rawDists = seg.cumulativeDistances

    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i]
      const b = coords[i + 1]
      const d0 = rawDists[i]
      const d1 = rawDists[i + 1]
      const spanDeg = Math.hypot(b[0] - a[0], b[1] - a[1])
      const steps = Math.max(1, Math.ceil(spanDeg / maxSegmentDeg))
      for (let s = 0; s < steps; s++) {
        const t = s / steps
        const lon = a[0] + (b[0] - a[0]) * t
        const lat = a[1] + (b[1] - a[1]) * t
        const [px, py] = projection.project(lon, lat)
        pts.push([px, py, zOffset])
        dists.push(d0 + (d1 - d0) * t)
      }
    }

    const lastCoord = coords.at(-1)!
    const [lastX, lastY] = projection.project(lastCoord[0], lastCoord[1])
    pts.push([lastX, lastY, zOffset])
    const finalDist = rawDists.at(-1) ?? endDistanceRad
    dists.push(finalDist)
    endDistanceRad = finalDist

    if (pts.length >= 2) {
      segments.push({ points: pts, cumulativeDistances: dists })
    }
  }

  return { segments, endDistanceRad }
}

/**
 * Builds continuous polyline screen-space Miter/Bevel ribbon attributes:
 * - Each polyline node emits 2 vertices (`side = -1` and `side = +1`) sharing identical `currPosition`,
 *   `prevPosition`, `nextPosition`, and monotonic `lineDistance` (zero gap at corners, continuous dash phase).
 * - Closed loops wrap `prevPosition[0]` and `nextPosition[n-1]` so the closing joint also miters seamlessly.
 */
export function buildPolylineRibbonAttributes(
  polylines: readonly {
    readonly points: readonly Vec3Tuple[]
    readonly cumulativeDistances: readonly number[]
    readonly featureIndex: number
  }[],
): PolylineRibbonData {
  let totalNodes = 0
  let totalSegments = 0
  for (const line of polylines) {
    if (line.points.length >= 2) {
      totalNodes += line.points.length
      totalSegments += line.points.length - 1
    }
  }

  const vertexCount = totalNodes * 2
  const prevPositions = new Float32Array(vertexCount * 3)
  const currPositions = new Float32Array(vertexCount * 3)
  const nextPositions = new Float32Array(vertexCount * 3)
  const sides = new Float32Array(vertexCount)
  const lineDistances = new Float32Array(vertexCount)
  const featureIndices = new Float32Array(vertexCount)
  const indices = new Uint32Array(totalSegments * 6)

  let vCursor = 0
  let iCursor = 0

  for (const line of polylines) {
    const pts = line.points
    const dists = line.cumulativeDistances
    const n = pts.length
    if (n < 2)
      continue

    const first = pts[0]
    const last = pts[n - 1]
    const isClosed = n >= 4 && Math.hypot(first[0] - last[0], first[1] - last[1], first[2] - last[2]) < 1e-5
    const baseVertex = vCursor

    for (let i = 0; i < n; i++) {
      const curr = pts[i]
      let prev: Vec3Tuple
      let next: Vec3Tuple

      if (i === 0) {
        prev = isClosed
          ? pts[n - 2]
          : [
              curr[0] * 2 - pts[1][0],
              curr[1] * 2 - pts[1][1],
              curr[2] * 2 - pts[1][2],
            ]
      }
      else {
        prev = pts[i - 1]
      }

      if (i === n - 1) {
        next = isClosed
          ? pts[1]
          : [
              curr[0] * 2 - pts[n - 2][0],
              curr[1] * 2 - pts[n - 2][1],
              curr[2] * 2 - pts[n - 2][2],
            ]
      }
      else {
        next = pts[i + 1]
      }

      const dist = dists[i] ?? 0
      for (const side of [-1, 1] as const) {
        const v3 = vCursor * 3
        prevPositions[v3] = prev[0]
        prevPositions[v3 + 1] = prev[1]
        prevPositions[v3 + 2] = prev[2]

        currPositions[v3] = curr[0]
        currPositions[v3 + 1] = curr[1]
        currPositions[v3 + 2] = curr[2]

        nextPositions[v3] = next[0]
        nextPositions[v3 + 1] = next[1]
        nextPositions[v3 + 2] = next[2]

        sides[vCursor] = side
        lineDistances[vCursor] = dist
        featureIndices[vCursor] = line.featureIndex
        vCursor++
      }
    }

    for (let i = 0; i < n - 1; i++) {
      const v0 = baseVertex + i * 2
      const v1 = v0 + 1
      const v2 = v0 + 2
      const v3 = v0 + 3
      indices[iCursor++] = v0
      indices[iCursor++] = v2
      indices[iCursor++] = v1
      indices[iCursor++] = v1
      indices[iCursor++] = v2
      indices[iCursor++] = v3
    }
  }

  return {
    prevPositions,
    currPositions,
    nextPositions,
    sides,
    lineDistances,
    featureIndices,
    indices,
    vertexCount,
  }
}

/**
 * Computes screen-space Miter join offset in pixels with `miterLimit = 2.5` (matching the Vertex Shader).
 */
export function computeScreenMiterOffset(
  prevScreenPx: readonly [number, number],
  currScreenPx: readonly [number, number],
  nextScreenPx: readonly [number, number],
  side: -1 | 1,
  halfWidthPx: number,
  miterLimit = LINE_MITER_LIMIT,
): [number, number] {
  let dx0 = currScreenPx[0] - prevScreenPx[0]
  let dy0 = currScreenPx[1] - prevScreenPx[1]
  const len0 = Math.hypot(dx0, dy0)
  let dx1 = nextScreenPx[0] - currScreenPx[0]
  let dy1 = nextScreenPx[1] - currScreenPx[1]
  const len1 = Math.hypot(dx1, dy1)

  if (len0 < 1e-5 && len1 < 1e-5) {
    return [0, side * halfWidthPx]
  }
  if (len0 < 1e-5) {
    dx0 = dx1 / len1
    dy0 = dy1 / len1
  }
  else {
    dx0 /= len0
    dy0 /= len0
  }
  if (len1 < 1e-5) {
    dx1 = dx0
    dy1 = dy0
  }
  else {
    dx1 /= len1
    dy1 /= len1
  }

  const n0x = -dy0
  const n0y = dx0
  const n1x = -dy1
  const n1y = dx1

  let mx = n0x + n1x
  let my = n0y + n1y
  const mLen = Math.hypot(mx, my)
  if (mLen < 1e-4) {
    return [n1x * side * halfWidthPx, n1y * side * halfWidthPx]
  }
  mx /= mLen
  my /= mLen

  const dot = mx * n1x + my * n1y
  const rawScale = dot > 1e-3 ? 1 / dot : miterLimit
  const clampedScale = Math.min(miterLimit, rawScale)
  return [
    mx * side * halfWidthPx * clampedScale,
    my * side * halfWidthPx * clampedScale,
  ]
}

const LINE_VERTEX_SHADER = /* glsl */`
  #if __VERSION__ >= 300
    #define FLAT_VARYING flat
  #else
    #define FLAT_VARYING
  #endif
  attribute vec3 aPrevPosition;
  attribute vec3 aNextPosition;
  attribute float aSide;
  attribute float aLineDistance;
  attribute float aFeatureIndex;

  uniform vec2 uViewportPx;
  uniform float uPixelRatio;
  uniform float uMiterLimit;
  uniform sampler2D uFeatureStyleTex;
  uniform int uStyleTexWidth;
  uniform int uStyleTexHeight;

  varying float vSide;
  varying float vLineDistance;
  varying float vHalfWidthPx;
  varying vec3 vWorldNormal;
  FLAT_VARYING varying float vDashOn;
  FLAT_VARYING varying float vDashOff;
  FLAT_VARYING varying vec4 vLineColor;

  vec4 fetchTexel(int featureIdx, int slotOffset) {
    int linearIdx = featureIdx * 2 + slotOffset;
    int col = linearIdx - (linearIdx / uStyleTexWidth) * uStyleTexWidth;
    int row = linearIdx / uStyleTexWidth;
    #if __VERSION__ >= 300
      return texelFetch(uFeatureStyleTex, ivec2(col, row), 0);
    #else
      vec2 uv = (vec2(float(col), float(row)) + 0.5) / vec2(float(uStyleTexWidth), float(uStyleTexHeight));
      return texture2D(uFeatureStyleTex, uv);
    #endif
  }

  void main() {
    int fIdx = int(floor(aFeatureIndex + 0.5));
    vec4 colorRgba = fetchTexel(fIdx, 0);
    vec4 metrics = fetchTexel(fIdx, 1);
    float widthCssPx = metrics.r * 25.5;
    vDashOn = metrics.g * 25.5;
    vDashOff = metrics.b * 25.5;
    vLineColor = colorRgba;
    vSide = aSide;
    vLineDistance = aLineDistance;
    vWorldNormal = normalize((modelMatrix * vec4(position, 0.0)).xyz);

    vec4 clipCurr = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec4 clipPrev = projectionMatrix * modelViewMatrix * vec4(aPrevPosition, 1.0);
    vec4 clipNext = projectionMatrix * modelViewMatrix * vec4(aNextPosition, 1.0);

    vec2 halfViewport = max(uViewportPx * 0.5, vec2(1.0));
    vec2 screenCurr = (clipCurr.xy / max(abs(clipCurr.w), 1e-5)) * halfViewport;
    vec2 screenPrev = (clipPrev.xy / max(abs(clipPrev.w), 1e-5)) * halfViewport;
    vec2 screenNext = (clipNext.xy / max(abs(clipNext.w), 1e-5)) * halfViewport;

    vec2 dir0 = screenCurr - screenPrev;
    vec2 dir1 = screenNext - screenCurr;
    float len0 = length(dir0);
    float len1 = length(dir1);
    dir0 = len0 > 1e-4 ? dir0 / len0 : (len1 > 1e-4 ? dir1 / len1 : vec2(1.0, 0.0));
    dir1 = len1 > 1e-4 ? dir1 / len1 : dir0;

    vec2 n0 = vec2(-dir0.y, dir0.x);
    vec2 n1 = vec2(-dir1.y, dir1.x);
    vec2 miter = n0 + n1;
    float miterLen = length(miter);
    miter = miterLen > 1e-4 ? miter / miterLen : n1;
    float denom = max(dot(miter, n1), 0.15);
    float miterScale = min(uMiterLimit, 1.0 / denom);

    float halfWidthPx = max(0.5, widthCssPx * 0.5 * uPixelRatio + 0.75);
    vHalfWidthPx = halfWidthPx;
    vec2 offsetPx = miter * (aSide * halfWidthPx * miterScale);
    vec2 ndcOffset = offsetPx / halfViewport;
    gl_Position = vec4(clipCurr.xy + ndcOffset * clipCurr.w, clipCurr.z, clipCurr.w);
  }
`

const LINE_FRAGMENT_SHADER = /* glsl */`
  #if __VERSION__ >= 300
    #define FLAT_VARYING flat
  #else
    #define FLAT_VARYING
  #endif
  uniform float uDayNightEnabled;
  uniform vec3 uSunDirection;

  varying float vSide;
  varying float vLineDistance;
  varying float vHalfWidthPx;
  varying vec3 vWorldNormal;
  FLAT_VARYING varying float vDashOn;
  FLAT_VARYING varying float vDashOff;
  FLAT_VARYING varying vec4 vLineColor;

  vec3 srgbToLinear(vec3 srgb) {
    return mix(srgb / 12.92, pow((srgb + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), srgb));
  }

  vec3 linearToSrgb(vec3 linear) {
    vec3 clamped = clamp(linear, 0.0, 1.0);
    return mix(clamped * 12.92, 1.055 * pow(clamped, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), clamped));
  }

  void main() {
    if (vLineColor.a <= 0.002) {
      discard;
    }

    if (vDashOn > 0.01 && vDashOff > 0.01) {
      float unitScale = 0.0045;
      float period = (vDashOn + vDashOff) * unitScale;
      float phase = mod(vLineDistance, period);
      if (phase > vDashOn * unitScale) {
        discard;
      }
    }

    float distRatio = abs(vSide);
    float aaWidth = max(fwidth(distRatio), 1.0 / max(vHalfWidthPx, 1.5));
    float edgeAlpha = 1.0 - smoothstep(1.0 - aaWidth, 1.0, distRatio);
    float alpha = vLineColor.a * edgeAlpha;
    if (alpha <= 0.01) {
      discard;
    }

    vec3 rgb = vLineColor.rgb;
    if (uDayNightEnabled > 0.5) {
      float dotNL = max(0.0, dot(normalize(vWorldNormal), normalize(uSunDirection)));
      vec3 ambientIrradiance = vec3(0.081, 0.130, 0.199) * 1.1;
      vec3 directIrradiance = vec3(1.0, 0.963, 0.871) * (4.0 * dotNL);
      vec3 lightFactor = (ambientIrradiance + directIrradiance) * 0.318309886;
      rgb = linearToSrgb(srgbToLinear(rgb) * lightFactor);
    }

    gl_FragColor = vec4(rgb, alpha);
  }
`

export interface LineLayerOptions {
  readonly renderOrder?: number
  readonly surfaceOffset?: number
  readonly projection?: MapProjection
  readonly tracker?: GpuResourceTracker
}

interface IndexedLineFeature {
  readonly feature: GeoJsonFeature
  readonly polylines: readonly (readonly Vec3Tuple[])[]
}

/**
 * Batched GPU `LineLayer` renderer:
 * - Merges all LineString / MultiLineString features into 1 `THREE.BufferGeometry`.
 * - Screen-space Miter/Bevel expansion (`miterLimit = 2.5`) with 1px `fwidth` analytical AA and `line-dasharray`.
 */
export class LineLayer {
  readonly id: string
  readonly sourceId: string
  readonly isGlobe: boolean
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  readonly styleTexture: THREE.DataTexture
  readonly styleBuffer: Uint8Array
  readonly styleTexWidth: number
  readonly styleTexHeight: number

  private readonly indexedFeatures: IndexedLineFeature[] = []
  private readonly widthByFeature: Float32Array
  private readonly visibleByFeature: Uint8Array
  private disposed = false

  constructor(
    compiledLayer: CompiledMapStyleLayer,
    source: GeoJsonSource,
    options: LineLayerOptions = {},
  ) {
    this.id = compiledLayer.id
    this.sourceId = compiledLayer.source
    this.isGlobe = !options.projection

    const surfaceOffset = options.surfaceOffset ?? 0.0022
    const radius = 1.0 + surfaceOffset
    const ribbonPolylines: {
      points: readonly Vec3Tuple[]
      cumulativeDistances: readonly number[]
      featureIndex: number
    }[] = []

    for (const feature of source.data.features) {
      const lines: GeoJsonLineCoordinates[] = feature.geometry.type === 'LineString'
        ? [feature.geometry.coordinates]
        : feature.geometry.type === 'MultiLineString'
          ? [...feature.geometry.coordinates]
          : []
      if (lines.length === 0)
        continue

      const featureIndex = this.indexedFeatures.length
      const sampledPolylines: Vec3Tuple[][] = []
      let cumulativeOffset = 0

      for (const coords of lines) {
        if (options.projection) {
          const { segments, endDistanceRad } = sampleAtlasClippedPolylines(
            coords,
            options.projection,
            surfaceOffset,
            cumulativeOffset,
          )
          cumulativeOffset = endDistanceRad
          for (const seg of segments) {
            sampledPolylines.push(seg.points)
            ribbonPolylines.push({
              points: seg.points,
              cumulativeDistances: seg.cumulativeDistances,
              featureIndex,
            })
          }
        }
        else {
          const { points, cumulativeDistances } = sampleSphericalPolyline(coords, radius)
          if (points.length < 2)
            continue
          const shiftedDistances = cumulativeDistances.map(d => d + cumulativeOffset)
          cumulativeOffset = shiftedDistances.at(-1) ?? cumulativeOffset
          sampledPolylines.push(points)
          ribbonPolylines.push({
            points,
            cumulativeDistances: shiftedDistances,
            featureIndex,
          })
        }
      }

      if (sampledPolylines.length > 0) {
        this.indexedFeatures.push({
          feature,
          polylines: sampledPolylines,
        })
      }
    }

    const ribbon = buildPolylineRibbonAttributes(ribbonPolylines)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(ribbon.currPositions, 3))
    geometry.setAttribute('aPrevPosition', new THREE.BufferAttribute(ribbon.prevPositions, 3))
    geometry.setAttribute('aNextPosition', new THREE.BufferAttribute(ribbon.nextPositions, 3))
    geometry.setAttribute('aSide', new THREE.BufferAttribute(ribbon.sides, 1))
    geometry.setAttribute('aLineDistance', new THREE.BufferAttribute(ribbon.lineDistances, 1))
    geometry.setAttribute('aFeatureIndex', new THREE.BufferAttribute(ribbon.featureIndices, 1))
    geometry.setIndex(new THREE.BufferAttribute(ribbon.indices, 1))
    const boundRadius = options.projection
      ? Math.hypot(options.projection.worldWidth, options.projection.worldHeight)
      : radius + 0.03
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), boundRadius)
    options.tracker?.trackGeometry(geometry)

    const featureCount = Math.max(1, this.indexedFeatures.length)
    this.widthByFeature = new Float32Array(featureCount)
    this.visibleByFeature = new Uint8Array(featureCount)

    const totalTexels = featureCount * 2
    this.styleTexWidth = Math.min(512, totalTexels)
    this.styleTexHeight = Math.max(1, Math.ceil(totalTexels / this.styleTexWidth))
    this.styleBuffer = new Uint8Array(this.styleTexWidth * this.styleTexHeight * 4)

    this.styleTexture = new THREE.DataTexture(
      this.styleBuffer,
      this.styleTexWidth,
      this.styleTexHeight,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    )
    this.styleTexture.minFilter = THREE.NearestFilter
    this.styleTexture.magFilter = THREE.NearestFilter
    this.styleTexture.generateMipmaps = false
    this.styleTexture.needsUpdate = true
    options.tracker?.trackTexture(this.styleTexture)

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uViewportPx: { value: new THREE.Vector2(1280, 720) },
        uPixelRatio: { value: 1 },
        uMiterLimit: { value: LINE_MITER_LIMIT },
        uFeatureStyleTex: { value: this.styleTexture },
        uStyleTexWidth: { value: this.styleTexWidth },
        uStyleTexHeight: { value: this.styleTexHeight },
        uDayNightEnabled: { value: 0 },
        uSunDirection: { value: new THREE.Vector3(0.6, 0.35, 0.72).normalize() },
      },
      vertexShader: LINE_VERTEX_SHADER,
      fragmentShader: LINE_FRAGMENT_SHADER,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    options.tracker?.trackMaterial(material)

    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.name = `LineLayer:${this.id}`
    this.mesh.renderOrder = options.renderOrder ?? 4
  }

  setLighting(dayNightEnabled: boolean, sunDirection: THREE.Vector3): void {
    if (this.disposed)
      return
    this.mesh.material.uniforms.uDayNightEnabled.value = dayNightEnabled ? 1 : 0
    this.mesh.material.uniforms.uSunDirection.value.copy(sunDirection).normalize()
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

    const colorExpr = compiledLayer.paint['line-color']
    const widthExpr = compiledLayer.paint['line-width']
    const opacityExpr = compiledLayer.paint['line-opacity']
    const dashExpr = compiledLayer.paint['line-dasharray']
    const filterExpr = compiledLayer.filter

    for (let i = 0; i < this.indexedFeatures.length; i++) {
      const { feature } = this.indexedFeatures[i]
      const evalInput = { zoom: styleZoom, properties: feature.properties }
      const colorOffset = i * 8
      const metricOffset = colorOffset + 4

      if (filterExpr && !filterExpr.evaluate(evalInput)) {
        this.styleBuffer.fill(0, colorOffset, colorOffset + 8)
        this.visibleByFeature[i] = 0
        continue
      }

      const opacity = opacityExpr ? Number(opacityExpr.evaluate(evalInput) ?? 1) : 1
      const width = widthExpr ? Number(widthExpr.evaluate(evalInput) ?? 1) : 1
      if (opacity <= 0.002 || width <= 0.01) {
        this.styleBuffer.fill(0, colorOffset, colorOffset + 8)
        this.visibleByFeature[i] = 0
        continue
      }

      const rawColor = colorExpr ? String(colorExpr.evaluate(evalInput) ?? '#ffffff') : '#ffffff'
      const [cr, cg, cb, ca] = parseCssColorToRgba8(rawColor)
      const finalAlpha = Math.max(0, Math.min(255, Math.round(opacity * ca)))

      let dashOn = 0
      let dashOff = 0
      if (dashExpr) {
        const dashVal = dashExpr.evaluate(evalInput)
        if (Array.isArray(dashVal) && dashVal.length >= 2) {
          dashOn = Number(dashVal[0] ?? 0)
          dashOff = Number(dashVal[1] ?? 0)
        }
      }

      this.styleBuffer[colorOffset] = cr
      this.styleBuffer[colorOffset + 1] = cg
      this.styleBuffer[colorOffset + 2] = cb
      this.styleBuffer[colorOffset + 3] = finalAlpha

      this.styleBuffer[metricOffset] = Math.max(1, Math.min(255, Math.round(width * 10)))
      this.styleBuffer[metricOffset + 1] = Math.max(0, Math.min(255, Math.round(dashOn * 10)))
      this.styleBuffer[metricOffset + 2] = Math.max(0, Math.min(255, Math.round(dashOff * 10)))
      this.styleBuffer[metricOffset + 3] = 255

      this.widthByFeature[i] = width
      this.visibleByFeature[i] = finalAlpha > 0 ? 1 : 0
    }

    this.styleTexture.needsUpdate = true
  }

  pickScreenPoint(
    screenX: number,
    screenY: number,
    viewportWidth: number,
    viewportHeight: number,
    camera: THREE.Camera,
    hitTolerancePx = 5,
    worldOffsetsX: readonly number[] = [0],
    planetSpinRadians = 0,
  ): { layerId: string, sourceId: string, featureId: string, distancePx: number } | null {
    if (this.disposed || !this.mesh.visible)
      return null

    const projA = new THREE.Vector3()
    const projB = new THREE.Vector3()
    const camPos = camera.position
    let bestHit: { layerId: string, sourceId: string, featureId: string, distancePx: number } | null = null
    let bestDistSq = Infinity

    for (let i = 0; i < this.indexedFeatures.length; i++) {
      if (!this.visibleByFeature[i])
        continue
      const entry = this.indexedFeatures[i]
      const maxDistPx = this.widthByFeature[i] * 0.5 + hitTolerancePx
      const maxDistSq = maxDistPx * maxDistPx

      for (const offsetX of worldOffsetsX) {
        for (const poly of entry.polylines) {
          for (let j = 0; j < poly.length - 1; j++) {
            const a = this.isGlobe ? rotateAroundPolarAxis(poly[j], planetSpinRadians) : poly[j]
            const b = this.isGlobe ? rotateAroundPolarAxis(poly[j + 1], planetSpinRadians) : poly[j + 1]
            if (this.isGlobe
              && a[0] * camPos.x + a[1] * camPos.y + a[2] * camPos.z <= 0.1
              && b[0] * camPos.x + b[1] * camPos.y + b[2] * camPos.z <= 0.1) {
              continue
            }

            projA.set(a[0] + offsetX, a[1], a[2]).project(camera)
            projB.set(b[0] + offsetX, b[1], b[2]).project(camera)
            if (projA.z < -1 || projA.z > 1 || projB.z < -1 || projB.z > 1)
              continue

            const ax = (projA.x + 1) * 0.5 * viewportWidth
            const ay = (1 - projA.y) * 0.5 * viewportHeight
            const bx = (projB.x + 1) * 0.5 * viewportWidth
            const by = (1 - projB.y) * 0.5 * viewportHeight

            const abx = bx - ax
            const aby = by - ay
            const abLenSq = abx * abx + aby * aby
            const t = abLenSq > 1e-6
              ? Math.max(0, Math.min(1, ((screenX - ax) * abx + (screenY - ay) * aby) / abLenSq))
              : 0
            const cx = ax + abx * t
            const cy = ay + aby * t
            const dx = screenX - cx
            const dy = screenY - cy
            const distSq = dx * dx + dy * dy

            if (distSq <= maxDistSq && distSq < bestDistSq) {
              bestDistSq = distSq
              bestHit = {
                layerId: this.id,
                sourceId: this.sourceId,
                featureId: entry.feature.id,
                distancePx: Math.sqrt(distSq),
              }
            }
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
    this.styleTexture.dispose()
  }
}

export function createLineLayerFromRegistry(
  compiledLayer: CompiledMapStyleLayer,
  registry: MapSourceRegistry,
  month: number,
  options: LineLayerOptions = {},
): LineLayer | null {
  const source = registry.getSource(compiledLayer.source, { month })
  if (source.unavailable || source.kind !== 'geojson')
    return null
  return new LineLayer(compiledLayer, source, options)
}
