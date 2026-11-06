export const CRUST_TYPE = {
  Oceanic: 0,
  Continental: 1,
} as const

export interface SphericalCrustData {
  /** Dominant crust type of each plate. */
  plateCrustType: Uint8Array
  /** Continental surface fraction of each plate, weighted by spherical cell area. */
  plateContinentalFraction: Float32Array
  /** Reference density in g/cm³. */
  plateDensity: Float32Array
  /** Internal dimensionless shaping coordinate, not physical km. */
  plateBaseElevation: Float32Array
  /** km. */
  plateCrustThickness: Float32Array
  /** Cell-scale crust type; candidate continents remain authoritative here. */
  regionCrustType: Uint8Array
  regionDensity: Float32Array
  /** Internal dimensionless shaping coordinate, not physical km. */
  regionBaseElevation: Float32Array
  /** km. */
  regionCrustThickness: Float32Array
}
