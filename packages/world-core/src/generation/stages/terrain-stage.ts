import type { AlgorithmMeshInput } from '#generation/nature/common'
import type { TerrainArtifact } from '#generation/nature/geography'
import type { ElevationFields, GeologyArtifact, SphericalCrustData, SphericalTectonicData } from '#generation/nature/geology'
import type { GenerationInput, GenerationStage, PipelineOptions, StageExecutionContext } from '#generation/pipeline'
import type { SphericalMesh } from '#mesh/spherical-mesh'
import type { CrustArtifact, GeologyGenerationConfig, PlateTopologyArtifact } from './geology-stage'
import { algorithmMesh, selectAlgorithmMeshInput } from '#generation/nature/common'
import { normalizedElevationArrayToKm, TerrainPostProcessor, validateTerrainArtifact } from '#generation/nature/geography'
import { PlatePhysicsProcessor, SphericalPlateBoundaryAnalyzer, SuperPlateGenerator, TectonicElevationGenerator } from '#generation/nature/geology'
import { GenerationPipeline, StageCache } from '#generation/pipeline'
import { copyDependency } from '#generation/pipeline/copy-dependency'
import { InvalidStageInputError } from '#generation/pipeline/errors'
import { stageRandom } from '#math/random'
import { createGeologyPipeline } from './geology-stage'

export interface LandformParameters {
  readonly islandArcCount: number
  readonly islandDensity: number
  readonly hotspotCount: number
}
export interface TerrainParameters {
  readonly roughness: number
  readonly terrainWarp: number
  readonly smoothing: number
  readonly glacialErosion: number
  readonly hydraulicErosion: number
  readonly ridgeSharpening: number
}
export interface TerrainGenerationConfig extends GeologyGenerationConfig {
  readonly planet: GeologyGenerationConfig['planet'] & { readonly seaLevelDatumKm?: number }
  readonly landforms: LandformParameters
  readonly terrain: TerrainParameters
}
export const DEFAULT_LANDFORM_PARAMETERS: LandformParameters = Object.freeze({ islandArcCount: 6, islandDensity: 0.65, hotspotCount: 5 })
export const DEFAULT_TERRAIN_PARAMETERS: Readonly<Required<TerrainParameters>> = Object.freeze({ roughness: 0.4, terrainWarp: 0.75, smoothing: 0.1, glacialErosion: 0.5, hydraulicErosion: 0.5, ridgeSharpening: 0.5 })
const VERSION = 'terrain-v2'
const SKELETON_VERSION = 'terrain-skeleton-v9'
const SKELETON_RANDOM_VERSION = 'terrain-skeleton-v5'
const TERRAIN_VERSION = 'terrain-v24'
export const TERRAIN_RANDOM_VERSION = 'terrain-v7'
interface DynamicsArtifact {
  readonly meshId: string
  readonly crust: SphericalCrustData
  readonly movingVelocity: Float32Array
  readonly subdivisionVelocity: Float32Array
  readonly mantleFlow: Float32Array
}
interface TectonicArtifact {
  readonly meshId: string
  readonly tectonics: SphericalTectonicData
  readonly movingVelocity: Float32Array
  readonly mantleFlow: Float32Array
  readonly mantleElevationCoordinate: Float32Array
}
interface SkeletonArtifact { readonly meshId: string, readonly fields: ElevationFields }

function selectTerrainTectonics(source: Readonly<TectonicArtifact>) {
  const { meshId, movingVelocity, mantleFlow, mantleElevationCoordinate, tectonics } = source
  return { meshId, movingVelocity, mantleFlow, mantleElevationCoordinate, tectonics: { regionBoundaryType: tectonics.regionBoundaryType, regionStress: tectonics.regionStress } }
}
function selectTerrainSkeleton(source: Readonly<SkeletonArtifact>) {
  const { elevation, phasorRidge, regionalUpliftCoordinate, spatialFields: s, classification: c, edifices } = source.fields
  return { meshId: source.meshId, fields: { elevation, phasorRidge, regionalUpliftCoordinate, spatialFields: s, classification: c, edifices: { hotspot: edifices.hotspot, total: edifices.total } } }
}

function parameter(context: StageExecutionContext, key: string, min: number, max: number, integer = false): number {
  const value = context.getConfig(key)
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)))
    throw new InvalidStageInputError(context.stageId, `${key} must be ${integer ? 'an integer' : 'finite'} in [${min}, ${max}]`)
  return value
}
function validateArrays(value: object, allowDistances = false): void {
  for (const [key, array] of Object.entries(value)) {
    if (ArrayBuffer.isView(array)) {
      if (!(array as Float32Array).every(v => Number.isFinite(v) || (allowDistances && key.endsWith('Distance') && v === Infinity)))
        throw new Error(`Invalid generated array ${key}`)
    }
    else if (array && typeof array === 'object') {
      validateArrays(array, allowDistances)
    }
  }
}
function projectCrust(source: SphericalCrustData, mapping: Uint32Array): SphericalCrustData {
  return {
    plateCrustType: Uint8Array.from(source.plateCrustType),
    plateContinentalFraction: Float32Array.from(source.plateContinentalFraction),
    plateDensity: Float32Array.from(source.plateDensity),
    plateBaseElevation: Float32Array.from(source.plateBaseElevation),
    plateCrustThickness: Float32Array.from(source.plateCrustThickness),
    regionCrustType: Uint8Array.from(mapping, r => source.regionCrustType[r]),
    regionDensity: Float32Array.from(mapping, r => source.regionDensity[r]),
    regionBaseElevation: Float32Array.from(mapping, r => source.regionBaseElevation[r]),
    regionCrustThickness: Float32Array.from(mapping, r => source.regionCrustThickness[r]),
  }
}
const dynamicsStage: GenerationStage<DynamicsArtifact> = {
  id: 'plate-dynamics',
  version: VERSION,
  dependencies: ['reference-mesh', 'plate-topology', 'continental-crust'],
  configKeys: [],
  execute(context) {
    const mesh = copyDependency<SphericalMesh, AlgorithmMeshInput>(context, 'reference-mesh', selectAlgorithmMeshInput)
    const { subdivisions, topology } = copyDependency<PlateTopologyArtifact>(context, 'plate-topology')
    const material = copyDependency<CrustArtifact>(context, 'continental-crust')
    if (material.meshId !== mesh.meshId)
      throw new Error('Reference crust mesh mismatch')
    const adapter = algorithmMesh(mesh)
    const crust = new SuperPlateGenerator().attachCrust(adapter, subdivisions, topology, material.crust).crust
    const physics = new PlatePhysicsProcessor()
    const movingVelocity = physics.apply(adapter, topology.regionPlate, topology.plateAngularVelocity, crust, context.random, 1.6)
    if (!physics.mantleFlow)
      throw new Error('Plate dynamics did not produce a mantle field')
    const subdivisionVelocity = new Float32Array(subdivisions.plateSeeds.length * 3)
    for (let plate = 0; plate < subdivisions.plateSeeds.length; plate++) {
      const source = topology.plateToSuper[plate] * 3
      subdivisionVelocity.set(movingVelocity.subarray(source, source + 3), plate * 3)
    }
    return { meshId: mesh.meshId, crust, movingVelocity, subdivisionVelocity, mantleFlow: physics.mantleFlow }
  },
  validate: validateArrays,
}
const tectonicStage: GenerationStage<TectonicArtifact> = {
  id: 'tectonics',
  version: VERSION,
  dependencies: ['mesh', 'geology', 'plate-topology', 'continental-crust', 'plate-dynamics'],
  configKeys: [],
  execute(context) {
    const mesh = copyDependency<SphericalMesh, AlgorithmMeshInput>(context, 'mesh', selectAlgorithmMeshInput)
    const geology = copyDependency<GeologyArtifact>(context, 'geology')
    const { subdivisions } = copyDependency<PlateTopologyArtifact>(context, 'plate-topology')
    const { crust } = copyDependency<CrustArtifact>(context, 'continental-crust')
    const dynamics = copyDependency<DynamicsArtifact>(context, 'plate-dynamics')
    if (geology.meshId !== mesh.meshId || dynamics.meshId !== geology.referenceMeshId)
      throw new Error('Tectonic mesh mismatch')
    const mapping = geology.geologicalReference
    const projectedCrust = projectCrust(crust, mapping)
    const groupedCrust = projectCrust(dynamics.crust, mapping)
    const boundaries = new SphericalPlateBoundaryAnalyzer().analyze(algorithmMesh(mesh), Int16Array.from(geology.plateIndex), dynamics.movingVelocity, groupedCrust)
    const mantleFlow = Float32Array.from(mapping, r => dynamics.mantleFlow[r])
    const mantleElevationCoordinate = new Float32Array(mesh.regionCount)
    for (let r = 0; r < mesh.regionCount; r++) {
      const value = mantleFlow[r]
      mantleElevationCoordinate[r] = value * (value > 0 ? 0.035 : 0.025)
      if (boundaries.regionStress[r] > 1e-6) {
        const multiplier = 1 + 0.4 * Math.max(-0.5, value)
        boundaries.regionStress[r] *= multiplier
        boundaries.regionCompression[r] *= multiplier
      }
    }
    return {
      meshId: mesh.meshId,
      tectonics: { ...projectedCrust, ...boundaries, regionPlate: Int16Array.from(geology.subdivisionIndex), regionPrimaryPlate: Int16Array.from(geology.plateIndex), plateSeeds: Uint32Array.from(subdivisions.plateSeeds), plateAngularVelocity: Float32Array.from(dynamics.subdivisionVelocity) },
      movingVelocity: Float32Array.from(dynamics.movingVelocity),
      mantleFlow,
      mantleElevationCoordinate,
    }
  },
  validate: validateArrays,
}
const skeletonStage: GenerationStage<SkeletonArtifact> = {
  id: 'tectonic-elevation',
  version: SKELETON_VERSION,
  dependencies: ['mesh', 'geology', 'tectonics'],
  configKeys: ['landforms.islandArcCount', 'landforms.islandDensity', 'landforms.hotspotCount'],
  execute(context) {
    const mesh = copyDependency<SphericalMesh, AlgorithmMeshInput>(context, 'mesh', selectAlgorithmMeshInput)
    const geology = copyDependency<GeologyArtifact, Pick<GeologyArtifact, 'meshId' | 'candidateLandMask'>>(context, 'geology', ({ meshId, candidateLandMask }) => ({ meshId, candidateLandMask }))
    const { tectonics } = copyDependency<TectonicArtifact, Pick<TectonicArtifact, 'tectonics'>>(context, 'tectonics', ({ tectonics }) => ({ tectonics }))
    const params = { islandArcCount: parameter(context, 'landforms.islandArcCount', 0, 100, true), islandDensity: parameter(context, 'landforms.islandDensity', 0, 1), hotspotCount: parameter(context, 'landforms.hotspotCount', 0, 100, true) }
    // Invalidate the skeleton cache, but keep its established random pattern:
    // this revision changes only the ocean shelf profile, not land noise.
    const skeletonRandom = stageRandom(context.worldSeed, context.stageId, SKELETON_RANDOM_VERSION)
    const fields = new TectonicElevationGenerator().generate(algorithmMesh(mesh), geology.candidateLandMask, tectonics, skeletonRandom, params, (fraction, message) => {
      context.throwIfCancelled()
      context.progress(fraction, message)
    })
    return { meshId: mesh.meshId, fields }
  },
  validate(output) { validateArrays(output, true) },
}
const terrainStage: GenerationStage<TerrainArtifact> = {
  id: 'terrain',
  version: TERRAIN_VERSION,
  dependencies: ['mesh', 'geology', 'tectonics', 'tectonic-elevation'],
  configKeys: ['terrain.roughness', 'terrain.terrainWarp', 'terrain.smoothing', 'terrain.glacialErosion', 'terrain.hydraulicErosion', 'terrain.ridgeSharpening', 'landforms.islandDensity', 'planet.seaLevelDatumKm'],
  execute(context) {
    const mesh = copyDependency<SphericalMesh, AlgorithmMeshInput>(context, 'mesh', selectAlgorithmMeshInput)
    const geology = copyDependency<GeologyArtifact, Pick<GeologyArtifact, 'meshId' | 'candidateLandMask' | 'statistics'>>(context, 'geology', ({ meshId, candidateLandMask, statistics }) => ({ meshId, candidateLandMask, statistics }))
    const tectonics = copyDependency<TectonicArtifact, ReturnType<typeof selectTerrainTectonics>>(context, 'tectonics', selectTerrainTectonics)
    const skeleton = copyDependency<SkeletonArtifact, ReturnType<typeof selectTerrainSkeleton>>(context, 'tectonic-elevation', selectTerrainSkeleton)
    const roughness = parameter(context, 'terrain.roughness', 0, 0.5)
    const warp = parameter(context, 'terrain.terrainWarp', 0, 1)
    const smoothing = parameter(context, 'terrain.smoothing', 0, 1)
    const glacialErosion = parameter(context, 'terrain.glacialErosion', 0, 1)
    const hydraulicErosion = parameter(context, 'terrain.hydraulicErosion', 0, 1)
    const sharpening = parameter(context, 'terrain.ridgeSharpening', 0, 1)
    const islandDensity = parameter(context, 'landforms.islandDensity', 0, 1)
    const datumInput = context.getConfig('planet.seaLevelDatumKm')
    const datum = datumInput === undefined ? 0 : parameter(context, 'planet.seaLevelDatumKm', -Number.MAX_VALUE, Number.MAX_VALUE)
    if (mesh.physicalRadiusKm + datum <= 0 || skeleton.meshId !== mesh.meshId || geology.meshId !== mesh.meshId || tectonics.meshId !== mesh.meshId)
      throw new InvalidStageInputError(context.stageId, 'Invalid sea level or terrain mesh')
    const { fields } = skeleton
    // Keep the v7 terrain random pattern while moving only the relief unit boundary.
    const terrainRandom = stageRandom(context.worldSeed, context.stageId, TERRAIN_RANDOM_VERSION)
    const terrain = new TerrainPostProcessor().generate(algorithmMesh(mesh), fields.elevation, geology.candidateLandMask, fields.spatialFields, fields.classification, terrainRandom, islandDensity, roughness, warp, smoothing, sharpening, tectonics.mantleElevationCoordinate, fields.phasorRidge, fields.edifices.hotspot, fields.edifices.total, undefined, false, glacialErosion, hydraulicErosion)
    const elevationKm = normalizedElevationArrayToKm(terrain.elevationCoordinate)
    for (let region = 0; region < elevationKm.length; region++)
      elevationKm[region] -= datum
    const landMask = Uint8Array.from(elevationKm, value => value > 0 ? 1 : 0)
    const slopeRadians = new Float32Array(mesh.regionCount)
    let landArea = 0
    let totalArea = 0
    let changedCoastRegions = 0
    for (let r = 0; r < mesh.regionCount; r++) {
      totalArea += mesh.areaKm2[r]
      landArea += landMask[r] * mesh.areaKm2[r]
      if (landMask[r] !== geology.candidateLandMask[r])
        changedCoastRegions++
      for (let i = mesh.neighborOffsets[r]; i < mesh.neighborOffsets[r + 1]; i++) {
        const distanceKm = mesh.edgeAngularDistances[mesh.neighborEdges[i]] * mesh.physicalRadiusKm
        slopeRadians[r] = Math.max(slopeRadians[r], Math.atan(Math.abs(elevationKm[r] - elevationKm[mesh.neighbors[i]]) / distanceKm))
      }
    }
    const visited = new Uint8Array(mesh.regionCount)
    let landComponentCount = 0
    let largestLandAreaKm2 = 0
    for (let start = 0; start < mesh.regionCount; start++) {
      if (!landMask[start] || visited[start])
        continue
      landComponentCount++
      const queue = [start]
      visited[start] = 1
      let area = 0
      for (let head = 0; head < queue.length; head++) {
        const r = queue[head]
        area += mesh.areaKm2[r]
        for (let i = mesh.neighborOffsets[r]; i < mesh.neighborOffsets[r + 1]; i++) {
          const neighbor = mesh.neighbors[i]
          if (landMask[neighbor] && !visited[neighbor]) {
            visited[neighbor] = 1
            queue.push(neighbor)
          }
        }
      }
      largestLandAreaKm2 = Math.max(largestLandAreaKm2, area)
    }
    const ordered = elevationKm.slice().sort()
    return {
      meshId: mesh.meshId,
      algorithmVersion: TERRAIN_VERSION,
      physicalRadiusKm: mesh.physicalRadiusKm,
      seaLevelDatumKm: datum,
      elevationKm,
      landMask,
      slopeRadians,
      boundaryType: Uint8Array.from(tectonics.tectonics.regionBoundaryType),
      stress: Float32Array.from(tectonics.tectonics.regionStress),
      mantleFlow: Float32Array.from(tectonics.mantleFlow),
      plateAngularVelocity: Float32Array.from(tectonics.movingVelocity),
      volcanicCoordinate: Float32Array.from(fields.edifices.total),
      ridgeCoordinate: Float32Array.from(fields.phasorRidge),
      regionalUpliftCoordinate: new Float32Array(mesh.regionCount),
      regionalReliefKm: new Float32Array(mesh.regionCount),
      roughnessWeight: new Float32Array(mesh.regionCount).fill(1),
      erosionCoordinate: terrain.erosion.erosionDelta,
      depositionCoordinate: terrain.erosion.depositionDelta,
      foldBelt: Float32Array.from(fields.classification.foldBelt),
      statistics: { landCoverage: landArea / totalArea, candidateLandCoverage: geology.statistics.outputCandidateLandCoverage, changedCoastRegions, landComponentCount, largestLandAreaKm2, minimumElevationKm: ordered[0], maximumElevationKm: ordered[ordered.length - 1], elevationQuantilesKm: [0, 0.25, 0.5, 0.75, 1].map(q => ordered[Math.floor(q * (ordered.length - 1))]) },
    }
  },
  validate: validateTerrainArtifact,
}

export function createTerrainPipeline(cache = new StageCache()): GenerationPipeline<TerrainGenerationConfig> {
  const registry = createGeologyPipeline(cache).registry
  registry.register(dynamicsStage).register(tectonicStage).register(skeletonStage).register(terrainStage)
  return new TerrainPipeline(registry, cache)
}

// Validate obsolete options before planning, including a full-cache-hit request.
// Keep this task-specific validation out of the generic Stage pipeline.
class TerrainPipeline extends GenerationPipeline<TerrainGenerationConfig> {
  private validateOptions(input: GenerationInput<TerrainGenerationConfig>): void {
    assertNoObsoleteTerrainOptions(input)
  }

  override plan(input: GenerationInput<TerrainGenerationConfig>, options: Pick<PipelineOptions, 'force'> = {}) {
    this.validateOptions(input)
    return super.plan(input, options)
  }

  override async execute(input: GenerationInput<TerrainGenerationConfig>, options: PipelineOptions = {}) {
    this.validateOptions(input)
    return super.execute(input, options)
  }
}

export function assertNoObsoleteTerrainOptions(input: GenerationInput<TerrainGenerationConfig>): void {
  const terrain = input.config.terrain
  if (terrain && typeof terrain === 'object') {
    for (const key of ['continentalUpliftKm']) {
      if (Object.hasOwn(terrain, key))
        throw new InvalidStageInputError('terrain', `terrain.${key} is no longer supported in M1.1`)
    }
  }
}
