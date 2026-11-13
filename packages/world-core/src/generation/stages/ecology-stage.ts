import type { ClimateArtifact } from '#generation/nature/climate/climate'
import type { EcologyArtifact, EcologyClimateInput } from '#generation/nature/ecology/ecology'
import type { TerrainArtifact } from '#generation/nature/geography'
import type { GenerationInput, GenerationStage, PipelineOptions, StageExecutionContext } from '#generation/pipeline'
import type { SphericalMesh } from '#mesh/spherical-mesh'
import type { ClimateGenerationConfig } from './climate-stage'
import { generateEcologyE0, validateEcologyArtifact } from '#generation/nature/ecology/ecology'
import { GenerationPipeline, StageCache } from '#generation/pipeline'
import { copyDependency } from '#generation/pipeline/copy-dependency'
import { InvalidStageInputError } from '#generation/pipeline/errors'
import { createClimatePipeline } from './climate-stage'

export interface EcologyGenerationConfig extends ClimateGenerationConfig {
  /** Selects ecology as the requested pipeline target; not an ecological model parameter. */
  readonly ecology: true
}

function orbitalPeriod(context: StageExecutionContext): number {
  const value = context.getConfig('climate.orbitalPeriodDays')
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 300 || value > 430)
    throw new InvalidStageInputError(context.stageId, 'climate.orbitalPeriodDays must be finite in [300, 430]')
  return value
}

export const ecologyStage: GenerationStage<EcologyArtifact> = {
  id: 'ecology-e0',
  version: 'ecology-e0-v3',
  dependencies: ['mesh', 'terrain', 'climate-c0'],
  configKeys: ['climate.orbitalPeriodDays'],
  execute(context) {
    const mesh = copyDependency<SphericalMesh, Pick<SphericalMesh, 'meshId' | 'regionCount' | 'centers'>>(
      context,
      'mesh',
      ({ meshId, regionCount, centers }) => ({ meshId, regionCount, centers }),
    )
    const terrain = copyDependency<TerrainArtifact, Pick<TerrainArtifact, 'meshId' | 'elevationKm' | 'landMask'>>(
      context,
      'terrain',
      ({ meshId, elevationKm, landMask }) => ({ meshId, elevationKm, landMask }),
    )
    const climate = copyDependency<ClimateArtifact, EcologyClimateInput>(
      context,
      'climate-c0',
      ({ meshId, terrainMeshId, monthsPerYear, layout, regionCount, temperatureC, precipitationMm, annualMeanTemperatureC, annualPrecipitationMm, koppenClass }) => ({ meshId, terrainMeshId, monthsPerYear, layout, regionCount, temperatureC, precipitationMm, annualMeanTemperatureC, annualPrecipitationMm, koppenClass }),
    )
    const output = generateEcologyE0(mesh, terrain, climate, orbitalPeriod(context), (fraction) => {
      context.throwIfCancelled()
      context.progress(fraction, '计算自然生物群系与覆盖')
    })
    context.throwIfCancelled()
    context.progress(1)
    return output
  },
  validate: validateEcologyArtifact,
}

class EcologyPipeline extends GenerationPipeline<EcologyGenerationConfig> {
  readonly #climatePipeline: ReturnType<typeof createClimatePipeline>

  constructor(climatePipeline: ReturnType<typeof createClimatePipeline>) {
    super(climatePipeline.registry, climatePipeline.cache)
    this.#climatePipeline = climatePipeline
  }

  override plan(input: GenerationInput<EcologyGenerationConfig>, options: Pick<PipelineOptions, 'force'> = {}) {
    this.#climatePipeline.plan(input, options)
    return super.plan(input, options)
  }

  override async execute(input: GenerationInput<EcologyGenerationConfig>, options: PipelineOptions = {}) {
    this.#climatePipeline.plan(input, { force: options.force })
    return super.execute(input, options)
  }
}

/** Ecology uses preliminary C0 and T0 only; hydrology remains an independent branch. */
export function createEcologyPipeline(cache = new StageCache()): GenerationPipeline<EcologyGenerationConfig> {
  const climatePipeline = createClimatePipeline(cache)
  climatePipeline.registry.register(ecologyStage)
  return new EcologyPipeline(climatePipeline)
}
