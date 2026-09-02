export const SPHERICAL_BIOME = {
  Ocean: 0,
  Ice: 1,
  PolarDesert: 2,
  Tundra: 3,
  BorealForest: 4,
  ColdDesert: 5,
  TemperateGrassland: 6,
  TemperateWoodland: 7,
  MediterraneanShrubland: 8,
  TemperateSeasonalForest: 9,
  TemperateRainforest: 10,
  HotDesert: 11,
  XericShrubland: 12,
  TropicalSavanna: 13,
  TropicalDryForest: 14,
  TropicalSeasonalForest: 15,
  TropicalRainforest: 16,
  AlpineTundra: 17,
  MontaneConiferForest: 18,
  MontaneCloudForest: 19,
} as const

export type SphericalBiomeCode
  = (typeof SPHERICAL_BIOME)[keyof typeof SPHERICAL_BIOME]

export const CLIMATE_MONTH_COUNT = 12
export const CLIMATE_SEASON_COUNT = 4

export const SPHERICAL_BIOME_NAME = [
  '海洋', '冰原', '极地荒漠', '苔原', '北方针叶林', '寒冷荒漠', '温带草原',
  '温带疏林', '地中海灌丛', '温带季节林', '温带雨林', '热荒漠', '旱生灌丛',
  '热带稀树草原', '热带干旱林', '热带季节林', '热带雨林', '高山苔原',
  '山地针叶林', '山地云雾林',
] as const

export interface SphericalClimateData {
  /** Mean annual temperature in degrees Celsius. */
  temperature: Float32Array
  /** Month-major temperature normals: month * numRegions + region. */
  monthlyTemperature: Float32Array
  warmestMonthTemperature: Float32Array
  coldestMonthTemperature: Float32Array
  moisture: Float32Array
  precipitation: Float32Array
  annualPrecipitationMm: Float32Array
  /** Representative January, April, July and October three-month totals. */
  seasonalPrecipitationMm: Float32Array
  summerPrecipitationMm: Float32Array
  winterPrecipitationMm: Float32Array
  driestSeasonPrecipitationMm: Float32Array
  wettestSeasonPrecipitationMm: Float32Array
  precipitationSeasonality: Float32Array
  evapotranspiration: Float32Array
  runoff: Float32Array
  seasonalRunoff: Float32Array
  wind: Float32Array
  seasonalWind: Float32Array
  /** Tangential surface-current velocity; magnitude is relative speed. */
  oceanCurrent: Float32Array
  oceanCurrentSpeed: Float32Array
  seaSurfaceTemperature: Float32Array
  seaSurfaceTemperatureAnomaly: Float32Array
  biome: Uint8Array
}
