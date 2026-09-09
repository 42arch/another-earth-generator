import type { GlobeGenParams } from '@/core/spherical/config'

export type NumericParamKey = {
  [K in keyof GlobeGenParams]: GlobeGenParams[K] extends number ? K : never
}[keyof GlobeGenParams]

export interface ParameterSpec {
  label: string
  min: number
  max: number
  step?: number
  decimals?: number
  unit?: string
  description?: string
}

// One definition per parameter; layer contexts reference these shared keys.
export const PARAMETERS = {
  plateCount: { label: '板块数量', min: 6, max: 48, step: 1, decimals: 0, description: '地壳分裂的板块总数，影响板块碰撞与海沟走向' },
  mountainStrength: { label: '造山强度', min: 0, max: 1, step: 0.01, description: '板块聚合挤压带的地形抬升剧烈程度' },
  noiseStrength: { label: '地表起伏', min: 0, max: 1, step: 0.01, description: '局部地形的起伏程度' },
  continentCount: { label: '大陆数量', min: 1, max: 10, step: 1, decimals: 0, description: '形成大陆的核心陆块数量' },
  landCoverage: { label: '陆地覆盖率', min: 0.1, max: 0.7, step: 0.01, decimals: 0, unit: '%', description: '全球地表面积中陆地的总占比' },
  sizeVariety: { label: '大陆规模差异', min: 0, max: 1, step: 0.01, description: '各大陆面积的离散程度' },
  spread: { label: '陆块分散程度', min: 0, max: 1, step: 0.01, description: '大陆板块在全球分布的分散程度' },
  compactness: { label: '大陆紧凑程度', min: 0, max: 1, step: 0.01, description: '大陆是聚集的整块还是破碎蜿蜒' },
  elongation: { label: '大陆延展程度', min: 0, max: 1, step: 0.01, description: '大陆沿主轴方向的拉伸倾向' },
  coastlineRoughness: { label: '海岸曲折程度', min: 0, max: 1, step: 0.01, description: '海岸线分形曲折与峡湾复杂度' },
  islandCount: { label: '离岸岛屿数', min: 0, max: 60, step: 1, decimals: 0, description: '散布在大洋与大陆架边缘的岛屿数' },
  islandLandShare: { label: '岛屿陆地占比', min: 0, max: 0.25, step: 0.01 },
  islandClustering: { label: '岛屿聚集程度', min: 0, max: 1, step: 0.01, description: '从分散的远洋孤岛过渡到群岛与岛链结构' },
  islandTectonicBias: { label: '构造带岛屿倾向', min: 0, max: 1, step: 0.01, description: '提高火山岛弧沿板块边界生成的倾向' },
  equatorTemperature: { label: '赤道基准温度', min: 20, max: 36, step: 0.5, unit: '°C' },
  poleTemperature: { label: '极地基准温度', min: -35, max: 5, step: 0.5, unit: '°C' },
  axialTilt: { label: '地轴倾角', min: 0, max: 45, step: 0.5, unit: '°', description: '星球自转倾角，决定季节温差幅度' },
  elevationLapseRate: { label: '气温垂直递减率', min: 0, max: 10, step: 0.1, unit: '°C/km' },
  oceanHeatTransport: { label: '洋流输热', min: 0, max: 1.5, step: 0.05 },
  orographicStrength: { label: '地形雨强度', min: 0, max: 2, step: 0.05, description: '迎风坡抬升降水与背风坡雨影效应' },
  subtropicalDryness: { label: '副热带干旱程度', min: 0, max: 0.9, step: 0.05 },
  latitudeTemperatureExponent: { label: '纬度温度曲线', min: 0.5, max: 5, step: 0.1, description: '控制赤道至极地的温度梯度形状' },
  temperatureNoiseStrength: { label: '温度扰动', min: 0, max: 6, step: 0.1, unit: '°C' },
  windPerturbation: { label: '风场扰动', min: 0, max: 0.5, step: 0.01 },
  oceanCurrentStrength: { label: '洋流强度', min: 0, max: 1.5, step: 0.05 },
  oceanEvaporation: { label: '海洋蒸发', min: 0.005, max: 0.1, step: 0.001, decimals: 3 },
  landEvaporation: { label: '陆地蒸发', min: 0, max: 0.03, step: 0.001, decimals: 3 },
  moistureIterations: { label: '水汽输送迭代次数', min: 8, max: 120, step: 1, decimals: 0 },
  moistureRetention: { label: '水汽滞留率', min: 0.8, max: 1, step: 0.005, decimals: 3 },
  basePrecipitation: { label: '基础降水', min: 0, max: 0.05, step: 0.001, decimals: 3 },
  equatorialRainStrength: { label: '赤道辐合降水', min: 0, max: 0.12, step: 0.002, decimals: 3 },
  precipitationCalibration: { label: '降水分布标定', min: 0, max: 1, step: 0.05, description: '0 保留水汽源强变化，1 将降水分布标定到地球式分位数' },
  physicalRadiusMeters: { label: '物理行星半径', min: 1000000, max: 10000000, step: 1000, decimals: 0, unit: 'm', description: '用于物理坡度、湖泊面积与库容计算' },
  midlatitudeRainStrength: { label: '中纬度锋面降水', min: 0, max: 0.06, step: 0.001, decimals: 3 },
  evapotranspirationStrength: { label: '蒸散强度', min: 0, max: 1, step: 0.02 },
  infiltration: { label: '土壤下渗', min: 0, max: 0.6, step: 0.01 },
  lakeDensity: { label: '湖泊密度', min: 0, max: 1, step: 0.05, description: '地表洼地形成湖泊的倾向' },
  lakeMinDepthMeters: { label: '最小湖深', min: 5, max: 400, step: 1, decimals: 0, unit: 'm' },
  lakeMinRegionCount: { label: '最小湖区规模', min: 1, max: 12, step: 1, decimals: 0, description: '过滤仅由极少数网格构成的微型湖泊' },
  lakeMinCoastDistance: { label: '最小离岸距离', min: 0, max: 12, step: 1, decimals: 0, description: '避免近海洼地被过度识别为内陆湖' },
  lakeMaxLandCoverage: { label: '湖泊最大陆地占比', min: 0, max: 0.1, step: 0.005, decimals: 3 },
  lakeEvaporationStrength: { label: '湖泊蒸发强度', min: 0, max: 3, step: 0.05, description: '影响湖水入流蒸发比及咸化演变' },
  lakeOverflowThreshold: { label: '湖泊溢流阈值', min: 0.05, max: 2, step: 0.05, description: '水量超过阈值时，内陆湖更倾向形成出流口' },
  lakeMinFillRatio: { label: '最低蓄水率', min: 0, max: 0.95, step: 0.01 },
  riverBasinThreshold: { label: '干流汇水阈值', min: 0.0005, max: 0.03, step: 0.0005, description: '地表径流汇聚形成显式河流的下限', decimals: 4 },
  riverMinSourceElevation: { label: '河流发源海拔', min: 0.2, max: 0.7, step: 0.01 },
  riverMinLength: { label: '最短河流长度', min: 1, max: 16, step: 1, decimals: 0, description: '过滤短促且缺少流域尺度的小溪段' },
  settlementDensity: { label: '聚落密度', min: 0.15, max: 2.5, step: 0.05, description: '基于宜居度与水源的可繁衍文明聚落数' },
  cultureCount: { label: '文化数量', min: 0, max: 18, step: 1, decimals: 0 },
  culturalBlending: { label: '文化交融程度', min: 0, max: 1, step: 0.05, description: '较高值会让文化过渡区更宽广' },
  polityCount: { label: '国家数量', min: 1, max: 16, step: 1, decimals: 0 },
  politicalCohesion: { label: '国家凝聚力', min: 0, max: 1, step: 0.05, description: '越高越易形成连续、稳定的统治区域' },
  overseasExpansion: { label: '海外扩张倾向', min: 0, max: 1, step: 0.05 },
  religionCount: { label: '宗教数量', min: 0, max: 12, step: 1, decimals: 0 },
  religiousProselytism: { label: '传教扩张程度', min: 0, max: 1.5, step: 0.05 },
  roadDensity: { label: '道路密度', min: 0, max: 1.5, step: 0.05 },
  shippingRouteDensity: { label: '航线密度', min: 0, max: 1.5, step: 0.05 },
  shippingMaxRange: { label: '最大航行距离', min: 0.2, max: 2.5, step: 0.05 },
  shippingCurrentInfluence: { label: '洋流助航影响', min: 0, max: 1.5, step: 0.05 },
  shippingWindInfluence: { label: '风力助航影响', min: 0, max: 1.5, step: 0.05 },
  shippingOpenOceanRisk: { label: '公海风险', min: 0, max: 1, step: 0.05 },
  tradeActivity: { label: '贸易活跃度', min: 0, max: 1.5, step: 0.05 },
  tradeSpecialization: { label: '生产专业化程度', min: 0, max: 1, step: 0.05 },
} satisfies Partial<Record<NumericParamKey, ParameterSpec>>

export type ParameterKey = keyof typeof PARAMETERS
