import type { FieldView } from '@another-earth/world-core'
import type { LonLatTuple, Vec3Tuple } from '#projections/spherical-math'

export type BuiltinMapSourceId
  = | 'world-surface'
    | 'climate-monthly'
    | 'land-areas'
    | 'continent-areas'
    | 'plate-areas'
    | 'koppen-areas'
    | 'biome-areas'
    | 'land-cover-areas'
    | 'lake-polygons'
    | 'river-polygons'
    | 'river-centerlines'
    | 'coastlines'
    | 'plate-boundaries'
    | 'graticule'
    | 'cell-wireframe'
    | 'circulation-vectors'
    | 'geographic-labels'
    | 'population-density'
    | 'resource-potential'
    | 'polity-territory'
    | 'culture-dominant'
    | 'religion-dominant'
    | 'polity-borders'
    | 'transport-routes'
    | 'settlements'
    | 'polity-labels'
    | 'settlement-labels'

export type GeoJsonGeometryKind = 'point' | 'line' | 'polygon'

export interface GeoJsonPointGeometry {
  readonly type: 'Point'
  readonly coordinates: LonLatTuple
}

export interface GeoJsonLineStringGeometry {
  readonly type: 'LineString'
  readonly coordinates: readonly LonLatTuple[]
}

export interface GeoJsonMultiLineStringGeometry {
  readonly type: 'MultiLineString'
  readonly coordinates: readonly (readonly LonLatTuple[])[]
}

export interface GeoJsonPolygonGeometry {
  readonly type: 'Polygon'
  readonly coordinates: readonly (readonly LonLatTuple[])[]
}

export interface GeoJsonMultiPolygonGeometry {
  readonly type: 'MultiPolygon'
  readonly coordinates: readonly (readonly (readonly LonLatTuple[])[])[]
}

export type GeoJsonGeometry
  = | GeoJsonPointGeometry
    | GeoJsonLineStringGeometry
    | GeoJsonMultiLineStringGeometry
    | GeoJsonPolygonGeometry
    | GeoJsonMultiPolygonGeometry

export type GeoJsonFeaturePropertyValue = string | number | boolean | null

export interface GeoJsonFeature<
  G extends GeoJsonGeometry = GeoJsonGeometry,
  P extends Readonly<Record<string, GeoJsonFeaturePropertyValue>> = Readonly<Record<string, GeoJsonFeaturePropertyValue>>,
> {
  readonly type: 'Feature'
  readonly id: string
  readonly geometry: G
  readonly properties: P
}

export interface GeoJsonFeatureCollection<
  G extends GeoJsonGeometry = GeoJsonGeometry,
  P extends Readonly<Record<string, GeoJsonFeaturePropertyValue>> = Readonly<Record<string, GeoJsonFeaturePropertyValue>>,
> {
  readonly type: 'FeatureCollection'
  readonly features: readonly GeoJsonFeature<G, P>[]
}

export interface TerritorySpineMetadata {
  readonly featureId: string
  readonly displayName: string
  readonly kind: 'continent' | 'ocean' | 'polity' | 'settlement'
  readonly areaKm2: number
  readonly anchorRegion: number
  readonly anchorPosition: Vec3Tuple
  readonly anchorCoordinates: LonLatTuple
  readonly elongation: number
  readonly isCurved: boolean
  /** Control points on the unit sphere when `elongation >= 1.35`; empty for point-placed labels. */
  readonly spinePoints: readonly Vec3Tuple[]
  /** Geographic `[lonDeg, latDeg]` control points matching `spinePoints`. */
  readonly spineCoordinates: readonly LonLatTuple[]
}

export interface RasterFieldDescriptor {
  readonly name: string
  readonly view: FieldView
  readonly unit?: string
  /** Explicit sentinel value indicating missing/invalid cell data (e.g. -1 for continentIndex on ocean). */
  readonly noDataValue?: number
  /** Optional availability mask (0 = unavailable/noData, 1 = valid), e.g. `oceanAvailable` for ocean currents. */
  readonly availableMask?: FieldView
}

export interface RasterCellSource {
  readonly unavailable?: false
  readonly kind: 'raster'
  readonly sourceId: string
  readonly snapshotId: string
  readonly adapterVersion: string
  readonly cacheKey: string
  readonly regionCount: number
  readonly month?: number
  readonly fields: Readonly<Record<string, RasterFieldDescriptor>>
  getCellValue: (fieldName: string, region: number) => number
  isNoData: (fieldName: string, region: number) => boolean
}

export interface GeoJsonSource<
  G extends GeoJsonGeometry = GeoJsonGeometry,
  P extends Readonly<Record<string, GeoJsonFeaturePropertyValue>> = Readonly<Record<string, GeoJsonFeaturePropertyValue>>,
> {
  readonly unavailable?: false
  readonly kind: 'geojson'
  readonly sourceId: string
  readonly snapshotId: string
  readonly adapterVersion: string
  readonly cacheKey: string
  readonly geometryKind: GeoJsonGeometryKind
  readonly month?: number
  readonly data: GeoJsonFeatureCollection<G, P>
  /** Precomputed territory spine metadata for `symbol` sources (`geographic-labels`). */
  readonly spines?: ReadonlyMap<string, TerritorySpineMetadata>
}

export interface SourceUnavailable {
  readonly unavailable: true
  readonly sourceId: string
  readonly snapshotId: string
  readonly adapterVersion: string
  readonly cacheKey: string
  readonly reason: string
}

export type ResolvedMapSource = RasterCellSource | GeoJsonSource | SourceUnavailable

export interface MapSourceSchema {
  readonly id: string
  readonly kind: 'raster' | 'geojson'
  readonly geometryKind?: GeoJsonGeometryKind
  readonly monthly: boolean
  readonly adapterVersion: string
  readonly properties: readonly string[]
}

export const BUILTIN_MAP_SOURCE_SCHEMAS: Readonly<Record<BuiltinMapSourceId, MapSourceSchema>> = Object.freeze({
  'world-surface': {
    id: 'world-surface',
    kind: 'raster',
    monthly: false,
    adapterVersion: 'surface-raster-v2',
    properties: [
      'landMask',
      'elevationKm',
      'slopeDeg',
      'crustType',
      'plateIndex',
      'annualTemperatureC',
      'annualPrecipitationMm',
      'annualWindSpeedMps',
      'annualOceanSpeedMps',
      'koppenClass',
      'biomeIndex',
      'landCoverIndex',
      'aridityIndex',
      'growingSeasonMonths',
      'annualRunoffMm',
      'basinIndex',
      'continentIndex',
      'oceanIndex',
      'seaIndex',
      'surfaceDetail',
      'hillshade',
    ],
  },
  'climate-monthly': {
    id: 'climate-monthly',
    kind: 'raster',
    monthly: true,
    adapterVersion: 'climate-monthly-v1',
    properties: [
      'landMask',
      'temperatureC',
      'precipitationMm',
      'snowWaterEquivalentMm',
      'snowfallMm',
      'snowmeltMm',
      'windSpeedMps',
      'oceanSpeedMps',
      'oceanAvailable',
      'oceanWarmth',
    ],
  },
  'land-areas': {
    id: 'land-areas',
    kind: 'geojson',
    geometryKind: 'polygon',
    monthly: false,
    adapterVersion: 'land-areas-v1',
    properties: ['id', 'kind', 'areaKm2'],
  },
  'continent-areas': {
    id: 'continent-areas',
    kind: 'geojson',
    geometryKind: 'polygon',
    monthly: false,
    adapterVersion: 'continent-areas-v2',
    properties: ['id', 'kind', 'groupIndex', 'continentIndex', 'oceanIndex', 'seaIndex', 'areaKm2', 'name'],
  },
  'plate-areas': {
    id: 'plate-areas',
    kind: 'geojson',
    geometryKind: 'polygon',
    monthly: false,
    adapterVersion: 'plate-areas-v1',
    properties: ['id', 'groupIndex', 'areaKm2', 'name'],
  },
  'koppen-areas': {
    id: 'koppen-areas',
    kind: 'geojson',
    geometryKind: 'polygon',
    monthly: false,
    adapterVersion: 'koppen-areas-v1',
    properties: ['id', 'groupIndex', 'koppenClass', 'areaKm2', 'name'],
  },
  'biome-areas': {
    id: 'biome-areas',
    kind: 'geojson',
    geometryKind: 'polygon',
    monthly: false,
    adapterVersion: 'biome-areas-v1',
    properties: ['id', 'groupIndex', 'biomeIndex', 'areaKm2', 'name'],
  },
  'land-cover-areas': {
    id: 'land-cover-areas',
    kind: 'geojson',
    geometryKind: 'polygon',
    monthly: false,
    adapterVersion: 'land-cover-areas-v1',
    properties: ['id', 'groupIndex', 'landCoverIndex', 'areaKm2', 'name'],
  },
  'lake-polygons': {
    id: 'lake-polygons',
    kind: 'geojson',
    geometryKind: 'polygon',
    monthly: false,
    adapterVersion: 'lake-polygons-v3',
    properties: ['id', 'areaKm2', 'waterLevelKm', 'endorheic'],
  },
  'river-polygons': {
    id: 'river-polygons',
    kind: 'geojson',
    geometryKind: 'polygon',
    monthly: false,
    adapterVersion: 'river-polygons-v1',
    properties: ['id', 'strahlerOrder', 'annualMeanDischargeM3s', 'endorheic', 'areaKm2'],
  },
  'river-centerlines': {
    id: 'river-centerlines',
    kind: 'geojson',
    geometryKind: 'line',
    monthly: false,
    adapterVersion: 'river-centerlines-v1',
    properties: ['id', 'strahlerOrder', 'annualMeanDischargeM3s', 'endorheic'],
  },
  'coastlines': {
    id: 'coastlines',
    kind: 'geojson',
    geometryKind: 'line',
    monthly: false,
    adapterVersion: 'coastlines-v1',
    properties: ['id', 'kind'],
  },
  'plate-boundaries': {
    id: 'plate-boundaries',
    kind: 'geojson',
    geometryKind: 'line',
    monthly: false,
    adapterVersion: 'plate-boundaries-v1',
    properties: ['id', 'plateA', 'plateB', 'plateIndexA', 'plateIndexB'],
  },
  'graticule': {
    id: 'graticule',
    kind: 'geojson',
    geometryKind: 'line',
    monthly: false,
    adapterVersion: 'graticule-v1',
    properties: ['id', 'kind', 'degrees'],
  },
  'cell-wireframe': {
    id: 'cell-wireframe',
    kind: 'geojson',
    geometryKind: 'line',
    monthly: false,
    adapterVersion: 'cell-wireframe-v1',
    properties: ['id'],
  },
  'circulation-vectors': {
    id: 'circulation-vectors',
    kind: 'geojson',
    geometryKind: 'line',
    monthly: true,
    adapterVersion: 'circulation-vectors-v1',
    properties: ['id', 'kind', 'speedMps', 'warmth'],
  },
  'geographic-labels': {
    id: 'geographic-labels',
    kind: 'geojson',
    geometryKind: 'point',
    monthly: false,
    adapterVersion: 'geographic-labels-v1',
    properties: ['id', 'kind', 'displayName', 'areaKm2', 'elongation', 'curved'],
  },
  'population-density': {
    id: 'population-density',
    kind: 'raster',
    monthly: false,
    adapterVersion: 'population-density-v1',
    properties: ['landMask', 'population', 'populationDensity', 'habitability', 'carryingCapacityPerKm2', 'transportAccessibility'],
  },
  'resource-potential': {
    id: 'resource-potential',
    kind: 'raster',
    monthly: false,
    adapterVersion: 'resource-potential-v1',
    properties: ['landMask', 'agriculturalPotential', 'forestryPotential', 'fisheryPotential', 'depositRichness'],
  },
  'polity-territory': {
    id: 'polity-territory',
    kind: 'geojson',
    geometryKind: 'polygon',
    monthly: false,
    adapterVersion: 'polity-territory-v4',
    properties: ['id', 'entityId', 'groupIndex', 'polityIndex', 'areaKm2', 'name', 'sizeClass', 'archetypeId', 'unassigned'],
  },
  'culture-dominant': {
    id: 'culture-dominant',
    kind: 'geojson',
    geometryKind: 'polygon',
    monthly: false,
    adapterVersion: 'culture-dominant-v1',
    properties: ['id', 'entityId', 'groupIndex', 'cultureIndex', 'areaKm2', 'name', 'peopleId'],
  },
  'religion-dominant': {
    id: 'religion-dominant',
    kind: 'geojson',
    geometryKind: 'polygon',
    monthly: false,
    adapterVersion: 'religion-dominant-v1',
    properties: ['id', 'entityId', 'groupIndex', 'religionIndex', 'areaKm2', 'name', 'archetypeId'],
  },
  'polity-borders': {
    id: 'polity-borders',
    kind: 'geojson',
    geometryKind: 'line',
    monthly: false,
    adapterVersion: 'polity-borders-v4',
    properties: ['id', 'entityId', 'polityA', 'polityB', 'polityIndexA', 'polityIndexB', 'isFrontier'],
  },
  'transport-routes': {
    id: 'transport-routes',
    kind: 'geojson',
    geometryKind: 'line',
    monthly: false,
    adapterVersion: 'transport-routes-v1',
    properties: ['id', 'entityId', 'mode', 'fromNodeId', 'toNodeId', 'cost', 'trafficScore'],
  },
  'settlements': {
    id: 'settlements',
    kind: 'geojson',
    geometryKind: 'point',
    monthly: false,
    adapterVersion: 'settlements-v1',
    properties: ['id', 'entityId', 'name', 'tier', 'isPort', 'population', 'polityId', 'cultureId', 'regionId', 'symbolShape'],
  },
  'polity-labels': {
    id: 'polity-labels',
    kind: 'geojson',
    geometryKind: 'point',
    monthly: false,
    adapterVersion: 'polity-labels-v1',
    properties: ['id', 'entityId', 'kind', 'displayName', 'areaKm2', 'priority', 'elongation', 'curved'],
  },
  'settlement-labels': {
    id: 'settlement-labels',
    kind: 'geojson',
    geometryKind: 'point',
    monthly: false,
    adapterVersion: 'settlement-labels-v1',
    properties: ['id', 'entityId', 'kind', 'displayName', 'tier', 'isPort', 'population', 'priority', 'curved'],
  },
})
