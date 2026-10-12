import type { WorldSimulationState } from '@/core/simulation/state'
import { civilizationGroupCssColor } from '@/core/simulation/civilization/group-color'
import { classifyOceanCurrentThermal } from '@/core/simulation/climate/ocean-current-thermal'
import { CRUST_TYPE, SUBDUCTION_ROLE } from '@/core/simulation/geology/geology-data'

interface Category {
  label: string
  color?: string
  key?: string
}

export interface LayerStatisticRow extends Category {
  key: string
  count: number
  percentage: number
  areaKm2?: number
}

export interface LayerStatistics {
  mode: string
  title: string
  seed?: number
  month?: number
  totalCells: number
  measure?: 'people'
  totalPopulation?: number
  description?: string
  rows: LayerStatisticRow[]
}

const MONTH_NAMES = ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月', '7 月', '8 月', '9 月', '10 月', '11 月', '12 月']

const MODES_WITHOUT_STATISTICS = new Set<string>(['satellite', 'dem', 'heightmap', 'population', 'market-access'])

export function hasLayerStatistics(mode: string): boolean {
  return !MODES_WITHOUT_STATISTICS.has(mode)
}

const MODE_TITLES: Record<string, string> = {
  'dem': 'DEM图',
  'heightmap': '高度图',
  'ethnicity': '民族分布',
  'languages': '语言分布',
  'polities': '国家归属',
  'religions': '宗教与信仰',
  'subduction': '俯冲极性',
  'volcanism': '火山构造',
  'classification': '地形分类',
  'texture': '地形纹理',
  'finalization': '最终整形',
  'geometric-flow': '几何汇流',
  'satellite': '卫星影像风格',
  'glacial': '冰川指数',
  'temperature': '月均气温',
  'precipitation': '月降水量',
  'wind': '盛行风',
  'ocean-current': '洋流',
}

function row(key: string, category: Category, count: number, totalCells: number): LayerStatisticRow {
  return { key, ...category, count, percentage: totalCells > 0 ? count / totalCells * 100 : 0 }
}

function finish(
  mode: string,
  totalCells: number,
  categories: Category[],
  counts: Uint32Array,
  month?: number,
): LayerStatistics {
  const rows = categories
    .map((category, index) => row(category.key ?? String(index), category, counts[index], totalCells))
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
): LayerStatistics | null {
  const total = data.geography.elevation.length
  const geo = data.geography
  const geology = data.geology
  const categoricalMode = mode

  if (mode === 'satellite')
    return null

  if (categoricalMode === 'polities') {
    const polities = data.civilization?.polities
    if (!polities)
      return null
    const totalPopulation = data.civilization?.totalPopulation ?? 0
    return {
      mode,
      title: '国家人口与面积',
      totalCells: total,
      measure: 'people',
      totalPopulation,
      description: '按居民所在地汇总人口，按球面物理面积汇总国土；灰色为没有政治中心或航线接入的独立陆地。',
      rows: [
        ...polities.polities.map(polity => ({
          key: String(polity.id),
          label: polity.name,
          color: civilizationGroupCssColor(polity.id),
          count: polity.population,
          percentage: totalPopulation > 0 ? polity.population / totalPopulation * 100 : 0,
          areaKm2: polity.areaKm2,
        })),
        {
          key: 'unassigned',
          label: '未归属',
          color: 'rgb(77, 84, 87)',
          count: polities.unassignedPopulation,
          percentage: totalPopulation > 0 ? polities.unassignedPopulation / totalPopulation * 100 : 0,
          areaKm2: polities.unassignedAreaKm2,
        },
      ].sort((a, b) => b.count - a.count),
    }
  }

  if (categoricalMode === 'religions') {
    const religions = data.civilization?.religions
    if (!religions)
      return null
    const counts = new Float64Array(religions.religions.length)
    let unaffiliated = 0
    for (let index = 0; index < religions.affiliationIds.length; index++) {
      const id = religions.affiliationIds[index]
      if (id >= 0)
        counts[id] += religions.residents[index]
      else
        unaffiliated += religions.residents[index]
    }
    const totalPopulation = counts.reduce((sum, value) => sum + value, unaffiliated)
    return {
      mode,
      title: '主要信仰归属人口',
      totalCells: total,
      measure: 'people',
      totalPopulation,
      description: '每位居民只计入一个主要信仰归属；无归属单列。尚未模拟多重参与。',
      rows: [
        ...religions.religions.map(religion => ({
          key: String(religion.id),
          label: religion.name,
          color: civilizationGroupCssColor(religion.id),
          count: counts[religion.id],
          percentage: totalPopulation > 0 ? counts[religion.id] / totalPopulation * 100 : 0,
        })),
        {
          key: 'unaffiliated',
          label: '无归属',
          color: 'rgb(115, 102, 92)',
          count: unaffiliated,
          percentage: totalPopulation > 0 ? unaffiliated / totalPopulation * 100 : 0,
        },
      ].sort((a, b) => b.count - a.count),
    }
  }

  if (categoricalMode === 'ethnicity' || categoricalMode === 'languages') {
    const ethnicity = data.civilization?.ethnicity
    if (!ethnicity)
      return null
    const entities = categoricalMode === 'ethnicity' ? ethnicity.groups : ethnicity.languages
    const counts = new Float64Array(entities.length)
    for (let index = 0; index < ethnicity.groupIds.length; index++) {
      const group = ethnicity.groups[ethnicity.groupIds[index]]
      const entityId = categoricalMode === 'ethnicity' ? group.id : group.languageId
      counts[entityId] += ethnicity.residents[index]
    }
    const totalPopulation = counts.reduce((sum, value) => sum + value, 0)
    return {
      mode,
      title: categoricalMode === 'ethnicity' ? '民族居民构成' : '语言使用人口',
      totalCells: total,
      measure: 'people',
      totalPopulation,
      description: categoricalMode === 'ethnicity'
        ? '按各区域居民构成人数汇总；底图仅显示当地人数最多的民族。'
        : '按民族关联的主要语言汇总使用人口；当前尚未模拟双语使用。',
      rows: entities.map(entity => ({
        key: String(entity.id),
        label: entity.name,
        color: civilizationGroupCssColor(entity.id),
        count: counts[entity.id],
        percentage: totalPopulation > 0 ? counts[entity.id] / totalPopulation * 100 : 0,
      })).sort((a, b) => b.count - a.count),
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
        { key: 'cold', label: '冷流' },
        { key: 'neutral', label: '中性' },
        { key: 'warm', label: '暖流' },
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
