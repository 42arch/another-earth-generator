import type { WorldMapReader } from '@another-earth/world-core'
import type { DerivedRiverFeature } from '#sources/topology/hydrography-buffer'
import type {
  BuiltinMapSourceId,
  GeoJsonSource,
  MapSourceSchema,
  RasterCellSource,
  ResolvedMapSource,
} from './types'
import {
  buildBiomeAreasSource,
  buildContinentAreasSource,
  buildKoppenAreasSource,
  buildLandAreasSource,
  buildLandCoverAreasSource,
  buildPlateAreasSource,
} from './adapters/area-sources'
import {
  buildCultureDominantSource,
  buildPolityBordersSource,
  buildPolityLabelsSource,
  buildPolityTerritorySource,
  buildPopulationDensityRasterSource,
  buildReligionDominantSource,
  buildResourcePotentialRasterSource,
  buildSettlementLabelsSource,
  buildSettlementsSource,
  buildTransportRoutesSource,
} from './adapters/civilization-sources'
import {
  buildLakePolygonsSource,
  buildRiverCenterlinesSource,
  buildRiverPolygonsSource,
} from './adapters/hydro-sources'
import { buildGeographicLabelsSource } from './adapters/label-sources'
import {
  buildCellWireframeSource,
  buildCirculationVectorsSource,
  buildCoastlinesSource,
  buildGraticuleSource,
  buildPlateBoundariesSource,
} from './adapters/line-sources'
import {
  buildClimateMonthlyRasterSource,
  buildWorldSurfaceRasterSource,
} from './adapters/surface-raster'
import { buildHydrographyRivers } from './topology/hydrography-buffer'
import { extractCornerPositions } from './topology/ring-tracer'
import { BUILTIN_MAP_SOURCE_SCHEMAS } from './types'

export interface MapSourceRequestOptions {
  /** Climate month (0..11) for monthly sources (`climate-monthly`, `circulation-vectors`). Defaults to 0. */
  readonly month?: number
}

export interface CustomMapSourceAdapter {
  readonly schema: MapSourceSchema
  readonly build: (reader: WorldMapReader, cacheKey: string, month?: number) => ResolvedMapSource
}

function validateMonth(month: number): number {
  if (!Number.isInteger(month) || month < 0 || month >= 12)
    throw new RangeError(`Invalid climate month "${month}" (expected integer 0..11)`)
  return month
}

/**
 * Instance-scoped data source registry bound to a single `WorldMapReader`.
 * Never uses module-level globals or implicit WeakMap caches.
 */
export class MapSourceRegistry {
  readonly #reader: WorldMapReader
  readonly #cache = new Map<string, ResolvedMapSource>()
  readonly #customAdapters = new Map<string, CustomMapSourceAdapter>()
  readonly #computeCounts = new Map<string, number>()
  #sharedCornerPositions?: Float64Array
  #sharedHydrographyRivers?: readonly DerivedRiverFeature[]

  constructor(reader: WorldMapReader) {
    this.#reader = reader
  }

  get reader(): WorldMapReader {
    return this.#reader
  }

  get snapshotId(): string {
    return this.#reader.identity.snapshotId
  }

  registerAdapter(adapter: CustomMapSourceAdapter): void {
    this.#customAdapters.set(adapter.schema.id, adapter)
  }

  getSchema(sourceId: string): MapSourceSchema | undefined {
    const custom = this.#customAdapters.get(sourceId)
    if (custom)
      return custom.schema
    return (BUILTIN_MAP_SOURCE_SCHEMAS as Readonly<Record<string, MapSourceSchema>>)[sourceId]
  }

  buildCacheKey(sourceId: string, options?: MapSourceRequestOptions): string {
    const schema = this.getSchema(sourceId)
    if (!schema)
      throw new Error(`Unknown map source "${sourceId}"`)
    const snapshotId = this.#reader.identity.snapshotId
    if (schema.monthly) {
      const month = validateMonth(options?.month ?? 0)
      return `${snapshotId}:${schema.adapterVersion}:${sourceId}:m${month}`
    }
    return `${snapshotId}:${schema.adapterVersion}:${sourceId}`
  }

  hasCached(sourceId: string, options?: MapSourceRequestOptions): boolean {
    const schema = this.getSchema(sourceId)
    if (!schema)
      return false
    return this.#cache.has(this.buildCacheKey(sourceId, options))
  }

  /** Returns how many times `sourceId` was computed (excluding cache hits) in this registry instance. */
  getComputeCount(sourceId: string): number {
    return this.#computeCounts.get(sourceId) ?? 0
  }

  getSource(sourceId: BuiltinMapSourceId | string, options?: MapSourceRequestOptions): ResolvedMapSource {
    const schema = this.getSchema(sourceId)
    if (!schema)
      throw new Error(`Unknown map source "${sourceId}"`)

    const month = schema.monthly ? validateMonth(options?.month ?? 0) : undefined
    const cacheKey = this.buildCacheKey(sourceId, options)
    const cached = this.#cache.get(cacheKey)
    if (cached)
      return cached

    const custom = this.#customAdapters.get(sourceId)
    const resolved = custom
      ? custom.build(this.#reader, cacheKey, month)
      : this.#buildBuiltinSource(sourceId as BuiltinMapSourceId, cacheKey, month)

    this.#cache.set(cacheKey, resolved)
    this.#computeCounts.set(sourceId, (this.#computeCounts.get(sourceId) ?? 0) + 1)
    return resolved
  }

  getRasterSource(sourceId: string, options?: MapSourceRequestOptions): RasterCellSource {
    const resolved = this.getSource(sourceId, options)
    if (resolved.unavailable)
      throw new Error(`Source "${sourceId}" is unavailable: ${resolved.reason}`)
    if (resolved.kind !== 'raster')
      throw new Error(`Source "${sourceId}" is not a raster source`)
    return resolved
  }

  getGeoJsonSource(sourceId: string, options?: MapSourceRequestOptions): GeoJsonSource {
    const resolved = this.getSource(sourceId, options)
    if (resolved.unavailable)
      throw new Error(`Source "${sourceId}" is unavailable: ${resolved.reason}`)
    if (resolved.kind !== 'geojson')
      throw new Error(`Source "${sourceId}" is not a geojson source`)
    return resolved
  }

  /** Invalidates cached monthly sources (`climate-monthly`, `circulation-vectors`), optionally for a single month. */
  invalidateMonthlySources(month?: number): void {
    const suffix = month !== undefined ? `:m${validateMonth(month)}` : ':m'
    for (const key of [...this.#cache.keys()]) {
      if (month !== undefined ? key.endsWith(suffix) : key.includes(':m'))
        this.#cache.delete(key)
    }
  }

  clear(): void {
    this.#cache.clear()
    this.#computeCounts.clear()
    this.#sharedCornerPositions = undefined
    this.#sharedHydrographyRivers = undefined
  }

  #ensureCornerPositions(): Float64Array {
    this.#sharedCornerPositions ??= extractCornerPositions(this.#reader.mesh)
    return this.#sharedCornerPositions
  }

  #ensureHydrographyRivers(): readonly DerivedRiverFeature[] {
    this.#sharedHydrographyRivers ??= buildHydrographyRivers(this.#reader)
    return this.#sharedHydrographyRivers
  }

  #buildBuiltinSource(
    sourceId: BuiltinMapSourceId,
    cacheKey: string,
    month?: number,
  ): ResolvedMapSource {
    switch (sourceId) {
      case 'world-surface':
        return buildWorldSurfaceRasterSource(this.#reader, cacheKey)
      case 'climate-monthly':
        return buildClimateMonthlyRasterSource(this.#reader, month ?? 0, cacheKey)
      case 'land-areas':
        return buildLandAreasSource(this.#reader, cacheKey, this.#ensureCornerPositions())
      case 'continent-areas':
        return buildContinentAreasSource(this.#reader, cacheKey, this.#ensureCornerPositions())
      case 'plate-areas':
        return buildPlateAreasSource(this.#reader, cacheKey, this.#ensureCornerPositions())
      case 'koppen-areas':
        return buildKoppenAreasSource(this.#reader, cacheKey, this.#ensureCornerPositions())
      case 'biome-areas':
        return buildBiomeAreasSource(this.#reader, cacheKey, this.#ensureCornerPositions())
      case 'land-cover-areas':
        return buildLandCoverAreasSource(this.#reader, cacheKey, this.#ensureCornerPositions())
      case 'lake-polygons':
        return buildLakePolygonsSource(this.#reader, cacheKey, this.#ensureCornerPositions())
      case 'river-polygons':
        return buildRiverPolygonsSource(this.#reader, cacheKey, this.#ensureHydrographyRivers())
      case 'river-centerlines':
        return buildRiverCenterlinesSource(this.#reader, cacheKey, this.#ensureHydrographyRivers())
      case 'coastlines':
        return buildCoastlinesSource(this.#reader, cacheKey, this.#ensureCornerPositions())
      case 'plate-boundaries':
        return buildPlateBoundariesSource(this.#reader, cacheKey, this.#ensureCornerPositions())
      case 'graticule':
        return buildGraticuleSource(this.#reader, cacheKey)
      case 'cell-wireframe':
        return buildCellWireframeSource(this.#reader, cacheKey, this.#ensureCornerPositions())
      case 'circulation-vectors':
        return buildCirculationVectorsSource(this.#reader, month ?? 0, cacheKey)
      case 'geographic-labels':
        return buildGeographicLabelsSource(this.#reader, cacheKey)
      case 'population-density':
        return buildPopulationDensityRasterSource(this.#reader, cacheKey)
      case 'resource-potential':
        return buildResourcePotentialRasterSource(this.#reader, cacheKey)
      case 'polity-territory':
        return buildPolityTerritorySource(this.#reader, cacheKey, this.#ensureCornerPositions())
      case 'culture-dominant':
        return buildCultureDominantSource(this.#reader, cacheKey, this.#ensureCornerPositions())
      case 'religion-dominant':
        return buildReligionDominantSource(this.#reader, cacheKey, this.#ensureCornerPositions())
      case 'polity-borders':
        return buildPolityBordersSource(this.#reader, cacheKey, this.#ensureCornerPositions())
      case 'transport-routes':
        return buildTransportRoutesSource(this.#reader, cacheKey, this.#ensureHydrographyRivers())
      case 'settlements':
        return buildSettlementsSource(this.#reader, cacheKey)
      case 'polity-labels':
        return buildPolityLabelsSource(this.#reader, cacheKey)
      case 'settlement-labels':
        return buildSettlementLabelsSource(this.#reader, cacheKey)
    }
  }
}
