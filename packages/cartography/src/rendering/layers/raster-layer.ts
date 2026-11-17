import type { MapProjection } from '#projections/map-projections'
import type { GpuResourceTracker } from '#rendering/gpu-resource-tracker'
import type { MapSourceRegistry } from '#sources/registry'
import type { RasterCellSource } from '#sources/types'
import type { CompiledMapStyleLayer } from '#styles/compiler'
import type { MapMeshReader, WorldMapReader } from '@another-earth/world-core'
import { clipRingToGeographicBox } from '#projections/seam-clipper'
import { cartesianToLonLatDeg, unwrapLongitudeDegNear } from '#projections/spherical-math'
import { applyCellHillshadeRgba8, applyPolarIceToRgba8, parseCssColorToRgba8, writeSatelliteCellColorsRgba8 } from '#rendering/satellite-shader'
import * as THREE from 'three'

export const RASTER_TEX_WIDTH = 1024

interface SharedMeshGeometryEntry {
  readonly key: string
  readonly geometry: THREE.BufferGeometry
  refCount: number
}

const SHARED_GLOBE_GEOMETRY_BY_MESH_ID = new Map<string, SharedMeshGeometryEntry>()
const SHARED_ATLAS_GEOMETRY_BY_KEY = new Map<string, SharedMeshGeometryEntry>()
const SHARED_SMOOTHED_CORNERS_BY_KEY = new Map<string, Float64Array>()

/**
 * Computes and caches topology-preserving smoothed dual corner positions (`Float64Array`)
 * where corners on shared boundaries of `groupIds` are relaxed along valence-2 chains
 * while triple junctions (`valence != 2`) remain strictly locked.
 */
export function acquireSmoothedDualCorners(
  mesh: MapMeshReader,
  cacheKey: string,
  groupIds: Int32Array,
  iterations = 4,
  strength = 0.44,
): Float64Array {
  const fullKey = `${mesh.meshId}:${cacheKey}`
  const cached = SHARED_SMOOTHED_CORNERS_BY_KEY.get(fullKey)
  if (cached)
    return cached

  const cornerCount = mesh.cornerCount
  let positions = new Float64Array(cornerCount * 3)
  const cornerOut = { x: 0, y: 0, z: 0 }
  for (let c = 0; c < cornerCount; c++) {
    mesh.getCornerPosition(c, cornerOut)
    positions[c * 3] = cornerOut.x
    positions[c * 3 + 1] = cornerOut.y
    positions[c * 3 + 2] = cornerOut.z
  }

  const neighbors = new Map<number, Set<number>>()
  mesh.forEachEdge((_edgeId, regionA, regionB, cornerA, cornerB) => {
    if (groupIds[regionA] === groupIds[regionB])
      return
    let setA = neighbors.get(cornerA)
    if (!setA) {
      setA = new Set<number>()
      neighbors.set(cornerA, setA)
    }
    setA.add(cornerB)

    let setB = neighbors.get(cornerB)
    if (!setB) {
      setB = new Set<number>()
      neighbors.set(cornerB, setB)
    }
    setB.add(cornerA)
  })

  for (let iter = 0; iter < iterations; iter++) {
    const next = positions.slice()
    for (const [corner, adj] of neighbors) {
      if (adj.size !== 2)
        continue
      const [neighborA, neighborB] = adj
      const cOffset = 3 * corner
      const aOffset = 3 * neighborA
      const bOffset = 3 * neighborB
      const cx = positions[cOffset]
      const cy = positions[cOffset + 1]
      const cz = positions[cOffset + 2]

      let x = cx * (1 - strength) + (positions[aOffset] + positions[bOffset]) * (strength * 0.5)
      let y = cy * (1 - strength) + (positions[aOffset + 1] + positions[bOffset + 1]) * (strength * 0.5)
      let z = cz * (1 - strength) + (positions[aOffset + 2] + positions[bOffset + 2]) * (strength * 0.5)
      const len = Math.hypot(x, y, z) || 1
      x /= len
      y /= len
      z /= len

      const da = Math.hypot(positions[aOffset] - cx, positions[aOffset + 1] - cy, positions[aOffset + 2] - cz)
      const db = Math.hypot(positions[bOffset] - cx, positions[bOffset + 1] - cy, positions[bOffset + 2] - cz)
      const maxDist = Math.min(da, db) * 0.46
      const moveDist = Math.hypot(x - cx, y - cy, z - cz)
      if (moveDist > maxDist && moveDist > 0) {
        const scale = maxDist / moveDist
        const rx = cx + (x - cx) * scale
        const ry = cy + (y - cy) * scale
        const rz = cz + (z - cz) * scale
        const rLen = Math.hypot(rx, ry, rz) || 1
        x = rx / rLen
        y = ry / rLen
        z = rz / rLen
      }
      next[cOffset] = x
      next[cOffset + 1] = y
      next[cOffset + 2] = z
    }
    positions = next
  }

  SHARED_SMOOTHED_CORNERS_BY_KEY.set(fullKey, positions)
  return positions
}

/**
 * Builds an indexed Voronoi cell surface `BufferGeometry` for a spherical mesh.
 * Each cell's dual polygon is triangulated as an indexed fan with `aCellId = regionId`
 * and radial unit normals. Built at most once per `meshId` while referenced.
 */
export function acquireGlobeCellGeometry(
  mesh: MapMeshReader,
  tracker?: GpuResourceTracker,
  options: {
    readonly cacheKey?: string
    readonly cornerPositions?: Float64Array
  } = {},
): { geometry: THREE.BufferGeometry, release: () => void } {
  const geomKey = options.cacheKey ? `${mesh.meshId}:${options.cacheKey}` : mesh.meshId
  const existing = SHARED_GLOBE_GEOMETRY_BY_MESH_ID.get(geomKey)
  if (existing) {
    existing.refCount++
    tracker?.trackGeometry(existing.geometry)
    return {
      geometry: existing.geometry,
      release: () => releaseGlobeCellGeometry(geomKey),
    }
  }

  const regionCount = mesh.regionCount
  let totalVertices = 0
  let totalTriangles = 0
  for (let r = 0; r < regionCount; r++) {
    const k = mesh.getRegionDegree(r)
    if (k >= 3) {
      totalVertices += k
      totalTriangles += k - 2
    }
  }

  const positions = new Float32Array(totalVertices * 3)
  const normals = new Float32Array(totalVertices * 3)
  const cellIds = new Float32Array(totalVertices)
  const indices = totalVertices > 65535
    ? new Uint32Array(totalTriangles * 3)
    : new Uint16Array(totalTriangles * 3)

  // Extract all dual corner positions once (or use smoothed corner positions)
  let cornerPositions = options.cornerPositions
  if (!cornerPositions) {
    cornerPositions = new Float64Array(mesh.cornerCount * 3)
    const cornerOut = { x: 0, y: 0, z: 0 }
    for (let c = 0; c < mesh.cornerCount; c++) {
      mesh.getCornerPosition(c, cornerOut)
      cornerPositions[c * 3] = cornerOut.x
      cornerPositions[c * 3 + 1] = cornerOut.y
      cornerPositions[c * 3 + 2] = cornerOut.z
    }
  }

  let vertexCursor = 0
  let indexCursor = 0

  for (let r = 0; r < regionCount; r++) {
    const baseVertex = vertexCursor
    let k = 0
    mesh.forEachRegionNeighbor(r, (_neighbor, cornerA) => {
      const c3 = cornerA * 3
      const x = cornerPositions![c3]
      const y = cornerPositions![c3 + 1]
      const z = cornerPositions![c3 + 2]
      const len = Math.hypot(x, y, z) || 1
      const nx = x / len
      const ny = y / len
      const nz = z / len
      const vOffset = vertexCursor * 3
      positions[vOffset] = nx
      positions[vOffset + 1] = ny
      positions[vOffset + 2] = nz
      normals[vOffset] = nx
      normals[vOffset + 1] = ny
      normals[vOffset + 2] = nz
      cellIds[vertexCursor] = r
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
  geometry.setAttribute('aCellId', new THREE.BufferAttribute(cellIds, 1))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1.02)

  tracker?.trackGeometry(geometry)
  SHARED_GLOBE_GEOMETRY_BY_MESH_ID.set(geomKey, {
    key: geomKey,
    geometry,
    refCount: 1,
  })

  return {
    geometry,
    release: () => releaseGlobeCellGeometry(geomKey),
  }
}

function releaseGlobeCellGeometry(geomKey: string): void {
  const entry = SHARED_GLOBE_GEOMETRY_BY_MESH_ID.get(geomKey)
  if (!entry)
    return
  entry.refCount--
  if (entry.refCount <= 0) {
    SHARED_GLOBE_GEOMETRY_BY_MESH_ID.delete(geomKey)
    entry.geometry.dispose()
  }
}

/**
 * Builds a 2D projected Voronoi cell `BufferGeometry` for `AtlasView`:
 * - Unwraps each cell's dual ring near its cell center longitude.
 * - Clips cells crossing `±180°` or polar boundaries (`±maxLatitudeDegrees`) via Sutherland-Hodgman
 *   into `[-180, 180]` fragments so zero triangles ever stretch horizontally across the map.
 * - Preserves `normal` = 3D spherical cell normal so optional `dayNight` lighting works in 2D too.
 * - Built at most once per `(meshId, projection.id)` (or smoothed key) while referenced.
 */
export function acquireAtlasCellGeometry(
  mesh: MapMeshReader,
  projection: MapProjection,
  tracker?: GpuResourceTracker,
  options: {
    readonly cacheKey?: string
    readonly cornerPositions?: Float64Array
  } = {},
): { geometry: THREE.BufferGeometry, release: () => void } {
  const key = options.cacheKey
    ? `${mesh.meshId}:${projection.id}:${options.cacheKey}`
    : `${mesh.meshId}:${projection.id}`
  const existing = SHARED_ATLAS_GEOMETRY_BY_KEY.get(key)
  if (existing) {
    existing.refCount++
    tracker?.trackGeometry(existing.geometry)
    return {
      geometry: existing.geometry,
      release: () => releaseAtlasCellGeometry(key),
    }
  }

  const regionCount = mesh.regionCount
  const maxLat = projection.maxLatitudeDegrees

  const cornerLonLat = new Float64Array(mesh.cornerCount * 2)
  const customCorners = options.cornerPositions
  if (customCorners) {
    for (let c = 0; c < mesh.cornerCount; c++) {
      const [lon, lat] = cartesianToLonLatDeg(
        customCorners[c * 3],
        customCorners[c * 3 + 1],
        customCorners[c * 3 + 2],
      )
      cornerLonLat[c * 2] = lon
      cornerLonLat[c * 2 + 1] = lat
    }
  }
  else {
    const cornerOut = { x: 0, y: 0, z: 0 }
    for (let c = 0; c < mesh.cornerCount; c++) {
      mesh.getCornerPosition(c, cornerOut)
      const [lon, lat] = cartesianToLonLatDeg(cornerOut.x, cornerOut.y, cornerOut.z)
      cornerLonLat[c * 2] = lon
      cornerLonLat[c * 2 + 1] = lat
    }
  }

  const outPositions: number[] = []
  const outNormals: number[] = []
  const outCellIds: number[] = []
  const outIndices: number[] = []
  let vertexCursor = 0

  const centerOut = { x: 0, y: 0, z: 0 }
  const ringScratch: [number, number][] = []

  const appendProjectedPolygonFan = (
    lonLatRing: readonly [number, number][],
    cellId: number,
    nx: number,
    ny: number,
    nz: number,
  ): void => {
    if (lonLatRing.length < 3)
      return
    const baseVertex = vertexCursor
    for (let i = 0; i < lonLatRing.length; i++) {
      const [px, py] = projection.project(lonLatRing[i][0], lonLatRing[i][1])
      outPositions.push(px, py, 0)
      outNormals.push(nx, ny, nz)
      outCellIds.push(cellId)
      vertexCursor++
    }
    for (let i = 1; i < lonLatRing.length - 1; i++) {
      outIndices.push(baseVertex, baseVertex + i, baseVertex + i + 1)
    }
  }

  for (let r = 0; r < regionCount; r++) {
    mesh.getRegionCenter(r, centerOut)
    const len = Math.hypot(centerOut.x, centerOut.y, centerOut.z) || 1
    const nx = centerOut.x / len
    const ny = centerOut.y / len
    const nz = centerOut.z / len
    const [centerLon, centerLat] = cartesianToLonLatDeg(nx, ny, nz)

    ringScratch.length = 0
    let minLon = Infinity
    let maxLon = -Infinity
    let minLat = Infinity
    let maxLatCell = -Infinity

    mesh.forEachRegionNeighbor(r, (_neighbor, cornerA) => {
      const rawLon = cornerLonLat[cornerA * 2]
      const rawLat = cornerLonLat[cornerA * 2 + 1]
      const prevLon = ringScratch.length > 0 ? ringScratch[ringScratch.length - 1][0] : centerLon
      const uLon = unwrapLongitudeDegNear(rawLon, prevLon)
      ringScratch.push([uLon, rawLat])
      if (uLon < minLon)
        minLon = uLon
      if (uLon > maxLon)
        maxLon = uLon
      if (rawLat < minLat)
        minLat = rawLat
      if (rawLat > maxLatCell)
        maxLatCell = rawLat
    })

    if (ringScratch.length < 3)
      continue

    // Polar cap cell (encloses North or South Pole where unwrapped longitude spans ~360 deg)
    const isPolarCap = Math.abs(centerLat) > 82 && (maxLon - minLon) > 240
    if (isPolarCap) {
      const poleLat = centerLat > 0 ? maxLat : -maxLat
      // Sort vertices by wrapped longitude [-180, 180] and close along the polar boundary
      const sorted = ringScratch
        .map(([lon, lat]) => [((lon + 180) % 360 + 360) % 360 - 180, Math.max(-maxLat, Math.min(maxLat, lat))] as [number, number])
        .sort((a, b) => a[0] - b[0])
      const polarPoly: [number, number][] = [
        [-180, poleLat],
        [-180, sorted[0][1]],
        ...sorted,
        [180, sorted.at(-1)![1]],
        [180, poleLat],
      ]
      appendProjectedPolygonFan(polarPoly, r, nx, ny, nz)
      continue
    }

    // Fast path: cell lies strictly inside [-180, 180] and [-maxLat, maxLat]
    if (minLon >= -180 && maxLon <= 180 && minLat >= -maxLat && maxLatCell <= maxLat) {
      appendProjectedPolygonFan(ringScratch, r, nx, ny, nz)
      continue
    }

    // Cell crosses ±180° antimeridian or polar truncation boundary: clip into [-180, 180] windows
    const minK = Math.floor((minLon + 180) / 360)
    const maxK = Math.floor((maxLon + 180 - 1e-9) / 360)
    for (let k = minK; k <= maxK; k++) {
      const shift = k * 360
      const shifted: [number, number][] = ringScratch.map(([lon, lat]) => [lon - shift, lat])
      const clipped = clipRingToGeographicBox(shifted, -180, 180, -maxLat, maxLat)
      if (clipped.length >= 3) {
        appendProjectedPolygonFan(clipped, r, nx, ny, nz)
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(outPositions), 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(outNormals), 3))
  geometry.setAttribute('aCellId', new THREE.BufferAttribute(new Float32Array(outCellIds), 1))
  const indexArray = vertexCursor > 65535 ? new Uint32Array(outIndices) : new Uint16Array(outIndices)
  geometry.setIndex(new THREE.BufferAttribute(indexArray, 1))
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), Math.hypot(projection.worldWidth, projection.worldHeight))

  tracker?.trackGeometry(geometry)
  SHARED_ATLAS_GEOMETRY_BY_KEY.set(key, {
    key,
    geometry,
    refCount: 1,
  })

  return {
    geometry,
    release: () => releaseAtlasCellGeometry(key),
  }
}

function releaseAtlasCellGeometry(key: string): void {
  const entry = SHARED_ATLAS_GEOMETRY_BY_KEY.get(key)
  if (!entry)
    return
  entry.refCount--
  if (entry.refCount <= 0) {
    SHARED_ATLAS_GEOMETRY_BY_KEY.delete(key)
    entry.geometry.dispose()
  }
}

export function getCachedGlobeGeometryCount(): number {
  return SHARED_GLOBE_GEOMETRY_BY_MESH_ID.size
}

export function getCachedAtlasGeometryCount(): number {
  return SHARED_ATLAS_GEOMETRY_BY_KEY.size
}

function resolveLayerBoundarySmoothing(
  layerId: string,
  reader: WorldMapReader,
): { readonly cacheKey: string, readonly cornerPositions: Float64Array } | null {
  const { mesh, capabilities } = reader
  const count = mesh.regionCount

  if (layerId === 'thematic-continents') {
    const geoRegions = reader.geographicRegions()
    if (!capabilities.hasGeographicRegions || !geoRegions)
      return null
    const continentField = reader.field('continentIndex')
    const oceanField = reader.field('oceanIndex')
    const seaField = capabilities.hasSeaClassification ? reader.field('seaIndex') : null
    const continentCount = geoRegions.continents.length
    const oceanCount = geoRegions.oceans.length
    const seaCount = seaField ? geoRegions.seas.length : 0
    const groupIds = new Int32Array(count).fill(-1)
    for (let r = 0; r < count; r++) {
      const cIdx = continentField.get(r)
      if (cIdx >= 0 && cIdx < continentCount) {
        groupIds[r] = cIdx
        continue
      }
      const oIdx = oceanField.get(r)
      if (oIdx >= 0 && oIdx < oceanCount) {
        groupIds[r] = continentCount + oIdx
        continue
      }
      if (seaField) {
        const sIdx = seaField.get(r)
        if (sIdx >= 0 && sIdx < seaCount) {
          groupIds[r] = continentCount + oceanCount + sIdx
        }
      }
    }
    return {
      cacheKey: 'smooth:continents-v1',
      cornerPositions: acquireSmoothedDualCorners(mesh, 'smooth:continents-v1', groupIds, 4, 0.44),
    }
  }

  if (layerId === 'thematic-koppen') {
    const landMask = reader.field('landMask')
    const koppen = reader.field('koppenClass')
    const groupIds = new Int32Array(count)
    for (let r = 0; r < count; r++) {
      groupIds[r] = landMask.get(r) === 0 ? -1 : Math.floor(koppen.get(r))
    }
    return {
      cacheKey: 'smooth:koppen-v1',
      cornerPositions: acquireSmoothedDualCorners(mesh, 'smooth:koppen-v1', groupIds, 4, 0.44),
    }
  }

  if (layerId === 'thematic-biomes') {
    const landMask = reader.field('landMask')
    const biomes = reader.field('potentialBiomeIndex')
    const groupIds = new Int32Array(count)
    for (let r = 0; r < count; r++) {
      groupIds[r] = landMask.get(r) === 0 ? -1 : Math.floor(biomes.get(r))
    }
    return {
      cacheKey: 'smooth:biomes-v1',
      cornerPositions: acquireSmoothedDualCorners(mesh, 'smooth:biomes-v1', groupIds, 4, 0.44),
    }
  }

  if (layerId === 'thematic-land-cover') {
    const landMask = reader.field('landMask')
    const landCover = reader.field('landCoverIndex')
    const groupIds = new Int32Array(count)
    for (let r = 0; r < count; r++) {
      groupIds[r] = landMask.get(r) === 0 ? -1 : Math.floor(landCover.get(r))
    }
    return {
      cacheKey: 'smooth:land-cover-v1',
      cornerPositions: acquireSmoothedDualCorners(mesh, 'smooth:land-cover-v1', groupIds, 4, 0.44),
    }
  }

  return null
}

const RASTER_VERTEX_SHADER = /* glsl */`
  #if __VERSION__ >= 300
    #define FLAT_VARYING flat
  #else
    #define FLAT_VARYING
  #endif
  attribute float aCellId;
  FLAT_VARYING varying float vCellId;
  varying vec3 vWorldNormal;

  void main() {
    vCellId = aCellId;
    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const RASTER_FRAGMENT_SHADER = /* glsl */`
  #if __VERSION__ >= 300
    #define FLAT_VARYING flat
  #else
    #define FLAT_VARYING
  #endif
  uniform sampler2D uCellColorTex;
  uniform int uTexWidth;
  uniform int uTexHeight;
  uniform float uLayerOpacity;
  uniform float uDayNightEnabled;
  uniform float uSatelliteLighting;
  uniform vec3 uSunDirection;

  FLAT_VARYING varying float vCellId;
  varying vec3 vWorldNormal;

  vec3 srgbToLinear(vec3 srgb) {
    return mix(srgb / 12.92, pow((srgb + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), srgb));
  }

  vec3 linearToSrgb(vec3 linear) {
    vec3 clamped = clamp(linear, 0.0, 1.0);
    return mix(clamped * 12.92, 1.055 * pow(clamped, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), clamped));
  }

  vec4 fetchCellColor(int cellId) {
    int col = cellId - (cellId / uTexWidth) * uTexWidth;
    int row = cellId / uTexWidth;
    #if __VERSION__ >= 300
      return texelFetch(uCellColorTex, ivec2(col, row), 0);
    #else
      vec2 uv = (vec2(float(col), float(row)) + 0.5) / vec2(float(uTexWidth), float(uTexHeight));
      return texture2D(uCellColorTex, uv);
    #endif
  }

  void main() {
    int cellId = int(floor(vCellId + 0.5));
    vec4 texColor = fetchCellColor(cellId);
    float alpha = texColor.a * uLayerOpacity;
    if (alpha <= 0.001) {
      discard;
    }

    vec3 rgb = texColor.rgb;
    if (uDayNightEnabled > 0.5) {
      float dotNL = max(0.0, dot(normalize(vWorldNormal), normalize(uSunDirection)));
      vec3 ambientIrradiance = vec3(0.081, 0.130, 0.199) * 1.1;
      vec3 directIrradiance = vec3(1.0, 0.963, 0.871) * (4.0 * dotNL);
      vec3 lightFactor = (ambientIrradiance + directIrradiance) * 0.318309886;
      vec3 linearLit = srgbToLinear(rgb) * lightFactor;
      rgb = linearToSrgb(linearLit);
    } else if (uSatelliteLighting > 0.5) {
      float dotNL = max(0.0, dot(normalize(vWorldNormal), normalize(uSunDirection)));
      vec3 ambientIrradiance = vec3(0.402, 0.497, 0.604) * 3.5;
      vec3 directIrradiance = vec3(1.0, 0.940, 0.855) * (1.5 * dotNL);
      vec3 lightFactor = (ambientIrradiance + directIrradiance) * 0.318309886;
      vec3 linearLit = srgbToLinear(rgb) * lightFactor;
      rgb = linearToSrgb(linearLit);
    }

    gl_FragColor = vec4(rgb, alpha);
  }
`

export interface RasterLayerOptions {
  readonly renderOrder?: number
  readonly polygonOffsetFactor?: number
  readonly polygonOffsetUnits?: number
  readonly radiusScale?: number
  readonly projection?: MapProjection
  readonly zOffset?: number
  readonly tracker?: GpuResourceTracker
}

/**
 * GPU `RasterLayer` renderer:
 * - Uses the shared indexed Voronoi cell geometry (3D Globe or 2D Atlas projection).
 * - Evaluates `raster-color` / `raster-opacity` / `satellite` mode into a `THREE.DataTexture`
 *   and samples it via `texelFetch` in the fragment shader (`< 2ms` single texture upload).
 */
export class RasterLayer {
  readonly id: string
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  readonly colorTexture: THREE.DataTexture
  readonly colorBuffer: Uint8Array
  readonly texWidth: number
  readonly texHeight: number

  private readonly reader: WorldMapReader
  private readonly releaseGeometry: () => void
  private readonly cellPropsScratch: Record<string, unknown> = {}
  private disposed = false
  private lastEvaluatedKey = ''
  readonly updateCount = { textureUploads: 0 }

  constructor(
    id: string,
    reader: WorldMapReader,
    options: RasterLayerOptions = {},
  ) {
    this.id = id
    this.reader = reader

    const regionCount = reader.identity.regionCount
    this.texWidth = Math.min(RASTER_TEX_WIDTH, Math.max(1, regionCount))
    this.texHeight = Math.max(1, Math.ceil(regionCount / this.texWidth))
    this.colorBuffer = new Uint8Array(this.texWidth * this.texHeight * 4)

    this.colorTexture = new THREE.DataTexture(
      this.colorBuffer,
      this.texWidth,
      this.texHeight,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    )
    this.colorTexture.minFilter = THREE.NearestFilter
    this.colorTexture.magFilter = THREE.NearestFilter
    this.colorTexture.generateMipmaps = false
    this.colorTexture.needsUpdate = true
    options.tracker?.trackTexture(this.colorTexture)

    const smoothing = resolveLayerBoundarySmoothing(id, reader)
    const { geometry, release } = options.projection
      ? acquireAtlasCellGeometry(reader.mesh, options.projection, options.tracker, smoothing ?? undefined)
      : acquireGlobeCellGeometry(reader.mesh, options.tracker, smoothing ?? undefined)
    this.releaseGeometry = release

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uCellColorTex: { value: this.colorTexture },
        uTexWidth: { value: this.texWidth },
        uTexHeight: { value: this.texHeight },
        uLayerOpacity: { value: 1 },
        uDayNightEnabled: { value: 0 },
        uSatelliteLighting: { value: 0 },
        uSunDirection: { value: new THREE.Vector3(1.8, 1.2, 2.2).normalize() },
      },
      vertexShader: RASTER_VERTEX_SHADER,
      fragmentShader: RASTER_FRAGMENT_SHADER,
      transparent: false,
      depthTest: true,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: options.polygonOffsetFactor ?? 2,
      polygonOffsetUnits: options.polygonOffsetUnits ?? 2,
    })
    options.tracker?.trackMaterial(material)

    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.name = `RasterLayer:${id}`
    this.mesh.renderOrder = options.renderOrder ?? 0
    if (!options.projection && options.radiusScale && options.radiusScale !== 1) {
      this.mesh.scale.setScalar(options.radiusScale)
    }
    if (options.projection && options.zOffset !== undefined) {
      this.mesh.position.z = options.zOffset
    }
  }

  updateStyleAndSource(
    compiledLayer: CompiledMapStyleLayer,
    registry: MapSourceRegistry,
    styleZoom: number,
    month: number,
    styleId: string,
    polarIce = false,
  ): void {
    if (this.disposed)
      return

    const inZoom = styleZoom >= compiledLayer.minzoom && styleZoom <= compiledLayer.maxzoom
    const layoutVisibility = compiledLayer.layout.visibility?.evaluate({ zoom: styleZoom })
    this.mesh.visible = inZoom && layoutVisibility !== 'none'
    if (!this.mesh.visible)
      return

    const rasterModeExpr = compiledLayer.paint['raster-mode'] ?? compiledLayer.layout['raster-mode']
    const rasterMode = rasterModeExpr ? String(rasterModeExpr.evaluate({ zoom: styleZoom })) : 'color'
    const hillshadeExpr = compiledLayer.paint['raster-hillshade']
    const hillshadeStrength = hillshadeExpr ? Number(hillshadeExpr.evaluate({ zoom: styleZoom }) ?? 0) : 0
    const opacityExpr = compiledLayer.paint['raster-opacity']
    const colorExpr = compiledLayer.paint['raster-color']

    const isZoomDependent = (colorExpr?.dependency === 'zoom' || colorExpr?.dependency === 'zoom-feature')
      || (opacityExpr?.dependency === 'zoom' || opacityExpr?.dependency === 'zoom-feature')
      || (hillshadeExpr?.dependency === 'zoom' || hillshadeExpr?.dependency === 'zoom-feature')

    const isMonthlySource = compiledLayer.source === 'climate-monthly'
    const paintPolarIce = polarIce && styleId === 'satellite'
    const cacheKey = `${styleId}:${compiledLayer.id}:${rasterMode}:${isMonthlySource ? month : 'static'}:${isZoomDependent ? styleZoom.toFixed(2) : 'z0'}:${hillshadeStrength.toFixed(3)}:${paintPolarIce ? 'ice' : 'noice'}`

    if (cacheKey === this.lastEvaluatedKey)
      return
    this.lastEvaluatedKey = cacheKey

    if (rasterMode === 'satellite') {
      const constOpacity = opacityExpr ? Number(opacityExpr.evaluate({ zoom: styleZoom }) ?? 1) : 1
      writeSatelliteCellColorsRgba8(this.reader, this.colorBuffer, {
        hillshadeStrength,
        opacity: constOpacity,
        polarIce: paintPolarIce,
      })
      this.mesh.material.transparent = constOpacity < 0.999
      this.mesh.material.depthWrite = constOpacity >= 0.999
    }
    else {
      const resolved = registry.getSource(compiledLayer.source, { month })
      if (resolved.unavailable || resolved.kind !== 'raster') {
        this.colorBuffer.fill(0)
        this.mesh.visible = false
        return
      }
      this.evaluateCellColors(compiledLayer, resolved, styleZoom, hillshadeStrength, paintPolarIce)
    }

    this.colorTexture.needsUpdate = true
    this.updateCount.textureUploads++
  }

  private evaluateCellColors(
    compiledLayer: CompiledMapStyleLayer,
    source: RasterCellSource,
    styleZoom: number,
    hillshadeStrength: number,
    polarIce = false,
  ): void {
    const count = source.regionCount
    const colorExpr = compiledLayer.paint['raster-color']
    const opacityExpr = compiledLayer.paint['raster-opacity']
    const filterExpr = compiledLayer.filter

    const referencedProps = new Set<string>([
      ...(colorExpr?.referencedProperties ?? []),
      ...(opacityExpr?.referencedProperties ?? []),
      ...(filterExpr?.referencedProperties ?? []),
    ])
    const propNames = [...referencedProps].filter(name => name in source.fields)

    let hasTransparency = false
    const props = this.cellPropsScratch

    for (let r = 0; r < count; r++) {
      for (let p = 0; p < propNames.length; p++) {
        const name = propNames[p]
        props[name] = source.getCellValue(name, r)
      }
      const evalInput = {
        zoom: styleZoom,
        properties: props,
        isNoData: (propName: string) => (propName in source.fields ? source.isNoData(propName, r) : false),
      }
      const offset = r * 4

      if (filterExpr && !filterExpr.evaluate(evalInput)) {
        this.colorBuffer[offset] = 0
        this.colorBuffer[offset + 1] = 0
        this.colorBuffer[offset + 2] = 0
        this.colorBuffer[offset + 3] = 0
        hasTransparency = true
        continue
      }

      const rawOpacity = opacityExpr ? Number(opacityExpr.evaluate(evalInput) ?? 1) : 1
      const alpha = Math.max(0, Math.min(255, Math.round(rawOpacity * 255)))
      if (alpha < 255)
        hasTransparency = true

      if (alpha === 0) {
        this.colorBuffer[offset] = 0
        this.colorBuffer[offset + 1] = 0
        this.colorBuffer[offset + 2] = 0
        this.colorBuffer[offset + 3] = 0
        continue
      }

      const rawColor = colorExpr ? String(colorExpr.evaluate(evalInput) ?? '#000000') : '#000000'
      const [cr, cg, cb, ca] = parseCssColorToRgba8(rawColor)
      const finalAlpha = Math.round((alpha * ca) / 255)
      if (finalAlpha < 255)
        hasTransparency = true

      this.colorBuffer[offset] = cr
      this.colorBuffer[offset + 1] = cg
      this.colorBuffer[offset + 2] = cb
      this.colorBuffer[offset + 3] = finalAlpha
    }

    if (polarIce)
      applyPolarIceToRgba8(this.reader, this.colorBuffer, count)

    if (hillshadeStrength > 0) {
      applyCellHillshadeRgba8(this.reader, this.colorBuffer, hillshadeStrength, polarIce)
    }

    this.mesh.material.transparent = hasTransparency
    this.mesh.material.depthWrite = !hasTransparency
  }

  setLighting(dayNightEnabled: boolean, sunDirection: THREE.Vector3, satelliteLighting = false): void {
    if (this.disposed)
      return
    this.mesh.material.uniforms.uDayNightEnabled.value = dayNightEnabled ? 1 : 0
    this.mesh.material.uniforms.uSatelliteLighting.value = satelliteLighting ? 1 : 0
    this.mesh.material.uniforms.uSunDirection.value.copy(sunDirection).normalize()
  }

  dispose(): void {
    if (this.disposed)
      return
    this.disposed = true
    this.mesh.material.dispose()
    this.colorTexture.dispose()
    this.releaseGeometry()
  }
}
