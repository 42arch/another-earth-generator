import type { LayerStatisticRow, LayerStatistics } from '@/core/world/layer-statistics'
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
import { getMapStyleDocument } from '@/core/rendering/styles'

const LAYER_ICONS: Record<string, typeof Component> = {
  'satellite': Satellite,
  'cartographic': Map,
  'heightmap': Mountain,
  'dem': Mountain,
  'geometric-flow': Workflow,
  'temperature': Thermometer,
  'precipitation': CloudRain,
  'wind': Wind,
  'ocean-current': Waves,
  'population': Layers,
  'market-access': Map,
  'ethnicity': Layers,
  'languages': Map,
  'polities': Map,
  'religions': Layers,
  'nation-borders': Map,
  'nation-labels': Tag,
  'religion-labels': Tag,
  'ethnicity-labels': Tag,
  'language-labels': Tag,
  'cities': Component,
  'routes': Workflow,
  'sacred-sites': Component,
  'clouds': CloudRain,
  'atmosphere': Component,
  'day-night': Component,
  'graticule': Component,
  'wireframe': Component,
}

export function getLayerIcon(id: string): typeof Component {
  return LAYER_ICONS[id] ?? Component
}

export function getLayerStatisticColor(mode: string, row: LayerStatisticRow, mapStyle?: string): string {
  if (row.color)
    return row.color

  if (mode === 'ocean-current') {
    const tokens = getMapStyleDocument(mapStyle).tokens
    if (row.key === 'cold')
      return String(tokens.oceanCurrentCold ?? '#2166AC')
    if (row.key === 'neutral')
      return String(tokens.oceanCurrentNeutral ?? '#F7F7F7')
    if (row.key === 'warm')
      return String(tokens.oceanCurrentWarm ?? '#B2182B')
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
    ...(statistics.description ? [`说明\t${statistics.description}`] : []),
    statistics.mode.startsWith('polities') ? '分类\t居民人数（人）\t占比\t面积（km²）' : statistics.measure === 'people' ? '分类\t居民人数（人）\t占比' : '分类\tcell 数\t占比',
    ...statistics.rows.map(item => `${item.label}\t${item.count}\t${item.percentage.toFixed(6)}%${item.areaKm2 === undefined ? '' : `\t${item.areaKm2}`}`),
  ].join('\n')
}
