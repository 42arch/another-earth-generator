import type { CivilizationContentBundle, ResourceDefinitionView } from '#content/content-port'
import type { CivilizationParametersInput } from '#generation/civilization/civilization-types'
import type { HabitabilityArtifact } from '#generation/civilization/habitability'
import type { PeoplesCulturesArtifact } from '#generation/civilization/peoples-cultures'
import type { PolitiesReligionsArtifact } from '#generation/civilization/polities-religions'
import type { PopulationSettlementsArtifact } from '#generation/civilization/population-settlements'
import type { TransportNetworkArtifact } from '#generation/civilization/transport-network'
import type { ClimateArtifact } from '#generation/nature/climate/climate'
import type { EcologyArtifact } from '#generation/nature/ecology/ecology'
import type { TerrainArtifact } from '#generation/nature/geography'
import type { GeologyArtifact } from '#generation/nature/geology'
import type { HydrologyArtifact } from '#generation/nature/hydrology/hydrology'
import type { StaticLakeArtifact } from '#generation/nature/hydrology/lakes'
import type { ResourcePotentialArtifact } from '#generation/nature/resources/resource-potential'
import type { GenerationInput, GenerationStage, PipelineOptions } from '#generation/pipeline'
import type { SphericalMesh } from '#mesh/spherical-mesh'
import type { NaturalGenerationConfig } from './natural-stage'
import { civilizationContentSignature, resourceDefinitionsSignature } from '#content/content-port'
import { resolveCivilizationParameters } from '#generation/civilization/civilization-parameters'
import { generateHabitability, HABITABILITY_VERSION, validateHabitabilityArtifact } from '#generation/civilization/habitability'
import { generatePeoplesCultures, PEOPLES_CULTURES_VERSION, validatePeoplesCulturesArtifact } from '#generation/civilization/peoples-cultures'
import { generatePolitiesReligions, POLITIES_RELIGIONS_VERSION, validatePolitiesReligionsArtifact } from '#generation/civilization/polities-religions'
import { generatePopulationSettlements, POPULATION_SETTLEMENTS_VERSION, validatePopulationSettlementsArtifact } from '#generation/civilization/population-settlements'
import { generateTransportNetwork, TRANSPORT_NETWORK_VERSION, validateTransportNetworkArtifact } from '#generation/civilization/transport-network'
import { generateResourcePotential, RESOURCE_POTENTIAL_VERSION, validateResourcePotentialArtifact } from '#generation/nature/resources/resource-potential'
import { GenerationPipeline, StageCache } from '#generation/pipeline'
import { copyDependency } from '#generation/pipeline/copy-dependency'
import { InvalidStageInputError } from '#generation/pipeline/errors'
import { createNaturalPipeline } from './natural-stage'

export interface WorldGenerationPipelineConfig extends NaturalGenerationConfig {
  readonly civilization?: CivilizationParametersInput
}

export { validateCivilizationParameters } from '#generation/civilization/civilization-parameters'

export const resourcePotentialStage: GenerationStage<ResourcePotentialArtifact> = {
  id: 'resource-potential',
  version: RESOURCE_POTENTIAL_VERSION,
  dependencies: ['mesh', 'geology', 'terrain', 'climate-c0', 'hydrology-h0', 'ecology-e0'],
  configKeys: [],
  contentKeys: ['resource-definitions'],
  execute(context) {
    const resources = context.getContent<readonly ResourceDefinitionView[]>('resource-definitions')
    const signature = context.getContentSignature('resource-definitions')
    if (!signature || signature !== resourceDefinitionsSignature(resources))
      throw new InvalidStageInputError(context.stageId, 'Resource definitions signature mismatch')
    const mesh = copyDependency<SphericalMesh, Pick<SphericalMesh, 'meshId' | 'regionCount' | 'centers' | 'areaKm2' | 'neighborOffsets' | 'neighbors' | 'physicalRadiusKm'>>(
      context,
      'mesh',
      ({ meshId, regionCount, centers, areaKm2, neighborOffsets, neighbors, physicalRadiusKm }) => ({ meshId, regionCount, centers, areaKm2, neighborOffsets, neighbors, physicalRadiusKm }),
    )
    const geology = copyDependency<GeologyArtifact, Pick<GeologyArtifact, 'meshId' | 'crustType' | 'thicknessKm'>>(
      context,
      'geology',
      ({ meshId, crustType, thicknessKm }) => ({ meshId, crustType, thicknessKm }),
    )
    const terrain = copyDependency<TerrainArtifact, Pick<TerrainArtifact, 'meshId' | 'elevationKm' | 'landMask' | 'slopeRadians' | 'boundaryType' | 'stress' | 'volcanicCoordinate' | 'depositionCoordinate' | 'foldBelt'>>(
      context,
      'terrain',
      ({ meshId, elevationKm, landMask, slopeRadians, boundaryType, stress, volcanicCoordinate, depositionCoordinate, foldBelt }) => ({ meshId, elevationKm, landMask, slopeRadians, boundaryType, stress, volcanicCoordinate, depositionCoordinate, foldBelt }),
    )
    const climate = copyDependency<ClimateArtifact, Pick<ClimateArtifact, 'meshId' | 'annualMeanTemperatureC' | 'annualPrecipitationMm' | 'oceanReference' | 'referenceRegionCount' | 'circulation' | 'projectedCirculation'>>(
      context,
      'climate-c0',
      ({ meshId, annualMeanTemperatureC, annualPrecipitationMm, oceanReference, referenceRegionCount, circulation, projectedCirculation }) => ({ meshId, annualMeanTemperatureC, annualPrecipitationMm, oceanReference, referenceRegionCount, circulation, projectedCirculation }),
    )
    const hydrology = copyDependency<HydrologyArtifact, Pick<HydrologyArtifact, 'meshId' | 'riverIndex' | 'accumulatedAnnualFlowM3s'>>(
      context,
      'hydrology-h0',
      ({ meshId, riverIndex, accumulatedAnnualFlowM3s }) => ({ meshId, riverIndex, accumulatedAnnualFlowM3s }),
    )
    const ecology = copyDependency<EcologyArtifact, Pick<EcologyArtifact, 'meshId' | 'potentialBiomeIds' | 'landCoverIds' | 'potentialBiomeIndex' | 'landCoverIndex' | 'aridityIndex' | 'growingSeasonMonths'>>(
      context,
      'ecology-e0',
      ({ meshId, potentialBiomeIds, landCoverIds, potentialBiomeIndex, landCoverIndex, aridityIndex, growingSeasonMonths }) => ({ meshId, potentialBiomeIds, landCoverIds, potentialBiomeIndex, landCoverIndex, aridityIndex, growingSeasonMonths }),
    )
    const output = generateResourcePotential(resources, mesh, geology, terrain, climate, hydrology, ecology, context.worldSeed, (fraction) => {
      context.throwIfCancelled()
      context.progress(fraction, '评估自然资源潜力与矿藏分布')
    })
    context.throwIfCancelled()
    context.progress(1)
    return output
  },
  validate: validateResourcePotentialArtifact,
}

export const habitabilityStage: GenerationStage<HabitabilityArtifact> = {
  id: 'habitability',
  version: HABITABILITY_VERSION,
  dependencies: ['mesh', 'terrain', 'climate-c0', 'hydrology-h0', 'static-lakes-l1', 'ecology-e0', 'resource-potential'],
  configKeys: ['civilization.capabilities.agriculturalProductivity', 'civilization.capabilities.industrialCapability', 'civilization.capabilities.landTransportCapability'],
  execute(context) {
    const mesh = copyDependency<SphericalMesh, Pick<SphericalMesh, 'meshId' | 'regionCount' | 'centers' | 'neighborOffsets' | 'neighbors' | 'physicalRadiusKm'>>(
      context,
      'mesh',
      ({ meshId, regionCount, centers, neighborOffsets, neighbors, physicalRadiusKm }) => ({ meshId, regionCount, centers, neighborOffsets, neighbors, physicalRadiusKm }),
    )
    const terrain = copyDependency<TerrainArtifact, Pick<TerrainArtifact, 'meshId' | 'elevationKm' | 'landMask' | 'slopeRadians'>>(
      context,
      'terrain',
      ({ meshId, elevationKm, landMask, slopeRadians }) => ({ meshId, elevationKm, landMask, slopeRadians }),
    )
    const climate = copyDependency<ClimateArtifact, Pick<ClimateArtifact, 'meshId' | 'annualMeanTemperatureC' | 'annualPrecipitationMm'>>(
      context,
      'climate-c0',
      ({ meshId, annualMeanTemperatureC, annualPrecipitationMm }) => ({ meshId, annualMeanTemperatureC, annualPrecipitationMm }),
    )
    const hydrology = copyDependency<HydrologyArtifact, Pick<HydrologyArtifact, 'meshId' | 'riverIndex' | 'accumulatedAnnualFlowM3s'>>(
      context,
      'hydrology-h0',
      ({ meshId, riverIndex, accumulatedAnnualFlowM3s }) => ({ meshId, riverIndex, accumulatedAnnualFlowM3s }),
    )
    const lakes = copyDependency<StaticLakeArtifact, Pick<StaticLakeArtifact, 'meshId' | 'lakeIndex'>>(
      context,
      'static-lakes-l1',
      ({ meshId, lakeIndex }) => ({ meshId, lakeIndex }),
    )
    const ecology = copyDependency<EcologyArtifact, Pick<EcologyArtifact, 'meshId' | 'potentialBiomeIds' | 'landCoverIds' | 'potentialBiomeIndex' | 'landCoverIndex' | 'aridityIndex' | 'growingSeasonMonths'>>(
      context,
      'ecology-e0',
      ({ meshId, potentialBiomeIds, landCoverIds, potentialBiomeIndex, landCoverIndex, aridityIndex, growingSeasonMonths }) => ({ meshId, potentialBiomeIds, landCoverIds, potentialBiomeIndex, landCoverIndex, aridityIndex, growingSeasonMonths }),
    )
    const resources = copyDependency<ResourcePotentialArtifact, Pick<ResourcePotentialArtifact, 'meshId' | 'agriculturalPotential' | 'forestryPotential' | 'fisheryPotential' | 'deposits'>>(
      context,
      'resource-potential',
      ({ meshId, agriculturalPotential, forestryPotential, fisheryPotential, deposits }) => ({ meshId, agriculturalPotential, forestryPotential, fisheryPotential, deposits }),
    )
    const output = generateHabitability(mesh, terrain, climate, hydrology, lakes, ecology, resources, {
      agriculturalProductivity: context.getConfig('civilization.capabilities.agriculturalProductivity') as number,
      industrialCapability: context.getConfig('civilization.capabilities.industrialCapability') as number,
      landTransportCapability: context.getConfig('civilization.capabilities.landTransportCapability') as number,
    }, (fraction) => {
      context.throwIfCancelled()
      context.progress(fraction, '评估区域宜居性与通行成本')
    })
    context.throwIfCancelled()
    context.progress(1)
    return output
  },
  validate: validateHabitabilityArtifact,
}

export const populationSettlementsStage: GenerationStage<PopulationSettlementsArtifact> = {
  id: 'population-settlements',
  version: POPULATION_SETTLEMENTS_VERSION,
  dependencies: ['mesh', 'terrain', 'hydrology-h0', 'static-lakes-l1', 'resource-potential', 'habitability'],
  configKeys: ['civilization.enabled', 'civilization.populationScale', 'civilization.settlementDensity', 'civilization.urbanConcentration'],
  execute(context) {
    const params = resolveCivilizationParameters({
      enabled: context.getConfig('civilization.enabled') as boolean,
      populationScale: context.getConfig('civilization.populationScale') as number,
      settlementDensity: context.getConfig('civilization.settlementDensity') as number,
      urbanConcentration: context.getConfig('civilization.urbanConcentration') as number,
    })
    const mesh = copyDependency<SphericalMesh, Pick<SphericalMesh, 'meshId' | 'regionCount' | 'centers' | 'areaKm2' | 'neighborOffsets' | 'neighbors' | 'physicalRadiusKm'>>(
      context,
      'mesh',
      ({ meshId, regionCount, centers, areaKm2, neighborOffsets, neighbors, physicalRadiusKm }) => ({ meshId, regionCount, centers, areaKm2, neighborOffsets, neighbors, physicalRadiusKm }),
    )
    const terrain = copyDependency<TerrainArtifact, Pick<TerrainArtifact, 'meshId' | 'landMask' | 'slopeRadians'>>(
      context,
      'terrain',
      ({ meshId, landMask, slopeRadians }) => ({ meshId, landMask, slopeRadians }),
    )
    const hydrology = copyDependency<HydrologyArtifact, Pick<HydrologyArtifact, 'meshId' | 'downstreamRegion' | 'riverIndex' | 'accumulatedAnnualFlowM3s'>>(
      context,
      'hydrology-h0',
      ({ meshId, downstreamRegion, riverIndex, accumulatedAnnualFlowM3s }) => ({ meshId, downstreamRegion, riverIndex, accumulatedAnnualFlowM3s }),
    )
    const lakes = copyDependency<StaticLakeArtifact, Pick<StaticLakeArtifact, 'meshId' | 'lakeIndex'>>(
      context,
      'static-lakes-l1',
      ({ meshId, lakeIndex }) => ({ meshId, lakeIndex }),
    )
    const resources = copyDependency<ResourcePotentialArtifact, Pick<ResourcePotentialArtifact, 'meshId' | 'agriculturalPotential' | 'fisheryPotential' | 'mineralPotential'>>(
      context,
      'resource-potential',
      ({ meshId, agriculturalPotential, fisheryPotential, mineralPotential }) => ({ meshId, agriculturalPotential, fisheryPotential, mineralPotential }),
    )
    const habitability = copyDependency<HabitabilityArtifact, Pick<HabitabilityArtifact, 'meshId' | 'habitability' | 'carryingCapacityPerKm2' | 'coastalMask' | 'lakeShoreMask' | 'portPotential'>>(
      context,
      'habitability',
      ({ meshId, habitability, carryingCapacityPerKm2, coastalMask, lakeShoreMask, portPotential }) => ({ meshId, habitability, carryingCapacityPerKm2, coastalMask, lakeShoreMask, portPotential }),
    )
    const output = generatePopulationSettlements(mesh, terrain, hydrology, lakes, resources, habitability, params, context.worldSeed, (fraction) => {
      context.throwIfCancelled()
      context.progress(fraction, '分配区域人口与早期聚落')
    })
    context.throwIfCancelled()
    context.progress(1)
    return output
  },
  validate: validatePopulationSettlementsArtifact,
}

export const transportNetworkStage: GenerationStage<TransportNetworkArtifact> = {
  id: 'transport-network',
  version: TRANSPORT_NETWORK_VERSION,
  dependencies: ['mesh', 'terrain', 'hydrology-h0', 'static-lakes-l1', 'habitability', 'population-settlements'],
  configKeys: ['civilization.enabled', 'civilization.capabilities.landTransportCapability', 'civilization.capabilities.seafaringCapability'],
  execute(context) {
    const mesh = copyDependency<SphericalMesh, Pick<SphericalMesh, 'meshId' | 'regionCount' | 'centers' | 'areaKm2' | 'neighborOffsets' | 'neighbors' | 'physicalRadiusKm'>>(
      context,
      'mesh',
      ({ meshId, regionCount, centers, areaKm2, neighborOffsets, neighbors, physicalRadiusKm }) => ({ meshId, regionCount, centers, areaKm2, neighborOffsets, neighbors, physicalRadiusKm }),
    )
    const terrain = copyDependency<TerrainArtifact, Pick<TerrainArtifact, 'meshId' | 'landMask'>>(
      context,
      'terrain',
      ({ meshId, landMask }) => ({ meshId, landMask }),
    )
    const hydrology = copyDependency<HydrologyArtifact, Pick<HydrologyArtifact, 'meshId' | 'riverIndex' | 'downstreamRegion'>>(
      context,
      'hydrology-h0',
      ({ meshId, riverIndex, downstreamRegion }) => ({ meshId, riverIndex, downstreamRegion }),
    )
    const lakes = copyDependency<StaticLakeArtifact, Pick<StaticLakeArtifact, 'meshId' | 'lakeIndex'>>(
      context,
      'static-lakes-l1',
      ({ meshId, lakeIndex }) => ({ meshId, lakeIndex }),
    )
    const habitability = copyDependency<HabitabilityArtifact, Pick<HabitabilityArtifact, 'meshId' | 'movementCost'>>(
      context,
      'habitability',
      ({ meshId, movementCost }) => ({ meshId, movementCost }),
    )
    const settlements = copyDependency<PopulationSettlementsArtifact, Pick<PopulationSettlementsArtifact, 'meshId' | 'enabled' | 'population' | 'settlementSites'>>(
      context,
      'population-settlements',
      ({ meshId, enabled, population, settlementSites }) => ({ meshId, enabled, population, settlementSites }),
    )
    const output = generateTransportNetwork(mesh, terrain, hydrology, lakes, habitability, settlements, {
      landTransportCapability: context.getConfig('civilization.capabilities.landTransportCapability') as number,
      seafaringCapability: context.getConfig('civilization.capabilities.seafaringCapability') as number,
    }, (fraction) => {
      context.throwIfCancelled()
      context.progress(fraction, '构建陆路、河运与近海交通网')
    })
    context.throwIfCancelled()
    context.progress(1)
    return output
  },
  validate: validateTransportNetworkArtifact,
}

export const peoplesCulturesStage: GenerationStage<PeoplesCulturesArtifact> = {
  id: 'peoples-cultures',
  version: PEOPLES_CULTURES_VERSION,
  dependencies: ['mesh', 'terrain', 'static-lakes-l1', 'resource-potential', 'habitability', 'population-settlements', 'transport-network'],
  configKeys: ['civilization.enabled', 'civilization.culturalDiversity'],
  contentKeys: ['civilization-content'],
  execute(context) {
    const bundle = context.getContent<CivilizationContentBundle>('civilization-content')
    const signature = context.getContentSignature('civilization-content')
    if (!signature || signature !== civilizationContentSignature(bundle))
      throw new InvalidStageInputError(context.stageId, 'Civilization content signature mismatch')
    const mesh = copyDependency<SphericalMesh, Pick<SphericalMesh, 'meshId' | 'regionCount' | 'centers' | 'areaKm2' | 'neighborOffsets' | 'neighbors' | 'physicalRadiusKm'>>(
      context,
      'mesh',
      ({ meshId, regionCount, centers, areaKm2, neighborOffsets, neighbors, physicalRadiusKm }) => ({ meshId, regionCount, centers, areaKm2, neighborOffsets, neighbors, physicalRadiusKm }),
    )
    const terrain = copyDependency<TerrainArtifact, Pick<TerrainArtifact, 'meshId' | 'landMask' | 'elevationKm'>>(
      context,
      'terrain',
      ({ meshId, landMask, elevationKm }) => ({ meshId, landMask, elevationKm }),
    )
    const lakes = copyDependency<StaticLakeArtifact, Pick<StaticLakeArtifact, 'meshId' | 'lakeIndex'>>(
      context,
      'static-lakes-l1',
      ({ meshId, lakeIndex }) => ({ meshId, lakeIndex }),
    )
    const resources = copyDependency<ResourcePotentialArtifact, Pick<ResourcePotentialArtifact, 'meshId' | 'agriculturalPotential' | 'forestryPotential' | 'fisheryPotential'>>(
      context,
      'resource-potential',
      ({ meshId, agriculturalPotential, forestryPotential, fisheryPotential }) => ({ meshId, agriculturalPotential, forestryPotential, fisheryPotential }),
    )
    const habitability = copyDependency<HabitabilityArtifact, Pick<HabitabilityArtifact, 'meshId' | 'habitability' | 'movementCost' | 'coastalMask'>>(
      context,
      'habitability',
      ({ meshId, habitability, movementCost, coastalMask }) => ({ meshId, habitability, movementCost, coastalMask }),
    )
    const settlements = copyDependency<PopulationSettlementsArtifact, Pick<PopulationSettlementsArtifact, 'meshId' | 'enabled' | 'population' | 'settlementSites'>>(
      context,
      'population-settlements',
      ({ meshId, enabled, population, settlementSites }) => ({ meshId, enabled, population, settlementSites }),
    )
    const transport = copyDependency<TransportNetworkArtifact, Pick<TransportNetworkArtifact, 'meshId' | 'enabled' | 'nodes' | 'routes'>>(
      context,
      'transport-network',
      ({ meshId, enabled, nodes, routes }) => ({ meshId, enabled, nodes, routes }),
    )
    const output = generatePeoplesCultures(bundle, signature, mesh, terrain, lakes, resources, habitability, settlements, transport, context.worldSeed, context.getConfig('civilization.culturalDiversity') as number, (fraction) => {
      context.throwIfCancelled()
      context.progress(fraction, '生成族群、文化与聚落命名')
    })
    context.throwIfCancelled()
    context.progress(1)
    return output
  },
  validate: validatePeoplesCulturesArtifact,
}

export const politiesReligionsStage: GenerationStage<PolitiesReligionsArtifact> = {
  id: 'polities-religions',
  version: POLITIES_RELIGIONS_VERSION,
  dependencies: ['mesh', 'terrain', 'hydrology-h0', 'static-lakes-l1', 'ecology-e0', 'resource-potential', 'habitability', 'population-settlements', 'transport-network', 'peoples-cultures'],
  configKeys: [
    'civilization.enabled',
    'civilization.polityCount',
    'civilization.politySizeVariation',
    'civilization.urbanConcentration',
    'civilization.capabilities.administrativeCapacity',
    'civilization.capabilities.seafaringCapability',
    'civilization.capabilities.industrialCapability',
    'civilization.capabilities.landTransportCapability',
  ],
  contentKeys: ['civilization-content'],
  execute(context) {
    const params = resolveCivilizationParameters({
      enabled: context.getConfig('civilization.enabled') as boolean,
      polityCount: context.getConfig('civilization.polityCount') as number,
      politySizeVariation: context.getConfig('civilization.politySizeVariation') as number,
      urbanConcentration: context.getConfig('civilization.urbanConcentration') as number,
      capabilities: {
        administrativeCapacity: context.getConfig('civilization.capabilities.administrativeCapacity') as number,
        seafaringCapability: context.getConfig('civilization.capabilities.seafaringCapability') as number,
        industrialCapability: context.getConfig('civilization.capabilities.industrialCapability') as number,
        landTransportCapability: context.getConfig('civilization.capabilities.landTransportCapability') as number,
      },
    })
    const bundle = context.getContent<CivilizationContentBundle>('civilization-content')
    const signature = context.getContentSignature('civilization-content')
    if (!signature || signature !== civilizationContentSignature(bundle))
      throw new InvalidStageInputError(context.stageId, 'Civilization content signature mismatch')
    const mesh = copyDependency<SphericalMesh, Pick<SphericalMesh, 'meshId' | 'regionCount' | 'centers' | 'areaKm2' | 'neighborOffsets' | 'neighbors' | 'physicalRadiusKm'>>(
      context,
      'mesh',
      ({ meshId, regionCount, centers, areaKm2, neighborOffsets, neighbors, physicalRadiusKm }) => ({ meshId, regionCount, centers, areaKm2, neighborOffsets, neighbors, physicalRadiusKm }),
    )
    const terrain = copyDependency<TerrainArtifact, Pick<TerrainArtifact, 'meshId' | 'landMask' | 'elevationKm' | 'slopeRadians'>>(
      context,
      'terrain',
      ({ meshId, landMask, elevationKm, slopeRadians }) => ({ meshId, landMask, elevationKm, slopeRadians }),
    )
    const hydrology = copyDependency<HydrologyArtifact, Pick<HydrologyArtifact, 'meshId' | 'riverIndex' | 'downstreamRegion'>>(
      context,
      'hydrology-h0',
      ({ meshId, riverIndex, downstreamRegion }) => ({ meshId, riverIndex, downstreamRegion }),
    )
    const lakes = copyDependency<StaticLakeArtifact, Pick<StaticLakeArtifact, 'meshId' | 'lakeIndex'>>(
      context,
      'static-lakes-l1',
      ({ meshId, lakeIndex }) => ({ meshId, lakeIndex }),
    )
    const ecology = copyDependency<EcologyArtifact, Pick<EcologyArtifact, 'meshId' | 'landCoverIds' | 'landCoverIndex'>>(
      context,
      'ecology-e0',
      ({ meshId, landCoverIds, landCoverIndex }) => ({ meshId, landCoverIds, landCoverIndex }),
    )
    const resources = copyDependency<ResourcePotentialArtifact, Pick<ResourcePotentialArtifact, 'meshId' | 'agriculturalPotential' | 'forestryPotential' | 'fisheryPotential' | 'deposits'>>(
      context,
      'resource-potential',
      ({ meshId, agriculturalPotential, forestryPotential, fisheryPotential, deposits }) => ({ meshId, agriculturalPotential, forestryPotential, fisheryPotential, deposits }),
    )
    const habitability = copyDependency<HabitabilityArtifact, Pick<HabitabilityArtifact, 'meshId' | 'movementCost' | 'coastalMask' | 'economicOpportunity' | 'portPotential'>>(
      context,
      'habitability',
      ({ meshId, movementCost, coastalMask, economicOpportunity, portPotential }) => ({ meshId, movementCost, coastalMask, economicOpportunity, portPotential }),
    )
    const popSettlements = copyDependency<PopulationSettlementsArtifact, Pick<PopulationSettlementsArtifact, 'meshId' | 'enabled' | 'population'>>(
      context,
      'population-settlements',
      ({ meshId, enabled, population }) => ({ meshId, enabled, population }),
    )
    const transport = copyDependency<TransportNetworkArtifact, Pick<TransportNetworkArtifact, 'meshId' | 'nodes' | 'routes' | 'nodeCentrality'>>(
      context,
      'transport-network',
      ({ meshId, nodes, routes, nodeCentrality }) => ({ meshId, nodes, routes, nodeCentrality }),
    )
    const peoplesCultures = copyDependency<PeoplesCulturesArtifact, Pick<PeoplesCulturesArtifact, 'meshId' | 'peoples' | 'cultures' | 'namedSettlements' | 'hearthRegions' | 'regionCultures' | 'dominantCultureIndex' | 'usedNames'>>(
      context,
      'peoples-cultures',
      ({ meshId, peoples, cultures, namedSettlements, hearthRegions, regionCultures, dominantCultureIndex, usedNames }) => ({ meshId, peoples, cultures, namedSettlements, hearthRegions, regionCultures, dominantCultureIndex, usedNames }),
    )
    const output = generatePolitiesReligions(
      bundle,
      signature,
      mesh,
      terrain,
      lakes,
      resources,
      habitability,
      popSettlements,
      transport,
      peoplesCultures,
      params,
      context.worldSeed,
      (fraction) => {
        context.throwIfCancelled()
        context.progress(fraction, '划分政体领土、宗教传播与人群结构')
      },
      { hydrology, ecology },
    )
    context.throwIfCancelled()
    context.progress(1)
    return output
  },
  validate: validatePolitiesReligionsArtifact,
}

/** Complete natural + initial civilization pipeline sharing cache with natural sub-pipelines. */
export function createWorldPipeline(cache = new StageCache()): GenerationPipeline<WorldGenerationPipelineConfig> {
  const natural = createNaturalPipeline(cache)
  natural.registry
    .register(resourcePotentialStage)
    .register(habitabilityStage)
    .register(populationSettlementsStage)
    .register(transportNetworkStage)
    .register(peoplesCulturesStage)
    .register(politiesReligionsStage)

  return new class extends GenerationPipeline<WorldGenerationPipelineConfig> {
    constructor() { super(natural.registry, cache) }

    #normalizeInput(input: GenerationInput<WorldGenerationPipelineConfig>): GenerationInput<WorldGenerationPipelineConfig> {
      return { ...input, config: { ...input.config, civilization: resolveCivilizationParameters(input.config.civilization) } }
    }

    override plan(input: GenerationInput<WorldGenerationPipelineConfig>, options: Pick<PipelineOptions, 'force'> = {}) {
      const normalized = this.#normalizeInput(input)
      natural.plan(normalized, options)
      return super.plan(normalized, options)
    }

    override async execute(input: GenerationInput<WorldGenerationPipelineConfig>, options: PipelineOptions = {}) {
      const normalized = this.#normalizeInput(input)
      natural.plan(normalized, { force: options.force })
      return super.execute(normalized, options)
    }
  }()
}
