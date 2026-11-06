import type { ClimateArtifact, ClimateParameters } from '#generation/nature/climate/climate'
import type { TerrainArtifact } from '#generation/nature/geography'
import type { GeologyArtifact } from '#generation/nature/geology'
import type { GenerationInput, GenerationStage, PipelineOptions, StageExecutionContext } from '#generation/pipeline'
import type { SphericalMesh } from '#mesh/spherical-mesh'
import type { TerrainGenerationConfig } from './terrain-stage'
import { aggregateClimateSurface, generateClimateC0, projectClimateC0, validateClimateArtifact } from '#generation/nature/climate/climate'
import { GenerationPipeline, StageCache } from '#generation/pipeline'
import { copyDependency } from '#generation/pipeline/copy-dependency'
import { InvalidStageInputError } from '#generation/pipeline/errors'
import { assertNoObsoleteTerrainOptions, createTerrainPipeline } from './terrain-stage'

export interface ClimateGenerationConfig extends TerrainGenerationConfig {
  readonly climate: ClimateParameters
}

function configNumber(context: StageExecutionContext, key: string, min: number, max: number): number {
  const value = context.getConfig(key)
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new InvalidStageInputError(context.stageId, `${key} must be finite in [${min}, ${max}]`)
  return value
}

const climateStage: GenerationStage<ClimateArtifact> = {
  id: 'climate-c0',
  version: 'climate-c0-v2',
  dependencies: ['mesh', 'reference-mesh', 'geology', 'terrain'],
  configKeys: ['climate.rotationPeriodHours', 'climate.axialTiltDegrees', 'climate.orbitalPeriodDays', 'climate.temperatureOffsetC', 'climate.precipitationScale'],
  execute(context) {
    const parameters: ClimateParameters = {
      rotationPeriodHours: configNumber(context, 'climate.rotationPeriodHours', 24, 24),
      axialTiltDegrees: configNumber(context, 'climate.axialTiltDegrees', 0, 45),
      orbitalPeriodDays: configNumber(context, 'climate.orbitalPeriodDays', 300, 430),
      temperatureOffsetC: configNumber(context, 'climate.temperatureOffsetC', -20, 20),
      precipitationScale: configNumber(context, 'climate.precipitationScale', 0, 3),
    }
    const mesh = copyDependency<SphericalMesh>(context, 'mesh')
    const reference = copyDependency<SphericalMesh>(context, 'reference-mesh')
    const mapping = copyDependency<GeologyArtifact, Pick<GeologyArtifact, 'meshId' | 'referenceMeshId' | 'geographicReference'>>(context, 'geology', ({ meshId, referenceMeshId, geographicReference }) => ({ meshId, referenceMeshId, geographicReference }))
    const terrain = copyDependency<TerrainArtifact, Pick<TerrainArtifact, 'meshId' | 'elevationKm' | 'landMask'>>(context, 'terrain', ({ meshId, elevationKm, landMask }) => ({ meshId, elevationKm, landMask }))
    if (mapping.meshId !== mesh.meshId || mapping.referenceMeshId !== reference.meshId)
      throw new Error('Climate reference mapping mesh mismatch')
    const surface = aggregateClimateSurface(mesh, reference, terrain, mapping.geographicReference)
    const source = generateClimateC0(reference, surface, parameters, (fraction) => {
      context.throwIfCancelled()
      context.progress(fraction * 0.65)
    }, context.random)
    return projectClimateC0(mesh, reference, terrain, surface, source, mapping.geographicReference, (fraction) => {
      context.throwIfCancelled()
      context.progress(0.65 + fraction * 0.35)
    })
  },
  validate: validateClimateArtifact,
}

class ClimatePipeline extends GenerationPipeline<ClimateGenerationConfig> {
  private validateInput(input: GenerationInput<ClimateGenerationConfig>): void {
    assertNoObsoleteTerrainOptions(input)
    const c = input.config.climate
    if (input.config.planet.physicalRadiusKm !== 6371)
      throw new InvalidStageInputError('climate-c0', 'Earthlike C0 currently requires a 6371 km radius')
    for (const [key, min, max] of [['rotationPeriodHours', 24, 24], ['axialTiltDegrees', 0, 45], ['orbitalPeriodDays', 300, 430], ['temperatureOffsetC', -20, 20], ['precipitationScale', 0, 3]] as const) {
      const value = c?.[key]
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
        throw new InvalidStageInputError('climate-c0', `climate.${key} must be finite in [${min}, ${max}]`)
    }
  }

  override plan(input: GenerationInput<ClimateGenerationConfig>, options: Pick<PipelineOptions, 'force'> = {}) {
    this.validateInput(input)
    return super.plan(input, options)
  }

  override async execute(input: GenerationInput<ClimateGenerationConfig>, options: PipelineOptions = {}) {
    this.validateInput(input)
    return super.execute(input, options)
  }
}

/** C0 only; final climate after erosion must use a distinct stage identity. */
export function createClimatePipeline(cache = new StageCache()): GenerationPipeline<ClimateGenerationConfig> {
  const registry = createTerrainPipeline(cache).registry
  registry.register(climateStage)
  return new ClimatePipeline(registry, cache)
}
