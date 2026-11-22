import type { ContentPackView, ContentPort } from '#content/content-port'
import type { PeoplesCulturesArtifact } from '#generation/civilization/peoples-cultures'
import type { PolitiesReligionsArtifact } from '#generation/civilization/polities-religions'
import type { TransportNetworkArtifact } from '#generation/civilization/transport-network'
import type { ClimateArtifact } from '#generation/nature/climate/climate'
import type { EcologyArtifact } from '#generation/nature/ecology/ecology'
import type { TerrainArtifact } from '#generation/nature/geography'
import type { GeographicRegionsArtifact } from '#generation/nature/geography/geographic-regions'
import type { GeologyArtifact } from '#generation/nature/geology'
import type { CryosphereArtifact, HydrologyArtifact } from '#generation/nature/hydrology/hydrology'
import type { StaticLakeArtifact } from '#generation/nature/hydrology/lakes'
import type { ResourcePotentialArtifact } from '#generation/nature/resources/resource-potential'
import type { GenerationInput, PipelineResult, StageRegistry } from '#generation/pipeline'
import type { NaturalGenerationConfig } from '#generation/stages/natural-stage'
import type { WorldGenerationPipelineConfig } from '#generation/stages/world-stage'
import type { SphericalMesh } from '#mesh/spherical-mesh'
import type { DenseField, NumericArray } from './fields'
import type { WorldSnapshot } from './world-snapshot'
import { resolveCivilizationParameters } from '#generation/civilization/civilization-parameters'
import { extractMonthlyCirculation } from '#generation/nature/climate/climate'
import { normalizeWorldSeed, stableHash } from '#math/random'
import { WORLD_SCHEMA_VERSION } from './world-snapshot'
import { validateWorldSnapshot } from './world-validator'

export interface WorldIdentity {
  readonly snapshotId: string
  readonly worldId: string
  readonly name: string
  readonly createdAt: string
  readonly revision?: number
  readonly year?: number
}

function owned<T extends NumericArray>(meshId: string, values: T): DenseField<T> {
  return { meshId, values: values.slice() as T }
}

const CIVILIZATION_STAGES = [
  'resource-potential',
  'habitability',
  'population-settlements',
  'transport-network',
  'peoples-cultures',
  'polities-religions',
] as const

/** Assemble a candidate WorldSnapshot from a completed DAG, then run full domain validation. */
export function assembleWorld(
  input: GenerationInput<NaturalGenerationConfig | WorldGenerationPipelineConfig>,
  result: PipelineResult,
  registry: StageRegistry,
  identity: WorldIdentity,
  packs: readonly ContentPackView[],
  content: ContentPort,
): WorldSnapshot {
  const outputs = new Map(result.plan.map(stage => [stage.stageId, stage]))
  for (const stageId of ['mesh', 'geology', 'terrain', 'geographic-regions', 'geographic-names', 'climate-c0', 'cryosphere-i0', 'hydrology-h0', 'static-lakes-l1', 'ecology-e0']) {
    if (!outputs.has(stageId))
      throw new Error(`Missing natural stage ${stageId}`)
  }

  const hasCivilizationStages = CIVILIZATION_STAGES.every(stageId => outputs.has(stageId))
  const civInput = 'civilization' in input.config ? input.config.civilization : undefined
  const civParams = resolveCivilizationParameters(civInput)
  const civilizationEnabled = hasCivilizationStages && civParams.enabled

  const mesh = result.getOutput<SphericalMesh>('mesh')
  const geology = result.getOutput<GeologyArtifact>('geology')
  const terrain = result.getOutput<TerrainArtifact>('terrain')
  const regions = result.getOutput<GeographicRegionsArtifact>('geographic-names')
  const climate = result.getOutput<ClimateArtifact>('climate-c0')
  const circulation = extractMonthlyCirculation(climate)
  const snow = result.getOutput<CryosphereArtifact>('cryosphere-i0')
  const hydrology = result.getOutput<HydrologyArtifact>('hydrology-h0')
  const lakes = result.getOutput<StaticLakeArtifact>('static-lakes-l1')
  const ecology = result.getOutput<EcologyArtifact>('ecology-e0')

  const resources = outputs.has('resource-potential')
    ? result.getOutput<ResourcePotentialArtifact>('resource-potential')
    : undefined
  const transport = hasCivilizationStages
    ? result.getOutput<TransportNetworkArtifact>('transport-network')
    : undefined
  const peoplesCultures = hasCivilizationStages
    ? result.getOutput<PeoplesCulturesArtifact>('peoples-cultures')
    : undefined
  const politiesReligions = hasCivilizationStages
    ? result.getOutput<PolitiesReligionsArtifact>('polities-religions')
    : undefined

  const meshId = mesh.meshId
  const planet = {
    physicalRadiusKm: input.config.planet.physicalRadiusKm,
    seaLevelDatumKm: input.config.planet.seaLevelDatumKm ?? 0,
    rotationPeriodHours: input.config.climate.rotationPeriodHours,
    axialTiltDegrees: input.config.climate.axialTiltDegrees,
    orbitalPeriodDays: input.config.climate.orbitalPeriodDays,
  }
  const stageVersions = Object.fromEntries(result.plan.map(stage => [stage.stageId, registry.get(stage.stageId)?.version ?? '']))
  const artifactSignatures = Object.fromEntries(result.plan.map(stage => [stage.stageId, stage.inputSignature]))
  const world: WorldSnapshot = {
    schemaVersion: WORLD_SCHEMA_VERSION,
    snapshotId: identity.snapshotId,
    revision: identity.revision ?? 0,
    time: { year: identity.year ?? 0 },
    metadata: {
      worldId: identity.worldId,
      name: identity.name,
      createdAt: identity.createdAt,
      seed: normalizeWorldSeed(input.seed),
      generatorVersion: hasCivilizationStages ? 'm2-world-v1' : 'm1-natural-v1',
      contentSignature: content.calculateContentSignature(packs),
      contentPacks: packs.map(pack => ({ id: pack.manifest.id, version: pack.manifest.version, contentHash: pack.manifest.contentHash })),
      generationConfig: {
        planet,
        mesh: { ...input.config.mesh },
        regionCount: mesh.regionCount,
        civilizationEnabled,
        civilization: { ...civParams, enabled: civilizationEnabled },
        ...(input.config.reference ? { reference: { ...input.config.reference } } : {}),
        geology: { ...input.config.geology },
        landforms: { ...input.config.landforms },
        terrain: { ...input.config.terrain },
        climate: { ...input.config.climate },
        hydrology: { ...input.config.hydrology },
      },
      provenance: {
        stageVersions,
        artifactSignatures,
        configSignature: stableHash(JSON.stringify(result.plan.map(stage => [stage.stageId, stage.inputSignature]))),
      },
    },
    planet,
    mesh: {
      meshId,
      regionCount: mesh.regionCount,
      centers: mesh.centers.slice(),
      areaKm2: mesh.areaKm2.slice(),
      neighborOffsets: mesh.neighborOffsets.slice(),
      neighbors: mesh.neighbors.slice(),
    },
    nature: {
      geology: {
        plates: geology.plates.map(plate => ({ id: plate.id })),
        plateIndex: owned(meshId, geology.plateIndex),
        crustType: owned(meshId, geology.crustType),
      },
      geography: {
        elevationKm: owned(meshId, terrain.elevationKm),
        landMask: owned(meshId, terrain.landMask),
        regions: {
          ...(regions.nameStyleId ? { nameStyleId: regions.nameStyleId } : {}),
          ...(regions.nameStyleSignature ? { nameStyleSignature: regions.nameStyleSignature } : {}),
          continentIndex: owned(meshId, regions.continentIndex),
          oceanIndex: owned(meshId, regions.oceanIndex),
          seaIndex: owned(meshId, regions.seaIndex),
          continents: regions.continents.map(item => ({ ...item })),
          oceans: regions.oceans.map(item => ({ ...item })),
          seas: regions.seas.map(item => ({ ...item })),
        },
      },
      climate: {
        monthsPerYear: 12,
        layout: 'month-major',
        temperatureC: owned(meshId, climate.temperatureC),
        precipitationMm: owned(meshId, climate.precipitationMm),
        annualMeanTemperatureC: owned(meshId, climate.annualMeanTemperatureC),
        annualPrecipitationMm: owned(meshId, climate.annualPrecipitationMm),
        koppenClass: owned(meshId, climate.koppenClass),
        circulation: {
          windEastMps: { meshId, values: circulation.windEastMps },
          windNorthMps: { meshId, values: circulation.windNorthMps },
          oceanEastMps: { meshId, values: circulation.oceanEastMps },
          oceanNorthMps: { meshId, values: circulation.oceanNorthMps },
          oceanWarmth: { meshId, values: circulation.oceanWarmth },
          oceanAvailable: { meshId, values: circulation.oceanAvailable },
        },
      },
      hydrology: {
        monthlySnowWaterEquivalentMm: owned(meshId, snow.monthlySnowWaterEquivalentMm),
        monthlySnowfallMm: owned(meshId, snow.monthlySnowfallMm),
        monthlySnowmeltMm: owned(meshId, snow.monthlySnowmeltMm),
        downstreamRegion: owned(meshId, hydrology.downstreamRegion),
        annualRunoffMm: owned(meshId, hydrology.annualRunoffMm),
        annualRunoffVolumeM3: owned(meshId, hydrology.annualRunoffVolumeM3),
        accumulatedAnnualFlowM3s: owned(meshId, hydrology.accumulatedAnnualFlowM3s),
        contributingAreaKm2: owned(meshId, hydrology.contributingAreaKm2),
        basinIndex: owned(meshId, hydrology.basinIndex),
        basins: hydrology.basins.map(basin => ({ ...basin })),
        riverIndex: owned(meshId, hydrology.riverIndex),
        rivers: hydrology.rivers.map(river => ({ ...river, regions: river.regions.slice() })),
        lakeIndex: owned(meshId, lakes.lakeIndex),
        lakes: lakes.lakes.map(lake => ({ ...lake, regions: lake.regions.slice() })),
      },
      ecology: {
        potentialBiomeIds: [...ecology.potentialBiomeIds],
        landCoverIds: [...ecology.landCoverIds],
        potentialBiomeIndex: owned(meshId, ecology.potentialBiomeIndex),
        landCoverIndex: owned(meshId, ecology.landCoverIndex),
        aridityIndex: owned(meshId, ecology.aridityIndex),
        growingSeasonMonths: owned(meshId, ecology.growingSeasonMonths),
      },
      resources: resources
        ? {
            resourceIds: [...resources.resourceIds],
            agriculturalPotential: owned(meshId, resources.agriculturalPotential),
            forestryPotential: owned(meshId, resources.forestryPotential),
            fisheryPotential: owned(meshId, resources.fisheryPotential),
            deposits: resources.deposits.map(deposit => ({ ...deposit })),
          }
        : {
            resourceIds: [],
            agriculturalPotential: { meshId, values: new Float32Array(mesh.regionCount) },
            forestryPotential: { meshId, values: new Float32Array(mesh.regionCount) },
            fisheryPotential: { meshId, values: new Float32Array(mesh.regionCount) },
            deposits: [],
          },
    },
    civilization: hasCivilizationStages && peoplesCultures && politiesReligions && transport
      ? {
          meshId,
          peoples: peoplesCultures.peoples.map(item => ({ ...item })),
          cultures: peoplesCultures.cultures.map(item => ({ ...item })),
          religions: politiesReligions.religions.map(item => ({ ...item })),
          polities: politiesReligions.polities.map(item => ({ ...item, traits: [...item.traits] })),
          settlements: politiesReligions.settlements.map(item => ({ ...item, features: [...item.features] })),
          population: owned(meshId, politiesReligions.population),
          populationGroups: politiesReligions.populationGroups.map(item => ({ ...item })),
          territoryPolityIndex: owned(meshId, politiesReligions.territoryPolityIndex),
          transport: {
            nodes: transport.nodes.map(node => ({ ...node })),
            routes: transport.routes.map(route => ({ ...route, regions: route.regions.slice() })),
            accessibility: owned(meshId, transport.accessibility),
          },
        }
      : {
          meshId,
          peoples: [],
          cultures: [],
          religions: [],
          polities: [],
          settlements: [],
          population: { meshId, values: new Float64Array(mesh.regionCount) },
          populationGroups: [],
          territoryPolityIndex: { meshId, values: new Int32Array(mesh.regionCount).fill(-1) },
          transport: {
            nodes: [],
            routes: [],
            accessibility: { meshId, values: new Float32Array(mesh.regionCount) },
          },
        },
  }
  const validation = validateWorldSnapshot(world, packs, content)
  if (!validation.valid)
    throw new Error(`Invalid world snapshot: ${validation.issues[0]?.path}: ${validation.issues[0]?.message}`)
  return world
}
