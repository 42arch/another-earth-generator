import type { ClimateArtifact } from '#generation/nature/climate/climate'
import type { TerrainArtifact } from '#generation/nature/geography'
import type { CryosphereArtifact, HydrologyArtifact, HydrologyParameters } from '#generation/nature/hydrology/hydrology'
import type { StaticLakeArtifact } from '#generation/nature/hydrology/lakes'
import type { GenerationInput, GenerationStage, PipelineOptions, StageExecutionContext } from '#generation/pipeline'
import type { SphericalMesh } from '#mesh/spherical-mesh'
import type { ClimateGenerationConfig } from './climate-stage'
import { generateCryosphereI0, generateHydrologyH0, validateCryosphereArtifact, validateHydrologyArtifact } from '#generation/nature/hydrology/hydrology'
import { generateStaticLakesL1, validateStaticLakeArtifact } from '#generation/nature/hydrology/lakes'
import { GenerationPipeline, StageCache } from '#generation/pipeline'
import { copyDependency } from '#generation/pipeline/copy-dependency'
import { InvalidStageInputError } from '#generation/pipeline/errors'
import { createClimatePipeline } from './climate-stage'

export interface HydrologyGenerationConfig extends ClimateGenerationConfig {
  readonly hydrology: HydrologyParameters
}

function configNumber(context: StageExecutionContext, key: string, min: number, max: number): number {
  const value = context.getConfig(key)
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new InvalidStageInputError(context.stageId, `${key} must be finite in [${min}, ${max}]`)
  return value
}

const cryosphereStage: GenerationStage<CryosphereArtifact> = {
  id: 'cryosphere-i0',
  version: 'cryosphere-i0-v1',
  dependencies: ['mesh', 'terrain', 'climate-c0'],
  configKeys: ['hydrology.snowTemperatureMinC', 'hydrology.snowTemperatureMaxC', 'hydrology.degreeDayMeltFactorMmPerCMonth'],
  execute(context) {
    const mesh = copyDependency<SphericalMesh>(context, 'mesh')
    const terrain = copyDependency<TerrainArtifact, Pick<TerrainArtifact, 'meshId' | 'landMask'>>(context, 'terrain', ({ meshId, landMask }) => ({ meshId, landMask }))
    const climate = copyDependency<ClimateArtifact, Pick<ClimateArtifact, 'meshId' | 'regionCount' | 'temperatureC' | 'precipitationMm'>>(context, 'climate-c0', ({ meshId, regionCount, temperatureC, precipitationMm }) => ({ meshId, regionCount, temperatureC, precipitationMm }))
    const parameters: Pick<HydrologyParameters, 'snowTemperatureMinC' | 'snowTemperatureMaxC' | 'degreeDayMeltFactorMmPerCMonth'> = {
      snowTemperatureMinC: configNumber(context, 'hydrology.snowTemperatureMinC', -20, 0),
      snowTemperatureMaxC: configNumber(context, 'hydrology.snowTemperatureMaxC', 0, 20),
      degreeDayMeltFactorMmPerCMonth: configNumber(context, 'hydrology.degreeDayMeltFactorMmPerCMonth', 0, 100),
    }
    if (parameters.snowTemperatureMinC >= parameters.snowTemperatureMaxC)
      throw new InvalidStageInputError(context.stageId, 'snowTemperatureMinC must be less than snowTemperatureMaxC')
    const output = generateCryosphereI0(mesh, terrain, climate, parameters, (fraction) => {
      context.throwIfCancelled()
      context.progress(fraction, '计算积雪与融雪')
    })
    context.throwIfCancelled()
    context.progress(1)
    return output
  },
  validate: validateCryosphereArtifact,
}

const hydrologyStage: GenerationStage<HydrologyArtifact> = {
  id: 'hydrology-h0',
  version: 'hydrology-h0-v2',
  dependencies: ['mesh', 'terrain', 'climate-c0', 'cryosphere-i0'],
  configKeys: ['hydrology.evapotranspirationFactorMmPerCMonth', 'hydrology.minimumRiverDrainageAreaKm2', 'climate.orbitalPeriodDays'],
  execute(context) {
    const mesh = copyDependency<SphericalMesh>(context, 'mesh')
    const terrain = copyDependency<TerrainArtifact, Pick<TerrainArtifact, 'meshId' | 'elevationKm' | 'landMask'>>(context, 'terrain', ({ meshId, elevationKm, landMask }) => ({ meshId, elevationKm, landMask }))
    const climate = copyDependency<ClimateArtifact, Pick<ClimateArtifact, 'meshId' | 'regionCount' | 'temperatureC' | 'precipitationMm'>>(context, 'climate-c0', ({ meshId, regionCount, temperatureC, precipitationMm }) => ({ meshId, regionCount, temperatureC, precipitationMm }))
    const cryosphere = copyDependency<CryosphereArtifact>(context, 'cryosphere-i0')
    const output = generateHydrologyH0(mesh, terrain, climate, cryosphere, {
      evapotranspirationFactorMmPerCMonth: configNumber(context, 'hydrology.evapotranspirationFactorMmPerCMonth', 0, 100),
      minimumRiverDrainageAreaKm2: configNumber(context, 'hydrology.minimumRiverDrainageAreaKm2', 0, 1e9),
      orbitalPeriodDays: configNumber(context, 'climate.orbitalPeriodDays', 1, 1e6),
    }, (fraction) => {
      context.throwIfCancelled()
      context.progress(fraction)
    })
    context.throwIfCancelled()
    context.progress(1)
    return output
  },
  validate: validateHydrologyArtifact,
}

const staticLakesStage: GenerationStage<StaticLakeArtifact> = {
  id: 'static-lakes-l1',
  version: 'static-lakes-l1-v4',
  dependencies: ['mesh', 'terrain', 'hydrology-h0'],
  configKeys: [],
  execute(context) {
    const mesh = copyDependency<SphericalMesh>(context, 'mesh')
    const terrain = copyDependency<TerrainArtifact, Pick<TerrainArtifact, 'meshId' | 'elevationKm' | 'landMask'>>(context, 'terrain', ({ meshId, elevationKm, landMask }) => ({ meshId, elevationKm, landMask }))
    const hydrology = copyDependency<HydrologyArtifact>(context, 'hydrology-h0')
    const output = generateStaticLakesL1(mesh, terrain, hydrology, (fraction) => {
      context.throwIfCancelled()
      context.progress(fraction, '识别静态湖泊')
    })
    context.throwIfCancelled()
    context.progress(1)
    return output
  },
  validate: validateStaticLakeArtifact,
}

class HydrologyPipeline extends GenerationPipeline<HydrologyGenerationConfig> {
  readonly #climatePipeline: GenerationPipeline<ClimateGenerationConfig>
  constructor(registry: ReturnType<typeof createClimatePipeline>['registry'], cache: StageCache, climatePipeline: GenerationPipeline<ClimateGenerationConfig>) {
    super(registry, cache)
    this.#climatePipeline = climatePipeline
  }

  #validateInput(input: GenerationInput<HydrologyGenerationConfig>): void {
    const p = input.config.hydrology
    if (!p || !Number.isFinite(p.snowTemperatureMinC) || !Number.isFinite(p.snowTemperatureMaxC) || p.snowTemperatureMinC >= p.snowTemperatureMaxC
      || !Number.isFinite(p.degreeDayMeltFactorMmPerCMonth) || p.degreeDayMeltFactorMmPerCMonth < 0
      || !Number.isFinite(p.evapotranspirationFactorMmPerCMonth) || p.evapotranspirationFactorMmPerCMonth < 0
      || !Number.isFinite(p.minimumRiverDrainageAreaKm2) || p.minimumRiverDrainageAreaKm2 < 0) {
      throw new InvalidStageInputError('hydrology-h0', 'Invalid hydrology parameters')
    }
    // Reuse existing T0/C0 input rules, including obsolete terrain options and Earthlike bounds.
    this.#climatePipeline.plan(input)
  }

  override plan(input: GenerationInput<HydrologyGenerationConfig>, options: Pick<PipelineOptions, 'force'> = {}) {
    this.#validateInput(input)
    return super.plan(input, options)
  }

  override async execute(input: GenerationInput<HydrologyGenerationConfig>, options: PipelineOptions = {}) {
    this.#validateInput(input)
    return super.execute(input, options)
  }
}

/** Preliminary snow and annual runoff pipeline; it does not publish a WorldSnapshot. */
export function createHydrologyPipeline(cache = new StageCache()): GenerationPipeline<HydrologyGenerationConfig> {
  const climatePipeline = createClimatePipeline(cache)
  const registry = climatePipeline.registry
  registry.register(cryosphereStage).register(hydrologyStage).register(staticLakesStage)
  return new HydrologyPipeline(registry, cache, climatePipeline)
}
