import type { BuiltinMapStylePresetId, MapProjectionId, MapViewportMode } from '@another-earth/cartography'
import {
  Activity,
  CloudRain,
  Compass,
  Globe,
  Layers,
  Map as MapIcon,
  Mountain,
  Snowflake,
  Thermometer,
  Waves,
  Wind,
  Workflow,
} from '@lucide/svelte'

export interface StylePresetPresentation {
  readonly id: BuiltinMapStylePresetId
  readonly label: string
  readonly subtitle: string
  readonly swatch: string
}

export const STYLE_PRESET_CARDS: readonly StylePresetPresentation[] = [
  { id: 'satellite', label: '仿真卫星', subtitle: '地表微纹理 · 晕渲 · 水面', swatch: 'linear-gradient(135deg, #0b2648 0%, #245c6e 45%, #4b703d 75%, #e2eaf0 100%)' },
  { id: 'standard-atlas', label: '标准地图', subtitle: '柔和分级 · 清晰河湖与地名', swatch: 'linear-gradient(135deg, #74bce0 0%, #a2d8f2 45%, #d6eac9 75%, #dfcba6 100%)' },
  { id: 'physical-relief', label: '自然地理', subtitle: '海深陆高色阶 · 地形晕渲', swatch: 'linear-gradient(135deg, #0b2545 0%, #367eae 40%, #2f8544 70%, #c45943 100%)' },
  { id: 'minimal-light', label: '极简明亮', subtitle: '低饱和浅底 · 突出科学专题', swatch: 'linear-gradient(135deg, #dce6ef 0%, #eef2f6 50%, #f7f6f2 100%)' },
  { id: 'minimal-dark', label: '极简暗色', subtitle: '深岩灰暗底 · 契合环流高亮', swatch: 'linear-gradient(135deg, #090f1d 0%, #111c33 50%, #1e293b 100%)' },
  { id: 'historical-parchment', label: '古典羊皮纸', subtitle: '暖羊皮纸色调 · 墨棕海岸', swatch: 'linear-gradient(135deg, #bfb191 0%, #d8ceb4 50%, #e8dec3 100%)' },
] as const

export interface ProjectionOptionPresentation {
  readonly id: MapProjectionId
  readonly label: string
  readonly shortLabel: string
}

export const MAP_PROJECTION_OPTIONS: readonly ProjectionOptionPresentation[] = [
  { id: 'equal-earth', label: 'Equal Earth（等面积自然地球）', shortLabel: 'Equal Earth' },
  { id: 'equirectangular', label: 'Equirectangular（等距圆柱环绕）', shortLabel: '等距圆柱' },
  { id: 'mercator', label: 'Mercator（墨卡托正轴等角）', shortLabel: '墨卡托' },
] as const

export const VIEW_MODE_OPTIONS: readonly { readonly id: MapViewportMode, readonly label: string }[] = [
  { id: 'globe', label: '3D 星球' },
  { id: 'atlas', label: '2D 地图' },
] as const

export const LAYER_GROUPS = [
  {
    label: '地形与构造',
    items: [
      { id: 'elevation', label: '高程 (km)', icon: Mountain },
      { id: 'plates', label: '构造板块', icon: Workflow },
      { id: 'continents', label: '陆海分区', icon: Globe },
    ],
  },
  {
    label: '气候与环流',
    items: [
      { id: 'temperature', label: '月平均气温 (°C)', icon: Thermometer },
      { id: 'annual-temperature', label: '年平均气温 (°C)', icon: Thermometer },
      { id: 'precipitation', label: '月降水量 (mm/月)', icon: CloudRain },
      { id: 'annual-precipitation', label: '年总降水量 (mm/年)', icon: CloudRain },
      { id: 'koppen', label: 'Köppen 气候带', icon: Thermometer },
      { id: 'wind-speed', label: '10m 月均风速 (m/s)', icon: Wind },
      { id: 'ocean-speed', label: '表层洋流速度 (m/s)', icon: Waves },
    ],
  },
  {
    label: '水文与冰雪',
    items: [
      { id: 'snow', label: '月度积雪水当量 (mm)', icon: Snowflake },
      { id: 'runoff', label: '年径流深 (mm/年)', icon: Waves },
      { id: 'basins', label: '水文流域', icon: Compass },
    ],
  },
  {
    label: '生态与覆盖',
    items: [
      { id: 'biomes', label: '潜在生物群系', icon: Globe },
      { id: 'land-cover', label: '自然地表覆盖', icon: Layers },
    ],
  },
] as const

export const SURFACE_LAYER_ITEM = {
  id: 'world-surface',
  label: '地表',
} as const

export interface OverlayTogglePresentation {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly requiresCapability?: 'hasCirculation' | 'hasGeographicNames'
}

export const OVERLAY_ITEMS: readonly OverlayTogglePresentation[] = [
  { id: 'rivers', label: '河网水系', description: '平滑中心线与按流量变宽的河道水体多边形。' },
  { id: 'lakes', label: '静态湖泊', description: '内流与外流洼地湖泊平滑多边形。' },
  { id: 'coastlines', label: '海岸线', description: '全球海陆交界平滑矢量描边。' },
  { id: 'plate-boundaries', label: '板块边界', description: '相邻构造板块之间的对偶边界虚线。' },
  { id: 'wind-arrows', label: '风向箭头', description: '当月 10m 近地表盛行风向矢量箭头。', requiresCapability: 'hasCirculation' },
  { id: 'ocean-arrows', label: '洋流箭头', description: '当月表层洋流方向与冷暖流配色箭头。', requiresCapability: 'hasCirculation' },
  { id: 'labels', label: '大陆与大洋地名', description: '沿版图 PCA 脊线弯曲排版的中文地理名称。', requiresCapability: 'hasGeographicNames' },
] as const

const THEMATIC_LAYER_IDS = new Set<string>(LAYER_GROUPS.flatMap(group => group.items.map(item => item.id)))
const OVERLAY_LAYER_IDS = new Set<string>(OVERLAY_ITEMS.map(item => item.id))

export function splitStyleDefaultLayers(layerIds: readonly string[]): {
  surfaceEnabled: boolean
  thematicId: string | null
  overlayIds: string[]
} {
  let surfaceEnabled = false
  let thematicId: string | null = null
  const overlayIds: string[] = []
  for (const id of layerIds) {
    if (id === SURFACE_LAYER_ITEM.id)
      surfaceEnabled = true
    else if (THEMATIC_LAYER_IDS.has(id))
      thematicId = id
    else if (OVERLAY_LAYER_IDS.has(id))
      overlayIds.push(id)
  }
  return { surfaceEnabled, thematicId, overlayIds }
}

export const LAYER_ICONS = {
  Activity,
  CloudRain,
  Compass,
  Globe,
  Layers,
  MapIcon,
  Mountain,
  Snowflake,
  Thermometer,
  Waves,
  Wind,
  Workflow,
}
