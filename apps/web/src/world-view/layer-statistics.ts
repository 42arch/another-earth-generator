import type { ClimateArtifact, CryosphereArtifact, EcologyArtifact, GeographicRegionsArtifact, GeologyArtifact, HydrologyArtifact, SphericalMesh, StaticLakeArtifact, TerrainArtifact } from '@another-earth/world-core'
import { KOPPEN_CODES, sampleClimateSpeedMps } from '@another-earth/world-core'
import { NATURAL_BIOME_DEFINITIONS, NATURAL_LAND_COVER_DEFINITIONS } from '@another-earth/world-data'
import type { GeologyTheme } from './map-theme-data'
import { CIRCULATION_SPEED_COLORS, CIRCULATION_SPEED_BINS, ecologyLegendColor, geographicNameLabel, geographicRegionColor, geologyRegionColor, KOPPEN_COLORS, KOPPEN_LABELS } from './map-theme-data'

export interface LayerStatisticRow {
  key: string
  label: string
  count: number
  percentage: number
  areaKm2?: number
  landSharePercentage?: number
  color: string
}

export interface LayerStatistics {
  mode: GeologyTheme
  title: string
  totalCells: number
  rows: LayerStatisticRow[]
  description?: string
  measure: 'cells'
  month?: number
}

export interface LayerStatisticsInput {
  regionCount: number
  geology?: GeologyArtifact | null
  terrain?: TerrainArtifact | null
  regions?: GeographicRegionsArtifact | null
  climate?: ClimateArtifact | null
  cryosphere?: CryosphereArtifact | null
  hydrology?: HydrologyArtifact | null
  lakes?: StaticLakeArtifact | null
  ecology?: EcologyArtifact | null
  mesh?: SphericalMesh | null
  regionAreaKm2?: ArrayLike<number>
  month?: number
}

interface StatisticClass {
  key: string
  label: string
  color: string
}

const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1, useGrouping: false })
const windSpeedLabels = ['< 1 m/s', '1 至 < 2 m/s', '2 至 < 4 m/s', '4 至 < 6 m/s', '6 至 < 8 m/s', '≥ 8 m/s']
const oceanSpeedLabels = ['< 0.02 m/s', '0.02 至 < 0.05 m/s', '0.05 至 < 0.1 m/s', '0.1 至 < 0.15 m/s', '0.15 至 < 0.2 m/s', '≥ 0.2 m/s']
const speedColors = CIRCULATION_SPEED_COLORS.map(toCssColor)

function toCssColor(color: readonly number[]): string {
  const toByte = (linear: number) => {
    const value = Math.max(0, Math.min(1, linear))
    const srgb = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
    return Math.round(srgb * 255)
  }
  return `rgb(${toByte(color[0])}, ${toByte(color[1])}, ${toByte(color[2])})`
}

function makeRows(theme: GeologyTheme, input: LayerStatisticsInput, classes: readonly StatisticClass[], keyForRegion: (region: number) => string | null, month?: number): LayerStatisticRow[] {
  const regionCount = Math.max(0, input.regionCount)
  if (!regionCount)
    return []
  const colorForRegion = geologyRegionColor(input.geology, theme, input.terrain, input.climate, month ?? 0, input.cryosphere, input.hydrology, input.lakes, input.ecology, input.mesh, input.regions)
  const tallies = new Map<string, { count: number, areaKm2: number, landCount: number, firstRegion: number }>(classes.map(entry => [entry.key, { count: 0, areaKm2: 0, landCount: 0, firstRegion: -1 }] as const))
  const landMask = input.terrain?.landMask
  let totalLandCount = 0
  if (landMask) {
    for (let region = 0; region < regionCount; region++)
      totalLandCount += Number(Boolean(landMask[region]))
  }
  for (let region = 0; region < regionCount; region++) {
    const key = keyForRegion(region)
    if (key === null)
      continue
    const tally = tallies.get(key)
    if (!tally)
      continue
    tally.count++
    tally.areaKm2 += input.regionAreaKm2?.[region] ?? input.mesh?.areaKm2[region] ?? 0
    if (tally.firstRegion < 0)
      tally.firstRegion = region
    if (landMask?.[region]) {
      tally.landCount++
    }
  }
  return classes.map((entry) => {
    const tally = tallies.get(entry.key)!
    const color = theme !== 'rivers' && tally.firstRegion >= 0 && colorForRegion ? toCssColor(colorForRegion(tally.firstRegion)) : entry.color
    return {
      key: entry.key,
      label: entry.label,
      count: tally.count,
      percentage: tally.count / regionCount * 100,
      ...(input.regionAreaKm2 || input.mesh ? { areaKm2: tally.areaKm2 } : {}),
      ...(landMask ? { landSharePercentage: totalLandCount ? tally.landCount / totalLandCount * 100 : 0 } : {}),
      color,
    }
  }).filter(entry => entry.count > 0)
}

function categoricalStatistics(theme: GeologyTheme, title: string, input: LayerStatisticsInput, classes: readonly StatisticClass[], keyForRegion: (region: number) => string | null, month?: number, description?: string): LayerStatistics {
  return { mode: theme, title, totalCells: input.regionCount, rows: makeRows(theme, input, classes, keyForRegion, month), measure: 'cells', ...(month === undefined ? {} : { month }), ...(description ? { description } : {}) }
}

function intervalClasses(boundaries: readonly number[], labels: readonly string[], colors: readonly string[], unit: string): StatisticClass[] {
  return Array.from({ length: boundaries.length + 1 }, (_, index) => ({
    key: String(index),
    label: index === 0 ? `< ${numberFormat.format(boundaries[0])} ${unit}` : index === boundaries.length ? `≥ ${numberFormat.format(boundaries[index - 1])} ${unit}` : `${numberFormat.format(boundaries[index - 1])} 至 < ${numberFormat.format(boundaries[index])} ${unit}`,
    color: colors[index] ?? '#888888',
  })).map((entry, index) => ({ ...entry, label: labels[index] ?? entry.label }))
}

function weightedSummary(values: ArrayLike<number>, area: ArrayLike<number> | undefined, mask: Uint8Array | undefined, regionCount: number): { mean: number | null, minimum: number | null, maximum: number | null } {
  let weighted = 0
  let totalWeight = 0
  let minimum = Infinity
  let maximum = -Infinity
  for (let region = 0; region < regionCount; region++) {
    if (mask && !mask[region])
      continue
    const value = values[region]
    const weight = area?.[region] ?? 1
    if (!Number.isFinite(value) || !(weight > 0))
      continue
    weighted += value * weight
    totalWeight += weight
    minimum = Math.min(minimum, value)
    maximum = Math.max(maximum, value)
  }
  return totalWeight > 0 ? { mean: weighted / totalWeight, minimum, maximum } : { mean: null, minimum: null, maximum: null }
}

function climateIntervals(theme: 'temperature' | 'annual-temperature' | 'precipitation' | 'annual-precipitation', input: LayerStatisticsInput): LayerStatistics | undefined {
  const climate = input.climate
  if (!climate)
    return undefined
  const annual = theme.startsWith('annual-')
  const precipitation = theme.endsWith('precipitation')
  const month = Math.max(0, Math.min(11, Math.floor(input.month ?? 0)))
  const values = precipitation
    ? annual ? climate.annualPrecipitationMm : climate.precipitationMm.subarray(month * climate.regionCount, (month + 1) * climate.regionCount)
    : annual ? climate.annualMeanTemperatureC : climate.temperatureC.subarray(month * climate.regionCount, (month + 1) * climate.regionCount)
  const landMask = input.terrain?.landMask
  const summary = weightedSummary(values, input.regionAreaKm2 ?? input.mesh?.areaKm2, landMask, input.regionCount)
  const unit = precipitation ? annual ? 'mm/年' : 'mm/月' : '°C'
  const thresholds = precipitation ? [100, 250, 500, 1000, 2000] : [-20, 0, 10, 20, 30]
  const labels = precipitation
    ? [`< 100 ${unit}`, `100 至 < 250 ${unit}`, `250 至 < 500 ${unit}`, `500 至 < 1000 ${unit}`, `1000 至 < 2000 ${unit}`, `≥ 2000 ${unit}`]
    : [`< -20 ${unit}`, `-20 至 < 0 ${unit}`, `0 至 < 10 ${unit}`, `10 至 < 20 ${unit}`, `20 至 < 30 ${unit}`, `≥ 30 ${unit}`]
  const classes = intervalClasses(thresholds, labels, ['#203d62', '#3173a2', '#55a8ad', '#b6c76c', '#e9b765', '#b64a40'], unit)
  const keyForRegion = (region: number) => {
    const value = values[region]
    let index = thresholds.findIndex(boundary => value < boundary)
    if (index < 0)
      index = thresholds.length
    return String(index)
  }
  const title = precipitation ? annual ? '年总降水分布' : '月降水分布' : annual ? '年平均气温分布' : '月平均气温分布'
  const fixed = (value: number | null) => value === null ? '无数据' : precipitation ? numberFormat.format(value) : value.toFixed(1)
  const meanLabel = summary.mean === null ? '无陆地区域' : `${fixed(summary.mean)} ${unit}`
  const rangeLabel = summary.minimum === null || summary.maximum === null ? '无陆地区域' : `${fixed(summary.minimum)}–${fixed(summary.maximum)} ${unit}`
  let description: string
  if (summary.mean === null) {
    description = '无陆地区域可供统计。'
  }
  else if (precipitation) {
    description = `陆地面积加权平均 ${meanLabel}；陆地范围 ${rangeLabel}。`
  }
  else {
    const global = weightedSummary(values, input.regionAreaKm2 ?? input.mesh?.areaKm2, undefined, input.regionCount)
    description = `全域面积加权平均 ${fixed(global.mean)} ${unit}；陆地面积加权平均 ${meanLabel}；陆地范围 ${rangeLabel}。`
  }
  const rows = makeRows(theme, input, classes, keyForRegion, annual ? undefined : month)
  return { mode: theme, title, totalCells: input.regionCount, rows, description, measure: 'cells', ...(!annual ? { month } : {}) }
}

function speedStatistics(theme: 'wind' | 'wind-speed' | 'ocean-current' | 'ocean-speed', input: LayerStatisticsInput): LayerStatistics | undefined {
  const climate = input.climate
  if (!climate)
    return undefined
  const month = Math.max(0, Math.min(11, Math.floor(input.month ?? 0)))
  const ocean = theme === 'ocean-current' || theme === 'ocean-speed'
  const classes = ocean
    ? [
        ...oceanSpeedLabels.map((label, index) => ({ key: String(index), label, color: speedColors[index] })),
        { key: 'no-data', label: '无流速数据', color: speedColors[6] },
        { key: 'land', label: '陆地', color: speedColors[7] },
      ]
    : windSpeedLabels.map((label, index) => ({ key: String(index), label, color: speedColors[index] }))
  const boundaries = ocean ? CIRCULATION_SPEED_BINS['ocean-speed'] : [1, 2, 4, 6, 8]
  const keyForRegion = (region: number) => {
    if (ocean && input.terrain?.landMask[region])
      return 'land'
    if (ocean && climate.oceanReference[region] < 0)
      return 'no-data'
    const speed = sampleClimateSpeedMps(climate, region, month, ocean ? 'ocean' : 'wind')
    if (speed === null)
      return ocean ? 'no-data' : null
    const bin = boundaries.findIndex(boundary => speed < boundary)
    return String(bin < 0 ? boundaries.length : bin)
  }
  const title = `${theme === 'ocean-current' ? '表层洋流流速与冷暖分布' : theme === 'ocean-speed' ? '估算表层流速分布' : theme === 'wind-speed' ? '估算 10 米风速分布' : '月风场与流速分布'}（第 ${month + 1} 月）`
  const description = theme === 'ocean-current'
    ? '底色按表层流速分级；方向箭头表示流向，箭头由蓝至红表示冷至暖。'
    : theme === 'wind'
      ? '底色按估算 10 米风速分级；青色箭头表示近地表风向。'
      : ocean ? '按估算表层流速分级；灰色表示无流速数据，陆地单独标示。' : '按估算 10 米风速分级。'
  return categoricalStatistics(theme, title, input, classes, keyForRegion, month, description)
}

export function buildLayerStatistics(theme: GeologyTheme, input: LayerStatisticsInput): LayerStatistics | undefined {
  if (!input.regionCount)
    return undefined
  if (theme === 'temperature' || theme === 'annual-temperature' || theme === 'precipitation' || theme === 'annual-precipitation')
    return climateIntervals(theme, input)
  if (theme === 'wind' || theme === 'wind-speed' || theme === 'ocean-current' || theme === 'ocean-speed')
    return speedStatistics(theme, input)

  if (theme === 'koppen' && input.climate) {
    const classes = KOPPEN_CODES.map((code, index) => ({ key: code, label: code === 'Ocean' ? '海洋' : `${code} · ${KOPPEN_LABELS[index] ?? code}`, color: toCssColor(KOPPEN_COLORS[index] ?? KOPPEN_COLORS[0]) }))
    return categoricalStatistics(theme, 'Köppen 气候分类', input, classes, region => KOPPEN_CODES[input.climate!.koppenClass[region]] ?? 'Ocean')
  }
  if ((theme === 'biomes' || theme === 'land-cover') && input.ecology) {
    const definitions = theme === 'biomes' ? NATURAL_BIOME_DEFINITIONS : NATURAL_LAND_COVER_DEFINITIONS
    const indexes = theme === 'biomes' ? input.ecology.potentialBiomeIndex : input.ecology.landCoverIndex
    const ids = theme === 'biomes' ? input.ecology.potentialBiomeIds : input.ecology.landCoverIds
    const classes = definitions.map(definition => ({ key: definition.id, label: definition.nameZh, color: ecologyLegendColor(theme, definition.id) }))
    return categoricalStatistics(theme, theme === 'biomes' ? '潜在生物群系分布' : '自然覆盖分布', input, classes, region => ids[indexes[region]] ?? null)
  }
  if (theme === 'rivers' && input.hydrology) {
    const orders = Array.from(new Set(input.hydrology.rivers.map(river => river.strahlerOrder))).sort((a, b) => a - b)
    const classes = orders.map(order => ({ key: String(order), label: `${order} 级河网单元`, color: ['#3D91BD', '#2378AF', '#0B5F9E', '#064C85'][Math.min(3, order - 1)] }))
    return categoricalStatistics(theme, '河网等级统计', input, classes, region => input.hydrology!.riverMask[region] ? String(input.hydrology!.rivers[input.hydrology!.riverIndex[region]]?.strahlerOrder ?? 1) : null, undefined, `${input.hydrology.rivers.length.toLocaleString()} 条河道段；河道带宽随累积流量增加，颜色按 Strahler 级序表示。`)
  }
  if (theme === 'lakes' && input.lakes) {
    const classes = [{ key: 'endorheic', label: '内流湖泊单元', color: '#0876ad' }, { key: 'overflow', label: '有溢流路径单元', color: '#26a8d5' }]
    return categoricalStatistics(theme, '静态湖泊统计', input, classes, region => {
      const index = input.lakes!.lakeIndex[region]
      return index < 0 ? null : input.lakes!.lakes[index].endorheic ? 'endorheic' : 'overflow'
    }, undefined, `${input.lakes.lakes.length.toLocaleString()} 个静态湖泊。`)
  }
  if (theme === 'basins' && input.hydrology) {
    const ids = Array.from(new Set(input.hydrology.basinIndex.filter(index => index >= 0))).sort((a, b) => a - b)
    const classes = ids.map(id => ({ key: String(id), label: `流域 ${input.hydrology!.basins[id]?.id ?? id}`, color: toCssColor([0.15 + (id * 0.37) % 0.7, 0.18 + (id * 0.63) % 0.65, 0.2 + (id * 0.19) % 0.65]) }))
    classes.push({ key: 'ocean', label: '海洋', color: '#102f4a' })
    return categoricalStatistics(theme, '流域分布', input, classes, region => input.hydrology!.basinIndex[region] < 0 ? 'ocean' : String(input.hydrology!.basinIndex[region]))
  }
  if (theme === 'candidate-land' && input.geology) {
    const classes = [{ key: 'land', label: '候选陆地', color: '#6e9b65' }, { key: 'ocean', label: '候选海洋', color: '#164768' }]
    return categoricalStatistics(theme, '候选海陆分布', input, classes, region => input.geology!.candidateLandMask[region] ? 'land' : 'ocean')
  }
  if (theme === 'crust' && input.geology) {
    const classes = [{ key: 'continental', label: '大陆地壳', color: '#b88653' }, { key: 'oceanic', label: '海洋地壳', color: '#3277a3' }]
    return categoricalStatistics(theme, '地壳类型分布', input, classes, region => input.geology!.crustType[region] ? 'continental' : 'oceanic')
  }
  if (theme === 'plates' && input.geology) {
    const classes = input.geology.plates.map((plate, index) => ({ key: String(index), label: `${plate.kind === 'micro' ? '小板块' : '主板块'} ${plate.id}`, color: toCssColor([(index * 0.37) % 0.8 + 0.15, (index * 0.63) % 0.7 + 0.15, (index * 0.19) % 0.65 + 0.2]) }))
    return categoricalStatistics(theme, '运动板块分布', input, classes, region => String(input.geology!.plateIndex[region]))
  }
  if (theme === 'continents' && input.regions && input.terrain) {
    const regions = input.regions
    const classes = [
      ...regions.continents.map((item, index) => ({ key: `land:${index}`, label: geographicNameLabel(item.name, 'continent', index), color: toCssColor(geographicRegionColor(regions, regions.continentIndex.indexOf(index))) })),
      ...regions.oceans.map((item, index) => ({ key: `ocean:${index}`, label: geographicNameLabel(item.name, 'ocean', index), color: toCssColor(geographicRegionColor(regions, regions.oceanIndex.indexOf(index))) })),
      ...regions.seas.map((_, index) => ({ key: `sea:${index}`, label: `海 ${index + 1}`, color: toCssColor(geographicRegionColor(regions, regions.seaIndex.indexOf(index))) })),
    ]
    return categoricalStatistics(theme, '大陆、洋与海', input, classes, region => regions.continentIndex[region] >= 0 ? `land:${regions.continentIndex[region]}` : regions.oceanIndex[region] >= 0 ? `ocean:${regions.oceanIndex[region]}` : `sea:${regions.seaIndex[region]}`)
  }
  if (theme === 'snow' && input.cryosphere) {
    const month = Math.max(0, Math.min(11, Math.floor(input.month ?? 0)))
    const values = input.cryosphere.monthlySnowWaterEquivalentMm.subarray(month * input.regionCount, (month + 1) * input.regionCount)
    const classes = [{ key: '0', label: '无积雪', color: '#73818c' }, { key: '1', label: '0 至 < 50 mm', color: '#9ab6c9' }, { key: '2', label: '50 至 < 200 mm', color: '#c2dce9' }, { key: '3', label: '≥ 200 mm', color: '#f0f7fb' }]
    return categoricalStatistics(theme, '月末积雪水当量', input, classes, region => String(values[region] === 0 ? 0 : values[region] < 50 ? 1 : values[region] < 200 ? 2 : 3), month)
  }
  if (theme === 'runoff' && input.hydrology) {
    const values = input.hydrology.annualRunoffMm
    const boundaries = [50, 200, 500, 1000, 2000]
    const labels = ['< 50 mm/年', '50 至 < 200 mm/年', '200 至 < 500 mm/年', '500 至 < 1000 mm/年', '1000 至 < 2000 mm/年', '≥ 2000 mm/年']
    const classes = intervalClasses(boundaries, labels, ['#834f37', '#ab784c', '#9eaf60', '#55a67b', '#267b9d', '#155182'], 'mm/年')
    return categoricalStatistics(theme, '年径流深分布', input, classes, region => {
      const index = boundaries.findIndex(boundary => values[region] < boundary)
      return String(index < 0 ? boundaries.length : index)
    })
  }
  if (theme === 'elevation' && input.terrain) {
    const values = input.terrain.elevationKm
    const boundaries = [0, 0.5, 1, 2, 4]
    const classes = intervalClasses(boundaries, ['< 0 km', '0 至 < 0.5 km', '0.5 至 < 1 km', '1 至 < 2 km', '2 至 < 4 km', '≥ 4 km'], ['#174d81', '#075537', '#27853c', '#9bc75a', '#efd18c', '#ba4033'], 'km')
    return categoricalStatistics(theme, '地形高程分布', input, classes, region => {
      const index = boundaries.findIndex(boundary => values[region] < boundary)
      return String(index < 0 ? boundaries.length : index)
    })
  }
  if ((theme === 'land' || theme === 'satellite') && input.terrain) {
    const classes = [{ key: 'land', label: '陆地', color: '#8aa76c' }, { key: 'ocean', label: '海洋', color: '#1c5478' }]
    return categoricalStatistics(theme, theme === 'satellite' ? '卫星影像海陆统计' : '最终海陆分布', input, classes, region => input.terrain!.landMask[region] ? 'land' : 'ocean')
  }
  if (theme === 'boundaries' && input.terrain) {
    const classes = [
      { key: '0', label: '无构造边界', color: '#364354' },
      { key: '1', label: '汇聚边界', color: '#e65f45' },
      { key: '2', label: '张裂边界', color: '#2ca6d3' },
      { key: '3', label: '走滑边界', color: '#d4aa42' },
    ]
    return categoricalStatistics(theme, '构造边界分布', input, classes, region => String(input.terrain!.boundaryType[region]))
  }
  if (theme === 'mantle' && input.terrain) {
    const values = input.terrain.mantleFlow
    const boundaries = [-0.25, 0.25]
    const classes = intervalClasses(boundaries, ['下降流', '弱流动', '上升流'], ['#5a70b0', '#59606a', '#bd6752'], '')
    return categoricalStatistics(theme, '地幔流动分布', input, classes, region => {
      const index = boundaries.findIndex(boundary => values[region] < boundary)
      return String(index < 0 ? boundaries.length : index)
    })
  }
  if (theme === 'volcanism' && input.terrain) {
    const values = input.terrain.volcanicCoordinate
    const boundaries = [0.01, 0.05, 0.15]
    const classes = intervalClasses(boundaries, ['极弱', '弱', '中等', '强'], ['#645c58', '#a55b45', '#d86a39', '#f2aa35'], '')
    return categoricalStatistics(theme, '火山塑形贡献', input, classes, region => {
      const index = boundaries.findIndex(boundary => values[region] < boundary)
      return String(index < 0 ? boundaries.length : index)
    })
  }
  if (theme === 'uplift' && input.terrain) {
    const values = input.terrain.regionalUpliftCoordinate
    const boundaries = [0.03, 0.08, 0.15]
    const classes = intervalClasses(boundaries, ['微弱', '较弱', '中等', '强'], ['#52677c', '#698b72', '#b5a04d', '#d88942'], '')
    return categoricalStatistics(theme, '地形抬升分布', input, classes, region => {
      const index = boundaries.findIndex(boundary => values[region] < boundary)
      return String(index < 0 ? boundaries.length : index)
    })
  }
  if (theme === 'relief' && input.terrain) {
    const values = input.terrain.regionalReliefKm
    const classes = [
      { key: 'lower', label: '相对降低（< −0.03 km）', color: '#596ca0' },
      { key: 'stable', label: '变化较小（±0.03 km）', color: '#77745d' },
      { key: 'raised', label: '相对抬升（> 0.03 km）', color: '#be7050' },
    ]
    return categoricalStatistics(theme, '地形起伏变化', input, classes, region => values[region] < -0.03 ? 'lower' : values[region] > 0.03 ? 'raised' : 'stable')
  }
  if (theme === 'plains' && input.terrain) {
    const classes = [
      { key: 'ocean', label: '海洋', color: '#1c5478' },
      { key: 'rough', label: '起伏较强', color: '#6c8350' },
      { key: 'mixed', label: '中等平缓', color: '#8caa62' },
      { key: 'smooth', label: '平缓地表', color: '#bad486' },
    ]
    return categoricalStatistics(theme, '平原与平缓地表', input, classes, region => {
      if (!input.terrain!.landMask[region])
        return 'ocean'
      const protection = 1 - input.terrain!.roughnessWeight[region]
      return protection < 0.25 ? 'rough' : protection < 0.6 ? 'mixed' : 'smooth'
    })
  }
  if (theme === 'slope' && input.terrain) {
    const values = input.terrain.slopeRadians
    const boundaries = [5, 15, 30, 45]
    const classes = intervalClasses(boundaries, ['< 5°', '5 至 < 15°', '15 至 < 30°', '30 至 < 45°', '≥ 45°'], ['#317b79', '#81a35a', '#d2b768', '#c17448', '#934a49'], '°')
    return categoricalStatistics(theme, '坡度分布', input, classes, region => {
      const degrees = values[region] * 180 / Math.PI
      const index = boundaries.findIndex(boundary => degrees < boundary)
      return String(index < 0 ? boundaries.length : index)
    })
  }
  if (theme === 'topology' && input.mesh) {
    const classes = [{ key: '5', label: '五邻域单元', color: '#d98b4a' }, { key: '6', label: '六邻域单元', color: '#5a9e73' }, { key: 'other', label: '其他邻域数', color: '#6c7c91' }]
    return categoricalStatistics(theme, '网格拓扑统计', input, classes, region => {
      const degree = input.mesh!.neighborOffsets[region + 1] - input.mesh!.neighborOffsets[region]
      return degree === 5 ? '5' : degree === 6 ? '6' : 'other'
    })
  }
  return undefined
}

export function formatLayerStatistics(statistics: LayerStatistics): string {
  return [
    `图层\t${statistics.title}`,
    ...(statistics.month === undefined ? [] : [`月份\t${statistics.month + 1}`]),
    `总单元\t${statistics.totalCells}`,
    ...(statistics.description ? [`说明\t${statistics.description}`] : []),
    '分类\t单元数\t占比\t面积（km²）',
    ...statistics.rows.map(row => `${row.label}\t${row.count}\t${row.percentage.toFixed(2)}%${row.areaKm2 === undefined ? '' : `\t${row.areaKm2.toFixed(0)}`}`),
  ].join('\n')
}
