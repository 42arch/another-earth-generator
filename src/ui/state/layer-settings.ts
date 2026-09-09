import type { GlobeDisplayMode, GlobeGenParams } from '@/core/spherical/config'
import type { ParameterKey } from '@/ui/state/parameter-catalog'

export type LayerKey = {
  [K in keyof GlobeGenParams]: GlobeGenParams[K] extends boolean ? K : never
}[keyof GlobeGenParams]

export type SettingsContext = { kind: 'theme', key: GlobeDisplayMode } | { kind: 'layer', key: LayerKey }

export const PARAMETER_GROUPS = {
  terrain: { label: '基础地形', keys: ['continentCount', 'landCoverage', 'mountainStrength', 'noiseStrength'] },
  land: { label: '大陆与海岸', keys: ['sizeVariety', 'spread', 'compactness', 'elongation', 'coastlineRoughness'] },
  islands: { label: '岛屿', keys: ['islandCount', 'islandLandShare', 'islandClustering', 'islandTectonicBias'] },
  plates: { label: '板块构造', keys: ['plateCount', 'mountainStrength', 'noiseStrength'] },
  temperature: { label: '温度与季节', keys: ['equatorTemperature', 'poleTemperature', 'axialTilt', 'elevationLapseRate', 'latitudeTemperatureExponent', 'temperatureNoiseStrength'] },
  rain: { label: '降水', keys: ['basePrecipitation', 'equatorialRainStrength', 'midlatitudeRainStrength', 'orographicStrength', 'subtropicalDryness', 'precipitationCalibration'] },
  moisture: { label: '水汽输送', keys: ['oceanEvaporation', 'landEvaporation', 'moistureIterations', 'moistureRetention'] },
  wind: { label: '风场', keys: ['windPerturbation'] },
  ocean: { label: '洋流与热量', keys: ['oceanCurrentStrength', 'oceanHeatTransport'] },
  water: { label: '地表水收支', keys: ['infiltration', 'evapotranspirationStrength'] },
  lakes: { label: '湖泊', keys: ['lakeDensity', 'lakeMinDepthMeters', 'lakeMinRegionCount', 'lakeMinCoastDistance', 'lakeMaxLandCoverage', 'lakeEvaporationStrength', 'lakeOverflowThreshold', 'lakeMinFillRatio'] },
  rivers: { label: '河流生成', keys: ['riverBasinThreshold', 'riverMinSourceElevation', 'riverMinLength'] },
  settlements: { label: '聚落', keys: ['settlementDensity'] },
  cultures: { label: '文化', keys: ['cultureCount', 'culturalBlending'] },
  polities: { label: '国家', keys: ['polityCount', 'politicalCohesion', 'overseasExpansion'] },
  religions: { label: '宗教', keys: ['religionCount', 'religiousProselytism'] },
  roads: { label: '道路', keys: ['roadDensity'] },
  shipping: { label: '航线', keys: ['shippingRouteDensity', 'shippingMaxRange', 'shippingCurrentInfluence', 'shippingWindInfluence', 'shippingOpenOceanRisk'] },
  trade: { label: '贸易', keys: ['tradeActivity', 'tradeSpecialization'] },
} satisfies Record<string, { label: string, keys: ParameterKey[] }>

export type GroupKey = keyof typeof PARAMETER_GROUPS
interface ContextSettings {
  label: string
  groups: GroupKey[]
  shared: GroupKey[]
  note: string
}

const waterNote = '水文参数也会影响湖泊、河流和聚落；关闭图层只隐藏显示。'
const climateNote = '气候参数由全世界共用，也会影响水系、生态和聚落。'
const humanNote = '人文参数由相关图层共用，应用后会更新受影响的人文要素。'

export const THEME_SETTINGS: Record<GlobeDisplayMode, ContextSettings> = {
  terrain: { label: '自然地貌', groups: ['land', 'islands'], shared: ['lakes'], note: '基础地形在通用设置中调整；湖泊直接显示在地表上。' },
  elevation: { label: '海拔高度', groups: ['plates'], shared: ['land', 'islands'], note: '地形变化会更新气候、水系和人文要素。' },
  contours: { label: '等高线', groups: ['plates'], shared: ['land', 'islands'], note: '等高线取决于地形，修改以下参数会改变世界地貌。' },
  plates: { label: '板块构造', groups: ['plates'], shared: ['land', 'islands'], note: '板块变化会更新地形及后续要素。' },
  biomes: { label: '生态群落', groups: [], shared: ['temperature', 'rain', 'moisture', 'water'], note: '生态群落由温度和水分共同决定，可展开相关环境参数调整。' },
  polities: { label: '国家疆域', groups: ['polities'], shared: ['settlements', 'cultures'], note: humanNote },
  cultures: { label: '文化分布', groups: ['cultures'], shared: ['settlements'], note: humanNote },
  religions: { label: '宗教分布', groups: ['religions'], shared: ['settlements', 'cultures'], note: humanNote },
  trade: { label: '贸易网络', groups: ['trade'], shared: ['roads', 'shipping', 'settlements'], note: humanNote },
}

export const LAYER_SETTINGS: Record<LayerKey, ContextSettings> = {
  showRivers: { label: '河流', groups: ['rivers'], shared: ['water', 'lakes', 'rain'], note: waterNote },
  showFlux: { label: '汇流', groups: ['water'], shared: ['rivers', 'lakes', 'rain'], note: waterNote },
  showTemperature: { label: '气温', groups: ['temperature'], shared: ['ocean'], note: climateNote },
  showPrecipitation: { label: '降水', groups: ['rain'], shared: ['moisture', 'wind', 'temperature'], note: climateNote },
  showMoisture: { label: '湿度', groups: ['moisture'], shared: ['rain', 'water'], note: climateNote },
  showSeaSurfaceTemperature: { label: '海温', groups: ['ocean'], shared: ['temperature'], note: climateNote },
  showOceanCurrents: { label: '洋流', groups: ['ocean'], shared: ['wind', 'temperature'], note: climateNote },
  showWind: { label: '风向', groups: ['wind'], shared: ['temperature'], note: climateNote },
  showCoastlines: { label: '海岸线', groups: ['land', 'islands'], shared: ['terrain'], note: '海岸形状取决于世界地形，修改这些参数会更新整个世界。' },
  showPlateBoundaries: { ...THEME_SETTINGS.plates, label: '板块边界' },
  showSettlements: { label: '聚落', groups: ['settlements'], shared: ['water'], note: humanNote },
  showPoliticalBoundaries: { ...THEME_SETTINGS.polities, label: '国界' },
  showCultureBoundaries: { ...THEME_SETTINGS.cultures, label: '文化边界' },
  showReligionBoundaries: { ...THEME_SETTINGS.religions, label: '宗教边界' },
  showHolySites: { ...THEME_SETTINGS.religions, label: '圣地' },
  showRoads: { label: '道路', groups: ['roads'], shared: ['settlements', 'trade'], note: humanNote },
  showShippingRoutes: { label: '航线', groups: ['shipping'], shared: ['settlements', 'trade'], note: humanNote },
  showMapLabels: { label: '地名', groups: [], shared: [], note: '显示已有地名，无独立生成参数。' },
  showGraticule: { label: '经纬网', groups: [], shared: [], note: '用于定位经纬度，无独立生成参数。' },
  wireframe: { label: '网格线框', groups: [], shared: [], note: '网格精度在通用设置中调整。' },
  autoRotate: { label: '自动旋转', groups: [], shared: [], note: '仅在 3D 视图中生效，无独立生成参数。' },
}

export const DISPLAY_MODES = Object.entries(THEME_SETTINGS).map(([key, settings]) => ({ key: key as GlobeDisplayMode, label: settings.label }))
export const ANALYSIS_LAYERS = ['showTemperature', 'showPrecipitation', 'showMoisture', 'showFlux', 'showSeaSurfaceTemperature'] as const
export type AnalysisLayerKey = typeof ANALYSIS_LAYERS[number]
export const LAYER_GROUPS: { label: string, keys: LayerKey[] }[] = [
  { label: '地理', keys: ['showCoastlines', 'showRivers', 'showSettlements', 'showMapLabels'] },
  { label: '交通与边界', keys: ['showRoads', 'showShippingRoutes', 'showPoliticalBoundaries', 'showCultureBoundaries', 'showReligionBoundaries', 'showPlateBoundaries', 'showHolySites'] },
  { label: '流场与辅助', keys: ['showWind', 'showOceanCurrents', 'showGraticule', 'wireframe', 'autoRotate'] },
]

export function getContextSettings(context: SettingsContext): ContextSettings {
  return context.kind === 'theme' ? THEME_SETTINGS[context.key] : LAYER_SETTINGS[context.key]
}
