import type { WorldMapReader } from '@another-earth/world-core'
import type { LonLatTuple } from '#projections/spherical-math'
import type {
  GeoJsonFeature,
  GeoJsonLineStringGeometry,
  GeoJsonMultiLineStringGeometry,
  GeoJsonSource,
  SourceUnavailable,
} from '#sources/types'
import {
  buildTangentBasis,
  cartesianToLonLatDeg,
  crossVec3,
  normalizeVec3,
} from '#projections/spherical-math'
import { traceClassificationRings } from '#sources/topology/ring-tracer'
import {
  buildSmoothedSharedBoundaryRings,
  offsetSphericalPoint,
  smoothBoundaryCornerPositions,
} from '#sources/topology/spherical-smooth'
import { BUILTIN_MAP_SOURCE_SCHEMAS } from '#sources/types'

type LineOrMultiLine = GeoJsonLineStringGeometry | GeoJsonMultiLineStringGeometry

const MAX_WIND_VECTORS = 2200
const MAX_OCEAN_VECTORS = 2400

export function chainCornerEdgesIntoLineStrings(
  cornerPositions: Float64Array,
  edges: readonly (readonly [cornerA: number, cornerB: number])[],
): LonLatTuple[][] {
  if (edges.length === 0)
    return []

  const adjacency = new Map<number, { neighbor: number, edgeIndex: number }[]>()
  for (let i = 0; i < edges.length; i++) {
    const [a, b] = edges[i]
    let listA = adjacency.get(a)
    if (!listA) {
      listA = []
      adjacency.set(a, listA)
    }
    listA.push({ neighbor: b, edgeIndex: i })

    let listB = adjacency.get(b)
    if (!listB) {
      listB = []
      adjacency.set(b, listB)
    }
    listB.push({ neighbor: a, edgeIndex: i })
  }

  const visited = new Uint8Array(edges.length)
  const chains: LonLatTuple[][] = []

  const cornerLonLat = (c: number): LonLatTuple =>
    cartesianToLonLatDeg(cornerPositions[3 * c], cornerPositions[3 * c + 1], cornerPositions[3 * c + 2])

  const traceFrom = (startCorner: number, firstEdgeIdx: number, nextCorner: number): number[] => {
    visited[firstEdgeIdx] = 1
    const path = [startCorner, nextCorner]
    let curr = nextCorner
    while (true) {
      const neighbors = adjacency.get(curr)
      if (!neighbors || neighbors.length !== 2)
        break
      const nextStep = neighbors.find(item => !visited[item.edgeIndex])
      if (!nextStep)
        break
      visited[nextStep.edgeIndex] = 1
      path.push(nextStep.neighbor)
      curr = nextStep.neighbor
      if (curr === startCorner)
        break
    }
    return path
  }

  // First trace open chains starting at degree != 2 junctions
  for (const [corner, neighbors] of adjacency) {
    if (neighbors.length === 2)
      continue
    for (const step of neighbors) {
      if (visited[step.edgeIndex])
        continue
      const corners = traceFrom(corner, step.edgeIndex, step.neighbor)
      if (corners.length >= 2)
        chains.push(corners.map(cornerLonLat))
    }
  }

  // Remaining unvisited edges form closed loops
  for (let i = 0; i < edges.length; i++) {
    if (visited[i])
      continue
    const [a, b] = edges[i]
    const corners = traceFrom(a, i, b)
    if (corners.length >= 2)
      chains.push(corners.map(cornerLonLat))
  }

  return chains
}

/**
 * Builds `coastlines`: each physical land/ocean shared boundary loop is output globally once,
 * smoothed identically to `land-areas`.
 */
export function buildCoastlinesSource(
  reader: WorldMapReader,
  cacheKey: string,
  sharedCornerPositions?: Float64Array,
): GeoJsonSource<LineOrMultiLine> {
  const { mesh, identity } = reader
  const count = mesh.regionCount
  const landMask = reader.field('landMask')
  const groupIds = new Int32Array(count)
  for (let r = 0; r < count; r++)
    groupIds[r] = landMask.get(r) !== 0 ? 1 : -1

  const traced = traceClassificationRings(mesh, groupIds, sharedCornerPositions)
  const landGroup = traced.groups.find(g => g.groupId === 1)
  const lines: LonLatTuple[][] = []
  if (landGroup) {
    const smoothedRings = buildSmoothedSharedBoundaryRings(
      mesh,
      traced.cornerPositions,
      traced.boundaryEdgeIds,
      landGroup.rings,
    )
    for (const ring of smoothedRings) {
      if (ring.points.length < 3)
        continue
      const coords = ring.points.map(p => cartesianToLonLatDeg(p[0], p[1], p[2]))
      coords.push([coords[0][0], coords[0][1]])
      lines.push(coords)
    }
  }

  const features: GeoJsonFeature<LineOrMultiLine>[] = lines.map((coords, idx) => ({
    type: 'Feature',
    id: `coastline:${idx}`,
    geometry: {
      type: 'LineString',
      coordinates: coords,
    },
    properties: {
      id: `coastline:${idx}`,
      kind: 'coastline',
    },
  }))

  return Object.freeze({
    unavailable: false as const,
    kind: 'geojson' as const,
    sourceId: 'coastlines',
    snapshotId: identity.snapshotId,
    adapterVersion: BUILTIN_MAP_SOURCE_SCHEMAS.coastlines.adapterVersion,
    cacheKey,
    geometryKind: 'line' as const,
    data: Object.freeze({
      type: 'FeatureCollection' as const,
      features: Object.freeze(features),
    }),
  })
}

/**
 * Builds `plate-boundaries`: shared dual edge chains between distinct tectonic plates,
 * carrying both adjacent plate IDs.
 */
export function buildPlateBoundariesSource(
  reader: WorldMapReader,
  cacheKey: string,
  sharedCornerPositions?: Float64Array,
): GeoJsonSource<GeoJsonLineStringGeometry> {
  const { mesh, identity } = reader
  const count = mesh.regionCount
  const plateField = reader.field('plateIndex')
  const plates = reader.plates()
  const groupIds = new Int32Array(count)
  for (let r = 0; r < count; r++)
    groupIds[r] = plateField.get(r)

  const traced = traceClassificationRings(mesh, groupIds, sharedCornerPositions)
  const smoothedCorners = smoothBoundaryCornerPositions(
    mesh,
    traced.cornerPositions,
    traced.boundaryEdgeIds,
    2,
    0.26,
  )

  const edgesByPair = new Map<string, {
    plateIndexA: number
    plateIndexB: number
    edges: [number, number][]
  }>()

  mesh.forEachEdge((_edgeId, regionA, regionB, cornerA, cornerB) => {
    const pA = groupIds[regionA]
    const pB = groupIds[regionB]
    if (pA === pB || pA < 0 || pB < 0)
      return
    const first = Math.min(pA, pB)
    const second = Math.max(pA, pB)
    const key = `${first}:${second}`
    let pair = edgesByPair.get(key)
    if (!pair) {
      pair = { plateIndexA: first, plateIndexB: second, edges: [] }
      edgesByPair.set(key, pair)
    }
    pair.edges.push([cornerA, cornerB])
  })

  const features: GeoJsonFeature<GeoJsonLineStringGeometry>[] = []
  const sortedPairs = [...edgesByPair.entries()].sort(([a], [b]) => a.localeCompare(b))
  for (const [key, pair] of sortedPairs) {
    const chains = chainCornerEdgesIntoLineStrings(smoothedCorners, pair.edges)
    const plateA = plates[pair.plateIndexA]?.id ?? `plate:${pair.plateIndexA}`
    const plateB = plates[pair.plateIndexB]?.id ?? `plate:${pair.plateIndexB}`
    for (let idx = 0; idx < chains.length; idx++) {
      const id = chains.length === 1 ? `plate-boundary:${key}` : `plate-boundary:${key}:${idx}`
      features.push({
        type: 'Feature',
        id,
        geometry: {
          type: 'LineString',
          coordinates: chains[idx],
        },
        properties: {
          id,
          plateA,
          plateB,
          plateIndexA: pair.plateIndexA,
          plateIndexB: pair.plateIndexB,
        },
      })
    }
  }

  return Object.freeze({
    unavailable: false as const,
    kind: 'geojson' as const,
    sourceId: 'plate-boundaries',
    snapshotId: identity.snapshotId,
    adapterVersion: BUILTIN_MAP_SOURCE_SCHEMAS['plate-boundaries'].adapterVersion,
    cacheKey,
    geometryKind: 'line' as const,
    data: Object.freeze({
      type: 'FeatureCollection' as const,
      features: Object.freeze(features),
    }),
  })
}

/**
 * Builds `graticule`: 15° intervals for parallels and meridians, with dedicated `kind` tags
 * (`'equator'`, `'prime-meridian'`, `'antimeridian'`, `'parallel'`, `'meridian'`).
 */
export function buildGraticuleSource(
  reader: WorldMapReader,
  cacheKey: string,
): GeoJsonSource<GeoJsonLineStringGeometry> {
  const features: GeoJsonFeature<GeoJsonLineStringGeometry>[] = []
  const lonStep = 5
  const latStep = 3

  for (let lat = -75; lat <= 75; lat += 15) {
    const coords: LonLatTuple[] = []
    for (let lon = -180; lon <= 180; lon += lonStep)
      coords.push([lon, lat])
    const kind = lat === 0 ? 'equator' : 'parallel'
    const id = `graticule:lat:${lat}`
    features.push({
      type: 'Feature',
      id,
      geometry: { type: 'LineString', coordinates: coords },
      properties: { id, kind, degrees: lat },
    })
  }

  for (let lon = -180; lon <= 180; lon += 15) {
    const coords: LonLatTuple[] = []
    for (let lat = -87; lat <= 87; lat += latStep)
      coords.push([lon, lat])
    const kind = lon === 0
      ? 'prime-meridian'
      : Math.abs(lon) === 180
        ? 'antimeridian'
        : 'meridian'
    const id = `graticule:lon:${lon}`
    features.push({
      type: 'Feature',
      id,
      geometry: { type: 'LineString', coordinates: coords },
      properties: { id, kind, degrees: lon },
    })
  }

  return Object.freeze({
    unavailable: false as const,
    kind: 'geojson' as const,
    sourceId: 'graticule',
    snapshotId: reader.identity.snapshotId,
    adapterVersion: BUILTIN_MAP_SOURCE_SCHEMAS.graticule.adapterVersion,
    cacheKey,
    geometryKind: 'line' as const,
    data: Object.freeze({
      type: 'FeatureCollection' as const,
      features: Object.freeze(features),
    }),
  })
}

/**
 * Builds `circulation-vectors` for a given month (0..11):
 * quasi-uniform spherical sampling of wind and ocean current arrows (`LineString` shaft + arrowhead wings).
 */
export function buildCirculationVectorsSource(
  reader: WorldMapReader,
  month: number,
  cacheKey: string,
): GeoJsonSource<GeoJsonLineStringGeometry> | SourceUnavailable {
  const { identity, capabilities, mesh } = reader
  const { adapterVersion } = BUILTIN_MAP_SOURCE_SCHEMAS['circulation-vectors']
  if (!capabilities.hasCirculation) {
    return Object.freeze({
      unavailable: true as const,
      sourceId: 'circulation-vectors',
      snapshotId: identity.snapshotId,
      adapterVersion,
      cacheKey,
      reason: 'Climate circulation is unavailable in this world snapshot',
    })
  }

  const count = mesh.regionCount
  const windEast = reader.monthlyField('windEastMps', month)
  const windNorth = reader.monthlyField('windNorthMps', month)
  const oceanEast = reader.monthlyField('oceanEastMps', month)
  const oceanNorth = reader.monthlyField('oceanNorthMps', month)
  const oceanWarmth = reader.monthlyField('oceanWarmth', month)
  const oceanAvailable = reader.field('oceanAvailable')

  const features: GeoJsonFeature<GeoJsonLineStringGeometry>[] = []
  const centerOut = { x: 0, y: 0, z: 0 }

  const sampleVectorSet = (
    kind: 'wind' | 'ocean',
    maxSamples: number,
    minSpeedMps: number,
    refSpeedMps: number,
  ): void => {
    const sampleCount = Math.min(maxSamples, count)
    const stride = Math.max(1, Math.floor(count / sampleCount))
    for (let idx = 0, region = 0; region < count && idx < sampleCount; region += stride, idx++) {
      if (kind === 'ocean' && oceanAvailable.get(region) === 0)
        continue
      const east = kind === 'wind' ? windEast.get(region) : oceanEast.get(region)
      const north = kind === 'wind' ? windNorth.get(region) : oceanNorth.get(region)
      const speedMps = Math.hypot(east, north)
      if (!Number.isFinite(speedMps) || speedMps < minSpeedMps)
        continue

      mesh.getRegionCenter(region, centerOut)
      const center = normalizeVec3(centerOut.x, centerOut.y, centerOut.z)
      const basis = buildTangentBasis(center)
      const dir = normalizeVec3(
        (basis.east[0] * east + basis.north[0] * north) / speedMps,
        (basis.east[1] * east + basis.north[1] * north) / speedMps,
        (basis.east[2] * east + basis.north[2] * north) / speedMps,
      )
      const side = normalizeVec3(...crossVec3(center, dir))

      const normStrength = Math.min(1, speedMps / refSpeedMps)
      const arcLengthRad = (0.018 + 0.016 * normStrength)
      const start = offsetSphericalPoint(center, [-dir[0], -dir[1], -dir[2]], arcLengthRad * 0.5)
      const tip = offsetSphericalPoint(center, dir, arcLengthRad * 0.5)
      const wingBase = offsetSphericalPoint(center, dir, arcLengthRad * 0.22)
      const wingSpreadRad = arcLengthRad * 0.22
      const leftWing = offsetSphericalPoint(wingBase, side, wingSpreadRad)
      const rightWing = offsetSphericalPoint(wingBase, [-side[0], -side[1], -side[2]], wingSpreadRad)

      const pStart = cartesianToLonLatDeg(start[0], start[1], start[2])
      const pTip = cartesianToLonLatDeg(tip[0], tip[1], tip[2])
      const pLeft = cartesianToLonLatDeg(leftWing[0], leftWing[1], leftWing[2])
      const pRight = cartesianToLonLatDeg(rightWing[0], rightWing[1], rightWing[2])

      // Continuous polyline: start -> tip -> leftWing -> tip -> rightWing
      const id = `${kind}-vector:m${month}:${region}`
      const warmth = kind === 'ocean' ? oceanWarmth.get(region) : 0
      features.push({
        type: 'Feature',
        id,
        geometry: {
          type: 'LineString',
          coordinates: [pStart, pTip, pLeft, pTip, pRight],
        },
        properties: {
          id,
          kind,
          speedMps,
          warmth,
        },
      })
    }
  }

  sampleVectorSet('wind', MAX_WIND_VECTORS, 0.25, 9)
  sampleVectorSet('ocean', MAX_OCEAN_VECTORS, 0.015, 0.4)

  return Object.freeze({
    unavailable: false as const,
    kind: 'geojson' as const,
    sourceId: 'circulation-vectors',
    snapshotId: identity.snapshotId,
    adapterVersion,
    cacheKey,
    geometryKind: 'line' as const,
    month,
    data: Object.freeze({
      type: 'FeatureCollection' as const,
      features: Object.freeze(features),
    }),
  })
}

/**
 * Builds `cell-wireframe`: dual Voronoi cell boundary edges across the sphere.
 */
export function buildCellWireframeSource(
  reader: WorldMapReader,
  cacheKey: string,
  sharedCornerPositions?: Float64Array,
): GeoJsonSource<GeoJsonLineStringGeometry> {
  const { mesh, identity } = reader
  const cornerPositions = sharedCornerPositions ?? (() => {
    const out = new Float64Array(mesh.cornerCount * 3)
    const pt = { x: 0, y: 0, z: 0 }
    for (let c = 0; c < mesh.cornerCount; c++) {
      mesh.getCornerPosition(c, pt)
      out[3 * c] = pt.x
      out[3 * c + 1] = pt.y
      out[3 * c + 2] = pt.z
    }
    return out
  })()

  const edges: [number, number][] = []
  mesh.forEachEdge((_edgeId, _regionA, _regionB, cornerA, cornerB) => {
    edges.push([cornerA, cornerB])
  })

  const chains = chainCornerEdgesIntoLineStrings(cornerPositions, edges)
  const features: GeoJsonFeature<GeoJsonLineStringGeometry>[] = chains.map((coords, idx) => ({
    type: 'Feature',
    id: `cell-wireframe:${idx}`,
    geometry: {
      type: 'LineString',
      coordinates: coords,
    },
    properties: {
      id: `cell-wireframe:${idx}`,
    },
  }))

  return Object.freeze({
    unavailable: false as const,
    kind: 'geojson' as const,
    sourceId: 'cell-wireframe',
    snapshotId: identity.snapshotId,
    adapterVersion: BUILTIN_MAP_SOURCE_SCHEMAS['cell-wireframe'].adapterVersion,
    cacheKey,
    geometryKind: 'line' as const,
    data: Object.freeze({
      type: 'FeatureCollection' as const,
      features: Object.freeze(features),
    }),
  })
}
