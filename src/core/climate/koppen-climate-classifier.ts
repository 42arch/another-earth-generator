import type { ClimateData, KoppenClimateData } from '@/core/climate/climate-data'
import type SphericalMesh from '@/core/mesh/mesh'
import type { GeographyData } from '@/core/simulation/state'
import { createOutputClimateRegionSampler } from '@/core/climate/climate-output-projector'
import { MONTH_DAYS } from '@/core/climate/monthly-forcing'

/** Stable IDs are stored as one byte per output region. */
export const KOPPEN_CODES = [
  'Ocean',
  'Af',
  'Am',
  'Aw',
  'As',
  'BWh',
  'BWk',
  'BSh',
  'BSk',
  'Csa',
  'Csb',
  'Csc',
  'Cwa',
  'Cwb',
  'Cwc',
  'Cfa',
  'Cfb',
  'Cfc',
  'Dsa',
  'Dsb',
  'Dsc',
  'Dsd',
  'Dwa',
  'Dwb',
  'Dwc',
  'Dwd',
  'Dfa',
  'Dfb',
  'Dfc',
  'Dfd',
  'ET',
  'EF',
] as const

const CODE_ID: Record<string, number> = Object.fromEntries(KOPPEN_CODES.map((code, id) => [code, id]))

export const KOPPEN_LABELS = [
  '海洋',
  '热带雨林',
  '热带季风',
  '热带冬干稀树草原',
  '热带夏干稀树草原',
  '热沙漠',
  '冷沙漠',
  '热半干旱草原',
  '冷半干旱草原',
  '炎夏地中海',
  '暖夏地中海',
  '凉夏地中海',
  '冬干炎夏温带',
  '冬干暖夏温带',
  '冬干凉夏温带',
  '湿润炎夏温带',
  '温带海洋性',
  '凉夏海洋性',
  '夏干炎夏大陆性',
  '夏干暖夏大陆性',
  '夏干亚寒带',
  '夏干严寒亚寒带',
  '冬干炎夏大陆性',
  '冬干暖夏大陆性',
  '冬干亚寒带',
  '冬干严寒亚寒带',
  '湿润炎夏大陆性',
  '湿润暖夏大陆性',
  '湿润亚寒带',
  '湿润严寒亚寒带',
  '苔原',
  '冰原',
] as const

export const KOPPEN_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [0.05, 0.18, 0.34],
  [0.04, 0.48, 0.28],
  [0.11, 0.63, 0.32],
  [0.64, 0.78, 0.19],
  [0.75, 0.85, 0.39],
  [0.94, 0.39, 0.17],
  [0.77, 0.33, 0.28],
  [0.96, 0.69, 0.26],
  [0.86, 0.63, 0.40],
  [0.95, 0.77, 0.33],
  [0.93, 0.87, 0.48],
  [0.82, 0.85, 0.62],
  [0.29, 0.65, 0.38],
  [0.44, 0.72, 0.48],
  [0.61, 0.80, 0.61],
  [0.18, 0.67, 0.53],
  [0.36, 0.75, 0.65],
  [0.57, 0.81, 0.73],
  [0.70, 0.50, 0.68],
  [0.63, 0.59, 0.76],
  [0.55, 0.66, 0.80],
  [0.44, 0.59, 0.75],
  [0.44, 0.43, 0.72],
  [0.40, 0.51, 0.78],
  [0.34, 0.58, 0.80],
  [0.27, 0.52, 0.72],
  [0.36, 0.38, 0.69],
  [0.31, 0.45, 0.73],
  [0.25, 0.53, 0.74],
  [0.20, 0.45, 0.65],
  [0.67, 0.76, 0.82],
  [0.90, 0.94, 0.96],
]

export function koppenLabel(id: number): string {
  const code = KOPPEN_CODES[id]
  return code ? `${code} · ${KOPPEN_LABELS[id]}` : '未知气候'
}

export function classifyKoppenSeries(temperatureC: ArrayLike<number>, precipitationMm: ArrayLike<number>, southern: boolean): number {
  if (temperatureC.length !== 12 || precipitationMm.length !== 12)
    throw new Error('Köppen classification requires exactly twelve monthly values')
  let annualTemperatureWeighted = 0
  let annualPrecipitation = 0
  let summerPrecipitation = 0
  let winterPrecipitation = 0
  let coldest = Infinity
  let warmest = -Infinity
  let driest = Infinity
  let summerDriest = Infinity
  let summerWettest = 0
  let winterDriest = Infinity
  let winterWettest = 0
  let monthsAbove10 = 0
  for (let month = 0; month < 12; month++) {
    const temp = temperatureC[month]
    const rain = precipitationMm[month]
    if (!Number.isFinite(temp) || !Number.isFinite(rain) || rain < 0)
      throw new Error('Köppen classification received invalid monthly climate data')
    const summer = southern ? month >= 9 || month <= 2 : month >= 3 && month <= 8
    annualTemperatureWeighted += temp * MONTH_DAYS[month]
    annualPrecipitation += rain
    coldest = Math.min(coldest, temp)
    warmest = Math.max(warmest, temp)
    driest = Math.min(driest, rain)
    if (temp > 10)
      monthsAbove10++
    if (summer) {
      summerPrecipitation += rain
      summerDriest = Math.min(summerDriest, rain)
      summerWettest = Math.max(summerWettest, rain)
    }
    else {
      winterPrecipitation += rain
      winterDriest = Math.min(winterDriest, rain)
      winterWettest = Math.max(winterWettest, rain)
    }
  }
  const annualTemperature = annualTemperatureWeighted / 365
  const summerShare = annualPrecipitation > 0 ? summerPrecipitation / annualPrecipitation : 0
  const dryThreshold = Math.max(0, 20 * annualTemperature
    + (summerShare >= 0.7 ? 280 : summerShare >= 0.3 ? 140 : 0))
  // Beck et al. (2018): B takes precedence wherever thermal and dry criteria overlap.
  if (annualPrecipitation < dryThreshold)
    return CODE_ID[`${annualPrecipitation < dryThreshold / 2 ? 'BW' : 'BS'}${annualTemperature >= 18 ? 'h' : 'k'}`]
  if (warmest < 10)
    return CODE_ID[warmest < 0 ? 'EF' : 'ET']
  if (coldest >= 18) {
    if (driest >= 60)
      return CODE_ID.Af
    if (driest >= 100 - annualPrecipitation / 25)
      return CODE_ID.Am
    return CODE_ID[winterDriest <= summerDriest ? 'Aw' : 'As']
  }
  const group = coldest >= 0 ? 'C' : 'D'
  const drySummer = summerDriest < 40 && summerDriest < winterWettest / 3
  const dryWinter = winterDriest < summerWettest / 10
  const moisture = drySummer && dryWinter
    ? (winterPrecipitation > summerPrecipitation ? 's' : 'w')
    : drySummer ? 's' : dryWinter ? 'w' : 'f'
  const thermal = warmest >= 22
    ? 'a'
    : monthsAbove10 >= 4
      ? 'b'
      : group === 'D' && coldest < -38 ? 'd' : 'c'
  return CODE_ID[`${group}${moisture}${thermal}`]
}

/** Classify the final output grid; high detail samples each cell's twelve values in place. */
export function classifyOutputKoppen(
  outputMesh: SphericalMesh,
  climateMesh: SphericalMesh,
  geography: GeographyData,
  climate: ClimateData,
  axialTiltDeg: number,
): KoppenClimateData {
  const count = outputMesh.numRegions
  const climateClass = new Uint8Array(count)
  const annualTemperatureC = new Float32Array(count)
  const annualPrecipitationMm = new Float32Array(count)
  const sample = createOutputClimateRegionSampler(climate, geography, axialTiltDeg, climateMesh)
  const temperature = new Float32Array(12)
  const precipitation = new Float32Array(12)
  const sampleTarget = { temperatureC: 0, precipitationMm: 0 }
  for (let region = 0; region < count; region++) {
    if (!geography.landMask[region])
      continue
    let weightedTemperature = 0
    let annualRain = 0
    for (let month = 0; month < 12; month++) {
      const fields = sample(region, month, sampleTarget)
      temperature[month] = fields.temperatureC
      precipitation[month] = fields.precipitationMm
      weightedTemperature += fields.temperatureC * MONTH_DAYS[month]
      annualRain += fields.precipitationMm
    }
    annualTemperatureC[region] = weightedTemperature / 365
    annualPrecipitationMm[region] = annualRain
    climateClass[region] = classifyKoppenSeries(temperature, precipitation, outputMesh.regionLatitude[region] < 0)
  }
  return { climateClass, annualTemperatureC, annualPrecipitationMm }
}
