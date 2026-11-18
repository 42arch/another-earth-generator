import type { MapMeshReader, WorldMapReader } from '@another-earth/world-core'
import type {
  GeoJsonFeature,
  GeoJsonMultiPolygonGeometry,
  GeoJsonPolygonGeometry,
  GeoJsonSource,
  SourceUnavailable,
} from '#sources/types'
import { cartesianToLonLatDeg } from '#projections/spherical-math'
import { assemblePolygonsWithHoles, traceClassificationRings } from '#sources/topology/ring-tracer'
import {
  buildSmoothedSharedBoundaryRings,
} from '#sources/topology/spherical-smooth'
import { BUILTIN_MAP_SOURCE_SCHEMAS } from '#sources/types'

type PolygonOrMultiPolygon = GeoJsonPolygonGeometry | GeoJsonMultiPolygonGeometry

const LON_TILE_STEP_DEG = 24
const LAT_TILE_STEP_DEG = 20
const LON_TILE_COUNT = Math.ceil(360 / LON_TILE_STEP_DEG)
const LAT_TILE_COUNT = Math.ceil(180 / LAT_TILE_STEP_DEG)
const TOTAL_SPHERICAL_TILES = LON_TILE_COUNT * LAT_TILE_COUNT

function computeRegionSphericalTileId(mesh: MapMeshReader, region: number, centerOut: { x: number, y: number, z: number }): number {
  mesh.getRegionCenter(region, centerOut)
  const [lon, lat] = cartesianToLonLatDeg(centerOut.x, centerOut.y, centerOut.z)
  // Avoid exact north/south pole ambiguity by clamping inside tile grid
  const lonIdx = Math.max(0, Math.min(LON_TILE_COUNT - 1, Math.floor((lon + 180) / LON_TILE_STEP_DEG)))
  const latIdx = Math.max(0, Math.min(LAT_TILE_COUNT - 1, Math.floor((lat + 90) / LAT_TILE_STEP_DEG)))
  return latIdx * LON_TILE_COUNT + lonIdx
}

/**
 * Traces and smooths classification polygons by partitioning large categories into bounded
 * spherical tiles (`24° × 20°`), while smoothing ONLY the true classification boundaries (`groupIds[a] !== groupIds[b]`).
 *
 * Why this guarantees 100% artifact-free `FillLayer` triangulation:
 * - Every traced polygon ring is bounded to `< 25°` spherical extent (no hemisphere-spanning rings,
 *   no circumpolar rings with inverted planar winding, no hundreds-of-holes multi-continent polygons).
 * - Internal tile seams between regions of the same category remain straight, un-relaxed dual edges
 *   shared identically by both tiles, so internal seams have zero gaps and zero overlaps.
 * - True boundaries between different categories are smoothed once globally via `buildSmoothedSharedBoundaryRings`
 *   with `smoothEdgeMask`, so adjacent categories (and `coastlines`) match vertex-for-vertex.
 */
function buildTiledSmoothedGroupPolygons(
  mesh: MapMeshReader,
  groupIds: Int32Array,
  sharedCornerPositions?: Float64Array,
): Map<number, (readonly (readonly (readonly [number, number])[])[])[]> {
  const count = mesh.regionCount
  const tiledGroupIds = new Int32Array(count).fill(-1)
  const centerOut = { x: 0, y: 0, z: 0 }

  for (let r = 0; r < count; r++) {
    const g = groupIds[r]
    if (g < 0)
      continue
    const tileId = computeRegionSphericalTileId(mesh, r, centerOut)
    tiledGroupIds[r] = g * TOTAL_SPHERICAL_TILES + tileId
  }

  const smoothEdgeMask = new Uint8Array(mesh.edgeCount)
  mesh.forEachEdge((edgeId, rA, rB) => {
    if (groupIds[rA] !== groupIds[rB]) {
      smoothEdgeMask[edgeId] = 1
    }
  })

  const traced = traceClassificationRings(mesh, tiledGroupIds, sharedCornerPositions)
  const allRings = traced.groups.flatMap(g => g.rings)
  const allSmoothedRings = buildSmoothedSharedBoundaryRings(
    mesh,
    traced.cornerPositions,
    traced.boundaryEdgeIds,
    allRings,
    { smoothEdgeMask },
  )

  const polygonsByGroup = new Map<number, (readonly (readonly (readonly [number, number])[])[])[]>()
  let ringCursor = 0
  for (const tiledGroup of traced.groups) {
    const ringCount = tiledGroup.rings.length
    const smoothedRings = allSmoothedRings.slice(ringCursor, ringCursor + ringCount)
    ringCursor += ringCount

    const originalGroupId = Math.floor(tiledGroup.groupId / TOTAL_SPHERICAL_TILES)
    const tilePolygons = assemblePolygonsWithHoles(mesh, smoothedRings)
    if (tilePolygons.length === 0)
      continue

    let list = polygonsByGroup.get(originalGroupId)
    if (!list) {
      list = []
      polygonsByGroup.set(originalGroupId, list)
    }
    list.push(...tilePolygons)
  }

  return polygonsByGroup
}

function makePolygonGeometry(
  polygons: readonly (readonly (readonly (readonly [number, number])[])[])[],
): PolygonOrMultiPolygon | null {
  if (polygons.length === 0)
    return null
  if (polygons.length === 1) {
    return {
      type: 'Polygon',
      coordinates: polygons[0],
    }
  }
  return {
    type: 'MultiPolygon',
    coordinates: polygons,
  }
}

export function buildLandAreasSource(
  reader: WorldMapReader,
  cacheKey: string,
  sharedCornerPositions?: Float64Array,
): GeoJsonSource<PolygonOrMultiPolygon> {
  const { mesh, identity } = reader
  const count = mesh.regionCount
  const landMask = reader.field('landMask')
  const groupIds = new Int32Array(count)
  let totalLandAreaKm2 = 0
  for (let r = 0; r < count; r++) {
    if (landMask.get(r) !== 0) {
      groupIds[r] = 1
      totalLandAreaKm2 += mesh.getRegionAreaKm2(r)
    }
    else {
      groupIds[r] = -1
    }
  }

  const polygonsByGroup = buildTiledSmoothedGroupPolygons(mesh, groupIds, sharedCornerPositions)
  const landPolygons = polygonsByGroup.get(1) ?? []
  const features: GeoJsonFeature<PolygonOrMultiPolygon>[] = []
  const geometry = makePolygonGeometry(landPolygons)
  if (geometry) {
    features.push({
      type: 'Feature',
      id: 'land',
      geometry,
      properties: {
        id: 'land',
        kind: 'land',
        areaKm2: totalLandAreaKm2,
      },
    })
  }

  return Object.freeze({
    unavailable: false as const,
    kind: 'geojson' as const,
    sourceId: 'land-areas',
    snapshotId: identity.snapshotId,
    adapterVersion: BUILTIN_MAP_SOURCE_SCHEMAS['land-areas'].adapterVersion,
    cacheKey,
    geometryKind: 'polygon' as const,
    data: Object.freeze({
      type: 'FeatureCollection' as const,
      features: Object.freeze(features),
    }),
  })
}

export function formatContinentDisplayName(name: string | undefined, index: number): string {
  if (!name)
    return `大陆 ${index + 1}`
  if (name.endsWith('大陆'))
    return name
  return `${name}${/[\u3400-\u9FFF〇]$/u.test(name) ? '' : ' '}大陆`
}

export function formatOceanDisplayName(name: string | undefined, index: number): string {
  if (!name)
    return `大洋 ${index + 1}`
  if (name.endsWith('洋'))
    return name
  return `${name}${/[\u3400-\u9FFF〇]$/u.test(name) ? '' : ' '}洋`
}

export function buildContinentAreasSource(
  reader: WorldMapReader,
  cacheKey: string,
  sharedCornerPositions?: Float64Array,
): GeoJsonSource<PolygonOrMultiPolygon> | SourceUnavailable {
  const { mesh, identity, capabilities } = reader
  const { adapterVersion } = BUILTIN_MAP_SOURCE_SCHEMAS['continent-areas']
  const geoRegions = reader.geographicRegions()
  if (!capabilities.hasGeographicRegions || !geoRegions) {
    return Object.freeze({
      unavailable: true as const,
      sourceId: 'continent-areas',
      snapshotId: identity.snapshotId,
      adapterVersion,
      cacheKey,
      reason: 'Geographic regions are unavailable in this world snapshot',
    })
  }

  const count = mesh.regionCount
  const continentField = reader.field('continentIndex')
  const oceanField = reader.field('oceanIndex')
  const seaField = capabilities.hasSeaClassification ? reader.field('seaIndex') : null
  const continentCount = geoRegions.continents.length
  const oceanCount = geoRegions.oceans.length
  const seaCount = seaField ? geoRegions.seas.length : 0
  const totalGroups = continentCount + oceanCount + seaCount

  const groupIds = new Int32Array(count).fill(-1)
  const areaByGroup = new Float64Array(totalGroups)

  for (let r = 0; r < count; r++) {
    const cIdx = continentField.get(r)
    if (cIdx >= 0 && cIdx < continentCount) {
      groupIds[r] = cIdx
      areaByGroup[cIdx] += mesh.getRegionAreaKm2(r)
      continue
    }
    const oIdx = oceanField.get(r)
    if (oIdx >= 0 && oIdx < oceanCount) {
      const gId = continentCount + oIdx
      groupIds[r] = gId
      areaByGroup[gId] += mesh.getRegionAreaKm2(r)
      continue
    }
    if (seaField) {
      const sIdx = seaField.get(r)
      if (sIdx >= 0 && sIdx < seaCount) {
        const gId = continentCount + oceanCount + sIdx
        groupIds[r] = gId
        areaByGroup[gId] += mesh.getRegionAreaKm2(r)
      }
    }
  }

  const polygonsByGroup = buildTiledSmoothedGroupPolygons(mesh, groupIds, sharedCornerPositions)
  const sortedGroupIds = [...polygonsByGroup.keys()].sort((a, b) => a - b)

  const features: GeoJsonFeature<PolygonOrMultiPolygon>[] = []
  for (const gId of sortedGroupIds) {
    const polygons = polygonsByGroup.get(gId) ?? []
    const geometry = makePolygonGeometry(polygons)
    if (!geometry)
      continue

    if (gId < continentCount) {
      const continentMeta = geoRegions.continents[gId]
      const featureId = continentMeta?.id ?? `continent:${gId}`
      const areaKm2 = continentMeta?.areaKm2 ?? areaByGroup[gId] ?? 0
      const name = formatContinentDisplayName(continentMeta?.name, gId)
      features.push({
        type: 'Feature',
        id: featureId,
        geometry,
        properties: {
          id: featureId,
          kind: 'continent',
          groupIndex: gId,
          continentIndex: gId,
          oceanIndex: -1,
          seaIndex: -1,
          areaKm2,
          name,
        },
      })
    }
    else if (gId < continentCount + oceanCount) {
      const oIdx = gId - continentCount
      const oceanMeta = geoRegions.oceans[oIdx]
      const featureId = oceanMeta?.id ?? `ocean:${oIdx}`
      const areaKm2 = oceanMeta?.areaKm2 ?? areaByGroup[gId] ?? 0
      const name = formatOceanDisplayName(oceanMeta?.name, oIdx)
      features.push({
        type: 'Feature',
        id: featureId,
        geometry,
        properties: {
          id: featureId,
          kind: 'ocean',
          groupIndex: oIdx,
          continentIndex: -1,
          oceanIndex: oIdx,
          seaIndex: -1,
          areaKm2,
          name,
        },
      })
    }
    else {
      const sIdx = gId - continentCount - oceanCount
      const seaMeta = geoRegions.seas[sIdx]
      const featureId = seaMeta?.id ?? `sea:${sIdx}`
      const areaKm2 = seaMeta?.areaKm2 ?? areaByGroup[gId] ?? 0
      const name = `海 ${sIdx + 1}`
      features.push({
        type: 'Feature',
        id: featureId,
        geometry,
        properties: {
          id: featureId,
          kind: 'sea',
          groupIndex: sIdx,
          continentIndex: -1,
          oceanIndex: -1,
          seaIndex: sIdx,
          areaKm2,
          name,
        },
      })
    }
  }

  return Object.freeze({
    unavailable: false as const,
    kind: 'geojson' as const,
    sourceId: 'continent-areas',
    snapshotId: identity.snapshotId,
    adapterVersion,
    cacheKey,
    geometryKind: 'polygon' as const,
    data: Object.freeze({
      type: 'FeatureCollection' as const,
      features: Object.freeze(features),
    }),
  })
}

export function buildPlateAreasSource(
  reader: WorldMapReader,
  cacheKey: string,
  sharedCornerPositions?: Float64Array,
): GeoJsonSource<PolygonOrMultiPolygon> {
  const { mesh, identity } = reader
  const count = mesh.regionCount
  const plateField = reader.field('plateIndex')
  const plates = reader.plates()
  const groupIds = new Int32Array(count)
  const areaByPlate = new Float64Array(plates.length)

  for (let r = 0; r < count; r++) {
    const pIdx = plateField.get(r)
    groupIds[r] = pIdx
    if (pIdx >= 0 && pIdx < areaByPlate.length)
      areaByPlate[pIdx] += mesh.getRegionAreaKm2(r)
  }

  const polygonsByGroup = buildTiledSmoothedGroupPolygons(mesh, groupIds, sharedCornerPositions)
  const sortedGroupIds = [...polygonsByGroup.keys()].sort((a, b) => a - b)

  const features: GeoJsonFeature<PolygonOrMultiPolygon>[] = []
  for (const gId of sortedGroupIds) {
    const polygons = polygonsByGroup.get(gId) ?? []
    const geometry = makePolygonGeometry(polygons)
    if (!geometry)
      continue
    const plateMeta = plates[gId]
    const featureId = plateMeta?.id ?? `plate:${gId}`
    features.push({
      type: 'Feature',
      id: featureId,
      geometry,
      properties: {
        id: featureId,
        groupIndex: gId,
        areaKm2: areaByPlate[gId] ?? 0,
        name: `板块 ${gId + 1}`,
      },
    })
  }

  return Object.freeze({
    unavailable: false as const,
    kind: 'geojson' as const,
    sourceId: 'plate-areas',
    snapshotId: identity.snapshotId,
    adapterVersion: BUILTIN_MAP_SOURCE_SCHEMAS['plate-areas'].adapterVersion,
    cacheKey,
    geometryKind: 'polygon' as const,
    data: Object.freeze({
      type: 'FeatureCollection' as const,
      features: Object.freeze(features),
    }),
  })
}

function buildCategoricalLandAreasSource(
  reader: WorldMapReader,
  sourceId: 'koppen-areas' | 'biome-areas' | 'land-cover-areas',
  readerFieldName: 'koppenClass' | 'potentialBiomeIndex' | 'landCoverIndex',
  propertyFieldName: 'koppenClass' | 'biomeIndex' | 'landCoverIndex',
  featureIdPrefix: string,
  labelPrefix: string,
  cacheKey: string,
  sharedCornerPositions?: Float64Array,
): GeoJsonSource<PolygonOrMultiPolygon> {
  const { mesh, identity } = reader
  const count = mesh.regionCount
  const landMask = reader.field('landMask')
  const valueField = reader.field(readerFieldName)
  const groupIds = new Int32Array(count).fill(-1)
  const areaByGroup = new Map<number, number>()

  for (let r = 0; r < count; r++) {
    // For land-cover-areas, class 0 is Water; only trace land cells so ocean uses the uniform base backdrop
    if (landMask.get(r) === 0)
      continue
    const val = Math.floor(valueField.get(r))
    if (val < 0)
      continue
    groupIds[r] = val
    areaByGroup.set(val, (areaByGroup.get(val) ?? 0) + mesh.getRegionAreaKm2(r))
  }

  const polygonsByGroup = buildTiledSmoothedGroupPolygons(mesh, groupIds, sharedCornerPositions)
  const sortedGroupIds = [...polygonsByGroup.keys()].sort((a, b) => a - b)

  const features: GeoJsonFeature<PolygonOrMultiPolygon>[] = []
  for (const gId of sortedGroupIds) {
    const polygons = polygonsByGroup.get(gId) ?? []
    const geometry = makePolygonGeometry(polygons)
    if (!geometry)
      continue
    const featureId = `${featureIdPrefix}:${gId}`
    features.push({
      type: 'Feature',
      id: featureId,
      geometry,
      properties: {
        id: featureId,
        groupIndex: gId,
        [propertyFieldName]: gId,
        areaKm2: areaByGroup.get(gId) ?? 0,
        name: `${labelPrefix} ${gId}`,
      },
    })
  }

  return Object.freeze({
    unavailable: false as const,
    kind: 'geojson' as const,
    sourceId,
    snapshotId: identity.snapshotId,
    adapterVersion: BUILTIN_MAP_SOURCE_SCHEMAS[sourceId].adapterVersion,
    cacheKey,
    geometryKind: 'polygon' as const,
    data: Object.freeze({
      type: 'FeatureCollection' as const,
      features: Object.freeze(features),
    }),
  })
}

export function buildKoppenAreasSource(
  reader: WorldMapReader,
  cacheKey: string,
  sharedCornerPositions?: Float64Array,
): GeoJsonSource<PolygonOrMultiPolygon> {
  return buildCategoricalLandAreasSource(
    reader,
    'koppen-areas',
    'koppenClass',
    'koppenClass',
    'koppen',
    '气候带',
    cacheKey,
    sharedCornerPositions,
  )
}

export function buildBiomeAreasSource(
  reader: WorldMapReader,
  cacheKey: string,
  sharedCornerPositions?: Float64Array,
): GeoJsonSource<PolygonOrMultiPolygon> {
  return buildCategoricalLandAreasSource(
    reader,
    'biome-areas',
    'potentialBiomeIndex',
    'biomeIndex',
    'biome',
    '生物群系',
    cacheKey,
    sharedCornerPositions,
  )
}

export function buildLandCoverAreasSource(
  reader: WorldMapReader,
  cacheKey: string,
  sharedCornerPositions?: Float64Array,
): GeoJsonSource<PolygonOrMultiPolygon> {
  return buildCategoricalLandAreasSource(
    reader,
    'land-cover-areas',
    'landCoverIndex',
    'landCoverIndex',
    'land-cover',
    '地表覆盖',
    cacheKey,
    sharedCornerPositions,
  )
}
