import type { CivilizationData } from '@/core/simulation/civilization/civilization-data'
import type { ClimateData } from '@/core/simulation/climate/climate-data'
import type { BiomeData } from '@/core/simulation/ecology/biome-data'
import type { TerrainErosionFields } from '@/core/simulation/geography/terrain-erosion-processor'
import type { TerrainFinalizationFields } from '@/core/simulation/geography/terrain-finalizer'
import type { TerrainTextureFields } from '@/core/simulation/geography/terrain-texture-generator'
import type { SphericalTectonicData } from '@/core/simulation/geology/geology-data'
import type { TectonicEdificeFields } from '@/core/simulation/geology/tectonic-edifice-generator'
import type { TectonicSpatialFields } from '@/core/simulation/geology/tectonic-spatial-fields'
import type { TerrainClassificationFields } from '@/core/simulation/geology/terrain-classifier'
import type { SurfaceHydrologyData } from '@/core/simulation/hydrology/surface-hydrology-generator'

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
  civilization?: CivilizationData
}

export interface SelectedWorldRegion {
  region: number
  latitude: number
  longitude: number
  elevation: number
  plate?: number
}
