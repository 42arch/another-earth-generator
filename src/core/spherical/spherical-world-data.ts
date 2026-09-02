import type { SphericalBiomeCode, SphericalClimateData } from '@/core/spherical/climate/climate-data'
import type { SphericalTectonicData } from '@/core/spherical/geology/geology-data'
import type { RegionFeatureCode } from '@/core/spherical/geography/region-feature'
import type { SphericalLakeData, SphericalRiverData } from '@/core/spherical/hydrology/hydrology-data'
import type { SphericalHumanData } from '@/core/spherical/society/society-data'

export * from '@/core/spherical/climate/climate-data'
export * from '@/core/spherical/geology/geology-data'
export * from '@/core/spherical/hydrology/hydrology-data'
export * from '@/core/spherical/society/society-data'

/**
 * Aggregate world payload. Domain-level data contracts live beside their
 * generators; this file intentionally owns only cross-domain composition.
 */
export interface SphericalWorldData {
  baseElevation: Float32Array
  elevation: Float32Array
  /** Authoritative bedrock elevation relative to sea level, in metres. */
  physicalElevationMeters: Float32Array
  /** Scale-aware ocean relief used only for natural terrain coloring. */
  naturalBathymetryMeters: Float32Array
  /** Raw terrain datum selected as zero sea level, in metres. */
  seaLevelMeters: number
  climateElevationMeters: Float32Array
  continentality: Float32Array
  climate: SphericalClimateData
  baseLandMask: Uint8Array
  landMask: Uint8Array
  regionFeature: Uint8Array
  regionFeatureId: Int32Array
  regionContinent: Int16Array
  /** Geological island archetype; zero for oceans and mainland regions. */
  regionIslandType: Uint8Array
  /** Island-group membership, or -1 outside generated island groups. */
  regionIslandGroup: Int16Array
  /** Relative geological age from young (0) to old (1). */
  regionIslandAge: Float32Array
  tectonics: SphericalTectonicData
  lakes: SphericalLakeData
  rivers: SphericalRiverData
  human: SphericalHumanData
  landArea: number
}

export interface SelectedSphericalRegion {
  region: number
  latitude: number
  longitude: number
  elevation: number
  climateElevationMeters: number
  temperature: number
  warmestMonthTemperature: number
  coldestMonthTemperature: number
  annualPrecipitationMm: number
  summerPrecipitationMm: number
  winterPrecipitationMm: number
  precipitationSeasonality: number
  runoff: number
  biome: SphericalBiomeCode
  plate: number
  feature: RegionFeatureCode
}
