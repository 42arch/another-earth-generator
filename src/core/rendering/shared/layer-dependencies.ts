import type { GenerationStage } from '@/core/world/generation-plan'
import { GENERATION_STAGES } from '@/core/world/generation-plan'

const LAYER_STAGE: Record<string, GenerationStage> = {
  coastlines: 'hydrology', contours: 'hydrology', plates: 'elevation', showPlateBoundaries: 'elevation',
  showTemperature: 'hydrology', showMoisture: 'hydrology', showPrecipitation: 'hydrology',
  showWind: 'hydrology', showOceanCurrents: 'hydrology', showSeaSurfaceTemperature: 'hydrology',
  rivers: 'rivers', showFlux: 'rivers', settlements: 'human', roads: 'transport', shipping: 'transport',
  trade: 'trade', cultures: 'cultures', showCultureBoundaries: 'cultures',
  polities: 'polities', showPoliticalBoundaries: 'polities',
  religions: 'religions', showReligionBoundaries: 'religions', holySites: 'religions',
}

export function isLayerAffected(key: string, stage: GenerationStage): boolean {
  const dependency = LAYER_STAGE[key]
  return dependency !== undefined
    && GENERATION_STAGES.indexOf(stage) <= GENERATION_STAGES.indexOf(dependency)
}
