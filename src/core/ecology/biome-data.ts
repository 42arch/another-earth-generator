export const BIOME_CODES = [
  'Ocean',
  'TropicalRainforest',
  'TropicalSeasonalForest',
  'Savanna',
  'HotDesert',
  'ColdDesert',
  'Steppe',
  'MediterraneanShrubland',
  'TemperateGrassland',
  'TemperateSeasonalForest',
  'TemperateRainforest',
  'BorealForest',
  'Tundra',
  'IceSheet',
  'AlpineTundra',
] as const

export type BiomeCode = typeof BIOME_CODES[number]

export const BIOME_LABELS = [
  '海洋',
  '热带雨林',
  '热带季节林',
  '稀树草原',
  '热沙漠',
  '冷沙漠',
  '半干旱草原',
  '地中海灌丛',
  '温带草原',
  '温带季节林',
  '温带雨林',
  '针叶林',
  '苔原',
  '冰原',
  '高山苔原',
] as const

export function biomeLabel(id: number): string {
  return BIOME_LABELS[id] ?? '未知群系'
}

/** Linear RGB colors indexed by BIOME_CODES. */
export const BIOME_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [0.035, 0.12, 0.28],
  [0.05, 0.42, 0.18],
  [0.12, 0.58, 0.22],
  [0.68, 0.66, 0.22],
  [0.83, 0.48, 0.22],
  [0.65, 0.48, 0.42],
  [0.72, 0.68, 0.40],
  [0.68, 0.58, 0.28],
  [0.48, 0.62, 0.32],
  [0.18, 0.48, 0.28],
  [0.16, 0.60, 0.48],
  [0.20, 0.42, 0.50],
  [0.56, 0.68, 0.72],
  [0.90, 0.94, 0.96],
  [0.73, 0.82, 0.78],
]

export interface BiomeData {
  /** Stable BIOME_CODES ID for each final output region. */
  biomeClass: Uint8Array
  /** Calendar-day weighted annual mean, degrees Celsius. */
  annualTemperatureC: Float32Array
  /** Annual total, millimetres. */
  annualPrecipitationMm: Float32Array
  /** Annual precipitation divided by temperature-based potential evapotranspiration. */
  aridityIndex: Float32Array
  /** Months with mean temperature above 5 °C. */
  growingSeasonMonths: Uint8Array
}
