/** feat-society Köppen rules adapted to twelve equal-duration year bins. */
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
    annualTemperatureWeighted += temp
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
  const annualTemperature = annualTemperatureWeighted / 12
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
