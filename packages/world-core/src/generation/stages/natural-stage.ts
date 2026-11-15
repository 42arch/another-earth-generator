import type { GenerationInput, PipelineOptions } from '#generation/pipeline'
import type { HydrologyGenerationConfig } from './hydrology-stage'
import { GenerationPipeline, StageCache } from '#generation/pipeline'
import { createEcologyPipeline, ecologyStage } from './ecology-stage'
import { createHydrologyPipeline } from './hydrology-stage'

export interface NaturalGenerationConfig extends HydrologyGenerationConfig {
  readonly ecology: true
}

/** One DAG owns both water and ecology results for a publishable natural candidate. */
export function createNaturalPipeline(cache = new StageCache()): GenerationPipeline<NaturalGenerationConfig> {
  const hydrology = createHydrologyPipeline(cache)
  const ecology = createEcologyPipeline(cache)
  hydrology.registry.register(ecologyStage)
  return new class extends GenerationPipeline<NaturalGenerationConfig> {
    constructor() { super(hydrology.registry, cache) }
    override plan(input: GenerationInput<NaturalGenerationConfig>, options: Pick<PipelineOptions, 'force'> = {}) {
      hydrology.plan(input, options)
      ecology.plan(input, options)
      return super.plan(input, options)
    }

    override async execute(input: GenerationInput<NaturalGenerationConfig>, options: PipelineOptions = {}) {
      hydrology.plan(input, { force: options.force })
      ecology.plan(input, { force: options.force })
      return super.execute(input, options)
    }
  }()
}
