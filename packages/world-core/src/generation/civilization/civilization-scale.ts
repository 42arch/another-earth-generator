import type { PolitySizeClass } from './civilization-types'

// Preserve the L6 Earthlike calibration as physical units, independent of mesh.
export const SETTLEMENT_SUPPORT_AREA_KM2 = (4 * Math.PI * 6371 ** 2) / (10 * 4 ** 6 + 2)
export const REFERENCE_TRAVEL_KM_PER_DAY = Math.max(25, Math.sqrt(SETTLEMENT_SUPPORT_AREA_KM2) * 0.45)

/** Physical territory size; sparse settlement never turns a large country into a city-state. */
export function classifyPolitySize(areaKm2: number, populationShare: number): PolitySizeClass {
  const equivalentRegions = areaKm2 / SETTLEMENT_SUPPORT_AREA_KM2
  if (equivalentRegions <= 3)
    return 'city-state'
  if (populationShare >= 0.25 && equivalentRegions >= 18)
    return 'empire'
  return equivalentRegions >= 8 ? 'kingdom' : 'regional'
}
