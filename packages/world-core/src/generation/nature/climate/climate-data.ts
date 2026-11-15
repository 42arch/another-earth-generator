/** Four circulation anchors: March equinox, June solstice, September equinox, December solstice. */
export const CLIMATE_SEASON_COUNT = 4
export const ITCZ_LONGITUDE_SAMPLES = 72

export interface ClimateSurfaceData {
  readonly regionCount: number
  readonly landMask: Uint8Array
  /** Area-weighted T0 elevation, km relative to sea level. */
  readonly elevationKm: Float32Array
}

/** Season-major circulation on the reference Mesh. Vector values are model-relative. */
export interface SeasonalCirculationData {
  readonly regionCount: number
  readonly solarDeclination: Float32Array
  readonly itczLatitude: Float32Array
  readonly pressureHpa: Float32Array
  readonly windEast: Float32Array
  readonly windNorth: Float32Array
  readonly monsoonEast: Float32Array
  readonly oceanEast: Float32Array
  readonly oceanNorth: Float32Array
  readonly oceanWarmth: Float32Array
}
