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
  { id: 'political-atlas', label: '政区地图', subtitle: '国家疆域 · 国界 · 聚落注记', swatch: 'linear-gradient(135deg, #2f86d6 0%, #d7e4c8 38%, #f3c9d4 68%, #f0d7b0 100%)' },
  { id: 'minimal-light', label: '极简明亮', subtitle: '低饱和浅底 · 突出科学专题', swatch: 'linear-gradient(135deg, #dce6ef 0%, #eef2f6 50%, #f7f6f2 100%)' },
  { id: 'minimal-dark', label: '极简暗色', subtitle: '深岩灰暗底 · 契合环流高亮', swatch: 'linear-gradient(135deg, #090f1d 0%, #111c33 50%, #1e293b 100%)' },
  { id: 'historical-parchment', label: '古典羊皮纸', subtitle: '暖羊皮纸 · 墨线国界与聚落', swatch: 'linear-gradient(135deg, #bfb191 0%, #d8ceb4 50%, #e8dec3 100%)' },
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

export interface ThematicItemPresentation {
  readonly id: string
  readonly label: string
  readonly icon: typeof Mountain
  readonly requiresCapability?: 'hasResources' | 'hasCivilization'
}

export interface ThematicGroupPresentation {
  readonly label: string
  readonly items: readonly ThematicItemPresentation[]
}

export const LAYER_GROUPS: readonly ThematicGroupPresentation[] = [
  {
    label: '地质',
    items: [
      { id: 'elevation', label: '高程', icon: Mountain },
      { id: 'dem', label: '高程灰度图', icon: Mountain },
      { id: 'plates', label: '构造板块', icon: Workflow },
      { id: 'continents', label: '陆海分区', icon: Globe },
    ],
  },
  {
    label: '气候',
    items: [
      { id: 'temperature', label: '气温', icon: Thermometer },
      { id: 'precipitation', label: '降水量', icon: CloudRain },
      { id: 'wind-speed', label: '10m 风速', icon: Wind },
      { id: 'ocean-speed', label: '表层洋流速度', icon: Waves },
      { id: 'snow', label: '月度积雪水当量', icon: Snowflake },
      { id: 'runoff', label: '年径流深', icon: Waves },
      { id: 'basins', label: '水文流域', icon: Compass },
    ],
  },
  {
    label: '生态与覆盖',
    items: [
      { id: 'koppen', label: 'Köppen 气候带', icon: Thermometer },
      { id: 'biomes', label: '潜在生物群系', icon: Globe },
      { id: 'land-cover', label: '自然地表覆盖', icon: Layers },
    ],
  },
  {
    label: '资源与文明',
    items: [
      { id: 'agricultural-potential', label: '农业潜力', icon: Globe, requiresCapability: 'hasResources' },
      { id: 'deposit-richness', label: '矿产富集度', icon: Mountain, requiresCapability: 'hasResources' },
      { id: 'population-density', label: '人口密度', icon: Activity, requiresCapability: 'hasCivilization' },
      { id: 'polity-territory', label: '国家政区', icon: MapIcon, requiresCapability: 'hasCivilization' },
      { id: 'culture-dominant', label: '主导文化', icon: Compass, requiresCapability: 'hasCivilization' },
      { id: 'religion-dominant', label: '主导宗教', icon: Layers, requiresCapability: 'hasCivilization' },
    ],
  },
] as const

/** 气温、降水各用一个按钮；默认年统计，图例开关切到月统计。年、月仍是两套专题 id。 */
export const CLIMATE_PERIOD_LAYERS = [
  { buttonId: 'temperature', annualId: 'annual-temperature', monthlyId: 'temperature' },
  { buttonId: 'precipitation', annualId: 'annual-precipitation', monthlyId: 'precipitation' },
  { buttonId: 'wind-speed', annualId: 'annual-wind-speed', monthlyId: 'wind-speed' },
  { buttonId: 'ocean-speed', annualId: 'annual-ocean-speed', monthlyId: 'ocean-speed' },
] as const

export type ClimatePeriodLayer = (typeof CLIMATE_PERIOD_LAYERS)[number]

/** 没有年统计对应项、必须按月份读取的专题。 */
export const MONTHLY_ONLY_THEMATIC_IDS = ['snow'] as const

export function climatePeriodByButtonId(id: string): ClimatePeriodLayer | undefined {
  return CLIMATE_PERIOD_LAYERS.find(layer => layer.buttonId === id)
}

export function climatePeriodForThematic(id: string | null): ClimatePeriodLayer | undefined {
  if (!id)
    return undefined
  return CLIMATE_PERIOD_LAYERS.find(layer => layer.annualId === id || layer.monthlyId === id)
}

export const SURFACE_LAYER_ITEM = {
  id: 'world-surface',
  label: '地表',
} as const

export interface OverlayTogglePresentation {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly requiresCapability?: 'hasCirculation' | 'hasGeographicNames' | 'hasCivilization'
}

export const OVERLAY_ITEMS: readonly OverlayTogglePresentation[] = [
  { id: 'rivers', label: '河网水系', description: '平滑中心线与按流量变宽的河道水体多边形。' },
  { id: 'lakes', label: '静态湖泊', description: '内流与外流洼地湖泊平滑多边形。' },
  { id: 'coastlines', label: '海岸线', description: '全球海陆交界平滑矢量描边。' },
  { id: 'plate-boundaries', label: '板块边界', description: '相邻构造板块之间的对偶边界虚线。' },
  { id: 'wind-arrows', label: '风向箭头', description: '当月 10m 近地表盛行风向矢量箭头。', requiresCapability: 'hasCirculation' },
  { id: 'ocean-arrows', label: '洋流箭头', description: '当月表层洋流方向与冷暖流配色箭头。', requiresCapability: 'hasCirculation' },
  { id: 'labels', label: '大陆与大洋地名', description: '沿版图 PCA 脊线弯曲排版的中文地理名称。', requiresCapability: 'hasGeographicNames' },
  { id: 'polity-borders', label: '国家边界线', description: '国家领土与无归属边疆边界轮廓线。', requiresCapability: 'hasCivilization' },
  { id: 'transport-routes', label: '交通航路网', description: '连接聚落的陆路、沿河与近海航线网络。', requiresCapability: 'hasCivilization' },
  { id: 'settlements', label: '聚落点位', description: '按首都、城市与城镇等级分级符号渲染。', requiresCapability: 'hasCivilization' },
  { id: 'polity-labels', label: '国家名称注记', description: '沿国家疆域核心轴线排版的政体名称。', requiresCapability: 'hasCivilization' },
  { id: 'settlement-labels', label: '聚落名称注记', description: '伴随聚落点位的避让分级地名注记。', requiresCapability: 'hasCivilization' },
] as const

const THEMATIC_LAYER_IDS = new Set<string>([
  ...LAYER_GROUPS.flatMap(group => group.items.map(item => item.id)),
  ...CLIMATE_PERIOD_LAYERS.flatMap(layer => [layer.annualId, layer.monthlyId]),
])
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
