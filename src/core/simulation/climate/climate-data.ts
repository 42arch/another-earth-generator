/** March equinox, June solstice, September equinox, December solstice. */
export const CLIMATE_SEASON_COUNT = 4
export const CLIMATE_MONTH_COUNT = 12
export const ITCZ_LONGITUDE_SAMPLES = 72

export interface ClimateSurfaceData {
  /** Same mesh as circulation: output mesh up to 20,000 regions, reference mesh above it. */
  regionCount: number
  /** Finalized land classification on the climate mesh. */
  landMask: Uint8Array
  /** Area-weighted finalized terrain elevation, in kilometres. */
  elevationKm: Float32Array
}

/**
 * Continuous fields use season-major layout: season * regionCount + region.
 * East and north components are tangent to the Y-up sphere. Wind and current
 * components are relative transport strengths; pressure is a model field in hPa
 * with a mild elevation correction.
 */
export interface SeasonalCirculationData {
  regionCount: number
  /** Radians, ordered from the March equinox. */
  solarDeclination: Float32Array
  /** season * ITCZ_LONGITUDE_SAMPLES + longitude bin, in radians. */
  itczLatitude: Float32Array
  pressureHpa: Float32Array
  windEast: Float32Array
  windNorth: Float32Array
  /** Signed eastward surface-monsoon flow near continental east coasts. */
  monsoonEast: Float32Array
  oceanEast: Float32Array
  oceanNorth: Float32Array
  /** Signed sea-surface thermal anomaly proxy in [-1, 1]; zero on land. */
  oceanWarmth: Float32Array
}

/** Twelve monthly solutions; month 0 is January. */
export interface MonthlyClimateData {
  regionCount: number
  /** month * regionCount + region; degrees Celsius. */
  temperatureC: Float32Array
  /** month * regionCount + region; millimetres per calendar month. */
  precipitationMm: Float32Array
}

/** One month's relative east/north transport on the output grid. */
export interface ClimateVectorDisplayData {
  month: number
  kind: 'wind' | 'ocean-current'
  east: Float32Array
  north: Float32Array
  /** Signed sea-surface thermal anomaly proxy on output cells; present for ocean currents. */
  warmth?: Float32Array
}

/** Three nearby climate cells for each output cell, with weights divided by 65535. */
export interface ClimateOutputProjectionData {
  outputRegionCount: number
  climateRegionCount: number
  sourceRegion: Uint16Array
  sourceWeight: Uint16Array
  sourceGradientEast: Float32Array
  sourceGradientNorth: Float32Array
  outputGradientEast: Float32Array
  outputGradientNorth: Float32Array
  /** Conservation factors for each projected calendar month. */
  globalRainScale: Float64Array
  landRainScale: Float64Array
}

export interface KoppenClimateData {
  /** One Köppen–Geiger class per final output region; zero denotes ocean. */
  climateClass: Uint8Array
  /** Calendar-day weighted annual mean, degrees Celsius. */
  annualTemperatureC: Float32Array
  /** Annual total, millimetres. */
  annualPrecipitationMm: Float32Array
}

export interface ClimateData {
  /** Fields are stored on the climate mesh (up to 20,000 regions). */
  surface: ClimateSurfaceData
  circulation: SeasonalCirculationData
  /** Filled by MonthlyClimateStage after the four circulation anchors. */
  monthly?: MonthlyClimateData
  /** Present when output detail exceeds the climate mesh resolution. */
  outputProjection?: ClimateOutputProjectionData
  /** Materialized for output meshes up to the default 204,000-region scale. */
  outputMonthly?: MonthlyClimateData
  /** One projected month held on the main thread for visualization. */
  displayMonth?: { month: number, temperatureC: Float32Array, precipitationMm: Float32Array }
  displayVector?: ClimateVectorDisplayData
  koppen?: KoppenClimateData
}
