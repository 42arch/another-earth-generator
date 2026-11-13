import type { GenerationInput, GenerationStage, PipelineResult } from '#generation/pipeline'
import type { SphericalMesh } from '#mesh/spherical-mesh'
import type { PlanetParameters } from '#world/planet-parameters'
import type { WorldMetadata } from '#world/world-metadata'
import { GenerationPipeline, StageCache, StageRegistry } from '#generation/pipeline'
import { InvalidStageInputError } from '#generation/pipeline/errors'
import { createSphericalMesh } from '#mesh/spherical-mesh'
import { validateSphericalMesh } from '#mesh/validation'

/** Pipeline input only. M0.2 snapshot metadata is assembled later, after all generation stages exist. */
export interface WorldGenerationConfig {
  readonly planet: Pick<PlanetParameters, 'physicalRadiusKm'>
  readonly mesh: {
    readonly subdivisionLevel: number
    readonly irregularity: number
    /** Optional override. Without it, the M0.3 jitter receives the world seed verbatim. */
    readonly seed?: string | number
  }
}

export const meshStage: GenerationStage<SphericalMesh> = {
  id: 'mesh',
  version: '1',
  dependencies: [],
  configKeys: ['mesh.subdivisionLevel', 'mesh.irregularity', 'mesh.seed', 'planet.physicalRadiusKm'],
  randomProfile: 'alea-direct-v1',
  randomSeedConfigKey: 'mesh.seed',
  execute(context) {
    const level = context.getConfig('mesh.subdivisionLevel')
    const irregularity = context.getConfig('mesh.irregularity')
    const radius = context.getConfig('planet.physicalRadiusKm')
    const override = context.getConfig('mesh.seed')
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 0 || level > 8)
      throw new InvalidStageInputError('mesh', 'subdivisionLevel must be an integer in [0, 8]')
    if (typeof irregularity !== 'number' || !Number.isFinite(irregularity) || irregularity < 0 || irregularity > 1)
      throw new InvalidStageInputError('mesh', 'irregularity must be in [0, 1]')
    if (typeof radius !== 'number' || !(radius > 0) || !Number.isFinite(4 * Math.PI * radius ** 2))
      throw new InvalidStageInputError('mesh', 'physicalRadiusKm must give a finite positive surface area')
    if (override !== undefined && ((typeof override !== 'string' && typeof override !== 'number') || (typeof override === 'string' && !override.trim()) || (typeof override === 'number' && !Number.isSafeInteger(override))))
      throw new InvalidStageInputError('mesh', 'mesh.seed must be a string or safe integer')
    context.throwIfCancelled()
    return createSphericalMesh({ subdivisionLevel: level, irregularity, physicalRadiusKm: radius, seed: override ?? context.worldSeed, random: context.random })
  },
  validate(output) {
    const result = validateSphericalMesh(output)
    if (!result.valid)
      throw new Error(`Invalid MeshStage output: ${result.issues[0]?.path}: ${result.issues[0]?.message}`)
  },
}

export function createMeshPipeline(cache = new StageCache()): GenerationPipeline<WorldGenerationConfig> {
  return new GenerationPipeline(new StageRegistry().register(meshStage), cache)
}

/** Capture exactly the Mesh input and signature used by a successful M0 Pipeline run. */
export function createMeshGenerationRecord(input: GenerationInput<WorldGenerationConfig>, result: PipelineResult, planet: PlanetParameters, civilizationEnabled: boolean): Pick<WorldMetadata, 'provenance'> & { generationConfig: Pick<WorldMetadata['generationConfig'], 'planet' | 'mesh' | 'regionCount' | 'civilizationEnabled'> } {
  const stage = result.plan.find(item => item.stageId === meshStage.id)
  if (!stage || stage.inputSignature !== createMeshPipeline().plan(input)[0]?.inputSignature || planet.physicalRadiusKm !== input.config.planet.physicalRadiusKm)
    throw new Error('Mesh result and planet configuration do not match')
  const mesh = result.getOutput<SphericalMesh>(meshStage.id)
  return {
    generationConfig: { planet, mesh: { ...input.config.mesh }, regionCount: mesh.regionCount, civilizationEnabled },
    provenance: { stageVersions: { mesh: meshStage.version }, artifactSignatures: { mesh: stage.inputSignature }, configSignature: stage.inputSignature },
  }
}
