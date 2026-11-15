/** Temperature-index estimate for one equal-duration climate bin. */
export function estimatePotentialEvapotranspirationMm(temperatureC: number, days: number): number {
  return days * 0.015 * Math.max(0, temperatureC + 5) ** 1.45
}
