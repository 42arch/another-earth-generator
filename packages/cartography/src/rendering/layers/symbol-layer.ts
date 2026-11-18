import type { MapProjection } from '#projections/map-projections'
import type { Vec3Tuple } from '#projections/spherical-math'
import type { GpuResourceTracker } from '#rendering/gpu-resource-tracker'
import type { MapSourceRegistry } from '#sources/registry'
import type { SampledSpineGlyphAnchor } from '#sources/topology/territory-spine'
import type { GeoJsonFeature, GeoJsonSource, TerritorySpineMetadata } from '#sources/types'
import type { CompiledMapStyleLayer } from '#styles/compiler'
import type { MapFontFaceDescriptor } from '#styles/spec'
import {
  buildTangentBasis,
  cartesianToLonLatDeg,
  crossVec3,
  dotVec3,
  lonLatDegToCartesian,
  normalizeVec3,
  rotateAroundPolarAxis,
} from '#projections/spherical-math'
import { parseCssColorToRgba8 } from '#rendering/satellite-shader'
import { sampleSpineGlyphAnchors } from '#sources/topology/territory-spine'
import * as THREE from 'three'

export const COLLISION_CELL_SIZE_PX = 32
export const GLOBE_SYMBOL_BACKFACE_DOT_THRESHOLD = 0.12
export const DEFAULT_SYMBOL_FONT_FAMILY = '"PingFang SC", "Noto Sans SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
export const DEFAULT_SYMBOL_FONT_WEIGHT = '600'

const registeredFontDescriptors = new Map<string, MapFontFaceDescriptor>()
const loadedFontPromises = new Map<string, Promise<boolean>>()

function makeFontDescriptorKey(desc: MapFontFaceDescriptor): string {
  return `${desc.family.trim()}|${String(desc.weight ?? 'normal').trim()}|${desc.style ?? 'normal'}|${desc.source.trim()}`
}

export function normalizeFontFaceSource(source: string): string {
  const trimmed = source.trim()
  if (/^(?:url|local)\s*\(/i.test(trimmed))
    return trimmed
  return `url("${trimmed.replace(/"/g, '\\"')}")`
}

/**
 * Registers a custom font descriptor (`.woff2`, `.woff`, `.ttf`, `.otf`, or `data:` URI)
 * so `loadMapFontFaces` or `CartographySession.prepareWorld` can load it via the browser `FontFace` API.
 */
export function registerCustomMapFont(descriptor: MapFontFaceDescriptor): void {
  if (!descriptor || typeof descriptor.family !== 'string' || !descriptor.family.trim())
    throw new Error('Custom map font requires a non-empty family name')
  if (typeof descriptor.source !== 'string' || !descriptor.source.trim())
    throw new Error(`Custom map font "${descriptor.family}" requires a non-empty font source URL`)
  const frozen = Object.freeze({
    ...descriptor,
    family: descriptor.family.trim(),
    source: descriptor.source.trim(),
  })
  registeredFontDescriptors.set(makeFontDescriptorKey(frozen), frozen)
}

export function getRegisteredMapFontFaces(): readonly MapFontFaceDescriptor[] {
  return [...registeredFontDescriptors.values()]
}

export function clearRegisteredMapFontFaces(): void {
  registeredFontDescriptors.clear()
  loadedFontPromises.clear()
}

export interface LoadMapFontFacesOptions {
  readonly signal?: AbortSignal
  /** Optional custom loader hook (used in Node/Vitest tests or custom asset pipelines). */
  readonly loader?: (descriptor: MapFontFaceDescriptor) => Promise<void>
}

function throwIfFontLoadAborted(signal?: AbortSignal): void {
  if (!signal?.aborted)
    return
  const err = new Error('Map font loading aborted')
  err.name = 'AbortError'
  throw err
}

/**
 * Loads custom font files using the native browser `FontFace` API (`document.fonts`),
 * deduplicating concurrent/repeated loads and gracefully falling back if a remote font URL is unreachable.
 */
export async function loadMapFontFaces(
  fonts: readonly MapFontFaceDescriptor[] = [],
  options: LoadMapFontFacesOptions = {},
): Promise<readonly string[]> {
  throwIfFontLoadAborted(options.signal)
  for (const font of fonts) {
    registerCustomMapFont(font)
  }

  const allDescriptors = [...registeredFontDescriptors.values()]
  if (allDescriptors.length === 0)
    return []

  const loadedFamilies: string[] = []
  for (const desc of allDescriptors) {
    throwIfFontLoadAborted(options.signal)
    const key = makeFontDescriptorKey(desc)
    let pending = loadedFontPromises.get(key)
    if (!pending || options.loader) {
      pending = (async () => {
        try {
          if (options.loader) {
            await options.loader(desc)
            return true
          }
          if (typeof FontFace === 'function' && typeof document !== 'undefined' && 'fonts' in document) {
            const cssSource = normalizeFontFaceSource(desc.source)
            const face = new FontFace(desc.family, cssSource, {
              ...(desc.weight !== undefined ? { weight: String(desc.weight) } : {}),
              ...(desc.style ? { style: desc.style } : {}),
              ...(desc.display ? { display: desc.display } : {}),
              ...(desc.unicodeRange ? { unicodeRange: desc.unicodeRange } : {}),
            })
            const loadedFace = await face.load()
            ;(document.fonts as unknown as { add: (f: FontFace) => void }).add(loadedFace)
            if (document.fonts.ready) {
              await document.fonts.ready
            }
            return true
          }
          return true
        }
        catch {
          return false
        }
      })()
      if (!options.loader) {
        loadedFontPromises.set(key, pending)
      }
    }

    const ok = await pending
    throwIfFontLoadAborted(options.signal)
    if (ok && !loadedFamilies.includes(desc.family)) {
      loadedFamilies.push(desc.family)
    }
  }

  return Object.freeze(loadedFamilies)
}

const SDF_INF = 1e20

function edt1d(
  grid: Float64Array,
  offset: number,
  stride: number,
  length: number,
  f: Float64Array,
  v: Int32Array,
  z: Float64Array,
): void {
  v[0] = 0
  z[0] = -SDF_INF
  z[1] = SDF_INF
  f[0] = grid[offset]

  let k = 0
  for (let q = 1; q < length; q++) {
    const fq = grid[offset + q * stride]
    f[q] = fq
    let s = ((fq + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = ((fq + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = SDF_INF
  }

  k = 0
  for (let q = 0; q < length; q++) {
    while (z[k + 1] < q)
      k++
    const dx = q - v[k]
    grid[offset + q * stride] = f[v[k]] + dx * dx
  }
}

function edt2d(
  grid: Float64Array,
  width: number,
  height: number,
  f: Float64Array,
  v: Int32Array,
  z: Float64Array,
): void {
  for (let y = 0; y < height; y++) {
    edt1d(grid, y * width, 1, width, f, v, z)
  }
  for (let x = 0; x < width; x++) {
    edt1d(grid, x, width, height, f, v, z)
  }
}

/**
 * Computes an 8-bit Signed Distance Field (SDF) from a glyph coverage mask (`0..255`)
 * using the linear-time 2D Euclidean Distance Transform (Felzenszwalb & Huttenlocher).
 * Output byte `128` (`~0.5`) represents the exact glyph contour; values `> 128` are inside the glyph,
 * and values `< 128` are outside the glyph up to `radiusPx`.
 */
export function computeGlyphSdf(
  alphaMask: Uint8Array,
  width: number,
  height: number,
  radiusPx = 14,
): Uint8Array {
  const size = width * height
  const outerGrid = new Float64Array(size)
  const innerGrid = new Float64Array(size)

  for (let i = 0; i < size; i++) {
    const a = alphaMask[i] / 255
    if (a <= 0) {
      outerGrid[i] = SDF_INF
      innerGrid[i] = 0
    }
    else if (a >= 1) {
      outerGrid[i] = 0
      innerGrid[i] = SDF_INF
    }
    else {
      const d = 0.5 - a
      outerGrid[i] = d > 0 ? d * d : 0
      innerGrid[i] = d < 0 ? d * d : 0
    }
  }

  const maxDim = Math.max(width, height)
  const f = new Float64Array(maxDim)
  const v = new Int32Array(maxDim)
  const z = new Float64Array(maxDim + 1)

  edt2d(outerGrid, width, height, f, v, z)
  edt2d(innerGrid, width, height, f, v, z)

  const out = new Uint8Array(size)
  const invRange = 1 / (2 * Math.max(1, radiusPx))
  for (let i = 0; i < size; i++) {
    const dist = Math.sqrt(outerGrid[i]) - Math.sqrt(innerGrid[i])
    const normalized = 0.5 - dist * invRange
    out[i] = Math.max(0, Math.min(255, Math.round(normalized * 255)))
  }
  return out
}

export interface ScreenCollisionBox {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
  readonly groupId?: string
}

/**
 * Deterministic screen-space spatial hash collision grid (`32px × 32px` buckets by default).
 */
export class CollisionGrid {
  readonly cellSizePx: number
  private readonly cells = new Map<number, ScreenCollisionBox[]>()
  readonly insertedBoxes: ScreenCollisionBox[] = []

  constructor(cellSizePx = COLLISION_CELL_SIZE_PX) {
    this.cellSizePx = Math.max(4, cellSizePx)
  }

  clear(): void {
    this.cells.clear()
    this.insertedBoxes.length = 0
  }

  private bucketKey(cx: number, cy: number): number {
    return ((cx & 0xFFFF) << 16) | (cy & 0xFFFF)
  }

  collides(box: ScreenCollisionBox, ignoreGroupId?: string): boolean {
    const minCX = Math.floor(box.minX / this.cellSizePx)
    const maxCX = Math.floor(box.maxX / this.cellSizePx)
    const minCY = Math.floor(box.minY / this.cellSizePx)
    const maxCY = Math.floor(box.maxY / this.cellSizePx)

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const bucket = this.cells.get(this.bucketKey(cx, cy))
        if (!bucket)
          continue
        for (let i = 0; i < bucket.length; i++) {
          const other = bucket[i]
          if (ignoreGroupId && other.groupId === ignoreGroupId)
            continue
          if (!(box.maxX < other.minX || box.minX > other.maxX || box.maxY < other.minY || box.minY > other.maxY)) {
            return true
          }
        }
      }
    }
    return false
  }

  insert(box: ScreenCollisionBox): void {
    this.insertedBoxes.push(box)
    const minCX = Math.floor(box.minX / this.cellSizePx)
    const maxCX = Math.floor(box.maxX / this.cellSizePx)
    const minCY = Math.floor(box.minY / this.cellSizePx)
    const maxCY = Math.floor(box.maxY / this.cellSizePx)

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const key = this.bucketKey(cx, cy)
        let bucket = this.cells.get(key)
        if (!bucket) {
          bucket = []
          this.cells.set(key, bucket)
        }
        bucket.push(box)
      }
    }
  }
}

class GlyphAtlasBuilder {
  private readonly cellPx = 96
  private readonly sdfRadiusPx = 12
  private readonly cols = 16
  private readonly rows: number
  private readonly uniqueChars: readonly string[]
  private readonly indexByChar = new Map<string, number>()
  readonly texture: THREE.DataTexture
  private readonly data: Uint8Array
  private nextSlot = 0
  fontFamily: string
  fontWeight: string

  constructor(
    uniqueChars: readonly string[],
    fontFamily = DEFAULT_SYMBOL_FONT_FAMILY,
    fontWeight = DEFAULT_SYMBOL_FONT_WEIGHT,
    tracker?: GpuResourceTracker,
  ) {
    this.uniqueChars = [...uniqueChars]
    this.fontFamily = fontFamily
    this.fontWeight = fontWeight

    const count = Math.max(1, this.uniqueChars.length + 1)
    this.rows = Math.max(1, Math.ceil(count / this.cols))
    const width = this.cols * this.cellPx
    const height = this.rows * this.cellPx
    this.data = new Uint8Array(width * height * 4)

    this.rasterizeAllGlyphs()

    this.texture = new THREE.DataTexture(
      this.data,
      width,
      height,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    )
    this.texture.minFilter = THREE.LinearFilter
    this.texture.magFilter = THREE.LinearFilter
    this.texture.generateMipmaps = false
    this.texture.needsUpdate = true
    tracker?.trackTexture(this.texture)
  }

  rebuild(fontFamily = this.fontFamily, fontWeight = this.fontWeight): void {
    this.fontFamily = fontFamily
    this.fontWeight = fontWeight
    this.data.fill(0)
    this.indexByChar.clear()
    this.nextSlot = 0
    this.rasterizeAllGlyphs()
    this.texture.needsUpdate = true
  }

  private rasterizeAllGlyphs(): void {
    this.registerChar(' ')
    for (const ch of this.uniqueChars) {
      this.registerChar(ch)
    }
  }

  getUvRect(char: string): readonly [number, number, number, number] {
    const slot = this.indexByChar.get(char) ?? 0
    const col = slot % this.cols
    const row = Math.floor(slot / this.cols)
    const u0 = col / this.cols
    const v0 = row / this.rows
    const uSpan = 1 / this.cols
    const vSpan = 1 / this.rows
    return [u0, v0, uSpan, vSpan]
  }

  private registerChar(char: string): void {
    if (this.indexByChar.has(char))
      return
    const slot = this.nextSlot++
    this.indexByChar.set(char, slot)
    if (char.trim().length === 0)
      return

    const col = slot % this.cols
    const row = Math.floor(slot / this.cols)
    const atlasWidth = this.cols * this.cellPx
    const startX = col * this.cellPx
    const startY = row * this.cellPx
    const alphaMask = new Uint8Array(this.cellPx * this.cellPx)

    let renderedByCanvas = false
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = this.cellPx
        canvas.height = this.cellPx
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.clearRect(0, 0, this.cellPx, this.cellPx)
          ctx.font = `${this.fontWeight} ${Math.round(this.cellPx * 0.62)}px ${this.fontFamily}`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillStyle = '#ffffff'
          ctx.fillText(char, this.cellPx * 0.5, this.cellPx * 0.52)
          const img = ctx.getImageData(0, 0, this.cellPx, this.cellPx).data
          for (let y = 0; y < this.cellPx; y++) {
            for (let x = 0; x < this.cellPx; x++) {
              const srcIdx = ((this.cellPx - 1 - y) * this.cellPx + x) * 4
              alphaMask[y * this.cellPx + x] = img[srcIdx + 3]
            }
          }
          renderedByCanvas = true
        }
      }
      catch {
        renderedByCanvas = false
      }
    }

    if (!renderedByCanvas) {
      const code = char.codePointAt(0) ?? 65
      const margin = Math.round(this.cellPx * 0.22)
      for (let y = margin; y < this.cellPx - margin; y++) {
        for (let x = margin; x < this.cellPx - margin; x++) {
          const pattern = ((x + y + (code & 7)) % 5) !== 0
          if (pattern) {
            alphaMask[y * this.cellPx + x] = 255
          }
        }
      }
    }

    const sdf = computeGlyphSdf(alphaMask, this.cellPx, this.cellPx, this.sdfRadiusPx)
    for (let y = 0; y < this.cellPx; y++) {
      for (let x = 0; x < this.cellPx; x++) {
        const sdfVal = sdf[y * this.cellPx + x]
        const dstIdx = ((startY + y) * atlasWidth + (startX + x)) * 4
        this.data[dstIdx] = sdfVal
        this.data[dstIdx + 1] = sdfVal
        this.data[dstIdx + 2] = sdfVal
        this.data[dstIdx + 3] = sdfVal
      }
    }
  }

  dispose(): void {
    this.texture.dispose()
  }
}

const SYMBOL_VERTEX_SHADER = /* glsl */`
  attribute vec3 instancePosition;
  attribute vec3 instanceTangent;
  attribute vec3 instanceNormal;
  attribute vec4 instanceUvRect;
  attribute vec4 instanceFillColor;
  attribute vec4 instanceHaloColor;
  attribute vec4 instanceMetrics; // x: sizeWorldOrPx, y: modeFlag (0=2D screen, 1=2D spine, 2=3D surface tangent), z: visibleFlag, w: haloWidthSdf

  uniform vec2 uViewportPx;
  uniform float uPixelRatio;

  varying vec2 vAtlasUv;
  varying vec4 vFillColor;
  varying vec4 vHaloColor;
  varying float vVisible;
  varying float vHorizonFade;
  varying float vHaloWidth;

  void main() {
    vFillColor = instanceFillColor;
    vHaloColor = instanceHaloColor;
    vVisible = instanceMetrics.z;
    vHaloWidth = instanceMetrics.w;
    vHorizonFade = 1.0;
    vec2 localQuad = position.xy; // [-0.5, 0.5]
    vAtlasUv = instanceUvRect.xy + (localQuad + 0.5) * instanceUvRect.zw;

    if (vVisible < 0.5 || (vFillColor.a <= 0.002 && vHaloColor.a <= 0.002)) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    // 3D Globe surface-hugging tangent-plane mode:
    // Each character quad lies flush on the local spherical tangent plane (tangent T, bitangent B = N x T),
    // so rotating the globe naturally foreshortens the text on the curved surface with zero floating parallax.
    if (instanceMetrics.y > 1.5) {
      vec3 N = normalize(instanceNormal);
      vec3 rawT = instanceTangent - N * dot(instanceTangent, N);
      float tLen = length(rawT);
      vec3 T = tLen > 1e-5 ? (rawT / tLen) : vec3(1.0, 0.0, 0.0);
      vec3 B = normalize(cross(N, T));

      float worldSize = instanceMetrics.x;
      vec3 worldOffset = (T * localQuad.x + B * localQuad.y) * worldSize;
      vec3 surfacePos = normalize(instancePosition + worldOffset) * length(instancePosition);

      vec3 viewCenter = (modelViewMatrix * vec4(instancePosition, 1.0)).xyz;
      vec3 viewNormal = normalize(normalMatrix * N);
      vec3 viewDir = normalize(-viewCenter);
      vHorizonFade = smoothstep(0.14, 0.34, dot(viewNormal, viewDir));

      gl_Position = projectionMatrix * modelViewMatrix * vec4(surfacePos, 1.0);
      return;
    }

    // 2D Atlas screen-space / projected tangent mode:
    float sizePx = instanceMetrics.x * uPixelRatio;
    vec2 halfViewport = max(uViewportPx * 0.5, vec2(1.0));
    vec4 clipCenter = projectionMatrix * modelViewMatrix * vec4(instancePosition, 1.0);

    vec2 screenRight = vec2(1.0, 0.0);
    vec2 screenUp = vec2(0.0, 1.0);

    if (instanceMetrics.y > 0.5) {
      vec4 clipTangent = projectionMatrix * modelViewMatrix * vec4(instancePosition + instanceTangent * 0.02, 1.0);
      vec2 screenCenter = (clipCenter.xy / max(abs(clipCenter.w), 1e-5)) * halfViewport;
      vec2 screenTanPt = (clipTangent.xy / max(abs(clipTangent.w), 1e-5)) * halfViewport;
      vec2 dir = screenTanPt - screenCenter;
      float dirLen = length(dir);
      if (dirLen > 1e-4) {
        screenRight = dir / dirLen;
        screenUp = vec2(-screenRight.y, screenRight.x);
      }
    }

    vec2 offsetPx = (screenRight * localQuad.x + screenUp * localQuad.y) * sizePx;
    vec2 ndcOffset = offsetPx / halfViewport;
    gl_Position = vec4(clipCenter.xy + ndcOffset * clipCenter.w, clipCenter.z, clipCenter.w);
  }
`

const SYMBOL_FRAGMENT_SHADER = /* glsl */`
  uniform sampler2D uGlyphAtlas;

  varying vec2 vAtlasUv;
  varying vec4 vFillColor;
  varying vec4 vHaloColor;
  varying float vVisible;
  varying float vHorizonFade;
  varying float vHaloWidth;

  void main() {
    if (vVisible < 0.5 || vHorizonFade <= 0.01) {
      discard;
    }

    float sdf = texture2D(uGlyphAtlas, vAtlasUv).r;
    float fw = clamp(fwidth(sdf) * 0.85, 0.006, 0.16);
    float fillAlpha = smoothstep(0.5 - fw, 0.5 + fw, sdf);
    float haloCutoff = clamp(0.5 - vHaloWidth, 0.05, 0.495);
    float haloAlpha = vHaloWidth > 0.001
      ? smoothstep(haloCutoff - fw * 1.25, haloCutoff + fw * 1.25, sdf)
      : fillAlpha;
    if (haloAlpha <= 0.01) {
      discard;
    }

    vec3 rgb = mix(vHaloColor.rgb, vFillColor.rgb, fillAlpha);
    float alpha = max(haloAlpha * vHaloColor.a, fillAlpha * vFillColor.a) * vHorizonFade;
    if (alpha <= 0.01) {
      discard;
    }

    gl_FragColor = vec4(rgb, alpha);
  }
`

export interface SymbolFeaturePlacementState {
  readonly featureId: string
  readonly text: string
  readonly priority: number
  readonly placementMode: 'point' | 'spine'
  readonly visible: boolean
  readonly culledByBackface: boolean
  readonly culledByCollision: boolean
  readonly glyphs: readonly SampledSpineGlyphAnchor[]
  readonly screenBoxes: readonly ScreenCollisionBox[]
}

export interface SymbolLayerOptions {
  readonly renderOrder?: number
  readonly surfaceOffset?: number
  readonly projection?: MapProjection
  readonly tracker?: GpuResourceTracker
}

interface SymbolEntry {
  readonly feature: GeoJsonFeature
  readonly text: string
  readonly priority: number
  readonly spine: TerritorySpineMetadata
  readonly glyphStartIndex: number
  readonly glyphCount: number
}

/**
 * Batched GPU `SymbolLayer` renderer:
 * - Supports `symbol-placement: 'point' | 'spine'` using territory PCA splines (`sampleSpineGlyphAnchors`).
 * - Enforces left-to-right Chinese reading orientation (`dot(chord, cameraRight) >= 0`).
 * - Evaluates deterministic `CollisionGrid` (`32px × 32px` spatial hash) in descending `priority` order
 *   with 3D globe backface culling (`dot(normal, cameraDir) <= 0.12`) and 2D antimeridian spine split guard.
 */
export class SymbolLayer {
  readonly id: string
  readonly sourceId: string
  readonly isGlobe: boolean
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>

  private readonly projection?: MapProjection
  private readonly entries: SymbolEntry[] = []
  private readonly atlas: GlyphAtlasBuilder
  private readonly posAttr: THREE.InstancedBufferAttribute
  private readonly tangentAttr: THREE.InstancedBufferAttribute
  private readonly normalAttr: THREE.InstancedBufferAttribute
  private readonly uvRectAttr: THREE.InstancedBufferAttribute
  private readonly fillColorAttr: THREE.InstancedBufferAttribute
  private readonly haloColorAttr: THREE.InstancedBufferAttribute
  private readonly metricsAttr: THREE.InstancedBufferAttribute
  private readonly placementStates = new Map<string, SymbolFeaturePlacementState>()
  private readonly surfaceOffset: number
  private readonly radius: number
  private compiledLayer: CompiledMapStyleLayer
  private styleZoom = 0
  private viewportWidth = 1280
  private viewportHeight = 720
  private pixelRatio = 1
  private disposed = false

  constructor(
    compiledLayer: CompiledMapStyleLayer,
    source: GeoJsonSource,
    options: SymbolLayerOptions = {},
  ) {
    this.id = compiledLayer.id
    this.sourceId = compiledLayer.source
    this.compiledLayer = compiledLayer
    this.projection = options.projection
    this.isGlobe = !options.projection
    this.surfaceOffset = options.surfaceOffset ?? (this.isGlobe ? 0.0005 : 0.005)
    this.radius = 1.0 + this.surfaceOffset

    const spineByFeatureId = source.spines ?? new Map<string, TerritorySpineMetadata>()

    const rawEntries: {
      feature: GeoJsonFeature
      text: string
      priority: number
      spine: TerritorySpineMetadata
    }[] = []
    const uniqueCharSet = new Set<string>()

    const textFieldExpr = compiledLayer.layout['text-field']
    for (const feature of source.data.features) {
      const evaluatedText = textFieldExpr
        ? textFieldExpr.evaluate({ zoom: 0, properties: feature.properties })
        : undefined
      const text = String(
        evaluatedText ?? feature.properties.displayName ?? feature.properties.name ?? '',
      ).trim()
      if (!text)
        continue
      for (const ch of Array.from(text)) {
        uniqueCharSet.add(ch)
      }

      const priority = Number(feature.properties.priority ?? feature.properties.areaKm2 ?? 0)
      let spine = spineByFeatureId.get(feature.id)
      if (!spine) {
        const coords = feature.geometry.type === 'Point'
          ? feature.geometry.coordinates
          : [0, 0] as const
        const pos = lonLatDegToCartesian(coords[0], coords[1])
        spine = {
          featureId: feature.id,
          displayName: text,
          kind: feature.properties.kind === 'ocean' ? 'ocean' : 'continent',
          areaKm2: priority,
          anchorRegion: Number(feature.properties.regionId ?? 0),
          anchorPosition: pos,
          anchorCoordinates: [coords[0], coords[1]],
          elongation: 1,
          isCurved: false,
          spinePoints: [],
          spineCoordinates: [],
        }
      }
      rawEntries.push({ feature, text, priority, spine })
    }

    // Sort by descending priority so larger territories place first in CollisionGrid
    rawEntries.sort((a, b) => b.priority - a.priority || a.feature.id.localeCompare(b.feature.id))

    let totalGlyphInstances = 0
    for (const item of rawEntries) {
      const charCount = Array.from(item.text).length
      this.entries.push({
        ...item,
        glyphStartIndex: totalGlyphInstances,
        glyphCount: charCount,
      })
      totalGlyphInstances += charCount
    }

    const initialFontFamily = String(
      compiledLayer.layout['text-font']?.evaluate({ zoom: 0 }) ?? DEFAULT_SYMBOL_FONT_FAMILY,
    ).trim() || DEFAULT_SYMBOL_FONT_FAMILY
    const initialFontWeight = String(
      compiledLayer.layout['text-weight']?.evaluate({ zoom: 0 }) ?? DEFAULT_SYMBOL_FONT_WEIGHT,
    ).trim() || DEFAULT_SYMBOL_FONT_WEIGHT

    this.atlas = new GlyphAtlasBuilder(
      [...uniqueCharSet],
      initialFontFamily,
      initialFontWeight,
      options.tracker,
    )
    const allocCount = Math.max(1, totalGlyphInstances)

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

    this.posAttr = new THREE.InstancedBufferAttribute(new Float32Array(allocCount * 3), 3)
    this.tangentAttr = new THREE.InstancedBufferAttribute(new Float32Array(allocCount * 3), 3)
    this.normalAttr = new THREE.InstancedBufferAttribute(new Float32Array(allocCount * 3), 3)
    this.uvRectAttr = new THREE.InstancedBufferAttribute(new Float32Array(allocCount * 4), 4)
    this.fillColorAttr = new THREE.InstancedBufferAttribute(new Float32Array(allocCount * 4), 4)
    this.haloColorAttr = new THREE.InstancedBufferAttribute(new Float32Array(allocCount * 4), 4)
    this.metricsAttr = new THREE.InstancedBufferAttribute(new Float32Array(allocCount * 4), 4)

    const geometry = new THREE.InstancedBufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(quadPositions, 3))
    geometry.setIndex(new THREE.BufferAttribute(quadIndices, 1))
    geometry.setAttribute('instancePosition', this.posAttr)
    geometry.setAttribute('instanceTangent', this.tangentAttr)
    geometry.setAttribute('instanceNormal', this.normalAttr)
    geometry.setAttribute('instanceUvRect', this.uvRectAttr)
    geometry.setAttribute('instanceFillColor', this.fillColorAttr)
    geometry.setAttribute('instanceHaloColor', this.haloColorAttr)
    geometry.setAttribute('instanceMetrics', this.metricsAttr)
    geometry.instanceCount = totalGlyphInstances
    const boundRadius = options.projection
      ? Math.hypot(options.projection.worldWidth, options.projection.worldHeight)
      : this.radius + 0.05
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), boundRadius)
    options.tracker?.trackGeometry(geometry)

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uGlyphAtlas: { value: this.atlas.texture },
        uViewportPx: { value: new THREE.Vector2(1280, 720) },
        uPixelRatio: { value: 1 },
      },
      vertexShader: SYMBOL_VERTEX_SHADER,
      fragmentShader: SYMBOL_FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    options.tracker?.trackMaterial(material)

    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.name = `SymbolLayer:${this.id}`
    this.mesh.renderOrder = options.renderOrder ?? 8
    this.mesh.frustumCulled = false
  }

  setViewport(widthCssPx: number, heightCssPx: number, pixelRatio = 1): void {
    if (this.disposed)
      return
    this.viewportWidth = Math.max(1, widthCssPx)
    this.viewportHeight = Math.max(1, heightCssPx)
    this.pixelRatio = Math.min(Math.max(1, pixelRatio), 2)
    this.mesh.material.uniforms.uViewportPx.value.set(
      this.viewportWidth * this.pixelRatio,
      this.viewportHeight * this.pixelRatio,
    )
    this.mesh.material.uniforms.uPixelRatio.value = this.pixelRatio
  }

  updateStyle(compiledLayer: CompiledMapStyleLayer, styleZoom: number): void {
    this.compiledLayer = compiledLayer
    this.styleZoom = styleZoom

    const nextFontFamily = String(
      compiledLayer.layout['text-font']?.evaluate({ zoom: styleZoom }) ?? DEFAULT_SYMBOL_FONT_FAMILY,
    ).trim() || DEFAULT_SYMBOL_FONT_FAMILY
    const nextFontWeight = String(
      compiledLayer.layout['text-weight']?.evaluate({ zoom: styleZoom }) ?? DEFAULT_SYMBOL_FONT_WEIGHT,
    ).trim() || DEFAULT_SYMBOL_FONT_WEIGHT

    if (nextFontFamily !== this.atlas.fontFamily || nextFontWeight !== this.atlas.fontWeight) {
      this.atlas.rebuild(nextFontFamily, nextFontWeight)
    }
  }

  getFontFamily(): string {
    return this.atlas.fontFamily
  }

  getFontWeight(): string {
    return this.atlas.fontWeight
  }

  rebuildGlyphAtlas(): void {
    if (this.disposed)
      return
    this.atlas.rebuild()
  }

  /**
   * Evaluates 3D backface culling (`dot(normal, cameraDir) <= 0.12`), left-to-right reading order,
   * and `CollisionGrid` avoidance in priority order for the current camera pose.
   */
  updatePlacement(camera: THREE.Camera, collisionGrid: CollisionGrid, planetSpinRadians = 0): void {
    if (this.disposed)
      return

    const compiledLayer = this.compiledLayer
    const styleZoom = this.styleZoom
    const layoutVis = compiledLayer.layout.visibility?.evaluate({ zoom: styleZoom })
    this.mesh.visible = styleZoom >= compiledLayer.minzoom && styleZoom <= compiledLayer.maxzoom && layoutVis !== 'none'
    this.placementStates.clear()

    if (!this.mesh.visible)
      return

    camera.updateMatrixWorld()
    const camPos = camera.position
    const camDist = this.isGlobe ? Math.max(1.05, camPos.length()) : 3.0
    const camAltitude = Math.max(0.05, camDist - 1.0)
    const fovDeg = 'fov' in camera && typeof (camera as THREE.PerspectiveCamera).fov === 'number'
      ? (camera as THREE.PerspectiveCamera).fov
      : 42
    const tanHalfFov = Math.tan((fovDeg * Math.PI / 180) * 0.5)
    const worldUnitsPerPixelAtSubcamera = (2 * camAltitude * tanHalfFov) / Math.max(1, this.viewportHeight)

    const camDir = this.isGlobe
      ? rotateAroundPolarAxis(normalizeVec3(camPos.x, camPos.y, camPos.z), -planetSpinRadians)
      : ([0, 0, 1] as const)
    const camRightVec = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize()
    const globeViewRight: Vec3Tuple | undefined = this.isGlobe
      ? rotateAroundPolarAxis([camRightVec.x, camRightVec.y, camRightVec.z], -planetSpinRadians)
      : undefined
    const projScratch = new THREE.Vector3()

    const placementExpr = compiledLayer.layout['symbol-placement']
    const textSizeExpr = compiledLayer.layout['text-size']
    const textColorExpr = compiledLayer.paint['text-color']
    const haloColorExpr = compiledLayer.paint['text-halo-color']
    const haloWidthExpr = compiledLayer.paint['text-halo-width']
    const opacityExpr = compiledLayer.paint['text-opacity']
    const filterExpr = compiledLayer.filter

    for (const entry of this.entries) {
      const { feature, text, spine, glyphStartIndex, glyphCount } = entry
      const props = feature.properties
      const evalInput = { zoom: styleZoom, properties: props }

      if (filterExpr && !filterExpr.evaluate(evalInput)) {
        this.hideEntryGlyphs(glyphStartIndex, glyphCount)
        this.placementStates.set(feature.id, {
          featureId: feature.id,
          text,
          priority: entry.priority,
          placementMode: 'point',
          visible: false,
          culledByBackface: false,
          culledByCollision: false,
          glyphs: [],
          screenBoxes: [],
        })
        continue
      }

      const rawPlacement = String(placementExpr?.evaluate(evalInput) ?? 'spine')
      let useSpine = rawPlacement === 'spine' && spine.isCurved && spine.spinePoints.length >= 3
      const textSizePx = Math.max(8, Number(textSizeExpr?.evaluate(evalInput) ?? 15))
      const opacity = opacityExpr ? Number(opacityExpr.evaluate(evalInput) ?? 1) : 1

      if (opacity <= 0.01) {
        this.hideEntryGlyphs(glyphStartIndex, glyphCount)
        continue
      }

      const glyphWorldSize = this.isGlobe
        ? Math.max(0.014, Math.min(0.075, textSizePx * worldUnitsPerPixelAtSubcamera * 1.15))
        : textSizePx
      const glyphStepRad = this.isGlobe
        ? Math.max(0.014, Math.min(0.055, glyphWorldSize * 0.88))
        : 0.032

      const entryViewRight = globeViewRight ?? buildTangentBasis(spine.anchorPosition).east
      let glyphs = useSpine
        ? sampleSpineGlyphAnchors(spine, text, entryViewRight, { glyphStepRad })
        : this.buildPointGlyphAnchors(spine, text, entryViewRight, glyphStepRad)

      // In 2D AtlasView, if a curved spine crosses the ±180° antimeridian, fall back to point placement at the interior anchor
      if (this.projection && useSpine && glyphs.length >= 2) {
        let crossesSeam = false
        for (let i = 0; i < glyphs.length - 1; i++) {
          if (Math.abs(glyphs[i + 1].coordinates[0] - glyphs[i].coordinates[0]) > 150) {
            crossesSeam = true
            break
          }
        }
        if (crossesSeam) {
          useSpine = false
          glyphs = this.buildPointGlyphAnchors(spine, text, entryViewRight, glyphStepRad)
        }
      }

      const placementMode: 'point' | 'spine' = useSpine ? 'spine' : 'point'

      // 3D Globe backface culling: check first, middle, and last glyph normals against camera direction
      let culledByBackface = false
      if (this.isGlobe) {
        const checkIndices = glyphs.length > 2
          ? [0, Math.floor(glyphs.length / 2), glyphs.length - 1]
          : glyphs.map((_, idx) => idx)

        for (const idx of checkIndices) {
          const g = glyphs[idx]
          if (dotVec3(g.position, camDir) <= GLOBE_SYMBOL_BACKFACE_DOT_THRESHOLD) {
            culledByBackface = true
            break
          }
        }
      }

      if (culledByBackface) {
        this.hideEntryGlyphs(glyphStartIndex, glyphCount)
        this.placementStates.set(feature.id, {
          featureId: feature.id,
          text,
          priority: entry.priority,
          placementMode,
          visible: false,
          culledByBackface: true,
          culledByCollision: false,
          glyphs,
          screenBoxes: [],
        })
        continue
      }

      // Compute world positions & tangents for each glyph
      const glyphWorldPositions: Vec3Tuple[] = []
      const glyphWorldTangents: Vec3Tuple[] = []

      if (this.projection) {
        const raw2D: [number, number][] = glyphs.map(g =>
          this.projection!.project(g.coordinates[0], g.coordinates[1]),
        )
        // Enforce left-to-right reading order in 2D projected space
        if (raw2D.length >= 2 && raw2D.at(-1)![0] < raw2D[0][0]) {
          raw2D.reverse()
        }
        for (let i = 0; i < glyphs.length; i++) {
          const [px, py] = raw2D[i]
          glyphWorldPositions.push([px, py, this.surfaceOffset])
          if (useSpine && raw2D.length >= 2) {
            const pPrev = raw2D[Math.max(0, i - 1)]
            const pNext = raw2D[Math.min(raw2D.length - 1, i + 1)]
            const dx = pNext[0] - pPrev[0]
            const dy = pNext[1] - pPrev[1]
            const len = Math.hypot(dx, dy)
            glyphWorldTangents.push(len > 1e-6 ? [dx / len, dy / len, 0] : [1, 0, 0])
          }
          else {
            glyphWorldTangents.push([1, 0, 0])
          }
        }
      }
      else {
        for (let i = 0; i < glyphs.length; i++) {
          const g = glyphs[i]
          glyphWorldPositions.push([
            g.position[0] * this.radius,
            g.position[1] * this.radius,
            g.position[2] * this.radius,
          ])
          glyphWorldTangents.push(g.tangent)
        }
      }

      // Project glyph bounding boxes into screen pixel space and test against CollisionGrid
      const candidateBoxes: ScreenCollisionBox[] = []
      let culledByCollision = false
      const halfBoxPx = textSizePx * 0.48

      for (let i = 0; i < glyphs.length; i++) {
        const wp = glyphWorldPositions[i]
        projScratch.set(wp[0], wp[1], wp[2]).project(camera)

        if (projScratch.z < -1 || projScratch.z > 1) {
          culledByBackface = true
          break
        }

        const sx = (projScratch.x + 1) * 0.5 * this.viewportWidth
        const sy = (1 - projScratch.y) * 0.5 * this.viewportHeight
        const box: ScreenCollisionBox = {
          minX: sx - halfBoxPx,
          maxX: sx + halfBoxPx,
          minY: sy - halfBoxPx,
          maxY: sy + halfBoxPx,
          groupId: feature.id,
        }
        if (collisionGrid.collides(box, feature.id)) {
          culledByCollision = true
          break
        }
        candidateBoxes.push(box)
      }

      if (culledByBackface || culledByCollision) {
        this.hideEntryGlyphs(glyphStartIndex, glyphCount)
        this.placementStates.set(feature.id, {
          featureId: feature.id,
          text,
          priority: entry.priority,
          placementMode,
          visible: false,
          culledByBackface,
          culledByCollision,
          glyphs,
          screenBoxes: [],
        })
        continue
      }

      for (const box of candidateBoxes) {
        collisionGrid.insert(box)
      }

      const rawTextColor = String(textColorExpr?.evaluate(evalInput) ?? '#f8fafc')
      const rawHaloColor = String(haloColorExpr?.evaluate(evalInput) ?? '#0f172a')
      const rawHaloWidthPx = Math.max(0, Number(haloWidthExpr?.evaluate(evalInput) ?? 1.8))
      const haloWidthSdf = Math.min(0.38, rawHaloWidthPx * 0.1)
      const [tr, tg, tb, ta] = parseCssColorToRgba8(rawTextColor)
      const [hr, hg, hb, ha] = parseCssColorToRgba8(rawHaloColor)

      for (let i = 0; i < glyphCount; i++) {
        const instIdx = glyphStartIndex + i
        const g = glyphs[i]
        if (!g) {
          this.metricsAttr.setXYZW(instIdx, 0, 0, 0, 0)
          continue
        }
        const wp = glyphWorldPositions[i]
        const wt = glyphWorldTangents[i]
        const uvRect = this.atlas.getUvRect(g.char)
        this.posAttr.setXYZ(instIdx, wp[0], wp[1], wp[2])
        this.tangentAttr.setXYZ(instIdx, wt[0], wt[1], wt[2])
        this.normalAttr.setXYZ(instIdx, g.position[0], g.position[1], g.position[2])
        this.uvRectAttr.setXYZW(instIdx, uvRect[0], uvRect[1], uvRect[2], uvRect[3])
        this.fillColorAttr.setXYZW(instIdx, tr / 255, tg / 255, tb / 255, (ta / 255) * opacity)
        this.haloColorAttr.setXYZW(instIdx, hr / 255, hg / 255, hb / 255, (ha / 255) * opacity)
        const modeFlag = this.isGlobe ? 2 : (useSpine ? 1 : 0)
        this.metricsAttr.setXYZW(instIdx, glyphWorldSize, modeFlag, 1, haloWidthSdf)
      }

      this.placementStates.set(feature.id, {
        featureId: feature.id,
        text,
        priority: entry.priority,
        placementMode,
        visible: true,
        culledByBackface: false,
        culledByCollision: false,
        glyphs,
        screenBoxes: candidateBoxes,
      })
    }

    this.posAttr.needsUpdate = true
    this.tangentAttr.needsUpdate = true
    this.normalAttr.needsUpdate = true
    this.uvRectAttr.needsUpdate = true
    this.fillColorAttr.needsUpdate = true
    this.haloColorAttr.needsUpdate = true
    this.metricsAttr.needsUpdate = true
  }

  private buildPointGlyphAnchors(
    spine: TerritorySpineMetadata,
    text: string,
    viewRight: Vec3Tuple,
    stepRad = 0.028,
  ): SampledSpineGlyphAnchor[] {
    const chars = Array.from(text)
    const count = chars.length
    const center = spine.anchorPosition
    let rightTangent: Vec3Tuple
    if (this.isGlobe) {
      rightTangent = buildTangentBasis(center).east
      if (dotVec3(rightTangent, viewRight) < 0) {
        rightTangent = [-rightTangent[0], -rightTangent[1], -rightTangent[2]]
      }
    }
    else {
      const radial = dotVec3(viewRight, center)
      rightTangent = [
        viewRight[0] - center[0] * radial,
        viewRight[1] - center[1] * radial,
        viewRight[2] - center[2] * radial,
      ]
      if (Math.hypot(rightTangent[0], rightTangent[1], rightTangent[2]) < 1e-5) {
        rightTangent = buildTangentBasis(center).east
      }
      else {
        rightTangent = normalizeVec3(rightTangent[0], rightTangent[1], rightTangent[2])
      }
    }

    const out: SampledSpineGlyphAnchor[] = []
    for (let i = 0; i < count; i++) {
      const offsetIndex = i - (count - 1) * 0.5
      const angle = offsetIndex * stepRad
      const pos = normalizeVec3(
        center[0] * Math.cos(angle) + rightTangent[0] * Math.sin(angle),
        center[1] * Math.cos(angle) + rightTangent[1] * Math.sin(angle),
        center[2] * Math.cos(angle) + rightTangent[2] * Math.sin(angle),
      )
      const up = crossVec3(pos, rightTangent)
      const localRight = normalizeVec3(...crossVec3(up, pos))
      const coords = cartesianToLonLatDeg(pos[0], pos[1], pos[2])
      out.push({
        char: chars[i],
        index: i,
        position: pos,
        tangent: localRight,
        coordinates: coords,
      })
    }
    return out
  }

  private hideEntryGlyphs(startIndex: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.metricsAttr.setXYZW(startIndex + i, 0, 0, 0, 0)
    }
  }

  getPlacementState(featureId: string): SymbolFeaturePlacementState | undefined {
    return this.placementStates.get(featureId)
  }

  getAllPlacementStates(): readonly SymbolFeaturePlacementState[] {
    return [...this.placementStates.values()]
  }

  pickScreenPoint(
    screenX: number,
    screenY: number,
    hitTolerancePx = 6,
  ): { layerId: string, sourceId: string, featureId: string, distancePx: number } | null {
    if (this.disposed || !this.mesh.visible)
      return null

    let bestHit: { layerId: string, sourceId: string, featureId: string, distancePx: number } | null = null
    let bestDist = Infinity

    for (const state of this.placementStates.values()) {
      if (!state.visible)
        continue
      for (const box of state.screenBoxes) {
        const dx = screenX < box.minX ? box.minX - screenX : screenX > box.maxX ? screenX - box.maxX : 0
        const dy = screenY < box.minY ? box.minY - screenY : screenY > box.maxY ? screenY - box.maxY : 0
        const dist = Math.hypot(dx, dy)
        if (dist <= hitTolerancePx && dist < bestDist) {
          bestDist = dist
          bestHit = {
            layerId: this.id,
            sourceId: this.sourceId,
            featureId: state.featureId,
            distancePx: dist,
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
    this.atlas.dispose()
  }
}

export function createSymbolLayerFromRegistry(
  compiledLayer: CompiledMapStyleLayer,
  registry: MapSourceRegistry,
  month: number,
  options: SymbolLayerOptions = {},
): SymbolLayer | null {
  const source = registry.getSource(compiledLayer.source, { month })
  if (source.unavailable || source.kind !== 'geojson')
    return null
  return new SymbolLayer(compiledLayer, source, options)
}
