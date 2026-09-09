import { LAKE_ICE_STATE } from '@/core/spherical/hydrology/hydrology-data'

/** Monthly area-weighted lake temperatures; open water is approximated at > 0°C. */
export function lakeThermalState(monthlyTemperature: ArrayLike<number>) {
  let openMonths = 0
  let warmest = -Infinity
  let coldest = Infinity
  for (let month = 0; month < monthlyTemperature.length; month++) {
    const temperature = monthlyTemperature[month]
    warmest = Math.max(warmest, temperature)
    coldest = Math.min(coldest, temperature)
    openMonths += temperature > 0 ? 1 : 0
  }
  const iceState = warmest <= 0
    ? LAKE_ICE_STATE.Subglacial
    : coldest <= 0
      ? LAKE_ICE_STATE.SeasonallyFrozen
      : LAKE_ICE_STATE.OpenWater
  return { iceState, openWaterFraction: openMonths / Math.max(1, monthlyTemperature.length) }
}
