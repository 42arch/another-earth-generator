import type { SphericalMesh } from '#mesh/spherical-mesh'
import type { AlgorithmMeshInput } from '#generation/nature/common'
import type { CandidateLandData, GeologyArtifact, SphericalCrustData, SphericalPlateData, SuperPlateTopologyData } from '#generation/nature/geology'
import type { WorldGenerationConfig } from './mesh-stage'
import type { GenerationStage, StageExecutionContext } from '#generation/pipeline'
import { createNoise3D } from 'simplex-noise'
import { stableHash } from '#math/random'
import { SphericalSpatialIndex } from '#mesh/spatial-index'
import { createSphericalMesh } from '#mesh/spherical-mesh'
import { validateSphericalMesh } from '#mesh/validation'
import { algorithmMesh, randomFunction, selectAlgorithmMeshInput } from '#generation/nature/common'
import { CandidateLandGenerator, PlatePropertiesGenerator, SphericalPlateGenerator, SuperPlateGenerator, validateGeologyArtifact } from '#generation/nature/geology'
import { copyDependency } from '#generation/pipeline/copy-dependency'
import { InvalidStageInputError } from '#generation/pipeline/errors'
import { meshStage } from './mesh-stage'
import { GenerationPipeline, StageCache, StageRegistry } from '#generation/pipeline'

export interface GeologyParameters {
  readonly primaryPlateCount: number
  readonly microPlateCount: number
  readonly plateSizeVariety: number
  readonly continentCount: number
  readonly continentSizeVariety: number
  /** Candidate area target; not the final terrain land fraction. */
  readonly candidateLandCoverage: number
}
export const DEFAULT_GEOLOGY_PARAMETERS: GeologyParameters = Object.freeze({ primaryPlateCount: 10, microPlateCount: 14, plateSizeVariety: 0.8, continentCount: 7, continentSizeVariety: 0.35, candidateLandCoverage: 0.3 })
export interface GeologyGenerationConfig extends WorldGenerationConfig {
  readonly geology: GeologyParameters
  /** Default L6. Lower levels (L2+) are useful for small regression fixtures. */
  readonly reference?: { readonly subdivisionLevel: number }
}
export const REFERENCE_SUBDIVISION_COUNT = 100
const VERSION = 'geology-v2'
export interface PlateTopologyArtifact { readonly meshId: string, readonly subdivisions: SphericalPlateData, readonly topology: SuperPlateTopologyData }
export interface CrustArtifact { readonly regionCount: number, readonly meshId: string, readonly land: CandidateLandData, readonly crust: SphericalCrustData }
interface MappingArtifact { readonly sourceRegionCount: number, readonly regionCount: number, readonly sourceMeshId: string, readonly meshId: string, readonly geographic: Uint32Array, readonly geological: Uint32Array }

function parameter(context: StageExecutionContext, key: string, min: number, max: number, integer = false): number {
  const value = context.getConfig(key)
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)))
    throw new InvalidStageInputError(context.stageId, `${key} must be ${integer ? 'an integer' : 'finite'} in [${min}, ${max}]`)
  return value
}
function validateMesh(mesh: SphericalMesh): void {
  const result = validateSphericalMesh(mesh)
  if (!result.valid)
    throw new Error(`Invalid reference mesh: ${result.issues[0]?.message}`)
}

const referenceMeshStage: GenerationStage<SphericalMesh> = {
  id: 'reference-mesh',
  version: VERSION,
  dependencies: [],
  configKeys: ['reference.subdivisionLevel', 'mesh.irregularity', 'mesh.seed', 'planet.physicalRadiusKm'],
  execute(context) {
    const rawLevel = context.getConfig('reference.subdivisionLevel')
    const level = rawLevel === undefined ? 6 : parameter(context, 'reference.subdivisionLevel', 2, 6, true)
    const irregularity = parameter(context, 'mesh.irregularity', 0, 1)
    const radius = parameter(context, 'planet.physicalRadiusKm', Number.MIN_VALUE, Math.sqrt(Number.MAX_VALUE / (4 * Math.PI)))
    const seed = context.getConfig('mesh.seed') ?? context.worldSeed
    if ((typeof seed !== 'string' && typeof seed !== 'number') || !String(seed).trim() || (typeof seed === 'number' && !Number.isSafeInteger(seed)))
      throw new InvalidStageInputError(context.stageId, 'Invalid mesh seed')
    return createSphericalMesh({ subdivisionLevel: level, irregularity, physicalRadiusKm: radius, seed })
  },
  validate: validateMesh,
}
const subdivisionStage: GenerationStage<SphericalPlateData> = {
  id: 'reference-subdivisions',
  version: VERSION,
  dependencies: ['reference-mesh'],
  configKeys: [],
  execute(context) {
    return new SphericalPlateGenerator().generate(algorithmMesh(copyDependency<SphericalMesh, AlgorithmMeshInput>(context, 'reference-mesh', selectAlgorithmMeshInput)), REFERENCE_SUBDIVISION_COUNT, context.random)
  },
  validate(output) {
    if (output.plateSeeds.length !== REFERENCE_SUBDIVISION_COUNT || new Set(output.plateSeeds).size !== REFERENCE_SUBDIVISION_COUNT || !output.plateSeeds.every(r => r < output.regionPlate.length) || !output.regionPlate.every(p => p >= 0 && p < REFERENCE_SUBDIVISION_COUNT) || output.plateAngularVelocity.length !== REFERENCE_SUBDIVISION_COUNT * 3 || !output.plateAngularVelocity.every(Number.isFinite))
      throw new Error('Invalid reference subdivisions')
  },
}
const topologyStage: GenerationStage<PlateTopologyArtifact> = {
  id: 'plate-topology',
  version: VERSION,
  dependencies: ['reference-mesh', 'reference-subdivisions'],
  configKeys: ['geology.primaryPlateCount', 'geology.microPlateCount', 'geology.plateSizeVariety'],
  execute(context) {
    const mesh = copyDependency<SphericalMesh, AlgorithmMeshInput>(context, 'reference-mesh', selectAlgorithmMeshInput)
    const subdivisions = copyDependency<SphericalPlateData>(context, 'reference-subdivisions')
    const primary = parameter(context, 'geology.primaryPlateCount', 2, REFERENCE_SUBDIVISION_COUNT, true)
    const micro = parameter(context, 'geology.microPlateCount', 0, REFERENCE_SUBDIVISION_COUNT - primary, true)
    const variety = parameter(context, 'geology.plateSizeVariety', 0, 1)
    const topology = new SuperPlateGenerator().generateTopology(algorithmMesh(mesh), subdivisions, subdivisions.plateAngularVelocity, primary, micro, variety, context.random)
    if (!topology)
      throw new InvalidStageInputError(context.stageId, 'At least two reference subdivisions are required')
    // Copy dependency data before returning: outputs must not retain read-only proxies.
    return { meshId: mesh.meshId, subdivisions: { regionPlate: Int16Array.from(subdivisions.regionPlate), plateSeeds: Uint32Array.from(subdivisions.plateSeeds), plateAngularVelocity: Float32Array.from(subdivisions.plateAngularVelocity) }, topology }
  },
  validate(output) {
    const { topology, subdivisions } = output
    if (!output.meshId || topology.regionPlate.length !== subdivisions.regionPlate.length || !topology.plateAngularVelocity.every(Number.isFinite) || topology.plateCount < 2 || topology.plateToSuper.length !== subdivisions.plateSeeds.length || topology.plateAngularVelocity.length !== 3 * topology.plateCount || !topology.regionPlate.every(p => p >= 0 && p < topology.plateCount) || !topology.plateToSuper.every(p => p >= 0 && p < topology.plateCount))
      throw new Error('Invalid plate topology')
  },
}
const crustStage: GenerationStage<CrustArtifact> = {
  id: 'continental-crust',
  version: VERSION,
  dependencies: ['reference-mesh', 'plate-topology'],
  configKeys: ['geology.continentCount', 'geology.continentSizeVariety', 'geology.candidateLandCoverage'],
  execute(context) {
    const mesh = copyDependency<SphericalMesh, AlgorithmMeshInput>(context, 'reference-mesh', selectAlgorithmMeshInput)
    const { subdivisions, topology } = copyDependency<PlateTopologyArtifact>(context, 'plate-topology')
    const continents = parameter(context, 'geology.continentCount', 1, REFERENCE_SUBDIVISION_COUNT, true)
    const coverage = parameter(context, 'geology.candidateLandCoverage', 0, 1)
    const variety = parameter(context, 'geology.continentSizeVariety', 0, 1)
    const adapter = algorithmMesh(mesh)
    const land = new CandidateLandGenerator().generate(adapter, subdivisions.regionPlate, subdivisions.plateSeeds, continents, coverage, variety, context.random.fork('land'), topology.plateToSuper)
    const crust = new PlatePropertiesGenerator().generate(adapter, subdivisions.regionPlate, subdivisions.plateSeeds, land.candidateLandMask, context.random.fork('material'))
    return { meshId: mesh.meshId, regionCount: mesh.regionCount, land, crust }
  },
  validate(output) {
    const { land, crust, regionCount } = output
    if (!output.meshId || land.candidateLandMask.length !== regionCount || land.continentId.length !== regionCount || land.nearestContinentId.length !== regionCount || !land.continentSeeds.every(r => r < regionCount))
      throw new Error('Invalid continental crust dimensions')
    for (const values of [crust.regionCrustType, crust.regionDensity, crust.regionBaseElevation, crust.regionCrustThickness]) {
      if (values.length !== regionCount || !values.every(Number.isFinite))
        throw new Error('Invalid region crust values')
    }
    for (let r = 0; r < regionCount; r++) {
      const label = land.continentId[r]
      const nearest = land.nearestContinentId[r]
      if (land.candidateLandMask[r] > 1 || crust.regionCrustType[r] !== land.candidateLandMask[r] || !(crust.regionDensity[r] > 0) || !(crust.regionCrustThickness[r] > 0) || (land.candidateLandMask[r] ? label < 0 || label >= land.continentSeeds.length : label !== -1) || (land.continentSeeds.length ? nearest < 0 || nearest >= land.continentSeeds.length : nearest !== -1))
        throw new Error(`Invalid candidate continent region ${r}`)
    }
    for (const values of [crust.plateCrustType, crust.plateContinentalFraction, crust.plateDensity, crust.plateBaseElevation, crust.plateCrustThickness]) {
      if (values.length !== REFERENCE_SUBDIVISION_COUNT || !values.every(Number.isFinite))
        throw new Error('Invalid subdivision crust values')
    }
  },
}
const mappingStage: GenerationStage<MappingArtifact> = {
  id: 'geological-mapping',
  version: VERSION,
  dependencies: ['mesh', 'reference-mesh'],
  configKeys: [],
  execute(context) {
    const mesh = copyDependency<SphericalMesh>(context, 'mesh')
    const reference = copyDependency<SphericalMesh>(context, 'reference-mesh')
    const index = new SphericalSpatialIndex(reference)
    const geographic = new Uint32Array(mesh.regionCount)
    const geological = new Uint32Array(mesh.regionCount)
    const noise = createNoise3D(randomFunction(context.random.fork('projection')))
    // Legacy projection uses 100 reference subdivisions: low-plate bonus is zero.
    const maximumAmplitude = Math.PI / Math.sqrt(reference.regionCount) * 1.5
    for (let r = 0; r < mesh.regionCount; r++) {
      const x = mesh.centers[3 * r]
      const y = mesh.centers[3 * r + 1]
      const z = mesh.centers[3 * r + 2]
      geographic[r] = index.findNearestRegion({ x, y, z })
      let dx = 0
      let dy = 0
      let dz = 0
      let amplitude = maximumAmplitude
      let frequency = 8
      for (let octave = 0; octave < 2; octave++) {
        dx += noise(x * frequency, y * frequency, z * frequency) * amplitude
        dy += noise(x * frequency + 100, y * frequency + 100, z * frequency + 100) * amplitude
        dz += noise(x * frequency + 200, y * frequency + 200, z * frequency + 200) * amplitude
        amplitude *= 0.5
        frequency *= 2
      }
      geological[r] = index.findNearestRegion({ x: x + dx, y: y + dy, z: z + dz })
      if (r % 4096 === 0) {
        context.throwIfCancelled()
        context.progress(r / mesh.regionCount)
      }
    }
    return { sourceRegionCount: reference.regionCount, regionCount: mesh.regionCount, sourceMeshId: reference.meshId, meshId: mesh.meshId, geographic, geological }
  },
  validate(output) {
    if (!output.meshId || !output.sourceMeshId || output.geographic.length !== output.regionCount || output.geological.length !== output.regionCount || !output.geographic.every(r => r < output.sourceRegionCount) || !output.geological.every(r => r < output.sourceRegionCount))
      throw new Error('Invalid reference mapping')
  },
}
const projectionStage: GenerationStage<GeologyArtifact> = {
  id: 'geology',
  version: VERSION,
  dependencies: ['mesh', 'reference-mesh', 'geological-mapping', 'plate-topology', 'continental-crust'],
  configKeys: ['geology.candidateLandCoverage', 'geology.primaryPlateCount', 'geology.microPlateCount'],
  execute(context) {
    const mesh = copyDependency<SphericalMesh>(context, 'mesh')
    const reference = copyDependency<SphericalMesh>(context, 'reference-mesh')
    const mapping = copyDependency<MappingArtifact>(context, 'geological-mapping')
    const { topology, subdivisions } = copyDependency<PlateTopologyArtifact>(context, 'plate-topology')
    const { land, crust } = copyDependency<CrustArtifact>(context, 'continental-crust')
    if (mapping.meshId !== mesh.meshId || mapping.sourceMeshId !== reference.meshId)
      throw new Error('Geology mapping mesh mismatch')
    const count = mesh.regionCount
    const plateIndex = new Uint32Array(count)
    const subdivisionIndex = new Uint32Array(count)
    const candidateLandMask = new Uint8Array(count)
    const crustType = new Uint8Array(count)
    const continentIndex = new Int32Array(count)
    const nearestContinentIndex = new Int32Array(count)
    const densityGcm3 = new Float32Array(count)
    const thicknessKm = new Float32Array(count)
    const baseElevationCoordinate = new Float32Array(count)
    let landAreaKm2 = 0
    let totalArea = 0
    let referenceLandArea = 0
    for (let r = 0; r < reference.regionCount; r++)
      referenceLandArea += land.candidateLandMask[r] * reference.areaKm2[r]
    for (let r = 0; r < count; r++) {
      const source = mapping.geological[r]
      plateIndex[r] = topology.regionPlate[source]
      subdivisionIndex[r] = subdivisions.regionPlate[source]
      candidateLandMask[r] = land.candidateLandMask[source]
      continentIndex[r] = land.continentId[source]
      nearestContinentIndex[r] = land.nearestContinentId[source]
      crustType[r] = crust.regionCrustType[source]
      densityGcm3[r] = crust.regionDensity[source]
      thicknessKm[r] = crust.regionCrustThickness[source]
      baseElevationCoordinate[r] = crust.regionBaseElevation[source]
      landAreaKm2 += candidateLandMask[r] * mesh.areaKm2[r]
      totalArea += mesh.areaKm2[r]
    }
    const identity = stableHash(JSON.stringify([context.worldSeed, reference.meshId, Array.from(topology.plateToSuper)]))
    const primary = parameter(context, 'geology.primaryPlateCount', 2, REFERENCE_SUBDIVISION_COUNT, true)
    return {
      meshId: mesh.meshId,
      referenceMeshId: reference.meshId,
      referenceRegionCount: reference.regionCount,
      algorithmVersion: VERSION,
      plates: Array.from({ length: topology.plateCount }, (_, i) => ({ id: `plate:${identity}:${i}`, kind: i < primary ? 'primary' as const : 'micro' as const })),
      continents: Array.from(land.continentSeeds, region => ({ id: `continent:${identity}:${region}`, referenceSeedRegion: region })),
      plateAngularVelocity: Float32Array.from(topology.plateAngularVelocity),
      geographicReference: Uint32Array.from(mapping.geographic),
      geologicalReference: Uint32Array.from(mapping.geological),
      plateIndex,
      subdivisionIndex,
      candidateLandMask,
      continentIndex,
      nearestContinentIndex,
      crustType,
      densityGcm3,
      thicknessKm,
      baseElevationCoordinate,
      statistics: { targetCandidateLandCoverage: parameter(context, 'geology.candidateLandCoverage', 0, 1), referenceCandidateLandCoverage: referenceLandArea / (4 * Math.PI * reference.physicalRadiusKm ** 2), outputCandidateLandCoverage: landAreaKm2 / totalArea, candidateLandAreaKm2: landAreaKm2, requestedMicroPlateCount: parameter(context, 'geology.microPlateCount', 0, REFERENCE_SUBDIVISION_COUNT, true), actualMicroPlateCount: topology.plateCount - primary },
    }
  },
  validate: validateGeologyArtifact,
}

/** Intermediate geology only; does not assemble or publish a WorldSnapshot. */
export function createGeologyPipeline(cache = new StageCache()): GenerationPipeline<GeologyGenerationConfig> {
  const registry = new StageRegistry().register(meshStage).register(referenceMeshStage).register(subdivisionStage).register(topologyStage).register(crustStage).register(mappingStage).register(projectionStage)
  return new GenerationPipeline(registry, cache)
}
