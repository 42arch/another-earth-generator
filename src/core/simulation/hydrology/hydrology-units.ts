/** The simulation currently uses Earth-sized physical distances independently of display radius. */
export const HYDROLOGY_RADIUS_M = 6_371_000
export const HYDROLOGY_YEAR_SECONDS = 365 * 86_400
/** mm/year × unit-sphere area → m³/s. */
export const RUNOFF_ACCUMULATION_TO_DISCHARGE = HYDROLOGY_RADIUS_M ** 2 / (1000 * HYDROLOGY_YEAR_SECONDS)
