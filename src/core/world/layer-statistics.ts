import type { WorldSimulationState } from '@/core/simulation/state'
import { KOPPEN_CODES, KOPPEN_COLORS, KOPPEN_LABELS } from '@/core/climate/koppen-climate-classifier'
import { classifyOceanCurrentThermal } from '@/core/climate/ocean-current-thermal'
import { BIOME_CODES, BIOME_COLORS, BIOME_LABELS } from '@/core/ecology/biome-data'
import { CRUST_TYPE, SUBDUCTION_ROLE } from '@/core/geology/geology-data'
import { OCEAN_CURRENT_THERMAL_COLORS } from '@/core/rendering/shared/climate-color-scale'

interface Category {
  label: string
  color: string
}

export interface LayerStatisticRow extends Category {
  key: string
  count: number
  percentage: number
}

export interface LayerStatistics {
  mode: string
  title: string
  seed?: number
  month?: number
  totalCells: number
  plateCounts?: { primary: number, micro: number }
  description?: string
  rows: LayerStatisticRow[]
}

/** Tab-separated text keeps copied counts readable and easy to paste into a sheet. */
export function formatLayerStatistics(statistics: LayerStatistics): string {
  return [
    ...(statistics.seed === undefined ? [] : [`种子\t${statistics.seed}`]),
    `图层\t${statistics.title}`,
    `模式\t${statistics.mode}`,
    ...(statistics.month === undefined ? [] : [`月份\t${statistics.month + 1}`]),
    `总 cell\t${statistics.totalCells}`,
    ...(statistics.plateCounts
      ? [`主要板块\t${statistics.plateCounts.primary}`, `小板块\t${statistics.plateCounts.micro}`]
      : []),
    ...(statistics.description ? [`说明\t${statistics.description}`] : []),
    '分类\tcell 数\t占比',
    ...statistics.rows.map(item => `${item.label}\t${item.count}\t${item.percentage.toFixed(6)}%`),
  ].join('\n')
}

const MONTH_NAMES = ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月', '7 月', '8 月', '9 月', '10 月', '11 月', '12 月']

const MODES_WITHOUT_STATISTICS = new Set<string>(['satellite', 'dem', 'heightmap'])

export function hasLayerStatistics(mode: string): boolean {
  return !MODES_WITHOUT_STATISTICS.has(mode)
}

const MODE_TITLES: Record<string, string> = {
  'dem': 'DEM图',
  'heightmap': '高度图',
  'plates': '板块构造',
  'plates-smoothed': '平滑板块',
  'continents': '大陆区划',
  'continents-smoothed': '平滑大陆',
  // 'crust': '地壳类型',
  // 'density': '地壳密度',
  'subduction': '俯冲极性',
  'stress': '构造应力',
  'mantle': '地幔动态地形',
  'volcanism': '火山构造',
  'classification': '地形分类',
  'texture': '地形纹理',
  'finalization': '最终整形',
  'geometric-flow': '几何汇流',
  'satellite': '卫星影像风格',
  'biome': 'Biome 生物群系',
  'biome-smoothed': 'Biome 平滑群系',
  'glacial': '冰川指数',
  'koppen': 'Köppen 气候分类',
  'koppen-smoothed': 'Köppen 平滑气候分类',
  'temperature': '月均气温',
  'precipitation': '月降水量',
  'wind': '盛行风',
  'ocean-current': '洋流',
}

function row(key: string, category: Category, count: number, totalCells: number): LayerStatisticRow {
  return { key, ...category, count, percentage: totalCells > 0 ? count / totalCells * 100 : 0 }
}

function plateLabel(plate: number, primaryPlateLimit?: number): string {
  if (plate < 0)
    return '未分配板块'
  if (primaryPlateLimit === undefined)
    return `板块 #${plate}`
  return `${plate < primaryPlateLimit ? '主要板块' : '小板块'} #${plate}`
}

function finish(
  mode: string,
  totalCells: number,
  categories: Category[],
  counts: Uint32Array,
  month?: number,
): LayerStatistics {
  const rows = categories
    .map((category, index) => row(String(index), category, counts[index], totalCells))
    .sort((a, b) => b.count - a.count)
  return {
    mode,
    title: month === undefined ? MODE_TITLES[mode] : `${MODE_TITLES[mode]} · ${MONTH_NAMES[month]}`,
    month,
    totalCells,
    rows,
  }
}

function countBuckets(
  mode: string,
  totalCells: number,
  categories: Category[],
  categoryOf: (region: number) => number,
  month?: number,
): LayerStatistics {
  const counts = new Uint32Array(categories.length)
  for (let region = 0; region < totalCells; region++)
    counts[categoryOf(region)]++
  return finish(mode, totalCells, categories, counts, month)
}

/** Count final output cells according to the active surface layer. */
export function buildLayerStatistics(
  data: WorldSimulationState,
  mode: string,
  month: number,
  primaryPlateCount?: number,
): LayerStatistics | null {
  const total = data.geography.elevation.length
  const geo = data.geography
  const geology = data.geology

  if (mode === 'satellite')
    return null

  if (mode === 'koppen' || mode === 'koppen-smoothed') {
    const classes = data.climate?.koppen?.climateClass
    if (!classes || classes.length !== total)
      return null
    const categories = KOPPEN_CODES.map((code, index) => ({
      label: `${code} · ${KOPPEN_LABELS[index]}`,
      color: `rgb(${KOPPEN_COLORS[index].map(value => Math.round(value * 255)).join(', ')})`,
    }))
    return countBuckets(mode, total, categories, region => classes[region])
  }

  if (mode === 'biome' || mode === 'biome-smoothed') {
    const classes = data.biome?.biomeClass
    if (!classes || classes.length !== total)
      return null
    const categories = BIOME_CODES.map((code, index) => ({
      label: `${code} · ${BIOME_LABELS[index]}`,
      color: `rgb(${BIOME_COLORS[index].map(value => Math.round(value * 255)).join(', ')})`,
    }))
    return countBuckets(mode, total, categories, region => classes[region])
  }

  if (mode === 'plates' || mode === 'plates-smoothed') {
    const regions = geology.regionSuperPlate
    const primaryPlateLimit = primaryPlateCount === undefined
      ? undefined
      : Math.max(2, Math.floor(primaryPlateCount))
    const counts = new Map<number, number>()
    for (let region = 0; region < total; region++) {
      const plate = regions[region]
      counts.set(plate, (counts.get(plate) ?? 0) + 1)
    }
    const plateCounts = primaryPlateLimit !== undefined
      ? {
          primary: [...counts.keys()].filter(plate => plate >= 0 && plate < primaryPlateLimit).length,
          micro: [...counts.keys()].filter(plate => plate >= primaryPlateLimit).length,
        }
      : undefined
    return {
      mode,
      title: MODE_TITLES[mode],
      totalCells: total,
      plateCounts,
      description: plateCounts
        ? '主要板块通常覆盖多个构造细分；小板块从主要板块边界拆出，面积较小，也独立运动。大陆可跨越板块边界。'
        : undefined,
      rows: [...counts].map(([plate, count]) => row(
        String(plate),
        {
          label: plateLabel(plate, primaryPlateLimit),
          color: plate >= 0 ? `hsl(${(plate * 137.508) % 360} 65% 55%)` : '#777b85',
        },
        count,
        total,
      )).sort((a, b) => b.count - a.count),
    }
  }

  if (mode === 'continents' || mode === 'continents-smoothed') {
    const counts = new Map<number, number>()
    for (let region = 0; region < total; region++) {
      const continent = geo.landMask[region] === 0 ? -2 : geo.visibleContinentId[region]
      counts.set(continent, (counts.get(continent) ?? 0) + 1)
    }
    return {
      mode,
      title: MODE_TITLES[mode],
      totalCells: total,
      description: '按最终海陆显示大陆归属；新露出的陆地继承最近候选大陆的编号。',
      rows: [...counts].map(([continent, count]) => row(
        String(continent),
        {
          label: continent >= 0 ? `大陆 #${continent}` : continent === -2 ? '海洋' : '未归属大陆的陆地',
          color: continent >= 0 ? `hsl(${(continent * 137.508) % 360} 65% 55%)` : continent === -2 ? '#1a2633' : '#9e9475',
        },
        count,
        total,
      )).sort((a, b) => b.count - a.count),
    }
  }

  if (mode === 'temperature' || mode === 'precipitation') {
    const display = data.climate?.displayMonth
    if (!display || display.month !== month
      || display.temperatureC.length !== total || display.precipitationMm.length !== total) {
      return null
    }
    if (mode === 'temperature') {
      const categories = [
        { label: '< −20 °C', color: '#2949a4' },
        { label: '−20 至 < 0 °C', color: '#6599cc' },
        { label: '0 至 < 10 °C', color: '#c6dacc' },
        { label: '10 至 < 20 °C', color: '#e6dc9a' },
        { label: '20 至 < 30 °C', color: '#e79e57' },
        { label: '≥ 30 °C', color: '#db451f' },
      ]
      return countBuckets(mode, total, categories, (region) => {
        const value = display.temperatureC[region]
        return value < -20 ? 0 : value < 0 ? 1 : value < 10 ? 2 : value < 20 ? 3 : value < 30 ? 4 : 5
      }, month)
    }
    const categories = [
      { label: '0 mm', color: '#cca66b' },
      { label: '> 0 至 < 25 mm', color: '#b8b06d' },
      { label: '25 至 < 100 mm', color: '#74b781' },
      { label: '100 至 < 250 mm', color: '#389a83' },
      { label: '250 至 < 500 mm', color: '#24749a' },
      { label: '≥ 500 mm', color: '#144092' },
    ]
    return countBuckets(mode, total, categories, (region) => {
      const value = display.precipitationMm[region]
      return value <= 0 ? 0 : value < 25 ? 1 : value < 100 ? 2 : value < 250 ? 3 : value < 500 ? 4 : 5
    }, month)
  }

  if (mode === 'wind' || mode === 'ocean-current') {
    const vectors = data.climate?.displayVector
    if (vectors?.kind !== mode || vectors.month !== month
      || vectors.east.length !== total || vectors.north.length !== total) {
      return null
    }
    const current = mode === 'ocean-current'
    if (current && vectors.warmth?.length !== total)
      return null
    if (current) {
      const categories = [
        { label: '陆地', color: '#253735' },
        { label: '近静止', color: '#344b57' },
        { label: '冷流', color: OCEAN_CURRENT_THERMAL_COLORS.cold },
        { label: '中性', color: OCEAN_CURRENT_THERMAL_COLORS.neutral },
        { label: '暖流', color: OCEAN_CURRENT_THERMAL_COLORS.warm },
      ]
      return countBuckets(mode, total, categories, (region) => {
        if (geo.landMask[region])
          return 0
        if (Math.hypot(vectors.east[region], vectors.north[region]) < 0.05)
          return 1
        const thermalClass = classifyOceanCurrentThermal(vectors.warmth![region])
        return thermalClass === 'cold' ? 2 : thermalClass === 'warm' ? 4 : 3
      }, month)
    }
    const categories = [
      { label: '近静止', color: '#344b57' },
      ...['北', '东北', '东', '东南', '南', '西南', '西', '西北'].map((label, index) => ({
        label: `${label}向`,
        color: ['#b7f4ff', '#81dcd9', '#61c7a6', '#a5d16f', '#f3d27c', '#f1a270', '#cd90c4', '#a7a8e9'][index],
      })),
    ]
    return countBuckets(mode, total, categories, (region) => {
      const east = vectors.east[region]
      const north = vectors.north[region]
      if (Math.hypot(east, north) < 0.05)
        return 0
      const angle = (Math.atan2(east, north) + 2 * Math.PI) % (2 * Math.PI)
      return 1 + Math.floor((angle + Math.PI / 8) % (2 * Math.PI) / (Math.PI / 4))
    }, month)
  }

  if (mode === 'dem') {
    const categories = [
      { label: '海洋 (< 0 km)', color: '#123f7c' },
      { label: '海岸 (0–0.02 km)', color: '#c2b378' },
      { label: '低地 (0.02–1 km)', color: '#388a34' },
      { label: '丘陵 (1–2.5 km)', color: '#6e7238' },
      { label: '山地 (2.5–4.5 km)', color: '#94705e' },
      { label: '高山 (≥ 4.5 km)', color: '#d9dce6' },
    ]
    return countBuckets(mode, total, categories, (region) => {
      const value = geo.elevation[region]
      return value < 0 ? 0 : value < 0.02 ? 1 : value < 1 ? 2 : value < 2.5 ? 3 : value < 4.5 ? 4 : 5
    })
  }

  if (mode === 'heightmap') {
    const categories = [
      { label: '海洋 (< 0 km)', color: '#123f7c' },
      { label: '低地 (0–1 km)', color: '#388a34' },
      { label: '丘陵 (1–2.5 km)', color: '#6e7238' },
      { label: '山地 (2.5–4.5 km)', color: '#94705e' },
      { label: '高山 (≥ 4.5 km)', color: '#d9dce6' },
    ]
    return countBuckets(mode, total, categories, (region) => {
      const value = geo.elevation[region]
      return value < 0 ? 0 : value < 1 ? 1 : value < 2.5 ? 2 : value < 4.5 ? 3 : 4
    })
  }

  /*
  if (mode === 'crust') {
    return countBuckets(mode, total, [
      { label: '海洋地壳', color: '#144d85' },
      { label: '大陆地壳', color: '#b88447' },
    ], region => geology.tectonics.regionCrustType[region] === CRUST_TYPE.Continental ? 1 : 0)
  }

  if (mode === 'density') {
    const categories = [
      { label: '< 2.675', color: '#f5c752' },
      { label: '2.675 至 < 2.95', color: '#cf8351' },
      { label: '2.95 至 < 3.225', color: '#884279' },
      { label: '≥ 3.225', color: '#40147a' },
    ]
    return countBuckets(mode, total, categories, (region) => {
      const value = geology.tectonics.regionDensity[region]
      return value < 2.675 ? 0 : value < 2.95 ? 1 : value < 3.225 ? 2 : 3
    })
  }
  */

  if (mode === 'subduction') {
    const categories = [
      { label: '稳定大陆侧', color: '#302a24' },
      { label: '稳定海洋侧', color: '#0d1a29' },
      { label: '上覆侧', color: '#ff7314' },
      { label: '俯冲侧', color: '#268cff' },
    ]
    return countBuckets(mode, total, categories, (region) => {
      const overriding = geo.terrainFields.overridingInfluence[region]
      const subducting = geo.terrainFields.subductingInfluence[region]
      const role = geology.tectonics.regionSubductionRole[region]
      if (overriding > subducting || role === SUBDUCTION_ROLE.Overriding)
        return 2
      if (subducting > 0 || role === SUBDUCTION_ROLE.Subducting)
        return 3
      return geology.tectonics.regionCrustType[region] === CRUST_TYPE.Continental ? 0 : 1
    })
  }

  if (mode === 'stress') {
    let maximum = 0
    for (const value of geology.tectonics.regionStress)
      maximum = Math.max(maximum, value)
    const categories = [
      { label: '无应力', color: '#04050a' },
      { label: '低应力 (0–35%)', color: '#73105e' },
      { label: '中应力 (35–70%)', color: '#e62e0d' },
      { label: '高应力 (70–100%)', color: '#fff273' },
    ]
    return countBuckets(mode, total, categories, (region) => {
      const value = maximum > 0 ? geology.tectonics.regionStress[region] / maximum : 0
      return value <= 0 ? 0 : value < 0.35 ? 1 : value < 0.7 ? 2 : 3
    })
  }

  if (mode === 'mantle') {
    const categories = [
      { label: '明显下沉 (< −0.25)', color: '#156bff' },
      { label: '轻微下沉 (−0.25–0)', color: '#31528a' },
      { label: '中性 (0)', color: '#070811' },
      { label: '轻微上涌 (0–0.25)', color: '#97452a' },
      { label: '明显上涌 (≥ 0.25)', color: '#ff3d0f' },
    ]
    return countBuckets(mode, total, categories, (region) => {
      const value = geology.mantleFlow[region]
      return value < -0.25 ? 0 : value < 0 ? 1 : value === 0 ? 2 : value < 0.25 ? 3 : 4
    })
  }

  if (mode === 'volcanism') {
    const categories = [
      { label: '无明显火山构造', color: '#08090c' },
      { label: '岛弧', color: '#1abfff' },
      { label: '陆缘火山弧', color: '#ff3d0f' },
      { label: '热点链', color: '#ffd114' },
      { label: '大型火成岩省', color: '#b833ff' },
    ]
    const sources = geology.edifices
    return countBuckets(mode, total, categories, (region) => {
      let value = sources.islandArc[region] / 3.3
      let category = 1
      const volcanicArc = sources.volcanicArc[region] / 1.32
      const hotspot = sources.hotspot[region] / 3.3
      const igneousProvince = sources.largeIgneousProvince[region] / 0.3
      if (volcanicArc > value) {
        value = volcanicArc
        category = 2
      }
      if (hotspot > value) {
        value = hotspot
        category = 3
      }
      if (igneousProvince > value) {
        value = igneousProvince
        category = 4
      }
      return value <= 0 ? 0 : category
    })
  }

  if (mode === 'classification') {
    const categories = [
      { label: '候选海洋', color: '#1f6db8' },
      { label: '未归类陆地', color: '#34422b' },
      { label: '克拉通', color: '#bdaa47' },
      { label: '盆地', color: '#1f7ab8' },
      { label: '褶皱带', color: '#f04014' },
      { label: '高原', color: '#9e45d1' },
    ]
    const fields = geo.terrainClassification
    return countBuckets(mode, total, categories, (region) => {
      if (!geo.candidateLandMask[region])
        return 0
      let value = fields.craton[region]
      let category = 2
      if (fields.basin[region] > value) {
        value = fields.basin[region]
        category = 3
      }
      if (fields.foldBelt[region] > value) {
        value = fields.foldBelt[region]
        category = 4
      }
      if (fields.plateau[region] > value) {
        value = fields.plateau[region]
        category = 5
      }
      return value <= 0 ? 1 : category
    })
  }

  if (mode === 'texture') {
    const categories = [
      { label: '无明显纹理', color: '#08090c' },
      { label: '方向性山脊', color: '#b84dff' },
      { label: '构造带纹理', color: '#ff6614' },
      { label: '表面细节', color: '#14ccb8' },
      { label: '海岸细化', color: '#ff2e8c' },
      { label: '陆地背景', color: '#add133' },
      { label: '物理尺度细节', color: '#4db8ff' },
    ]
    const texture = geo.terrainTexture
    return countBuckets(mode, total, categories, (region) => {
      let value = Math.abs(texture.phasorRidge[region]) / 0.9
      let category = 1
      const tectonicBand = Math.abs(texture.tectonicBand[region]) / 0.48
      const detail = Math.abs(texture.detail[region]) / 0.24
      const coastal = Math.abs(texture.coastal[region]) / 0.3
      const uniformLand = Math.abs(texture.uniformLand[region]) / 0.21
      const postDetail = Math.abs(texture.postDetail[region]) / 0.15
      if (tectonicBand > value) {
        value = tectonicBand
        category = 2
      }
      if (detail > value) {
        value = detail
        category = 3
      }
      if (coastal > value) {
        value = coastal
        category = 4
      }
      if (uniformLand > value) {
        value = uniformLand
        category = 5
      }
      if (postDetail > value) {
        value = postDetail
        category = 6
      }
      return value <= 0 ? 0 : category
    })
  }

  if (mode === 'finalization') {
    const categories = [
      { label: '无高程变化', color: '#08090c' },
      { label: '高程抬升', color: '#ff9e1f' },
      { label: '高程压低', color: '#1f94ff' },
      { label: '拓扑修改', color: '#ff33b8' },
    ]
    const fields = geo.terrainFinalization
    return countBuckets(mode, total, categories, (region) => {
      if (fields.topologyChanged[region])
        return 3
      const delta = fields.shapingDelta[region] + fields.topologyDelta[region] + fields.postProcessDelta[region]
      return delta > 0 ? 1 : delta < 0 ? 2 : 0
    })
  }

  if (mode === 'geometric-flow') {
    const categories = [
      { label: '≤ 1 个上游 cell', color: '#030509' },
      { label: '2–9 个', color: '#12436d' },
      { label: '10–99 个', color: '#0a6bb8' },
      { label: '100–999 个', color: '#4ca8bf' },
      { label: '≥ 1000 个', color: '#b8fff5' },
    ]
    return countBuckets(mode, total, categories, (region) => {
      const value = geo.terrainErosion.flowAccumulation[region]
      return value <= 1 ? 0 : value < 10 ? 1 : value < 100 ? 2 : value < 1000 ? 3 : 4
    })
  }

  if (mode === 'glacial') {
    const categories = [
      { label: '无冰川 (0)', color: '#030509' },
      { label: '弱 (0–0.25)', color: '#164d8e' },
      { label: '中 (0.25–0.5)', color: '#1f7ae6' },
      { label: '强 (0.5–0.75)', color: '#8dc3ee' },
      { label: '极强 (≥ 0.75)', color: '#f0faff' },
    ]
    return countBuckets(mode, total, categories, (region) => {
      const value = geo.terrainErosion.glacialIndex[region]
      return value <= 0 ? 0 : value < 0.25 ? 1 : value < 0.5 ? 2 : value < 0.75 ? 3 : 4
    })
  }
  return null
}
