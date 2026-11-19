import type {
  CategoricalLegendDescriptor,
  ContinuousLegendDescriptor,
  LegendDescriptor,
} from '@another-earth/cartography'
import type { WorldMapReader } from '@another-earth/world-core'
import {
  BIOME_CLASS_LABELS_ZH,
  BIOME_PALETTE_HEX,
  CATEGORICAL_GROUP_PALETTE_HEX,
  formatContinentDisplayName,
  formatOceanDisplayName,
  KOPPEN_CLASS_LABELS_ZH,
  KOPPEN_PALETTE_HEX,
  LAND_COVER_LABELS_ZH,
  LAND_COVER_PALETTE_HEX,
  OCEAN_SPEED_COLOR_STOPS,
  WIND_SPEED_COLOR_STOPS,
} from '@another-earth/cartography'
import { KOPPEN_CODES } from '@another-earth/world-core'
import { NATURAL_BIOME_DEFINITIONS, NATURAL_LAND_COVER_DEFINITIONS } from '@another-earth/world-data'

export interface LayerStatisticRow {
  key: string
  label: string
  count: number
  percentage: number
  areaKm2: number
  landSharePercentage?: number
  color: string
}

export interface LayerStatistics {
  mode: string
  title: string
  totalCells: number
  totalAreaKm2: number
  rows: LayerStatisticRow[]
  description?: string
  measure: 'cells'
  month?: number
  legendKind?: 'continuous' | 'categorical'
  unit?: string
  gradientStops?: readonly { readonly value: number, readonly color: string }[]
}

export interface ReaderLayerStatisticsOptions {
  readonly activeThematicId: string | null
  readonly styleId?: string
  readonly month?: number
  readonly legend?: LegendDescriptor | null
}

interface StatisticBucket {
  readonly key: string
  readonly label: string
  readonly color: string
}

const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1, useGrouping: false })
const speedNumberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3, useGrouping: false })

function computeWeightedSummary(
  reader: WorldMapReader,
  sampleValue: (region: number) => number | null,
  landOnly = false,
): { mean: number | null, minimum: number | null, maximum: number | null } {
  const count = reader.mesh.regionCount
  const landMask = reader.field('landMask')
  let weightedSum = 0
  let totalArea = 0
  let minVal = Infinity
  let maxVal = -Infinity

  for (let r = 0; r < count; r++) {
    if (landOnly && landMask.get(r) === 0)
      continue
    const value = sampleValue(r)
    if (value === null || !Number.isFinite(value))
      continue
    const area = reader.mesh.getRegionAreaKm2(r)
    if (!(area > 0))
      continue
    weightedSum += value * area
    totalArea += area
    if (value < minVal)
      minVal = value
    if (value > maxVal)
      maxVal = value
  }

  if (totalArea <= 0)
    return { mean: null, minimum: null, maximum: null }
  return {
    mean: weightedSum / totalArea,
    minimum: minVal,
    maximum: maxVal,
  }
}

function accumulateBuckets(
  reader: WorldMapReader,
  buckets: readonly StatisticBucket[],
  keyForRegion: (region: number) => string | null,
): { rows: LayerStatisticRow[], totalAreaKm2: number } {
  const count = reader.mesh.regionCount
  const landMask = reader.field('landMask')
  const tallies = new Map<string, { count: number, areaKm2: number, landCount: number }>()
  for (const b of buckets) {
    tallies.set(b.key, { count: 0, areaKm2: 0, landCount: 0 })
  }

  let totalAreaKm2 = 0
  let totalLandCount = 0
  for (let r = 0; r < count; r++) {
    const area = reader.mesh.getRegionAreaKm2(r)
    totalAreaKm2 += area
    const isLand = landMask.get(r) !== 0
    if (isLand)
      totalLandCount++
    const key = keyForRegion(r)
    if (key === null)
      continue
    const tally = tallies.get(key)
    if (!tally)
      continue
    tally.count++
    tally.areaKm2 += area
    if (isLand)
      tally.landCount++
  }

  const rows: LayerStatisticRow[] = []
  for (const b of buckets) {
    const tally = tallies.get(b.key)!
    if (tally.count <= 0)
      continue
    rows.push({
      key: b.key,
      label: b.label,
      count: tally.count,
      percentage: count > 0 ? (tally.count / count) * 100 : 0,
      areaKm2: tally.areaKm2,
      landSharePercentage: totalLandCount > 0 ? (tally.landCount / totalLandCount) * 100 : 0,
      color: b.color,
    })
  }
  return { rows, totalAreaKm2 }
}

function buildIntervalBuckets(
  thresholds: readonly number[],
  colors: readonly string[],
  unit: string,
  customLabels?: readonly string[],
): StatisticBucket[] {
  const formatter = unit === 'm/s' ? speedNumberFormat : numberFormat
  return Array.from({ length: thresholds.length + 1 }, (_, index) => {
    const defaultLabel = index === 0
      ? `< ${formatter.format(thresholds[0])}${unit ? ` ${unit}` : ''}`
      : index === thresholds.length
        ? `≥ ${formatter.format(thresholds[index - 1])}${unit ? ` ${unit}` : ''}`
        : `${formatter.format(thresholds[index - 1])} 至 < ${formatter.format(thresholds[index])}${unit ? ` ${unit}` : ''}`
    return {
      key: String(index),
      label: customLabels?.[index] ?? defaultLabel,
      color: colors[index] ?? colors.at(-1) ?? '#64748b',
    }
  })
}

function buildContinuousLegendFallback(
  reader: WorldMapReader,
  legend: ContinuousLegendDescriptor,
  mode: string,
  month: number,
): LayerStatistics {
  const stops = legend.stops
  const thresholds = stops.slice(1).map(s => s.value)
  const colors = stops.map(s => s.color)
  const unit = legend.unit ?? ''
  const buckets = buildIntervalBuckets(thresholds, colors, unit)
  if (legend.noDataLabel) {
    buckets.push({
      key: 'no-data',
      label: legend.noDataLabel,
      color: legend.noDataColor ?? '#475569',
    })
  }

  const isMonthly = legend.fieldName === 'temperatureC'
    || legend.fieldName === 'precipitationMm'
    || legend.fieldName === 'snowWaterEquivalentMm'
  const fieldView = isMonthly
    ? reader.monthlyField(legend.fieldName as 'temperatureC' | 'precipitationMm' | 'snowWaterEquivalentMm', month)
    : reader.field(
        (legend.fieldName === 'annualTemperatureC' ? 'annualMeanTemperatureC' : legend.fieldName) as Parameters<WorldMapReader['field']>[0],
      )

  const { rows, totalAreaKm2 } = accumulateBuckets(reader, buckets, (r) => {
    const val = fieldView.get(r)
    if (!Number.isFinite(val))
      return legend.noDataLabel ? 'no-data' : null
    const idx = thresholds.findIndex(t => val < t)
    return String(idx < 0 ? thresholds.length : idx)
  })

  return {
    mode,
    title: legend.title,
    totalCells: reader.mesh.regionCount,
    totalAreaKm2,
    rows,
    measure: 'cells',
    legendKind: 'continuous',
    unit: legend.unit,
    gradientStops: stops,
  }
}

function buildCategoricalLegendFallback(
  reader: WorldMapReader,
  legend: CategoricalLegendDescriptor,
  mode: string,
): LayerStatistics {
  const buckets: StatisticBucket[] = legend.items.map(item => ({
    key: String(item.value),
    label: item.label,
    color: item.color,
  }))
  if (legend.noDataLabel) {
    buckets.push({
      key: 'no-data',
      label: legend.noDataLabel,
      color: legend.noDataColor ?? '#475569',
    })
  }

  const fieldName = (legend.fieldName ?? 'landMask') as Parameters<WorldMapReader['field']>[0]
  const fieldView = reader.field(fieldName)
  const { rows, totalAreaKm2 } = accumulateBuckets(reader, buckets, (r) => {
    const v = fieldView.get(r)
    if (v < 0)
      return legend.noDataLabel ? 'no-data' : null
    return String(v % Math.max(1, legend.items.length))
  })

  return {
    mode,
    title: legend.title,
    totalCells: reader.mesh.regionCount,
    totalAreaKm2,
    rows,
    measure: 'cells',
    legendKind: 'categorical',
  }
}

/**
 * Computes area-weighted distribution and legend statistics directly from a `WorldMapReader`
 * and optional `LegendDescriptor`, without requiring intermediate `GenerationArtifact` objects.
 */
export function buildLayerStatisticsFromReader(
  reader: WorldMapReader,
  options: ReaderLayerStatisticsOptions,
): LayerStatistics {
  const count = reader.mesh.regionCount
  const month = Math.max(0, Math.min(11, Math.floor(options.month ?? 0)))
  const thematicId = options.activeThematicId && options.activeThematicId !== 'none'
    ? options.activeThematicId
    : null
  const mode = thematicId ?? (options.styleId ?? 'satellite')
  const legend = options.legend ?? null

  // Base style (no thematic layer active): summarize land vs ocean distribution and elevation range
  if (!thematicId) {
    const landMask = reader.field('landMask')
    const elevationKm = reader.field('elevationKm')
    const landSummary = computeWeightedSummary(reader, r => elevationKm.get(r), true)
    const oceanSummary = computeWeightedSummary(reader, r => landMask.get(r) === 0 ? elevationKm.get(r) : null, false)
    const buckets: StatisticBucket[] = [
      { key: 'land', label: '陆地单元', color: '#6b9e58' },
      { key: 'ocean', label: '海洋单元', color: '#1b5886' },
    ]
    const { rows, totalAreaKm2 } = accumulateBuckets(
      reader,
      buckets,
      r => landMask.get(r) !== 0 ? 'land' : 'ocean',
    )
    const landRow = rows.find(r => r.key === 'land')
    const landPct = landRow && totalAreaKm2 > 0 ? ((landRow.areaKm2 / totalAreaKm2) * 100).toFixed(1) : '0.0'
    const landMean = landSummary.mean !== null ? `${landSummary.mean.toFixed(2)} km` : '无陆地'
    const oceanMean = oceanSummary.mean !== null ? `${oceanSummary.mean.toFixed(2)} km` : '无海洋'

    const surfaceNote = options.styleId === 'satellite' ? '地表按气温、降水和干湿度着色。' : ''
    return {
      mode,
      title: legend?.title ?? '底图海陆与高程统计',
      totalCells: count,
      totalAreaKm2,
      rows,
      description: `${surfaceNote}陆地面积占比 ${landPct}%；陆地均高 ${landMean}，海洋均深 ${oceanMean}。`,
      measure: 'cells',
      legendKind: legend?.kind ?? 'categorical',
      unit: legend?.kind === 'continuous' ? legend.unit : undefined,
      gradientStops: legend?.kind === 'continuous' ? legend.stops : undefined,
    }
  }

  // 1. Climate temperature & precipitation (monthly and annual)
  if (
    thematicId === 'temperature'
    || thematicId === 'annual-temperature'
    || thematicId === 'precipitation'
    || thematicId === 'annual-precipitation'
  ) {
    const isAnnual = thematicId.startsWith('annual-')
    const isPrecipitation = thematicId.endsWith('precipitation')
    const fieldView = isPrecipitation
      ? (isAnnual ? reader.field('annualPrecipitationMm') : reader.monthlyField('precipitationMm', month))
      : (isAnnual ? reader.field('annualMeanTemperatureC') : reader.monthlyField('temperatureC', month))

    const unit = isPrecipitation ? (isAnnual ? 'mm/年' : 'mm/月') : '°C'
    const thresholds = isPrecipitation ? [100, 250, 500, 1000, 2000] : [-20, 0, 10, 20, 30]
    const colors = isPrecipitation
      ? ['#d7b57d', '#8dc38b', '#3c93a6', '#1f5b9c', '#163f7a', '#112e6e']
      : ['#2b5cb8', '#5ea4d8', '#9ecae1', '#e3eedd', '#f2b659', '#d94325']

    const buckets = buildIntervalBuckets(thresholds, colors, unit)
    const { rows, totalAreaKm2 } = accumulateBuckets(reader, buckets, (r) => {
      const value = fieldView.get(r)
      const idx = thresholds.findIndex(t => value < t)
      return String(idx < 0 ? thresholds.length : idx)
    })

    const landSummary = computeWeightedSummary(reader, r => fieldView.get(r), true)
    const globalSummary = computeWeightedSummary(reader, r => fieldView.get(r), false)
    const fmt = (v: number | null) => v === null ? '无数据' : isPrecipitation ? numberFormat.format(v) : v.toFixed(1)

    let description: string
    if (landSummary.mean === null) {
      description = '无陆地区域可供统计。'
    }
    else if (isPrecipitation) {
      description = `陆地面积加权平均 ${fmt(landSummary.mean)} ${unit}；陆地范围 ${fmt(landSummary.minimum)}–${fmt(landSummary.maximum)} ${unit}。`
    }
    else {
      description = `全域面积加权平均 ${fmt(globalSummary.mean)} ${unit}；陆地面积加权平均 ${fmt(landSummary.mean)} ${unit}；陆地范围 ${fmt(landSummary.minimum)}–${fmt(landSummary.maximum)} ${unit}。`
    }

    const title = isPrecipitation
      ? (isAnnual ? '年总降水分布' : `月降水分布（第 ${month + 1} 月）`)
      : (isAnnual ? '年平均气温分布' : `月平均气温分布（第 ${month + 1} 月）`)

    return {
      mode: thematicId,
      title,
      totalCells: count,
      totalAreaKm2,
      rows,
      description,
      measure: 'cells',
      ...(!isAnnual ? { month } : {}),
      legendKind: 'continuous',
      unit,
      gradientStops: legend?.kind === 'continuous' ? legend.stops : undefined,
    }
  }

  // 2. Wind speed & ocean speed. Annual speed is the mean of the 12 monthly speeds.
  if (thematicId === 'wind-speed' || thematicId === 'ocean-speed' || thematicId === 'annual-wind-speed' || thematicId === 'annual-ocean-speed') {
    const isOcean = thematicId === 'ocean-speed' || thematicId === 'annual-ocean-speed'
    const isAnnual = thematicId === 'annual-wind-speed' || thematicId === 'annual-ocean-speed'
    if (!reader.capabilities.hasCirculation) {
      return {
        mode: thematicId,
        title: isOcean ? (isAnnual ? '表层洋流年平均速度' : '表层洋流速度') : (isAnnual ? '10m 年平均风速' : '10m 风速'),
        totalCells: count,
        totalAreaKm2: 0,
        rows: [],
        description: '当前世界快照不包含月度大气/海洋环流场数据。',
        measure: 'cells',
        ...(!isAnnual ? { month } : {}),
      }
    }

    const landMask = reader.field('landMask')
    const oceanAvailable = reader.field('oceanAvailable')
    const annualSpeed = isAnnual
      ? reader.field(isOcean ? 'annualOceanSpeedMps' : 'annualWindSpeedMps')
      : undefined
    const eastField = isAnnual ? undefined : reader.monthlyField(isOcean ? 'oceanEastMps' : 'windEastMps', month)
    const northField = isAnnual ? undefined : reader.monthlyField(isOcean ? 'oceanNorthMps' : 'windNorthMps', month)

    const stops = legend?.kind === 'continuous'
      ? legend.stops
      : isOcean ? OCEAN_SPEED_COLOR_STOPS : WIND_SPEED_COLOR_STOPS
    const thresholds = stops.slice(1).map(stop => stop.value)
    const colors = stops.map(stop => stop.color)
    const buckets = buildIntervalBuckets(thresholds, colors, 'm/s')
    if (isOcean) {
      buckets.push(
        { key: 'no-data', label: '无流速数据', color: '#9aa3ad' },
        { key: 'land', label: '陆地', color: '#f7f4ef' },
      )
    }

    const { rows, totalAreaKm2 } = accumulateBuckets(reader, buckets, (r) => {
      if (isOcean && landMask.get(r) !== 0)
        return 'land'
      if (isOcean && oceanAvailable.get(r) === 0)
        return 'no-data'
      const speed = annualSpeed
        ? annualSpeed.get(r)
        : Math.hypot(eastField!.get(r), northField!.get(r))
      if (!Number.isFinite(speed))
        return isOcean ? 'no-data' : null
      const idx = thresholds.findIndex(t => speed < t)
      return String(idx < 0 ? thresholds.length : idx)
    })

    return {
      mode: thematicId,
      title: isOcean
        ? (isAnnual ? '估算表层洋流年平均速度' : `估算表层洋流速度分布（第 ${month + 1} 月）`)
        : (isAnnual ? '估算 10 米年平均风速' : `估算 10 米风速分布（第 ${month + 1} 月）`),
      totalCells: count,
      totalAreaKm2,
      rows,
      description: isOcean
        ? '按估算表层流速连续着色；可配合“洋流箭头”覆盖层查看流向与冷暖性质。'
        : '按估算 10 米等效风速连续着色；可配合“风向箭头”覆盖层查看近地表风向。',
      measure: 'cells',
      ...(!isAnnual ? { month } : {}),
      legendKind: 'continuous',
      unit: 'm/s',
      gradientStops: stops,
    }
  }

  // 3. Köppen climate classification
  if (thematicId === 'koppen') {
    const koppenField = reader.field('koppenClass')
    const buckets: StatisticBucket[] = KOPPEN_CODES.map((code, index) => ({
      key: code,
      label: KOPPEN_CLASS_LABELS_ZH[index] ?? code,
      color: KOPPEN_PALETTE_HEX[index] ?? KOPPEN_PALETTE_HEX[0],
    }))
    const { rows, totalAreaKm2 } = accumulateBuckets(
      reader,
      buckets,
      r => KOPPEN_CODES[koppenField.get(r)] ?? 'Ocean',
    )
    return {
      mode: thematicId,
      title: 'Köppen 气候带分布',
      totalCells: count,
      totalAreaKm2,
      rows,
      measure: 'cells',
      legendKind: 'categorical',
    }
  }

  // 4. Biomes & Land Cover
  if (thematicId === 'biomes' || thematicId === 'land-cover') {
    const isBiomes = thematicId === 'biomes'
    const dicts = reader.ecologyDictionaries()
    const fieldView = reader.field(isBiomes ? 'potentialBiomeIndex' : 'landCoverIndex')
    const ids = isBiomes ? dicts.potentialBiomeIds : dicts.landCoverIds
    const defs = isBiomes ? NATURAL_BIOME_DEFINITIONS : NATURAL_LAND_COVER_DEFINITIONS
    const palette = isBiomes ? BIOME_PALETTE_HEX : LAND_COVER_PALETTE_HEX
    const labelsZh = isBiomes ? BIOME_CLASS_LABELS_ZH : LAND_COVER_LABELS_ZH

    const buckets: StatisticBucket[] = ids.map((id, idx) => {
      const def = defs.find(d => d.id === id)
      return {
        key: String(idx),
        label: def?.nameZh ?? labelsZh[idx] ?? id,
        color: palette[idx % palette.length] ?? '#334155',
      }
    })

    const { rows, totalAreaKm2 } = accumulateBuckets(
      reader,
      buckets,
      r => String(fieldView.get(r)),
    )
    return {
      mode: thematicId,
      title: isBiomes ? '潜在生物群系分布' : '自然地表覆盖分布',
      totalCells: count,
      totalAreaKm2,
      rows,
      measure: 'cells',
      legendKind: 'categorical',
    }
  }

  // 5. Colored elevation and the grayscale map share the same field and intervals.
  if (thematicId === 'elevation' || thematicId === 'dem') {
    const elevationKm = reader.field('elevationKm')
    const thresholds = [0, 0.5, 1, 2, 4]
    const colors = thematicId === 'dem'
      ? ['#000000', '#090909', '#1c1c1c', '#383838', '#707070', '#bababa']
      : ['#174d81', '#075537', '#27853c', '#9bc75a', '#efd18c', '#ba4033']
    const labels = ['< 0 km（海洋）', '0 至 < 0.5 km', '0.5 至 < 1 km', '1 至 < 2 km', '2 至 < 4 km', '≥ 4 km']
    const buckets = buildIntervalBuckets(thresholds, colors, 'km', labels)
    const { rows, totalAreaKm2 } = accumulateBuckets(reader, buckets, (r) => {
      const val = elevationKm.get(r)
      const idx = thresholds.findIndex(t => val < t)
      return String(idx < 0 ? thresholds.length : idx)
    })
    const landSummary = computeWeightedSummary(reader, r => elevationKm.get(r), true)
    return {
      mode: thematicId,
      title: thematicId === 'dem' ? '高程灰度图' : '高程分布',
      totalCells: count,
      totalAreaKm2,
      rows,
      description: landSummary.mean !== null
        ? `陆地面积加权平均高程 ${landSummary.mean.toFixed(2)} km（最高 ${landSummary.maximum!.toFixed(2)} km）。`
        : undefined,
      measure: 'cells',
      legendKind: 'continuous',
      unit: 'km',
      gradientStops: legend?.kind === 'continuous' ? legend.stops : undefined,
    }
  }

  // 6. Plates & Continents
  if (thematicId === 'plates') {
    const plateField = reader.field('plateIndex')
    const plates = reader.plates()
    const buckets: StatisticBucket[] = plates.map((plate, index) => ({
      key: String(index),
      label: `板块 ${plate.id}`,
      color: CATEGORICAL_GROUP_PALETTE_HEX[index % CATEGORICAL_GROUP_PALETTE_HEX.length],
    }))
    const { rows, totalAreaKm2 } = accumulateBuckets(reader, buckets, r => String(plateField.get(r)))
    return {
      mode: thematicId,
      title: '构造板块分布',
      totalCells: count,
      totalAreaKm2,
      rows,
      description: `共 ${plates.length} 个构造板块。`,
      measure: 'cells',
      legendKind: 'categorical',
    }
  }

  if (thematicId === 'continents') {
    const geo = reader.geographicRegions()
    if (!geo) {
      return {
        mode: thematicId,
        title: '陆海分区',
        totalCells: count,
        totalAreaKm2: 0,
        rows: [],
        description: '当前世界快照未包含地理分区数据。',
        measure: 'cells',
      }
    }
    const continentField = reader.field('continentIndex')
    const oceanField = reader.field('oceanIndex')
    const seaField = reader.field('seaIndex')
    const oceanPalette = ['#12385b', '#184b73', '#1f5e89', '#164366', '#256b96']
    const seaPalette = ['#28667a', '#31798e', '#3a8ba0', '#2b7085']
    const buckets: StatisticBucket[] = [
      ...geo.continents.map((item, idx) => ({
        key: `continent:${idx}`,
        label: formatContinentDisplayName(item.name, idx),
        color: CATEGORICAL_GROUP_PALETTE_HEX[idx % CATEGORICAL_GROUP_PALETTE_HEX.length],
      })),
      ...geo.oceans.map((item, idx) => ({
        key: `ocean:${idx}`,
        label: formatOceanDisplayName(item.name, idx),
        color: oceanPalette[idx % oceanPalette.length],
      })),
      ...geo.seas.map((_item, idx) => ({
        key: `sea:${idx}`,
        label: `海 ${idx + 1}`,
        color: seaPalette[idx % seaPalette.length],
      })),
    ]
    const { rows, totalAreaKm2 } = accumulateBuckets(reader, buckets, (r) => {
      const cIdx = continentField.get(r)
      if (cIdx >= 0)
        return `continent:${cIdx}`
      const oIdx = oceanField.get(r)
      if (oIdx >= 0)
        return `ocean:${oIdx}`
      const sIdx = seaField.get(r)
      if (sIdx >= 0)
        return `sea:${sIdx}`
      return null
    })
    return {
      mode: thematicId,
      title: '陆海分区',
      totalCells: count,
      totalAreaKm2,
      rows,
      description: `${geo.continents.length} 个大陆、${geo.oceans.length} 个大洋、${geo.seas.length} 个海。`,
      measure: 'cells',
      legendKind: 'categorical',
    }
  }

  // 7. Runoff, Snow, Basins
  if (thematicId === 'runoff') {
    const runoffField = reader.field('annualRunoffMm')
    const landMask = reader.field('landMask')
    const thresholds = [50, 200, 500, 1000, 2000]
    const colors = ['#d97854', '#ab784c', '#97b87a', '#3a9ab0', '#1d5d99', '#0d3170']
    const buckets = [
      ...buildIntervalBuckets(thresholds, colors, 'mm/年'),
      { key: 'ocean', label: '海洋', color: '#0d2238' },
    ]
    const { rows, totalAreaKm2 } = accumulateBuckets(reader, buckets, (r) => {
      if (landMask.get(r) === 0)
        return 'ocean'
      const v = runoffField.get(r)
      const idx = thresholds.findIndex(t => v < t)
      return String(idx < 0 ? thresholds.length : idx)
    })
    return {
      mode: thematicId,
      title: '年径流深分布',
      totalCells: count,
      totalAreaKm2,
      rows,
      measure: 'cells',
      legendKind: 'continuous',
      unit: 'mm/年',
      gradientStops: legend?.kind === 'continuous' ? legend.stops : undefined,
    }
  }

  if (thematicId === 'snow') {
    const snowField = reader.monthlyField('snowWaterEquivalentMm', month)
    const landMask = reader.field('landMask')
    const buckets: StatisticBucket[] = [
      { key: '0', label: '无积雪 (0 mm)', color: '#2e3f52' },
      { key: '1', label: '0 至 < 50 mm', color: '#5b7d9c' },
      { key: '2', label: '50 至 < 200 mm', color: '#8fb6d6' },
      { key: '3', label: '≥ 200 mm', color: '#f4f9fc' },
      { key: 'ocean', label: '海洋', color: '#0d2238' },
    ]
    const { rows, totalAreaKm2 } = accumulateBuckets(reader, buckets, (r) => {
      if (landMask.get(r) === 0)
        return 'ocean'
      const v = snowField.get(r)
      return v <= 0 ? '0' : v < 50 ? '1' : v < 200 ? '2' : '3'
    })
    return {
      mode: thematicId,
      title: `月度积雪水当量（第 ${month + 1} 月）`,
      totalCells: count,
      totalAreaKm2,
      rows,
      measure: 'cells',
      month,
      legendKind: 'continuous',
      unit: 'mm',
      gradientStops: legend?.kind === 'continuous' ? legend.stops : undefined,
    }
  }

  if (thematicId === 'basins') {
    const basinField = reader.field('basinIndex')
    const basins = reader.basins()
    const buckets: StatisticBucket[] = basins.map((basin, idx) => ({
      key: String(idx),
      label: `流域 ${basin.id}${basin.endorheic ? '（内流）' : ''}`,
      color: CATEGORICAL_GROUP_PALETTE_HEX[idx % CATEGORICAL_GROUP_PALETTE_HEX.length],
    }))
    buckets.push({ key: 'ocean', label: '海洋或非流域', color: '#0e243b' })

    const { rows, totalAreaKm2 } = accumulateBuckets(reader, buckets, (r) => {
      const idx = basinField.get(r)
      return idx < 0 ? 'ocean' : String(idx)
    })
    return {
      mode: thematicId,
      title: '水文流域分布',
      totalCells: count,
      totalAreaKm2,
      rows,
      description: `共 ${basins.length} 个独立汇水流域。`,
      measure: 'cells',
      legendKind: 'categorical',
    }
  }

  // Fallback for custom style legends
  if (legend?.kind === 'continuous') {
    return buildContinuousLegendFallback(reader, legend, mode, month)
  }
  if (legend?.kind === 'categorical') {
    return buildCategoricalLegendFallback(reader, legend, mode)
  }

  return {
    mode,
    title: '图层统计',
    totalCells: count,
    totalAreaKm2: 0,
    rows: [],
    measure: 'cells',
  }
}

export function formatLayerStatistics(statistics: LayerStatistics): string {
  return [
    `图层\t${statistics.title}`,
    ...(statistics.month === undefined ? [] : [`月份\t${statistics.month + 1}`]),
    `总单元\t${statistics.totalCells}`,
    ...(statistics.description ? [`说明\t${statistics.description}`] : []),
    '分类\t单元数\t占比\t面积（km²）',
    ...statistics.rows.map(row => `${row.label}\t${row.count}\t${row.percentage.toFixed(2)}%\t${row.areaKm2.toFixed(0)}`),
  ].join('\n')
}
