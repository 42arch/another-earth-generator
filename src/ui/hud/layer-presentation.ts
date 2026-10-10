import {
  CloudRain,
  Component,
  Layers,
  Map,
  Mountain,
  Satellite,
  Tag,
  Thermometer,
  Waves,
  Wind,
  Workflow,
} from '@lucide/svelte'
import { getOceanCurrentThermalColor } from '@/core/rendering/shared/climate-color-scale'
import type { LayerStatisticRow, LayerStatistics } from '@/core/world/layer-statistics'

const LAYER_ICONS: Record<string, typeof Component> = {
  satellite: Satellite,
  heightmap: Mountain,
  dem: Mountain,
  plates: Workflow,
  'plates-smoothed': Workflow,
  continents: Map,
  'continents-smoothed': Map,
  'geometric-flow': Workflow,
  temperature: Thermometer,
  precipitation: CloudRain,
  wind: Wind,
  'ocean-current': Waves,
  koppen: Layers,
  'koppen-smoothed': Layers,
  biome: Layers,
  'biome-smoothed': Layers,
  population: Layers,
  'market-access': Map,
  ethnicity: Layers,
  languages: Map,
  polities: Map,
  religions: Layers,
  'nation-borders': Map,
  'nation-labels': Tag,
  'religion-labels': Tag,
  'ethnicity-labels': Tag,
  'language-labels': Tag,
  cities: Component,
  routes: Workflow,
  'sacred-sites': Component,
  clouds: CloudRain,
  atmosphere: Component,
  'day-night': Component,
  graticule: Component,
  wireframe: Component,
}

export function getLayerIcon(id: string): typeof Component {
  return LAYER_ICONS[id] ?? Component
}

export function getLayerStatisticColor(mode: string, row: LayerStatisticRow): string {
  if (row.color)
    return row.color

  if (mode === 'ocean-current') {
    if (row.key === 'cold')
      return getOceanCurrentThermalColor(-1)
    if (row.key === 'neutral')
      return getOceanCurrentThermalColor(0)
    if (row.key === 'warm')
      return getOceanCurrentThermalColor(1)
  }

  return '#888888'
}

/** Tab-separated text keeps copied counts readable and easy to paste into a sheet. */
export function formatLayerStatistics(statistics: LayerStatistics): string {
  return [
    ...(statistics.seed === undefined ? [] : [`种子\t${statistics.seed}`]),
    `图层\t${statistics.title}`,
    `模式\t${statistics.mode}`,
    ...(statistics.month === undefined ? [] : [`月份\t${statistics.month + 1}`]),
    ...(statistics.measure === 'people'
      ? [`模型总人口（人）\t${statistics.totalPopulation ?? 0}`]
      : [`总 cell\t${statistics.totalCells}`]),
    ...(statistics.plateCounts
      ? [`主要板块\t${statistics.plateCounts.primary}`, `小板块\t${statistics.plateCounts.micro}`]
      : []),
    ...(statistics.description ? [`说明\t${statistics.description}`] : []),
    statistics.mode.startsWith('polities') ? '分类\t居民人数（人）\t占比\t面积（km²）' : statistics.measure === 'people' ? '分类\t居民人数（人）\t占比' : '分类\tcell 数\t占比',
    ...statistics.rows.map(item => `${item.label}\t${item.count}\t${item.percentage.toFixed(6)}%${item.areaKm2 === undefined ? '' : `\t${item.areaKm2}`}`),
  ].join('\n')
}
