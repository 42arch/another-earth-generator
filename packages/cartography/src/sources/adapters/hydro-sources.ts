import type { Vec3Tuple } from '#projections/spherical-math'
import type { DerivedRiverFeature } from '#sources/topology/hydrography-buffer'
import type {
  GeoJsonFeature,
  GeoJsonLineStringGeometry,
  GeoJsonMultiPolygonGeometry,
  GeoJsonPolygonGeometry,
  GeoJsonSource,
} from '#sources/types'
import type { WorldMapReader } from '@another-earth/world-core'
import { normalizeVec3 } from '#projections/spherical-math'
import { buildHydrographyRivers } from '#sources/topology/hydrography-buffer'
import { assemblePolygonsWithHoles, traceClassificationRings } from '#sources/topology/ring-tracer'
import { catmullRomSmoothClosedRing } from '#sources/topology/spherical-smooth'
import { BUILTIN_MAP_SOURCE_SCHEMAS } from '#sources/types'

type PolygonOrMultiPolygon = GeoJsonPolygonGeometry | GeoJsonMultiPolygonGeometry

export function buildLakePolygonsSource(
  reader: WorldMapReader,
  cacheKey: string,
  sharedCornerPositions?: Float64Array,
): GeoJsonSource<PolygonOrMultiPolygon> {
  const { mesh, identity } = reader
  const lakes = reader.lakes()
  if (lakes.length === 0) {
    return Object.freeze({
      unavailable: false as const,
      kind: 'geojson' as const,
      sourceId: 'lake-polygons',
      snapshotId: identity.snapshotId,
      adapterVersion: BUILTIN_MAP_SOURCE_SCHEMAS['lake-polygons'].adapterVersion,
      cacheKey,
      geometryKind: 'polygon' as const,
      data: Object.freeze({
        type: 'FeatureCollection' as const,
        features: Object.freeze([]),
      }),
    })
  }

  const count = mesh.regionCount
  const lakeIndexField = reader.field('lakeIndex')
  const groupIds = new Int32Array(count)
  for (let r = 0; r < count; r++)
    groupIds[r] = lakeIndexField.get(r)

  const traced = traceClassificationRings(mesh, groupIds, sharedCornerPositions)
  const features: GeoJsonFeature<PolygonOrMultiPolygon>[] = []

  for (const group of traced.groups) {
    const lakeSummary = lakes[group.groupId]
    if (!lakeSummary)
      continue
    const smoothedRings = group.rings.map((ring) => {
      const raw: Vec3Tuple[] = []
      for (let i = 0; i < ring.corners.length; i++) {
        const c = ring.corners[i]
        raw.push(normalizeVec3(
          traced.cornerPositions[3 * c],
          traced.cornerPositions[3 * c + 1],
          traced.cornerPositions[3 * c + 2],
        ))
      }
      const points = raw.length >= 3
        ? catmullRomSmoothClosedRing(raw, 4)
        : raw
      return {
        points,
        sampleInteriorRegion: ring.sampleInteriorRegion,
      }
    })

    const polygons = assemblePolygonsWithHoles(mesh, smoothedRings)
    if (polygons.length === 0)
      continue
    const geometry: PolygonOrMultiPolygon = polygons.length === 1
      ? { type: 'Polygon', coordinates: polygons[0] }
      : { type: 'MultiPolygon', coordinates: polygons }

    features.push({
      type: 'Feature',
      id: lakeSummary.id,
      geometry,
      properties: {
        id: lakeSummary.id,
        areaKm2: lakeSummary.areaKm2,
        waterLevelKm: lakeSummary.waterLevelKm,
        endorheic: lakeSummary.endorheic,
      },
    })
  }

  return Object.freeze({
    unavailable: false as const,
    kind: 'geojson' as const,
    sourceId: 'lake-polygons',
    snapshotId: identity.snapshotId,
    adapterVersion: BUILTIN_MAP_SOURCE_SCHEMAS['lake-polygons'].adapterVersion,
    cacheKey,
    geometryKind: 'polygon' as const,
    data: Object.freeze({
      type: 'FeatureCollection' as const,
      features: Object.freeze(features),
    }),
  })
}

export function buildRiverPolygonsSource(
  reader: WorldMapReader,
  cacheKey: string,
  derivedRivers?: readonly DerivedRiverFeature[],
): GeoJsonSource<PolygonOrMultiPolygon> {
  const rivers = derivedRivers ?? buildHydrographyRivers(reader)
  const features: GeoJsonFeature<PolygonOrMultiPolygon>[] = rivers.map((river) => {
    const geometry: PolygonOrMultiPolygon = river.polygonsCoords.length === 1
      ? { type: 'Polygon', coordinates: river.polygonsCoords[0] }
      : { type: 'MultiPolygon', coordinates: river.polygonsCoords }
    return {
      type: 'Feature',
      id: river.id,
      geometry,
      properties: {
        id: river.id,
        strahlerOrder: river.strahlerOrder,
        annualMeanDischargeM3s: river.annualMeanDischargeM3s,
        endorheic: river.endorheic,
        areaKm2: river.areaKm2,
      },
    }
  })

  return Object.freeze({
    unavailable: false as const,
    kind: 'geojson' as const,
    sourceId: 'river-polygons',
    snapshotId: reader.identity.snapshotId,
    adapterVersion: BUILTIN_MAP_SOURCE_SCHEMAS['river-polygons'].adapterVersion,
    cacheKey,
    geometryKind: 'polygon' as const,
    data: Object.freeze({
      type: 'FeatureCollection' as const,
      features: Object.freeze(features),
    }),
  })
}

export function buildRiverCenterlinesSource(
  reader: WorldMapReader,
  cacheKey: string,
  derivedRivers?: readonly DerivedRiverFeature[],
): GeoJsonSource<GeoJsonLineStringGeometry> {
  const rivers = derivedRivers ?? buildHydrographyRivers(reader)
  const features: GeoJsonFeature<GeoJsonLineStringGeometry>[] = rivers.map(river => ({
    type: 'Feature',
    id: river.id,
    geometry: {
      type: 'LineString',
      coordinates: river.centerlineCoords,
    },
    properties: {
      id: river.id,
      strahlerOrder: river.strahlerOrder,
      annualMeanDischargeM3s: river.annualMeanDischargeM3s,
      endorheic: river.endorheic,
    },
  }))

  return Object.freeze({
    unavailable: false as const,
    kind: 'geojson' as const,
    sourceId: 'river-centerlines',
    snapshotId: reader.identity.snapshotId,
    adapterVersion: BUILTIN_MAP_SOURCE_SCHEMAS['river-centerlines'].adapterVersion,
    cacheKey,
    geometryKind: 'line' as const,
    data: Object.freeze({
      type: 'FeatureCollection' as const,
      features: Object.freeze(features),
    }),
  })
}
