export const MIN_DETAIL = 5000
export const MAX_DETAIL = 2560000
export const DETAIL_SLIDER_STEPS = 1000

const DETAIL_POWER = 5
const DETAIL_RANGE = MAX_DETAIL - MIN_DETAIL

/** Matches World Orogen's fifth-power detail slider. */
export function detailFromSlider(position: number): number {
  const t = Math.max(0, Math.min(1, position / DETAIL_SLIDER_STEPS))
  return Math.round((MIN_DETAIL + DETAIL_RANGE * t ** DETAIL_POWER) / 1000) * 1000
}

export function sliderFromDetail(detail: number): number {
  const normalized = Math.max(0, Math.min(1, (detail - MIN_DETAIL) / DETAIL_RANGE))
  return Math.round(DETAIL_SLIDER_STEPS * normalized ** (1 / DETAIL_POWER))
}
