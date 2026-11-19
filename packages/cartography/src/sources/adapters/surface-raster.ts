import type { FieldView, WorldMapReader } from '@another-earth/world-core'
import type { RasterCellSource, RasterFieldDescriptor, SourceUnavailable } from '#sources/types'
import { BUILTIN_MAP_SOURCE_SCHEMAS } from '#sources/types'

function createConstantSentinelFieldView(meshId: string, length: number, sentinel = -1): FieldView {
  return Object.freeze({
    meshId,
    length,
    get(index: number) {
      if (!Number.isInteger(index) || index < 0 || index >= length)
        throw new RangeError('Invalid field index')
      return sentinel
    },
  })
}

function buildRasterSourceFromFields(
  sourceId: 'world-surface' | 'climate-monthly',
  reader: WorldMapReader,
  cacheKey: string,
  fields: Record<string, RasterFieldDescriptor>,
  month?: number,
): RasterCellSource {
  const { snapshotId, regionCount } = reader.identity
  const { adapterVersion } = BUILTIN_MAP_SOURCE_SCHEMAS[sourceId]
  const frozenFields = Object.freeze({ ...fields })

  return Object.freeze({
    unavailable: false as const,
    kind: 'raster' as const,
    sourceId,
    snapshotId,
    adapterVersion,
    cacheKey,
    regionCount,
    ...(month !== undefined ? { month } : {}),
    fields: frozenFields,
    getCellValue(fieldName: string, region: number): number {
      const desc = frozenFields[fieldName]
      if (!desc)
        throw new Error(`Unknown raster field "${fieldName}" on source "${sourceId}"`)
      return desc.view.get(region)
    },
    isNoData(fieldName: string, region: number): boolean {
      const desc = frozenFields[fieldName]
      if (!desc)
        throw new Error(`Unknown raster field "${fieldName}" on source "${sourceId}"`)
      if (desc.availableMask && desc.availableMask.get(region) === 0)
        return true
      const value = desc.view.get(region)
      if (!Number.isFinite(value))
        return true
      return desc.noDataValue !== undefined && value === desc.noDataValue
    },
  })
}

export function buildWorldSurfaceRasterSource(
  reader: WorldMapReader,
  cacheKey: string,
): RasterCellSource {
  const { meshId, regionCount } = reader.identity
  const { hasGeographicRegions, hasSeaClassification, hasCirculation } = reader.capabilities
  const sentinelView = (!hasGeographicRegions || !hasSeaClassification)
    ? createConstantSentinelFieldView(meshId, regionCount, -1)
    : undefined
  const unavailableMask = !hasCirculation
    ? createConstantSentinelFieldView(meshId, regionCount, 0)
    : undefined
  const zeroSlice = !hasCirculation
    ? createConstantSentinelFieldView(meshId, regionCount, 0)
    : undefined
  const oceanAvailableView = hasCirculation ? reader.field('oceanAvailable') : unavailableMask!

  const fields: Record<string, RasterFieldDescriptor> = {
    landMask: { name: 'landMask', view: reader.field('landMask') },
    elevationKm: { name: 'elevationKm', view: reader.field('elevationKm'), unit: 'km' },
    slopeDeg: { name: 'slopeDeg', view: reader.field('slopeDeg'), unit: '°' },
    crustType: { name: 'crustType', view: reader.field('crustType') },
    plateIndex: { name: 'plateIndex', view: reader.field('plateIndex'), noDataValue: -1 },
    annualTemperatureC: { name: 'annualTemperatureC', view: reader.field('annualMeanTemperatureC'), unit: '°C' },
    annualPrecipitationMm: { name: 'annualPrecipitationMm', view: reader.field('annualPrecipitationMm'), unit: 'mm/年' },
    annualWindSpeedMps: {
      name: 'annualWindSpeedMps',
      view: hasCirculation ? reader.field('annualWindSpeedMps') : zeroSlice!,
      unit: 'm/s',
      ...(hasCirculation ? {} : { availableMask: unavailableMask }),
    },
    annualOceanSpeedMps: {
      name: 'annualOceanSpeedMps',
      view: hasCirculation ? reader.field('annualOceanSpeedMps') : zeroSlice!,
      unit: 'm/s',
      availableMask: oceanAvailableView,
    },
    koppenClass: { name: 'koppenClass', view: reader.field('koppenClass') },
    biomeIndex: { name: 'biomeIndex', view: reader.field('potentialBiomeIndex') },
    landCoverIndex: { name: 'landCoverIndex', view: reader.field('landCoverIndex') },
    aridityIndex: { name: 'aridityIndex', view: reader.field('aridityIndex') },
    growingSeasonMonths: { name: 'growingSeasonMonths', view: reader.field('growingSeasonMonths'), unit: '月' },
    annualRunoffMm: { name: 'annualRunoffMm', view: reader.field('annualRunoffMm'), unit: 'mm/年' },
    basinIndex: { name: 'basinIndex', view: reader.field('basinIndex'), noDataValue: -1 },
    continentIndex: {
      name: 'continentIndex',
      view: hasGeographicRegions ? reader.field('continentIndex') : sentinelView!,
      noDataValue: -1,
    },
    oceanIndex: {
      name: 'oceanIndex',
      view: hasGeographicRegions ? reader.field('oceanIndex') : sentinelView!,
      noDataValue: -1,
    },
    seaIndex: {
      name: 'seaIndex',
      view: hasSeaClassification ? reader.field('seaIndex') : sentinelView!,
      noDataValue: -1,
    },
    surfaceDetail: { name: 'surfaceDetail', view: reader.field('surfaceDetail') },
    hillshade: { name: 'hillshade', view: reader.field('hillshade') },
  }

  return buildRasterSourceFromFields('world-surface', reader, cacheKey, fields)
}

export function buildClimateMonthlyRasterSource(
  reader: WorldMapReader,
  month: number,
  cacheKey: string,
): RasterCellSource | SourceUnavailable {
  const { meshId, regionCount } = reader.identity
  const { hasCirculation } = reader.capabilities
  const unavailableMask = !hasCirculation
    ? createConstantSentinelFieldView(meshId, regionCount, 0)
    : undefined
  const zeroSlice = !hasCirculation
    ? createConstantSentinelFieldView(meshId, regionCount, 0)
    : undefined

  const oceanAvailableView = hasCirculation ? reader.field('oceanAvailable') : unavailableMask!

  const fields: Record<string, RasterFieldDescriptor> = {
    landMask: { name: 'landMask', view: reader.field('landMask') },
    temperatureC: { name: 'temperatureC', view: reader.monthlyField('temperatureC', month), unit: '°C' },
    precipitationMm: { name: 'precipitationMm', view: reader.monthlyField('precipitationMm', month), unit: 'mm/月' },
    snowWaterEquivalentMm: { name: 'snowWaterEquivalentMm', view: reader.monthlyField('snowWaterEquivalentMm', month), unit: 'mm' },
    snowfallMm: { name: 'snowfallMm', view: reader.monthlyField('snowfallMm', month), unit: 'mm/月' },
    snowmeltMm: { name: 'snowmeltMm', view: reader.monthlyField('snowmeltMm', month), unit: 'mm/月' },
    windSpeedMps: {
      name: 'windSpeedMps',
      view: hasCirculation ? reader.monthlyField('windSpeedMps', month) : zeroSlice!,
      unit: 'm/s',
      ...(hasCirculation ? {} : { availableMask: unavailableMask }),
    },
    oceanSpeedMps: {
      name: 'oceanSpeedMps',
      view: hasCirculation ? reader.monthlyField('oceanSpeedMps', month) : zeroSlice!,
      unit: 'm/s',
      availableMask: oceanAvailableView,
    },
    oceanAvailable: {
      name: 'oceanAvailable',
      view: oceanAvailableView,
    },
    oceanWarmth: {
      name: 'oceanWarmth',
      view: hasCirculation ? reader.monthlyField('oceanWarmth', month) : zeroSlice!,
      availableMask: oceanAvailableView,
    },
  }

  return buildRasterSourceFromFields('climate-monthly', reader, cacheKey, fields, month)
}
