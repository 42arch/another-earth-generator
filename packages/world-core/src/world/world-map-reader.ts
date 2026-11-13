import type { FieldView, NumericArray } from './fields'
import type { WorldSnapshot } from './world-snapshot'
import { createNoise3D } from 'simplex-noise'
import { clamp, smoothstep } from '#math/math'
import { DeterministicRandom } from '#math/random'
import { createFieldView } from './fields'

export type WorldMapFieldName =
  | 'plateIndex'
  | 'crustType'
  | 'elevationKm'
  | 'landMask'
  | 'slopeDeg'
  | 'surfaceDetail'
  | 'hillshade'
  | 'continentIndex'
  | 'oceanIndex'
  | 'seaIndex'
  | 'annualMeanTemperatureC'
  | 'annualPrecipitationMm'
  | 'koppenClass'
  | 'oceanAvailable'
  | 'downstreamRegion'
  | 'annualRunoffMm'
  | 'annualRunoffVolumeM3'
  | 'accumulatedAnnualFlowM3s'
  | 'contributingAreaKm2'
  | 'basinIndex'
  | 'riverIndex'
  | 'lakeIndex'
  | 'potentialBiomeIndex'
  | 'landCoverIndex'
  | 'aridityIndex'
  | 'growingSeasonMonths'
  | 'population'

export type WorldMonthlyFieldName =
  | 'temperatureC'
  | 'precipitationMm'
  | 'snowWaterEquivalentMm'
  | 'snowfallMm'
  | 'snowmeltMm'
  | 'windEastMps'
  | 'windNorthMps'
  | 'windSpeedMps'
  | 'oceanEastMps'
  | 'oceanNorthMps'
  | 'oceanSpeedMps'
  | 'oceanWarmth'

export interface GeographicMapRegions {
  readonly continents: readonly Readonly<{ id: string, areaKm2: number, name?: string }>[]
  readonly oceans: readonly Readonly<{ id: string, areaKm2: number, name?: string, definingContinentIds?: readonly string[] }>[]
  readonly seas: readonly Readonly<{ id: string, areaKm2: number }>[]
}

export interface BasinMapSummary {
  readonly id: string
  readonly outletRegion: number
  readonly endorheic: boolean
  readonly areaKm2: number
  readonly annualRunoffM3: number
}

export interface RiverMapSummary {
  readonly id: string
  readonly sourceRegion: number
  readonly mouthRegion: number
  readonly downstreamRiver: number
  readonly annualMeanDischargeM3s: number
  readonly strahlerOrder: number
  readonly endorheic: boolean
  readonly regionCount: number
}

export interface LakeMapSummary {
  readonly id: string
  readonly basinId: string
  readonly endorheic: boolean
  readonly areaKm2: number
  readonly waterLevelKm: number
  readonly spillRegion: number | null
  readonly downstreamRegion: number | null
  readonly regionCount: number
}

export interface MapMeshReader {
  readonly meshId: string
  readonly regionCount: number
  readonly cornerCount: number
  readonly edgeCount: number
  readonly physicalRadiusKm: number
  getRegionCenter: (region: number, out: { x: number, y: number, z: number }) => void
  getRegionAreaKm2: (region: number) => number
  getCornerPosition: (corner: number, out: { x: number, y: number, z: number }) => void
  getRegionDegree: (region: number) => number
  forEachRegionNeighbor: (
    region: number,
    visit: (neighborRegion: number, cornerA: number, cornerB: number, edgeId: number) => void,
  ) => void
  forEachEdge: (
    visit: (edgeId: number, regionA: number, regionB: number, cornerA: number, cornerB: number) => void,
  ) => void
  locateRegion: (x: number, y: number, z: number) => number
}

export interface WorldMapReader {
  readonly identity: Readonly<{
    snapshotId: string
    worldId: string
    revision: number
    meshId: string
    regionCount: number
  }>
  readonly planet: Readonly<{
    radiusKm: number
    axialTiltDegrees: number
  }>
  readonly capabilities: Readonly<{
    hasGeographicRegions: boolean
    hasGeographicNames: boolean
    hasSeaClassification: boolean
    hasCirculation: boolean
  }>
  readonly mesh: MapMeshReader
  field: (name: WorldMapFieldName) => FieldView
  monthlyField: (name: WorldMonthlyFieldName, month: number) => FieldView
  plates: () => readonly { readonly id: string }[]
  geographicRegions: () => GeographicMapRegions | null
  basins: () => readonly BasinMapSummary[]
  rivers: () => readonly RiverMapSummary[]
  forEachRiverRegion: (riverIndex: number, visit: (region: number, stepIndex: number) => void) => void
  lakes: () => readonly LakeMapSummary[]
  forEachLakeRegion: (lakeIndex: number, visit: (region: number) => void) => void
  ecologyDictionaries: () => Readonly<{
    potentialBiomeIds: readonly string[]
    landCoverIds: readonly string[]
  }>
}

interface DualTopologyData {
  readonly cornerCount: number
  readonly edgeCount: number
  readonly dualVertices: Float64Array
  readonly sortedNeighbors: Uint32Array
  readonly boundaryCorners: Uint32Array
  readonly sortedEdgeIds: Uint32Array
  readonly edgeRegions: Uint32Array
  readonly edgeCorners: Uint32Array
  readonly seedRegions: Uint32Array
}

const RAD_TO_DEG = 180 / Math.PI
const SATELLITE_HILLSHADE_GRADIENT_SCALE = 12
const SURFACE_DETAIL_NAMESPACE = 'world-map-reader:surface-detail-v1'

function createSliceFieldView(meshId: string, values: NumericArray, offset: number, length: number): FieldView {
  return Object.freeze({
    meshId,
    length,
    get(index: number) {
      if (!Number.isInteger(index) || index < 0 || index >= length)
        throw new RangeError('Invalid field index')
      return values[offset + index]
    },
  })
}

function buildDualTopology(mesh: WorldSnapshot['mesh']): DualTopologyData {
  const count = mesh.regionCount
  const { centers, neighborOffsets, neighbors } = mesh
  const totalHalfEdges = neighbors.length
  if (totalHalfEdges % 2 !== 0 || totalHalfEdges % 3 !== 0)
    throw new Error('Closed spherical Voronoi mesh requires 2E = 3F half-edges')

  const edgeCount = totalHalfEdges / 2
  const expectedFaces = totalHalfEdges / 3
  const sortedNeighbors = neighbors.slice()
  let maxDegree = 0
  for (let r = 0; r < count; r++)
    maxDegree = Math.max(maxDegree, neighborOffsets[r + 1] - neighborOffsets[r])

  const angles = new Float64Array(maxDegree)
  for (let r = 0; r < count; r++) {
    const start = neighborOffsets[r]
    const end = neighborOffsets[r + 1]
    const degree = end - start
    if (degree < 3)
      throw new Error('Invalid spherical cell valence')

    const x = centers[3 * r]
    const y = centers[3 * r + 1]
    const z = centers[3 * r + 2]
    const refx = Math.abs(y) < 0.9 ? 0 : 1
    const refy = Math.abs(y) < 0.9 ? 1 : 0
    const el = Math.hypot(refy * z, -refx * z, refx * y - refy * x)
    const ex = refy * z / el
    const ey = -refx * z / el
    const ez = (refx * y - refy * x) / el
    const nx = y * ez - z * ey
    const ny = z * ex - x * ez
    const nz = x * ey - y * ex

    for (let i = start; i < end; i++) {
      const nb = 3 * sortedNeighbors[i]
      angles[i - start] = Math.atan2(
        centers[nb] * nx + centers[nb + 1] * ny + centers[nb + 2] * nz,
        centers[nb] * ex + centers[nb + 1] * ey + centers[nb + 2] * ez,
      )
    }

    for (let i = 1; i < degree; i++) {
      const neighbor = sortedNeighbors[start + i]
      const angle = angles[i]
      let j = i - 1
      while (j >= 0 && angles[j] > angle) {
        sortedNeighbors[start + j + 1] = sortedNeighbors[start + j]
        angles[j + 1] = angles[j]
        j--
      }
      sortedNeighbors[start + j + 1] = neighbor
      angles[j + 1] = angle
    }
  }

  const boundaryCorners = new Uint32Array(totalHalfEdges).fill(0xFFFFFFFF)
  const dualVertices = new Float64Array(3 * expectedFaces)
  let cornerCount = 0

  const findHalfEdgeSlot = (from: number, to: number): number => {
    for (let i = neighborOffsets[from]; i < neighborOffsets[from + 1]; i++) {
      if (sortedNeighbors[i] === to)
        return i
    }
    return -1
  }

  for (let r = 0; r < count; r++) {
    const start = neighborOffsets[r]
    const end = neighborOffsets[r + 1]
    for (let i = start; i < end; i++) {
      const u = sortedNeighbors[i]
      const v = sortedNeighbors[i + 1 < end ? i + 1 : start]
      if (r >= u || r >= v)
        continue

      const slotU = findHalfEdgeSlot(u, v)
      const slotV = findHalfEdgeSlot(v, r)
      if (slotU < 0 || slotV < 0)
        throw new Error('Nonmanifold spherical Delaunay face')
      const nextU = sortedNeighbors[slotU + 1 < neighborOffsets[u + 1] ? slotU + 1 : neighborOffsets[u]]
      const nextV = sortedNeighbors[slotV + 1 < neighborOffsets[v + 1] ? slotV + 1 : neighborOffsets[v]]
      if (nextU !== r || nextV !== u)
        throw new Error('Inconsistent CCW neighbor ring')
      if (cornerCount >= expectedFaces)
        throw new Error('Unexpected dual face count')

      const cornerId = cornerCount++
      const a = 3 * r
      const b = 3 * u
      const c = 3 * v
      const abx = centers[b] - centers[a]
      const aby = centers[b + 1] - centers[a + 1]
      const abz = centers[b + 2] - centers[a + 2]
      const acx = centers[c] - centers[a]
      const acy = centers[c + 1] - centers[a + 1]
      const acz = centers[c + 2] - centers[a + 2]
      const x = aby * acz - abz * acy
      const y = abz * acx - abx * acz
      const z = abx * acy - aby * acx
      const length = Math.hypot(x, y, z)
      if (!(length > 0) || x * centers[a] + y * centers[a + 1] + z * centers[a + 2] <= 0)
        throw new Error('Degenerate or inward Delaunay triangle')

      dualVertices[3 * cornerId] = x / length
      dualVertices[3 * cornerId + 1] = y / length
      dualVertices[3 * cornerId + 2] = z / length
      boundaryCorners[i] = cornerId
      boundaryCorners[slotU] = cornerId
      boundaryCorners[slotV] = cornerId
    }
  }

  if (cornerCount !== expectedFaces || boundaryCorners.includes(0xFFFFFFFF))
    throw new Error('Incomplete dual Voronoi reconstruction')

  const sortedEdgeIds = new Uint32Array(totalHalfEdges)
  const edgeRegions = new Uint32Array(2 * edgeCount)
  const edgeCorners = new Uint32Array(2 * edgeCount)
  let nextEdgeId = 0

  for (let r = 0; r < count; r++) {
    const start = neighborOffsets[r]
    const end = neighborOffsets[r + 1]
    for (let i = start; i < end; i++) {
      const nb = sortedNeighbors[i]
      if (r >= nb)
        continue
      const reverseSlot = findHalfEdgeSlot(nb, r)
      if (reverseSlot < 0 || nextEdgeId >= edgeCount)
        throw new Error('Missing reciprocal edge in dual reconstruction')
      const prevSlot = i > start ? i - 1 : end - 1
      const cornerA = boundaryCorners[prevSlot]
      const cornerB = boundaryCorners[i]
      const edgeId = nextEdgeId++
      sortedEdgeIds[i] = edgeId
      sortedEdgeIds[reverseSlot] = edgeId
      edgeRegions[2 * edgeId] = r
      edgeRegions[2 * edgeId + 1] = nb
      edgeCorners[2 * edgeId] = cornerA
      edgeCorners[2 * edgeId + 1] = cornerB
    }
  }

  if (nextEdgeId !== edgeCount)
    throw new Error('Unexpected dual edge count')

  const targetSeeds = Math.min(count, Math.max(1, Math.min(64, Math.ceil(Math.sqrt(count) / 4))))
  const stride = Math.max(1, Math.floor(count / targetSeeds))
  const seeds: number[] = []
  for (let r = 0; r < count && seeds.length < targetSeeds; r += stride)
    seeds.push(r)

  return {
    cornerCount,
    edgeCount,
    dualVertices,
    sortedNeighbors,
    boundaryCorners,
    sortedEdgeIds,
    edgeRegions,
    edgeCorners,
    seedRegions: Uint32Array.from(seeds),
  }
}

function locateVoronoiRegion(
  centers: Float64Array,
  neighborOffsets: Uint32Array,
  neighbors: Uint32Array,
  seedRegions: Uint32Array,
  x: number,
  y: number,
  z: number,
): number {
  const length = Math.hypot(x, y, z)
  if (!Number.isFinite(length) || !(length > 0))
    throw new RangeError('Invalid query direction')
  const qx = x / length
  const qy = y / length
  const qz = z / length

  const count = neighborOffsets.length - 1
  if (count <= 64) {
    let best = 0
    let bestDistSq = Infinity
    for (let r = 0; r < count; r++) {
      const dx = qx - centers[3 * r]
      const dy = qy - centers[3 * r + 1]
      const dz = qz - centers[3 * r + 2]
      const d = dx * dx + dy * dy + dz * dz
      if (d < bestDistSq || (d === bestDistSq && r < best)) {
        bestDistSq = d
        best = r
      }
    }
    return best
  }

  let current = seedRegions[0]
  let bestDistSq = Infinity
  for (let i = 0; i < seedRegions.length; i++) {
    const r = seedRegions[i]
    const dx = qx - centers[3 * r]
    const dy = qy - centers[3 * r + 1]
    const dz = qz - centers[3 * r + 2]
    const d = dx * dx + dy * dy + dz * dz
    if (d < bestDistSq || (d === bestDistSq && r < current)) {
      bestDistSq = d
      current = r
    }
  }

  while (true) {
    let next = current
    let nextDistSq = bestDistSq
    for (let i = neighborOffsets[current]; i < neighborOffsets[current + 1]; i++) {
      const nb = neighbors[i]
      const dx = qx - centers[3 * nb]
      const dy = qy - centers[3 * nb + 1]
      const dz = qz - centers[3 * nb + 2]
      const d = dx * dx + dy * dy + dz * dz
      if (d < nextDistSq || (d === nextDistSq && nb < next)) {
        nextDistSq = d
        next = nb
      }
    }
    if (next === current)
      break
    current = next
    bestDistSq = nextDistSq
  }

  // Expand one extra neighbor ring around ties for exact lower-ID tie-breaking.
  let exact = current
  let exactDistSq = bestDistSq
  for (let i = neighborOffsets[current]; i < neighborOffsets[current + 1]; i++) {
    const nb = neighbors[i]
    const dx = qx - centers[3 * nb]
    const dy = qy - centers[3 * nb + 1]
    const dz = qz - centers[3 * nb + 2]
    const d = dx * dx + dy * dy + dz * dz
    if (d < exactDistSq || (d === exactDistSq && nb < exact)) {
      exactDistSq = d
      exact = nb
    }
  }
  return exact
}

function computeSlopeDeg(world: WorldSnapshot): Float32Array {
  const { mesh, planet, nature } = world
  const count = mesh.regionCount
  const radiusKm = planet.physicalRadiusKm
  const centers = mesh.centers
  const offsets = mesh.neighborOffsets
  const neighbors = mesh.neighbors
  const elevationKm = nature.geography.elevationKm.values
  const slopeDeg = new Float32Array(count)

  for (let r = 0; r < count; r++) {
    const ax = centers[3 * r]
    const ay = centers[3 * r + 1]
    const az = centers[3 * r + 2]
    const elevA = elevationKm[r]
    let maxRadians = 0
    for (let i = offsets[r]; i < offsets[r + 1]; i++) {
      const nb = neighbors[i]
      const bx = centers[3 * nb]
      const by = centers[3 * nb + 1]
      const bz = centers[3 * nb + 2]
      const angle = Math.atan2(
        Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx),
        ax * bx + ay * by + az * bz,
      )
      const distanceKm = angle * radiusKm
      if (distanceKm > 0) {
        const slope = Math.atan(Math.abs(elevA - elevationKm[nb]) / distanceKm)
        if (slope > maxRadians)
          maxRadians = slope
      }
    }
    slopeDeg[r] = maxRadians * RAD_TO_DEG
  }
  return slopeDeg
}

function computeHillshade(world: WorldSnapshot): Float32Array {
  const { mesh, planet, nature } = world
  const count = mesh.regionCount
  const radiusKm = planet.physicalRadiusKm
  const centers = mesh.centers
  const offsets = mesh.neighborOffsets
  const neighbors = mesh.neighbors
  const rawElevation = nature.geography.elevationKm.values
  const landMask = nature.geography.landMask.values
  const landElevation = new Float32Array(count)
  const shading = new Float32Array(count)

  for (let r = 0; r < count; r++) {
    if (landMask[r])
      landElevation[r] = Math.max(0, rawElevation[r])
  }

  for (let r = 0; r < count; r++) {
    const x = centers[3 * r]
    const y = centers[3 * r + 1]
    const z = centers[3 * r + 2]
    const latitude = Math.asin(clamp(y, -1, 1))
    const longitude = Math.atan2(x, z)
    const eastX = Math.cos(longitude)
    const eastZ = -Math.sin(longitude)
    const northX = -Math.sin(latitude) * Math.sin(longitude)
    const northY = Math.cos(latitude)
    const northZ = -Math.sin(latitude) * Math.cos(longitude)
    let eastRise = 0
    let eastSpan = 0
    let northRise = 0
    let northSpan = 0

    for (let edge = offsets[r]; edge < offsets[r + 1]; edge++) {
      const nb = neighbors[edge]
      const dx = centers[3 * nb] - x
      const dy = centers[3 * nb + 1] - y
      const dz = centers[3 * nb + 2] - z
      const eastDistance = (dx * eastX + dz * eastZ) * radiusKm
      const northDistance = (dx * northX + dy * northY + dz * northZ) * radiusKm
      const rise = landElevation[nb] - landElevation[r]
      eastRise += eastDistance * rise
      eastSpan += eastDistance * eastDistance
      northRise += northDistance * rise
      northSpan += northDistance * northDistance
    }

    const east = (eastSpan > 1e-8 ? eastRise / eastSpan : 0) * SATELLITE_HILLSHADE_GRADIENT_SCALE
    const north = (northSpan > 1e-8 ? northRise / northSpan : 0) * SATELLITE_HILLSHADE_GRADIENT_SCALE
    const normalLength = Math.sqrt(east * east + north * north + 1)
    const sunDot = (east * 0.48 - north * 0.42 + 0.77) / normalLength
    shading[r] = clamp(0.64 + 0.42 * Math.max(0, sunDot), 0.62, 1.04)
  }
  return shading
}

function fbm3D(
  noise: (x: number, y: number, z: number) => number,
  x: number,
  y: number,
  z: number,
  baseFreq: number,
  octaves: number,
): number {
  let sum = 0
  let amp = 0.5
  let freq = baseFreq
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq, z * freq)
    norm += amp
    freq *= 2.03
    amp *= 0.5
  }
  return norm > 0 ? sum / norm : 0
}

function computeSurfaceDetail(world: WorldSnapshot): Float32Array {
  const { mesh, metadata, nature } = world
  const count = mesh.regionCount
  const centers = mesh.centers
  const offsets = mesh.neighborOffsets
  const neighbors = mesh.neighbors
  const elevationKm = nature.geography.elevationKm.values
  const landMask = nature.geography.landMask.values
  const crustType = nature.geology.crustType.values
  const roughness = clamp(metadata.generationConfig.terrain?.roughness ?? 0.4, 0, 1)
  const roughnessBoost = 0.65 + 0.9 * roughness

  const rootRandom = new DeterministicRandom(JSON.stringify([SURFACE_DETAIL_NAMESPACE, metadata.seed]))
  const makeNoise = (channel: string) => {
    const stream = rootRandom.fork(channel)
    return createNoise3D(() => stream.nextFloat())
  }
  const nFine = makeNoise('fine-stream')
  const nRidge = makeNoise('ridge-stream')
  const nBroad = makeNoise('broad-stream')
  const nCoast = makeNoise('coast-stream')

  const detail = new Float32Array(count)
  for (let r = 0; r < count; r++) {
    const x = centers[3 * r]
    const y = centers[3 * r + 1]
    const z = centers[3 * r + 2]
    const elev = elevationKm[r]
    const isLand = landMask[r] === 1
    let coastal = 0
    for (let i = offsets[r]; i < offsets[r + 1]; i++) {
      if (landMask[neighbors[i]] !== landMask[r]) {
        coastal = 1
        break
      }
    }

    const fine = fbm3D(nFine, x, y, z, 18, 4)
    const broad = fbm3D(nBroad, x, y, z, 4.5, 3)
    const ridged = 1 - 2 * Math.abs(fbm3D(nRidge, x, y, z, 9, 3))
    const shore = coastal ? fbm3D(nCoast, x, y, z, 28, 2) : 0

    if (!isLand) {
      const shelfFactor = 1 - smoothstep(0.05, 2.5, Math.max(0, -elev))
      const crustBias = crustType[r] === 1 ? 0.15 : 0
      const raw = (fine * 0.55 + broad * 0.35 + ridged * 0.25) * (0.45 + 0.55 * shelfFactor + crustBias)
      detail[r] = clamp(raw * 0.08 * roughnessBoost, -0.025, 0.025)
    }
    else {
      const reliefWeight = 0.55 + 0.75 * smoothstep(0.15, 3.2, Math.max(0, elev))
      const crustFactor = crustType[r] === 1 ? 1 : 1.12
      const raw = (fine * 0.42 + ridged * 0.24 * reliefWeight + broad * 0.22 + shore * 0.16) * roughnessBoost * crustFactor
      detail[r] = clamp(raw * 0.18, -0.14, 0.14)
    }
  }
  return detail
}

/** Create an instance-scoped read-only cartography reader over an immutable WorldSnapshot. */
export function createWorldMapReader(world: WorldSnapshot): WorldMapReader {
  const { mesh, planet, metadata, nature, civilization } = world
  const count = mesh.regionCount
  const meshId = mesh.meshId

  let topologyCache: DualTopologyData | undefined
  const ensureTopology = (): DualTopologyData => {
    if (!topologyCache)
      topologyCache = buildDualTopology(mesh)
    return topologyCache
  }

  let slopeDegView: FieldView | undefined
  let hillshadeView: FieldView | undefined
  let surfaceDetailView: FieldView | undefined
  const windSpeedViews = new Array<FieldView | undefined>(12)
  const oceanSpeedViews = new Array<FieldView | undefined>(12)

  let platesCache: readonly { readonly id: string }[] | undefined
  let geoRegionsCache: GeographicMapRegions | null | undefined
  let basinsCache: readonly BasinMapSummary[] | undefined
  let riversCache: readonly RiverMapSummary[] | undefined
  let lakesCache: readonly LakeMapSummary[] | undefined
  let ecologyDictCache: Readonly<{ potentialBiomeIds: readonly string[], landCoverIds: readonly string[] }> | undefined

  const checkRegion = (region: number): void => {
    if (!Number.isInteger(region) || region < 0 || region >= count)
      throw new RangeError('Invalid region index')
  }

  const checkMonth = (month: number): void => {
    if (!Number.isInteger(month) || month < 0 || month >= 12)
      throw new RangeError('Invalid climate month')
  }

  const meshReader: MapMeshReader = Object.freeze({
    meshId,
    regionCount: count,
    get cornerCount() {
      return ensureTopology().cornerCount
    },
    get edgeCount() {
      return ensureTopology().edgeCount
    },
    physicalRadiusKm: planet.physicalRadiusKm,
    getRegionCenter(region: number, out: { x: number, y: number, z: number }): void {
      checkRegion(region)
      out.x = mesh.centers[3 * region]
      out.y = mesh.centers[3 * region + 1]
      out.z = mesh.centers[3 * region + 2]
    },
    getRegionAreaKm2(region: number): number {
      checkRegion(region)
      return mesh.areaKm2[region]
    },
    getCornerPosition(corner: number, out: { x: number, y: number, z: number }): void {
      const topology = ensureTopology()
      if (!Number.isInteger(corner) || corner < 0 || corner >= topology.cornerCount)
        throw new RangeError('Invalid dual corner index')
      out.x = topology.dualVertices[3 * corner]
      out.y = topology.dualVertices[3 * corner + 1]
      out.z = topology.dualVertices[3 * corner + 2]
    },
    getRegionDegree(region: number): number {
      checkRegion(region)
      return mesh.neighborOffsets[region + 1] - mesh.neighborOffsets[region]
    },
    forEachRegionNeighbor(
      region: number,
      visit: (neighborRegion: number, cornerA: number, cornerB: number, edgeId: number) => void,
    ): void {
      checkRegion(region)
      const topology = ensureTopology()
      const start = mesh.neighborOffsets[region]
      const end = mesh.neighborOffsets[region + 1]
      for (let i = start; i < end; i++) {
        const prevSlot = i > start ? i - 1 : end - 1
        visit(
          topology.sortedNeighbors[i],
          topology.boundaryCorners[prevSlot],
          topology.boundaryCorners[i],
          topology.sortedEdgeIds[i],
        )
      }
    },
    forEachEdge(
      visit: (edgeId: number, regionA: number, regionB: number, cornerA: number, cornerB: number) => void,
    ): void {
      const topology = ensureTopology()
      for (let edgeId = 0; edgeId < topology.edgeCount; edgeId++) {
        visit(
          edgeId,
          topology.edgeRegions[2 * edgeId],
          topology.edgeRegions[2 * edgeId + 1],
          topology.edgeCorners[2 * edgeId],
          topology.edgeCorners[2 * edgeId + 1],
        )
      }
    },
    locateRegion(x: number, y: number, z: number): number {
      const topology = ensureTopology()
      return locateVoronoiRegion(mesh.centers, mesh.neighborOffsets, mesh.neighbors, topology.seedRegions, x, y, z)
    },
  })

  const regions = nature.geography.regions
  const hasGeographicRegions = Boolean(regions)
  const hasGeographicNames = Boolean(
    regions
    && (Boolean(regions.nameContentSignature)
      || regions.continents.some(item => Boolean(item.name))
      || regions.oceans.some(item => Boolean(item.name))),
  )
  const hasSeaClassification = Boolean(regions?.seaIndex && regions.seas)
  const hasCirculation = Boolean(nature.climate.circulation)

  return Object.freeze({
    identity: Object.freeze({
      snapshotId: world.snapshotId,
      worldId: metadata.worldId,
      revision: world.revision,
      meshId,
      regionCount: count,
    }),
    planet: Object.freeze({
      radiusKm: planet.physicalRadiusKm,
      axialTiltDegrees: planet.axialTiltDegrees,
    }),
    capabilities: Object.freeze({
      hasGeographicRegions,
      hasGeographicNames,
      hasSeaClassification,
      hasCirculation,
    }),
    mesh: meshReader,
    field(name: WorldMapFieldName): FieldView {
      switch (name) {
        case 'plateIndex': return createFieldView(nature.geology.plateIndex)
        case 'crustType': return createFieldView(nature.geology.crustType)
        case 'elevationKm': return createFieldView(nature.geography.elevationKm)
        case 'landMask': return createFieldView(nature.geography.landMask)
        case 'slopeDeg':
          slopeDegView ??= createFieldView({ meshId, values: computeSlopeDeg(world) })
          return slopeDegView
        case 'surfaceDetail':
          surfaceDetailView ??= createFieldView({ meshId, values: computeSurfaceDetail(world) })
          return surfaceDetailView
        case 'hillshade':
          hillshadeView ??= createFieldView({ meshId, values: computeHillshade(world) })
          return hillshadeView
        case 'continentIndex':
          if (regions)
            return createFieldView(regions.continentIndex)
          throw new Error('Geographic regions are unavailable in this world')
        case 'oceanIndex':
          if (regions)
            return createFieldView(regions.oceanIndex)
          throw new Error('Geographic regions are unavailable in this world')
        case 'seaIndex':
          if (regions?.seaIndex)
            return createFieldView(regions.seaIndex)
          throw new Error('Sea classification is unavailable in this world')
        case 'annualMeanTemperatureC': return createFieldView(nature.climate.annualMeanTemperatureC)
        case 'annualPrecipitationMm': return createFieldView(nature.climate.annualPrecipitationMm)
        case 'koppenClass': return createFieldView(nature.climate.koppenClass)
        case 'oceanAvailable':
          if (nature.climate.circulation)
            return createFieldView(nature.climate.circulation.oceanAvailable)
          throw new Error('Climate circulation is unavailable in this world')
        case 'downstreamRegion': return createFieldView(nature.hydrology.downstreamRegion)
        case 'annualRunoffMm': return createFieldView(nature.hydrology.annualRunoffMm)
        case 'annualRunoffVolumeM3': return createFieldView(nature.hydrology.annualRunoffVolumeM3)
        case 'accumulatedAnnualFlowM3s': return createFieldView(nature.hydrology.accumulatedAnnualFlowM3s)
        case 'contributingAreaKm2': return createFieldView(nature.hydrology.contributingAreaKm2)
        case 'basinIndex': return createFieldView(nature.hydrology.basinIndex)
        case 'riverIndex': return createFieldView(nature.hydrology.riverIndex)
        case 'lakeIndex': return createFieldView(nature.hydrology.lakeIndex)
        case 'potentialBiomeIndex': return createFieldView(nature.ecology.potentialBiomeIndex)
        case 'landCoverIndex': return createFieldView(nature.ecology.landCoverIndex)
        case 'aridityIndex': return createFieldView(nature.ecology.aridityIndex)
        case 'growingSeasonMonths': return createFieldView(nature.ecology.growingSeasonMonths)
        case 'population': return createFieldView(civilization.population)
      }
    },
    monthlyField(name: WorldMonthlyFieldName, month: number): FieldView {
      checkMonth(month)
      const offset = month * count
      switch (name) {
        case 'temperatureC':
          return createSliceFieldView(meshId, nature.climate.temperatureC.values, offset, count)
        case 'precipitationMm':
          return createSliceFieldView(meshId, nature.climate.precipitationMm.values, offset, count)
        case 'snowWaterEquivalentMm':
          return createSliceFieldView(meshId, nature.hydrology.monthlySnowWaterEquivalentMm.values, offset, count)
        case 'snowfallMm':
          return createSliceFieldView(meshId, nature.hydrology.monthlySnowfallMm.values, offset, count)
        case 'snowmeltMm':
          return createSliceFieldView(meshId, nature.hydrology.monthlySnowmeltMm.values, offset, count)
        case 'windEastMps':
          if (nature.climate.circulation)
            return createSliceFieldView(meshId, nature.climate.circulation.windEastMps.values, offset, count)
          throw new Error('Climate circulation is unavailable in this world')
        case 'windNorthMps':
          if (nature.climate.circulation)
            return createSliceFieldView(meshId, nature.climate.circulation.windNorthMps.values, offset, count)
          throw new Error('Climate circulation is unavailable in this world')
        case 'windSpeedMps': {
          const circ = nature.climate.circulation
          if (!circ)
            throw new Error('Climate circulation is unavailable in this world')
          let view = windSpeedViews[month]
          if (!view) {
            const speeds = new Float32Array(count)
            for (let r = 0; r < count; r++)
              speeds[r] = Math.hypot(circ.windEastMps.values[offset + r], circ.windNorthMps.values[offset + r])
            view = createFieldView({ meshId, values: speeds })
            windSpeedViews[month] = view
          }
          return view
        }
        case 'oceanEastMps':
          if (nature.climate.circulation)
            return createSliceFieldView(meshId, nature.climate.circulation.oceanEastMps.values, offset, count)
          throw new Error('Climate circulation is unavailable in this world')
        case 'oceanNorthMps':
          if (nature.climate.circulation)
            return createSliceFieldView(meshId, nature.climate.circulation.oceanNorthMps.values, offset, count)
          throw new Error('Climate circulation is unavailable in this world')
        case 'oceanSpeedMps': {
          const circ = nature.climate.circulation
          if (!circ)
            throw new Error('Climate circulation is unavailable in this world')
          let view = oceanSpeedViews[month]
          if (!view) {
            const speeds = new Float32Array(count)
            for (let r = 0; r < count; r++) {
              speeds[r] = circ.oceanAvailable.values[r]
                ? Math.hypot(circ.oceanEastMps.values[offset + r], circ.oceanNorthMps.values[offset + r])
                : 0
            }
            view = createFieldView({ meshId, values: speeds })
            oceanSpeedViews[month] = view
          }
          return view
        }
        case 'oceanWarmth':
          if (nature.climate.circulation)
            return createSliceFieldView(meshId, nature.climate.circulation.oceanWarmth.values, offset, count)
          throw new Error('Climate circulation is unavailable in this world')
      }
    },
    plates(): readonly { readonly id: string }[] {
      platesCache ??= Object.freeze(nature.geology.plates.map(plate => Object.freeze({ id: plate.id })))
      return platesCache
    },
    geographicRegions(): GeographicMapRegions | null {
      if (geoRegionsCache !== undefined)
        return geoRegionsCache
      if (!regions) {
        geoRegionsCache = null
        return null
      }
      geoRegionsCache = Object.freeze({
        continents: Object.freeze(regions.continents.map(item => Object.freeze({ ...item }))),
        oceans: Object.freeze(regions.oceans.map(item => Object.freeze({
          ...item,
          ...(item.definingContinentIds ? { definingContinentIds: Object.freeze([...item.definingContinentIds]) } : {}),
        }))),
        seas: Object.freeze((regions.seas ?? []).map(item => Object.freeze({ ...item }))),
      })
      return geoRegionsCache
    },
    basins(): readonly BasinMapSummary[] {
      basinsCache ??= Object.freeze(nature.hydrology.basins.map(basin => Object.freeze({ ...basin })))
      return basinsCache
    },
    rivers(): readonly RiverMapSummary[] {
      riversCache ??= Object.freeze(nature.hydrology.rivers.map(river => Object.freeze({
        id: river.id,
        sourceRegion: river.sourceRegion,
        mouthRegion: river.mouthRegion,
        downstreamRiver: river.downstreamRiver,
        annualMeanDischargeM3s: river.annualMeanDischargeM3s,
        strahlerOrder: river.strahlerOrder,
        endorheic: river.endorheic,
        regionCount: river.regions.length,
      })))
      return riversCache
    },
    forEachRiverRegion(riverIndex: number, visit: (region: number, stepIndex: number) => void): void {
      const rivers = nature.hydrology.rivers
      if (!Number.isInteger(riverIndex) || riverIndex < 0 || riverIndex >= rivers.length)
        throw new RangeError('Invalid river index')
      const members = rivers[riverIndex].regions
      for (let i = 0; i < members.length; i++)
        visit(members[i], i)
    },
    lakes(): readonly LakeMapSummary[] {
      lakesCache ??= Object.freeze(nature.hydrology.lakes.map(lake => Object.freeze({
        id: lake.id,
        basinId: lake.basinId,
        endorheic: lake.endorheic,
        areaKm2: lake.areaKm2,
        waterLevelKm: lake.waterLevelKm,
        spillRegion: lake.spillRegion,
        downstreamRegion: lake.downstreamRegion,
        regionCount: lake.regions.length,
      })))
      return lakesCache
    },
    forEachLakeRegion(lakeIndex: number, visit: (region: number) => void): void {
      const lakes = nature.hydrology.lakes
      if (!Number.isInteger(lakeIndex) || lakeIndex < 0 || lakeIndex >= lakes.length)
        throw new RangeError('Invalid lake index')
      const members = lakes[lakeIndex].regions
      for (let i = 0; i < members.length; i++)
        visit(members[i])
    },
    ecologyDictionaries(): Readonly<{ potentialBiomeIds: readonly string[], landCoverIds: readonly string[] }> {
      ecologyDictCache ??= Object.freeze({
        potentialBiomeIds: Object.freeze([...nature.ecology.potentialBiomeIds]),
        landCoverIds: Object.freeze([...nature.ecology.landCoverIds]),
      })
      return ecologyDictCache
    },
  })
}
