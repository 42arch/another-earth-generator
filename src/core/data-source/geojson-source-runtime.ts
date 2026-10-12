import type { GeoJsonDataSource } from '@/core/data-source/data-sources'
import type { GeoJsonFeatureCollection } from '@/core/data-source/geojson'
import type { AreaSourceId } from '@/core/data-source/geojson-area-sources'
import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { getImportedGeoJsonSource, notifyMapDataSourceChanges, resolveRasterCellSource } from '@/core/data-source/data-sources'
import { validateGeoJson } from '@/core/data-source/geojson'
import { createAreaGeoJsonSource, createLandGeoJsonSource } from '@/core/data-source/geojson-area-sources'
import { GEOJSON_LINE_SOURCE_ADAPTERS } from '@/core/data-source/geojson-line-sources'
import { POINT_SOURCE_ADAPTERS } from '@/core/data-source/point-source-adapters'
import { createRiverGeoJsonSource } from '@/core/data-source/river-geojson'
import { SYMBOL_SOURCE_ADAPTERS } from '@/core/data-source/symbol-source-adapters'

const areaIds = new Set([
  'plate-areas',
  'continent-areas',
  'koppen-areas',
  'biome-areas',
  'polity-areas',
  'ethnicity-areas',
  'language-areas',
  'religion-areas',
])
export type GeneratedGeoJsonProvider = (mesh: SphericalMesh, data: WorldSimulationState, params: WorldConfig) => GeoJsonFeatureCollection
const registeredProviders = new Map<string, GeneratedGeoJsonProvider>()
let generatedCache = new WeakMap<WorldSimulationState, WeakMap<SphericalMesh, Map<string, GeoJsonDataSource>>>()
let generatedRevision = 0
const rasterMaskIds = new WeakMap<object, number>()
let nextRasterMaskId = 1

function landMaskCacheKey(mesh: SphericalMesh, data: WorldSimulationState): string {
  const source = resolveRasterCellSource('world-surface', mesh, data)
  const mask = source?.fields.isLand ?? data.geography.landMask
  let id = rasterMaskIds.get(mask)
  if (id === undefined) {
    id = nextRasterMaskId++
    rasterMaskIds.set(mask, id)
  }
  return `${id}:${source?.revision ?? 0}`
}

export function registerGeneratedGeoJsonSource(id: string, provider: GeneratedGeoJsonProvider): () => void {
  if (!id || hasGeoJsonSource(id))
    throw new Error(`GeoJSON source "${id}" is already registered`)
  registeredProviders.set(id, provider)
  invalidateGeneratedGeoJsonSources()
  return () => {
    if (registeredProviders.get(id) === provider) {
      registeredProviders.delete(id)
      invalidateGeneratedGeoJsonSources()
    }
  }
}

export function hasGeoJsonSource(id: string): boolean {
  return Boolean(getImportedGeoJsonSource(id) || areaIds.has(id) || id === 'land-areas'
    || id === 'river-network' || registeredProviders.has(id)
    || GEOJSON_LINE_SOURCE_ADAPTERS[id] || POINT_SOURCE_ADAPTERS[id] || SYMBOL_SOURCE_ADAPTERS[id])
}

export function invalidateGeneratedGeoJsonSources(data?: WorldSimulationState): void {
  generatedRevision++
  if (data)
    generatedCache.delete(data)
  else
    generatedCache = new WeakMap()
  notifyMapDataSourceChanges('*')
}

function createGeneratedCollection(
  id: string,
  mesh: SphericalMesh,
  data: WorldSimulationState,
  params: WorldConfig,
): GeoJsonFeatureCollection | undefined {
  const registered = registeredProviders.get(id)
  if (registered) {
    const collection = registered(mesh, data, params)
    const errors = validateGeoJson(collection)
    if (errors.length > 0)
      throw new Error(`Generated GeoJSON source "${id}" is invalid: ${errors.join('; ')}`)
    return collection
  }
  if (areaIds.has(id))
    return createAreaGeoJsonSource(id as AreaSourceId, mesh, data)
  if (id === 'land-areas')
    return createLandGeoJsonSource(mesh, data)
  if (id === 'river-network')
    return createRiverGeoJsonSource(mesh, data)
  const line = GEOJSON_LINE_SOURCE_ADAPTERS[id]
  if (line)
    return line({ mesh, data })
  const point = POINT_SOURCE_ADAPTERS[id]
  if (point)
    return point(mesh, data)
  return SYMBOL_SOURCE_ADAPTERS[id]?.({ mesh, data, params }).data
}

export function resolveGeoJsonSource(
  id: string,
  mesh: SphericalMesh,
  data: WorldSimulationState,
  params: WorldConfig,
): GeoJsonDataSource | undefined {
  const imported = getImportedGeoJsonSource(id)
  if (imported)
    return imported
  let byMesh = generatedCache.get(data)
  if (!byMesh) {
    byMesh = new WeakMap()
    generatedCache.set(data, byMesh)
  }
  let cache = byMesh.get(mesh)
  if (!cache) {
    cache = new Map()
    byMesh.set(mesh, cache)
  }
  const key = id === 'land-areas'
    ? `${id}:${landMaskCacheKey(mesh, data)}`
    : `${id}:${params.appearance.mapStyle}:${params.appearance.overlays.cities}:${params.appearance.overlays['sacred-sites']}`
  const existing = cache.get(key)
  if (existing)
    return existing
  const collection = createGeneratedCollection(id, mesh, data, params)
  if (!collection)
    return undefined
  const source: GeoJsonDataSource = { type: 'geojson', id, data: collection, revision: generatedRevision }
  cache.set(key, source)
  return source
}

export function exportGeneratedGeoJsonSource(
  id: string,
  mesh: SphericalMesh,
  data: WorldSimulationState,
  params: WorldConfig,
) {
  const source = resolveGeoJsonSource(id, mesh, data, params)
  return source ? structuredClone(source.data) : undefined
}

export function exportGeneratedGeoJsonSourceBundle(
  id: string,
  mesh: SphericalMesh,
  data: WorldSimulationState,
  params: WorldConfig,
): { sourceId: string, revision: number, data: GeoJsonFeatureCollection } | undefined {
  const source = resolveGeoJsonSource(id, mesh, data, params)
  return source ? { sourceId: id, revision: source.revision, data: structuredClone(source.data) } : undefined
}
