import type { GlobeGenParams } from '@/core/spherical/config'

export const GENERATION_STAGES = ['world', 'elevation', 'hydrology', 'rivers', 'human', 'transport', 'trade', 'cultures', 'polities', 'religions'] as const
export type GenerationStage = typeof GENERATION_STAGES[number]

/** Earliest stage affected; each stage also recomputes its downstream consumers. */
export const PARAMETER_STAGE = {
  seed: 'world',
  subdivision: 'world',
  planetRadius: null,
  physicalRadiusMeters: 'hydrology',
  precipitationCalibration: 'hydrology',
  plateCount: 'world',
  continentCount: 'world',
  landCoverage: 'world',
  sizeVariety: 'world',
  spread: 'world',
  compactness: 'world',
  elongation: 'world',
  coastlineRoughness: 'world',
  islandCount: 'world',
  islandLandShare: 'world',
  islandClustering: 'world',
  islandTectonicBias: 'world',
  mountainStrength: 'elevation',
  noiseStrength: 'elevation',
  equatorTemperature: 'hydrology',
  poleTemperature: 'hydrology',
  latitudeTemperatureExponent: 'hydrology',
  axialTilt: 'hydrology',
  elevationLapseRate: 'hydrology',
  temperatureNoiseStrength: 'hydrology',
  windPerturbation: 'hydrology',
  oceanCurrentStrength: 'hydrology',
  oceanHeatTransport: 'hydrology',
  oceanEvaporation: 'hydrology',
  landEvaporation: 'hydrology',
  moistureIterations: 'hydrology',
  moistureRetention: 'hydrology',
  basePrecipitation: 'hydrology',
  equatorialRainStrength: 'hydrology',
  subtropicalDryness: 'hydrology',
  midlatitudeRainStrength: 'hydrology',
  orographicStrength: 'hydrology',
  evapotranspirationStrength: 'hydrology',
  infiltration: 'hydrology',
  lakeDensity: 'hydrology',
  lakeMinDepthMeters: 'hydrology',
  lakeMinRegionCount: 'hydrology',
  lakeMinCoastDistance: 'hydrology',
  lakeMaxLandCoverage: 'hydrology',
  lakeEvaporationStrength: 'hydrology',
  lakeOverflowThreshold: 'hydrology',
  lakeMinFillRatio: 'hydrology',
  riverBasinThreshold: 'rivers',
  riverMinSourceElevation: 'rivers',
  riverMinLength: 'rivers',
  settlementDensity: 'human',
  cultureCount: 'cultures',
  culturalBlending: 'cultures',
  religionCount: 'religions',
  religiousProselytism: 'religions',
  polityCount: 'polities',
  politicalCohesion: 'polities',
  roadDensity: 'transport',
  shippingRouteDensity: 'transport',
  shippingMaxRange: 'transport',
  shippingCurrentInfluence: 'transport',
  shippingWindInfluence: 'transport',
  shippingOpenOceanRisk: 'transport',
  tradeActivity: 'trade',
  tradeSpecialization: 'trade',
  overseasExpansion: 'polities',
  displayMode: null,
  showGraticule: null,
  showRivers: null,
  showSettlements: null,
  showMapLabels: null,
  showRoads: null,
  showShippingRoutes: null,
  showCultureBoundaries: null,
  showReligionBoundaries: null,
  showHolySites: null,
  showPoliticalBoundaries: null,
  showTemperature: null,
  showMoisture: null,
  showWind: null,
  showOceanCurrents: null,
  showSeaSurfaceTemperature: null,
  showPrecipitation: null,
  showFlux: null,
  showCoastlines: null,
  showPlateBoundaries: null,
  wireframe: null,
  autoRotate: null,
} satisfies Record<keyof GlobeGenParams, GenerationStage | null>

export function mergeGenerationStages(a: GenerationStage | null, b: GenerationStage | null): GenerationStage | null {
  if (a === null)
    return b
  if (b === null)
    return a
  return GENERATION_STAGES.indexOf(a) <= GENERATION_STAGES.indexOf(b) ? a : b
}

export function planGeneration(previous: GlobeGenParams | null, next: GlobeGenParams): GenerationStage | null {
  if (!previous)
    return 'world'
  let stage: GenerationStage | null = null
  for (const key of Object.keys(PARAMETER_STAGE) as (keyof GlobeGenParams)[]) {
    if (previous[key] !== next[key])
      stage = mergeGenerationStages(stage, PARAMETER_STAGE[key])
  }
  return stage
}
