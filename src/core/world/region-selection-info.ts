import type { GeneratedSphericalWorld } from '@/core/simulation/pipeline/types'
import type { WorldConfig } from '@/core/simulation/config'
import type { SelectedRegionInfo } from '@/core/world/world-info'
import { createOutputClimateRegionSampler } from '@/core/climate/climate-output-projector'
import { koppenLabel } from '@/core/climate/koppen-climate-classifier'
import { biomeLabel } from '@/core/ecology/biome-data'

export class RegionSelectionInfoBuilder {
  private climateRegionSampler: ReturnType<typeof createOutputClimateRegionSampler> | null = null

  reset(): void {
    this.climateRegionSampler = null
  }

  build(
    world: GeneratedSphericalWorld,
    config: WorldConfig,
    region: number,
    settlementId?: number,
    routeId?: number,
  ): SelectedRegionInfo {
    const state = world.data
    const latitude = world.mesh.regionLatitude[region] * 180 / Math.PI
    const longitude = world.mesh.regionLongitude[region] * 180 / Math.PI
    const elevation = state.geography.elevation[region]
    const plate = state.geology.regionSuperPlate[region]
    const plateDetail = state.geology.regionPlate[region]
    const continent = state.geography.visibleContinentId[region]
    const society = state.society
    const selectedSettlement = settlementId !== undefined
      ? society?.settlements[settlementId]
      : society?.settlements[society.settlementByRegion[region]]
    const transport = society?.transport
    const selectedRoute = routeId !== undefined ? transport?.routes[routeId] : undefined
    const marketId = transport?.nearestMarket[region] ?? -1
    const ethnicity = society?.ethnicity
    const religionData = society?.religions
    const polityData = society?.polities
    const polityId = polityData?.polityByRegion[region] ?? -1
    const polity = polityId >= 0 ? polityData?.polities[polityId] : undefined
    const districtId = polityData?.districtByRegion[region] ?? -1
    const district = districtId >= 0 ? polityData?.districts[districtId] : undefined
    const ethnicComposition: NonNullable<SelectedRegionInfo['ethnicComposition']> = []
    const languageResidents = new Map<number, number>()

    if (ethnicity && society.population[region] > 0) {
      for (let index = ethnicity.regionOffsets[region]; index < ethnicity.regionOffsets[region + 1]; index++) {
        const group = ethnicity.groups[ethnicity.groupIds[index]]
        const residents = ethnicity.residents[index]
        ethnicComposition.push({
          name: group.name,
          population: residents,
          share: residents / society.population[region],
          originRegion: group.originRegion,
          languageName: ethnicity.languages[group.languageId].name,
        })
        languageResidents.set(group.languageId, (languageResidents.get(group.languageId) ?? 0) + residents)
      }
    }

    const languageComposition = [...languageResidents].map(([id, population]) => {
      const language = ethnicity!.languages[id]
      return {
        name: language.name,
        population,
        share: population / society!.population[region],
        familyName: ethnicity!.languageFamilies[language.familyId].name,
      }
    }).sort((a, b) => b.population - a.population)

    const religiousComposition: NonNullable<SelectedRegionInfo['religiousComposition']> = []
    if (religionData && society.population[region] > 0) {
      for (let index = religionData.regionOffsets[region]; index < religionData.regionOffsets[region + 1]; index++) {
        const religionId = religionData.affiliationIds[index]
        const religion = religionId >= 0 ? religionData.religions[religionId] : undefined
        const residents = religionData.residents[index]
        religiousComposition.push({
          name: religion?.name ?? '无归属',
          population: residents,
          share: residents / society.population[region],
          originName: religion ? society.settlements[religion.originSettlementId]?.name : undefined,
          parentName: religion && religion.parentReligionId >= 0
            ? religionData.religions[religion.parentReligionId]?.name
            : undefined,
        })
      }
    }

    const climate = state.climate
    const displayVector = climate?.displayVector
    const vectorInfo = displayVector?.month === config.appearance.climateMonth
      && displayVector.kind === config.appearance.baseMap
      ? {
          vectorEast: displayVector.east[region],
          vectorNorth: displayVector.north[region],
          vectorKind: displayVector.kind,
          vectorWarmth: displayVector.warmth?.[region],
        }
      : {}

    let climateInfo: Partial<SelectedRegionInfo> = {}
    if (climate?.monthly && climate.koppen) {
      if (!this.climateRegionSampler) {
        const climateMesh = world.mesh.numRegions <= world.referenceMesh.numRegions
          ? world.mesh
          : world.referenceMesh
        this.climateRegionSampler = createOutputClimateRegionSampler(
          climate,
          state.geography,
          config.climate.axialTiltDeg,
          climateMesh,
        )
      }
      const monthlyTemperatureC: number[] = []
      const monthlyPrecipitationMm: number[] = []
      for (let month = 0; month < 12; month++) {
        const fields = this.climateRegionSampler(region, month)
        monthlyTemperatureC.push(fields.temperatureC)
        monthlyPrecipitationMm.push(fields.precipitationMm)
      }
      climateInfo = {
        isLand: Boolean(state.geography.landMask[region]),
        koppenLabel: koppenLabel(climate.koppen.climateClass[region]),
        biomeLabel: state.biome ? biomeLabel(state.biome.biomeClass[region]) : undefined,
        aridityIndex: state.biome?.aridityIndex[region],
        growingSeasonMonths: state.biome?.growingSeasonMonths[region],
        annualTemperatureC: climate.koppen.annualTemperatureC[region],
        annualPrecipitationMm: climate.koppen.annualPrecipitationMm[region],
        monthlyTemperatureC,
        monthlyPrecipitationMm,
      }
    }

    return {
      region,
      latitude,
      longitude,
      elevation,
      isLand: Boolean(state.geography.landMask[region]),
      plate,
      plateDetail,
      continent,
      geometricFlowCount: state.geography.terrainErosion.flowAccumulation[region],
      habitability: society?.habitability[region],
      population: society?.population[region],
      populationDensity: society?.populationDensity[region],
      ethnicComposition: ethnicity ? ethnicComposition : undefined,
      languageComposition: ethnicity ? languageComposition : undefined,
      religiousComposition: religionData ? religiousComposition : undefined,
      sacredSiteNames: religionData?.sacredSites.filter(site => site.region === region).map(site => site.name),
      polityName: polity?.name,
      polityForm: polity?.governingForm,
      capitalName: polity ? society?.settlements[polity.capitalSettlementId]?.name : undefined,
      officialLanguageName: polity && polity.officialLanguageId >= 0 ? ethnicity?.languages[polity.officialLanguageId]?.name : undefined,
      controlStrength: polity ? polityData?.controlStrength[region] : undefined,
      districtName: district?.name,
      patronReligionName: polity?.patronReligionId !== undefined
        ? religionData?.religions[polity.patronReligionId]?.name
        : undefined,
      settlement: selectedSettlement,
      route: selectedRoute,
      routeFromName: selectedRoute ? society?.settlements[selectedRoute.fromSettlement]?.name : undefined,
      routeToName: selectedRoute ? society?.settlements[selectedRoute.toSettlement]?.name : undefined,
      nearestMarketName: marketId >= 0 ? society?.settlements[marketId]?.name : undefined,
      marketCostKm: Number.isFinite(transport?.marketCostKm[region]) ? transport?.marketCostKm[region] : undefined,
      marketAccess: transport?.marketAccess[region],
      isPort: selectedSettlement ? Boolean(transport?.portSettlementIds[selectedSettlement.id]) : false,
      ...climateInfo,
      ...vectorInfo,
    }
  }
}
