import type { GeoJsonFeatureCollection } from '@/core/data-source/geojson'
import type SphericalMesh from '@/core/mesh/mesh'
import type { ClimateVectorDisplayData } from '@/core/simulation/climate/climate-data'
import type { WorldSimulationState } from '@/core/simulation/state'
import { geoJsonGeometryKind, validateGeoJson } from '@/core/data-source/geojson'
import { MAP_STYLE_SOURCES } from '@/core/data-source/source-registry'

export type RasterCellField = Float32Array | Float64Array | Int32Array | Int16Array | Uint32Array | Uint16Array | Uint8Array

export interface RasterCellSource {
  type: 'raster'
  id: string
  mesh: SphericalMesh
  fields: Record<string, RasterCellField>
  gridId: string
  units?: Record<string, string>
  timeIndex?: number
  noData?: number
  revision: number
}

export interface SerializedRasterCellSource {
  type: 'raster'
  id: string
  gridId: string
  fields: Record<string, { dataType: 'float32' | 'float64' | 'int32' | 'int16' | 'uint32' | 'uint16' | 'uint8', values: number[] }>
  units?: Record<string, string>
  timeIndex?: number
  noData?: number
}

export interface GeoJsonDataSource {
  type: 'geojson'
  id: string
  data: GeoJsonFeatureCollection
  revision: number
}

export type MapDataSource = RasterCellSource | GeoJsonDataSource

const importedSources = new Map<string, GeoJsonDataSource>()
const importedRasterSources = new Map<string, RasterCellSource>()
const changeListeners = new Set<(id: string) => void>()

export function notifyMapDataSourceChanges(id: string): void {
  for (const listener of changeListeners)
    listener(id)
}

export function subscribeMapDataSourceChanges(listener: (id: string) => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

export function getImportedGeoJsonSource(id: string): GeoJsonDataSource | undefined {
  return importedSources.get(id)
}

export function rasterGridId(mesh: SphericalMesh): string {
  let hash = 2166136261
  const positions = mesh.regionPosition
  const stride = Math.max(1, Math.floor(positions.length / 96))
  for (let index = 0; index < positions.length; index += stride) {
    hash ^= Math.round(positions[index] * 1e6)
    hash = Math.imul(hash, 16777619)
  }
  return `spherical-cells:${mesh.numRegions}:${(hash >>> 0).toString(16)}`
}

export function importRasterCellSource(value: SerializedRasterCellSource, mesh: SphericalMesh): RasterCellSource {
  if (value.type !== 'raster' || value.gridId !== rasterGridId(mesh))
    throw new Error('Raster source grid does not match the current world mesh')
  if (!value.id || !value.fields || typeof value.fields !== 'object' || Object.keys(value.fields).length === 0)
    throw new Error('Raster source requires an id and at least one field')
  const fields: Record<string, RasterCellField> = {}
  for (const [name, field] of Object.entries(value.fields)) {
    if (!field || !Array.isArray(field.values) || field.values.length !== mesh.numRegions
      || field.values.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
      throw new Error(`Raster field "${name}" must contain one finite value per cell`)
    }
    switch (field.dataType) {
      case 'float32':
        fields[name] = Float32Array.from(field.values)
        break
      case 'float64':
        fields[name] = Float64Array.from(field.values)
        break
      case 'int32':
        fields[name] = Int32Array.from(field.values)
        break
      case 'int16':
        fields[name] = Int16Array.from(field.values)
        break
      case 'uint32':
        fields[name] = Uint32Array.from(field.values)
        break
      case 'uint16':
        fields[name] = Uint16Array.from(field.values)
        break
      case 'uint8':
        fields[name] = Uint8Array.from(field.values)
        break
      default:
        throw new Error(`Unsupported raster field type "${field.dataType}"`)
    }
  }
  if (value.id === 'world-surface' && (!fields.isLand || !fields.elevation))
    throw new Error('The world-surface raster requires isLand and elevation fields')
  const previous = importedRasterSources.get(value.id)
  const source: RasterCellSource = {
    type: 'raster',
    id: value.id,
    mesh,
    gridId: value.gridId,
    fields,
    units: value.units ? { ...value.units } : undefined,
    timeIndex: value.timeIndex,
    noData: value.noData,
    revision: (previous?.revision ?? 0) + 1,
  }
  importedRasterSources.set(value.id, source)
  notifyMapDataSourceChanges(value.id)
  return source
}

export function exportRasterCellSource(source: RasterCellSource): SerializedRasterCellSource {
  const fields: SerializedRasterCellSource['fields'] = {}
  for (const [name, field] of Object.entries(source.fields)) {
    fields[name] = {
      dataType: field instanceof Uint8Array
        ? 'uint8'
        : field instanceof Uint16Array
          ? 'uint16'
          : field instanceof Uint32Array
            ? 'uint32'
            : field instanceof Int16Array
              ? 'int16'
              : field instanceof Int32Array
                ? 'int32'
                : field instanceof Float64Array ? 'float64' : 'float32',
      values: Array.from(field),
    }
  }
  return {
    type: 'raster',
    id: source.id,
    gridId: source.gridId,
    fields,
    units: source.units ? { ...source.units } : undefined,
    timeIndex: source.timeIndex,
    noData: source.noData,
  }
}

export function resolveRasterCellSource(id: string, mesh: SphericalMesh, data: WorldSimulationState): RasterCellSource | undefined {
  const source = importedRasterSources.get(id)
  if (source?.gridId === rasterGridId(mesh))
    return source
  return id === 'world-surface' ? createWorldRasterSource(mesh, data) : undefined
}

export function removeRasterCellSource(id: string): void {
  if (importedRasterSources.delete(id))
    notifyMapDataSourceChanges(id)
}

export function importGeoJsonSource(id: string, value: unknown): GeoJsonDataSource {
  const errors = validateGeoJson(value)
  if (errors.length > 0)
    throw new Error(`Invalid GeoJSON source "${id}": ${errors.join('; ')}`)
  const expectedGeometry = MAP_STYLE_SOURCES[id]?.geometry
  if (expectedGeometry && (value as GeoJsonFeatureCollection).features.some(feature => geoJsonGeometryKind(feature.geometry) !== expectedGeometry))
    throw new Error(`GeoJSON source "${id}" requires ${expectedGeometry} geometries`)
  const previous = importedSources.get(id)
  const source: GeoJsonDataSource = {
    type: 'geojson',
    id,
    data: structuredClone(value as GeoJsonFeatureCollection),
    revision: (previous?.revision ?? 0) + 1,
  }
  importedSources.set(id, source)
  notifyMapDataSourceChanges(id)
  return source
}

export function exportGeoJsonSource(id: string): GeoJsonFeatureCollection | undefined {
  const source = importedSources.get(id)
  return source ? structuredClone(source.data) : undefined
}

export function updateGeoJsonFeature(id: string, featureId: string | number, update: (feature: GeoJsonFeatureCollection['features'][number]) => GeoJsonFeatureCollection['features'][number]): GeoJsonDataSource {
  const source = importedSources.get(id)
  if (!source)
    throw new Error(`Unknown imported GeoJSON source "${id}"`)
  const index = source.data.features.findIndex(feature => feature.id === featureId)
  if (index < 0)
    throw new Error(`Unknown feature "${featureId}" in source "${id}"`)
  const next = structuredClone(source.data)
  const changed = update(structuredClone(next.features[index]))
  if (changed.id !== featureId)
    throw new Error('Editing a feature cannot change its stable id')
  next.features[index] = changed
  return importGeoJsonSource(id, next)
}

export function removeGeoJsonSource(id: string): void {
  if (importedSources.delete(id)) {
    notifyMapDataSourceChanges(id)
  }
}

export function extractVectorSpeed(
  vector: ClimateVectorDisplayData | undefined,
  count: number,
  isLand?: Uint8Array,
  maskLand = false,
): Float32Array {
  const speed = new Float32Array(count)
  if (!vector || vector.east.length !== count || vector.north.length !== count)
    return speed
  const east = vector.east
  const north = vector.north
  for (let i = 0; i < count; i++) {
    if (maskLand && isLand && isLand[i])
      continue
    speed[i] = Math.hypot(east[i], north[i])
  }
  return speed
}

export function extractOceanWarmth(
  vector: ClimateVectorDisplayData | undefined,
  count: number,
  isLand?: Uint8Array,
): Float32Array {
  const warmth = new Float32Array(count)
  if (!vector || !vector.warmth || vector.warmth.length !== count)
    return warmth
  const raw = vector.warmth
  for (let i = 0; i < count; i++) {
    if (isLand && isLand[i])
      continue
    warmth[i] = raw[i]
  }
  return warmth
}

export function createWorldRasterSource(mesh: SphericalMesh, data: WorldSimulationState): RasterCellSource {
  const count = mesh.numRegions
  const windVector = data.climate?.displayWindVector ?? (data.climate?.displayVector?.kind === 'wind' ? data.climate.displayVector : undefined)
  const oceanVector = data.climate?.displayOceanVector ?? (data.climate?.displayVector?.kind === 'ocean-current' ? data.climate.displayVector : undefined)
  const isLand = data.geography.landMask

  return {
    type: 'raster',
    id: 'world-surface',
    mesh,
    gridId: rasterGridId(mesh),
    units: {
      elevation: 'km',
      temperature: '°C',
      precipitation: 'mm/month',
      windSpeed: 'relative',
      oceanCurrentSpeed: 'relative',
    },
    revision: 0,
    fields: {
      isLand: data.geography.landMask,
      elevation: data.geography.elevation,
      temperature: data.climate?.displayMonth?.temperatureC ?? new Float32Array(count),
      precipitation: data.climate?.displayMonth?.precipitationMm ?? new Float32Array(count),
      flowAccumulation: data.geography.terrainErosion?.flowAccumulation ?? new Float32Array(count),
      populationDensity: data.civilization?.populationDensity ?? new Float32Array(count),
      marketAccess: data.civilization?.transport?.marketAccess ?? new Float32Array(count),
      glacialIndex: data.geography.terrainErosion?.glacialIndex ?? new Float32Array(count),
      subductionOverriding: data.geography.terrainFields?.overridingInfluence ?? new Float32Array(count),
      subductionSubducting: data.geography.terrainFields?.subductingInfluence ?? new Float32Array(count),
      windSpeed: extractVectorSpeed(windVector, count),
      oceanCurrentSpeed: extractVectorSpeed(oceanVector, count, isLand, true),
      oceanWarmth: extractOceanWarmth(oceanVector, count, isLand),
    },
  }
}
