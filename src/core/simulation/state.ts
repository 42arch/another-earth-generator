import type { ClimateData } from '@/core/climate/climate-data'
import type { BiomeData } from '@/core/ecology/biome-data'
import type { TerrainErosionFields } from '@/core/geography/terrain-erosion-processor'
import type { TerrainFinalizationFields } from '@/core/geography/terrain-finalizer'
import type { TerrainTextureFields } from '@/core/geography/terrain-texture-generator'
import type { SphericalTectonicData } from '@/core/geology/geology-data'
import type { TectonicEdificeFields } from '@/core/geology/tectonic-edifice-generator'
import type { TectonicSpatialFields } from '@/core/geology/tectonic-spatial-fields'
import type { TerrainClassificationFields } from '@/core/geology/terrain-classifier'
import type { SurfaceHydrologyData } from '@/core/hydrology/surface-hydrology-generator'
import type { SocietyData } from '@/core/society/society-data'

export interface GeologyData {
  regionPlate: Int16Array
  regionSuperPlate: Int16Array
  tectonics: SphericalTectonicData
  edifices: TectonicEdificeFields
  mantleFlow: Float32Array
  dynamicTopography: Float32Array
}

export interface GeographyData {
  baseElevation: Float32Array
  elevation: Float32Array
  terrainNoise: Float32Array
  terrainTexture: TerrainTextureFields
  terrainFinalization: TerrainFinalizationFields
  terrainErosion: TerrainErosionFields
  landMask: Uint8Array
  candidateLandMask: Uint8Array
  /** Candidate-continent assignment, independent of the final shoreline. */
  continentId: Int16Array
  /** Final visible land assignment; ocean is -1. */
  visibleContinentId: Int16Array
  terrainFields: TectonicSpatialFields
  terrainClassification: TerrainClassificationFields
  landArea?: number
}

export interface WorldSimulationState {
  geology: GeologyData
  geography: GeographyData
  /** Populated after the terrain stage; monthly fields follow in a later stage. */
  climate?: ClimateData
  /** Annual river network routed over the finalized terrain. */
  hydrology?: SurfaceHydrologyData
  /** Climate and elevation-derived terrestrial biome classification. */
  biome?: BiomeData
  /** Residents, settlements, transport, ethnic/language composition, governance, and belief affiliation on the output mesh. */
  society?: SocietyData
}

export interface SelectedWorldRegion {
  region: number
  latitude: number
  longitude: number
  elevation: number
  plate?: number
}
