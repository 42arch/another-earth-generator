import type { GlobeGenParams } from '@/core/spherical/config'
import type { SphericalClimateData } from '@/core/spherical/climate/climate-data'
import type { SphericalLakeData, SphericalRiverData } from '@/core/spherical/hydrology/hydrology-data'
import type { SphericalHumanData } from '@/core/spherical/society/society-data'
import type { SphericalWorldData } from '@/core/spherical/spherical-world-data'
import { SphericalClimateGenerator } from '@/core/spherical/climate/climate-generator'
import { SphericalFeatureGenerator } from '@/core/spherical/geography/feature-generator'
import { SphericalElevationGenerator } from '@/core/spherical/geology/elevation-generator'
import { SphericalLandmassGenerator } from '@/core/spherical/geology/landmass-generator'
import { SphericalPlateGenerator } from '@/core/spherical/geology/plate-generator'
import { SphericalLakeGenerator } from '@/core/spherical/hydrology/lake-generator'
import { SphericalRiverGenerator } from '@/core/spherical/hydrology/river-generator'
import { SphericalCultureGenerator } from '@/core/spherical/society/culture-generator'
import { SphericalHumanGenerator } from '@/core/spherical/society/human-generator'
import { SphericalMaritimeContactGenerator } from '@/core/spherical/society/maritime-contact-generator'
import { SphericalNamingGenerator } from '@/core/spherical/society/naming-generator'
import { SphericalPolityGenerator } from '@/core/spherical/society/polity-generator'
import { SphericalReligionGenerator } from '@/core/spherical/society/religion-generator'
import { SphericalTradeGenerator } from '@/core/spherical/society/trade-generator'
import { SphericalTransportGenerator } from '@/core/spherical/society/transport-generator'
import { IcosphereBuilder } from '@/core/spherical/mesh/icosphere-builder'
import SphericalMesh from '@/core/spherical/spherical-mesh'

export interface GeneratedSphericalWorld {
  mesh: SphericalMesh
  data: SphericalWorldData
}

interface SphericalHydrologyResult {
  elevation: Float32Array
  landMask: Uint8Array
  lakes: SphericalLakeData
  climate: SphericalClimateData
  rivers: SphericalRiverData
  regionFeature: Uint8Array
  regionFeatureId: Int32Array
  landArea: number
}

export class SphericalWorldGenerator {
  private readonly meshBuilder = new IcosphereBuilder()
  private readonly climateGenerator = new SphericalClimateGenerator()
  private readonly cultureGenerator = new SphericalCultureGenerator()
  private readonly plateGenerator = new SphericalPlateGenerator()
  private readonly landmassGenerator = new SphericalLandmassGenerator()
  private readonly lakeGenerator = new SphericalLakeGenerator()
  private readonly maritimeContactGenerator = new SphericalMaritimeContactGenerator()
  private readonly elevationGenerator = new SphericalElevationGenerator()
  private readonly featureGenerator = new SphericalFeatureGenerator()
  private readonly humanGenerator = new SphericalHumanGenerator()
  private readonly namingGenerator = new SphericalNamingGenerator()
  private readonly polityGenerator = new SphericalPolityGenerator()
  private readonly riverGenerator = new SphericalRiverGenerator()
  private readonly religionGenerator = new SphericalReligionGenerator()
  private readonly tradeGenerator = new SphericalTradeGenerator()
  private readonly transportGenerator = new SphericalTransportGenerator()

  generate(params: GlobeGenParams): GeneratedSphericalWorld {
    const mesh = new SphericalMesh(
      this.meshBuilder.build(params.subdivision, params.seed),
    )
    const tectonics = this.plateGenerator.generate(mesh, params)
    const provisionalLandmasses = this.landmassGenerator.generate(
      mesh,
      tectonics,
      params,
      continentalCrustMask => this.plateGenerator.enrichCrust(
        mesh,
        tectonics,
        continentalCrustMask,
        params.seed,
      ),
    )
    this.plateGenerator.promoteContinentalFragments(
      mesh,
      tectonics,
      provisionalLandmasses.regionIslandType,
      provisionalLandmasses.regionIslandAge,
      params.seed,
    )
    const elevationData = this.elevationGenerator.generate(
      mesh,
      tectonics,
      provisionalLandmasses.landMask,
      params,
      provisionalLandmasses.regionIslandType,
      provisionalLandmasses.regionIslandAge,
    )
    const landmasses = this.landmassGenerator.reconcileLandMask(
      mesh,
      provisionalLandmasses,
      elevationData.landMask,
    )
    this.plateGenerator.promoteContinentalFragments(
      mesh,
      tectonics,
      landmasses.regionIslandType,
      landmasses.regionIslandAge,
      params.seed,
    )
    const baseElevation = elevationData.renderElevation
    const hydrology = this.generateHydrology(
      mesh,
      baseElevation,
      elevationData.climateElevationMeters,
      elevationData.continentality,
      landmasses.landMask,
      params,
    )
    const human = this.generateHuman(
      mesh,
      elevationData.climateElevationMeters,
      hydrology,
      params,
    )
    const data: SphericalWorldData = {
      baseElevation: new Float32Array(baseElevation),
      elevation: hydrology.elevation,
      physicalElevationMeters: elevationData.physicalElevationMeters,
      naturalBathymetryMeters: elevationData.naturalBathymetryMeters,
      seaLevelMeters: elevationData.seaLevelMeters,
      climateElevationMeters: elevationData.climateElevationMeters,
      continentality: elevationData.continentality,
      climate: hydrology.climate,
      baseLandMask: new Uint8Array(landmasses.landMask),
      landMask: hydrology.landMask,
      regionFeature: hydrology.regionFeature,
      regionFeatureId: hydrology.regionFeatureId,
      regionContinent: landmasses.regionContinent,
      regionIslandType: landmasses.regionIslandType,
      regionIslandGroup: landmasses.regionIslandGroup,
      regionIslandAge: landmasses.regionIslandAge,
      tectonics,
      lakes: hydrology.lakes,
      rivers: hydrology.rivers,
      human,
      landArea: hydrology.landArea,
    }
    this.regenerateTransport(mesh, data, params)
    return { mesh, data }
  }

  regenerateElevation(
    mesh: SphericalMesh,
    data: SphericalWorldData,
    params: GlobeGenParams,
  ): void {
    const provisionalLandmasses = this.landmassGenerator.generate(
      mesh,
      data.tectonics,
      params,
      continentalCrustMask => this.plateGenerator.enrichCrust(
        mesh,
        data.tectonics,
        continentalCrustMask,
        params.seed,
      ),
    )
    this.plateGenerator.promoteContinentalFragments(
      mesh,
      data.tectonics,
      provisionalLandmasses.regionIslandType,
      provisionalLandmasses.regionIslandAge,
      params.seed,
    )
    const elevationData = this.elevationGenerator.generate(
      mesh,
      data.tectonics,
      provisionalLandmasses.landMask,
      params,
      provisionalLandmasses.regionIslandType,
      provisionalLandmasses.regionIslandAge,
    )
    const landmasses = this.landmassGenerator.reconcileLandMask(
      mesh,
      provisionalLandmasses,
      elevationData.landMask,
    )
    this.plateGenerator.promoteContinentalFragments(
      mesh,
      data.tectonics,
      landmasses.regionIslandType,
      landmasses.regionIslandAge,
      params.seed,
    )
    data.baseElevation = elevationData.renderElevation
    data.physicalElevationMeters = elevationData.physicalElevationMeters
    data.naturalBathymetryMeters = elevationData.naturalBathymetryMeters
    data.seaLevelMeters = elevationData.seaLevelMeters
    data.climateElevationMeters = elevationData.climateElevationMeters
    data.continentality = elevationData.continentality
    data.baseLandMask = landmasses.landMask
    data.regionContinent = landmasses.regionContinent
    data.regionIslandType = landmasses.regionIslandType
    data.regionIslandGroup = landmasses.regionIslandGroup
    data.regionIslandAge = landmasses.regionIslandAge
    this.regenerateLakes(mesh, data, params)
  }

  regenerateLakes(
    mesh: SphericalMesh,
    data: SphericalWorldData,
    params: GlobeGenParams,
  ): void {
    const hydrology = this.generateHydrology(
      mesh,
      data.baseElevation,
      data.climateElevationMeters,
      data.continentality,
      data.baseLandMask,
      params,
    )
    data.elevation = hydrology.elevation
    data.landMask = hydrology.landMask
    data.lakes = hydrology.lakes
    data.landArea = hydrology.landArea
    data.regionFeature = hydrology.regionFeature
    data.regionFeatureId = hydrology.regionFeatureId
    data.climate = hydrology.climate
    data.rivers = hydrology.rivers
    this.regenerateHuman(mesh, data, params)
  }

  regenerateClimate(
    mesh: SphericalMesh,
    data: SphericalWorldData,
    params: GlobeGenParams,
  ): void {
    this.regenerateLakes(mesh, data, params)
  }

  regenerateRivers(
    mesh: SphericalMesh,
    data: SphericalWorldData,
    params: GlobeGenParams,
  ): void {
    data.rivers = this.riverGenerator.generate(
      mesh,
      data.elevation,
      data.landMask,
      data.climate.runoff,
      data.climate.seasonalRunoff,
      params,
      data.lakes,
    )
    data.lakes.inflow = this.riverGenerator.calculateLakeInflow(
      data.landMask,
      data.lakes,
      data.rivers,
    )
    const seasonalInflow = this.riverGenerator.calculateSeasonalLakeInflow(
      data.landMask,
      data.lakes,
      data.rivers,
    )
    this.lakeGenerator.updateSeasonalWaterBalance(
      mesh,
      data.lakes,
      data.climate,
      seasonalInflow,
      params,
    )
    this.regenerateHuman(mesh, data, params)
  }

  regenerateHuman(
    mesh: SphericalMesh,
    data: SphericalWorldData,
    params: GlobeGenParams,
  ): void {
    data.human = this.humanGenerator.generate(mesh, {
      elevation: data.elevation,
      climateElevationMeters: data.climateElevationMeters,
      landMask: data.landMask,
      regionFeature: data.regionFeature,
      climate: data.climate,
      rivers: data.rivers,
    }, params)
    this.regenerateTransport(mesh, data, params)
  }

  regenerateTransport(
    mesh: SphericalMesh,
    data: SphericalWorldData,
    params: GlobeGenParams,
  ): void {
    data.human.maritimeContacts = this.maritimeContactGenerator.generate(mesh, {
      landMask: data.landMask,
      regionFeature: data.regionFeature,
      climate: data.climate,
      settlements: data.human.settlements,
    }, params)
    data.human.transport = this.transportGenerator.generate(mesh, {
      elevation: data.elevation,
      climateElevationMeters: data.climateElevationMeters,
      landMask: data.landMask,
      regionFeature: data.regionFeature,
      climate: data.climate,
      rivers: data.rivers,
      human: data.human,
    }, params)
    this.regenerateTrade(mesh, data, params)
  }

  regenerateTrade(
    mesh: SphericalMesh,
    data: SphericalWorldData,
    params: GlobeGenParams,
  ): void {
    data.human.trade = this.tradeGenerator.generate(mesh, {
      elevation: data.elevation,
      climateElevationMeters: data.climateElevationMeters,
      landMask: data.landMask,
      regionFeature: data.regionFeature,
      tectonicStress: data.tectonics.regionStress,
      climate: data.climate,
      rivers: data.rivers,
      human: data.human,
    }, params)
    this.regenerateCultures(mesh, data, params)
  }

  regenerateCultures(
    mesh: SphericalMesh,
    data: SphericalWorldData,
    params: GlobeGenParams,
  ): void {
    data.human.culture = this.cultureGenerator.generate(mesh, {
      elevation: data.elevation,
      climateElevationMeters: data.climateElevationMeters,
      landMask: data.landMask,
      climate: data.climate,
      rivers: data.rivers,
      human: data.human,
    }, params)
    this.regeneratePolities(mesh, data, params)
  }

  regeneratePolities(
    mesh: SphericalMesh,
    data: SphericalWorldData,
    params: GlobeGenParams,
  ): void {
    data.human.politics = this.polityGenerator.generate(mesh, {
      elevation: data.elevation,
      landMask: data.landMask,
      regionIslandGroup: data.regionIslandGroup,
      climate: data.climate,
      rivers: data.rivers,
      human: data.human,
    }, params)
    this.regenerateReligions(mesh, data, params)
  }

  regenerateReligions(
    mesh: SphericalMesh,
    data: SphericalWorldData,
    params: GlobeGenParams,
  ): void {
    data.human.religion = this.religionGenerator.generate(mesh, {
      elevation: data.elevation,
      climateElevationMeters: data.climateElevationMeters,
      landMask: data.landMask,
      climate: data.climate,
      rivers: data.rivers,
      human: data.human,
    }, params)
    this.regenerateNaming(mesh, data, params)
  }

  regenerateNaming(
    mesh: SphericalMesh,
    data: SphericalWorldData,
    params: GlobeGenParams,
  ): void {
    data.human.naming = this.namingGenerator.generate(mesh, {
      climateElevationMeters: data.climateElevationMeters,
      rivers: data.rivers,
      human: data.human,
    }, params)
  }

  private generateHydrology(
    mesh: SphericalMesh,
    baseElevation: Float32Array,
    climateElevationMeters: Float32Array,
    continentality: Float32Array,
    baseLandMask: Uint8Array,
    params: GlobeGenParams,
  ): SphericalHydrologyResult {
    const topographic = this.lakeGenerator.generate(
      mesh,
      baseElevation,
      baseLandMask,
      params,
    )
    const provisionalClimate = this.climateGenerator.generate(
      mesh,
      topographic.elevation,
      climateElevationMeters,
      continentality,
      topographic.landMask,
      baseLandMask,
      params,
    )
    const provisionalRivers = this.riverGenerator.generate(
      mesh,
      topographic.elevation,
      topographic.landMask,
      provisionalClimate.runoff,
      provisionalClimate.seasonalRunoff,
      params,
      topographic.lakes,
    )
    const provisionalInflow = this.riverGenerator.calculateLakeInflow(
      topographic.landMask,
      topographic.lakes,
      provisionalRivers,
    )
    const balanced = this.lakeGenerator.balanceWater(
      mesh,
      baseElevation,
      baseLandMask,
      topographic,
      provisionalInflow,
      provisionalClimate.temperature,
      provisionalClimate.warmestMonthTemperature,
      params,
    )
    const features = this.featureGenerator.generate(mesh, balanced.landMask)
    const climate = this.climateGenerator.generate(
      mesh,
      balanced.elevation,
      climateElevationMeters,
      continentality,
      balanced.landMask,
      baseLandMask,
      params,
    )
    const rivers = this.riverGenerator.generate(
      mesh,
      balanced.elevation,
      balanced.landMask,
      climate.runoff,
      climate.seasonalRunoff,
      params,
      balanced.lakes,
    )
    balanced.lakes.inflow = this.riverGenerator.calculateLakeInflow(
      balanced.landMask,
      balanced.lakes,
      rivers,
    )
    const seasonalInflow = this.riverGenerator.calculateSeasonalLakeInflow(
      balanced.landMask,
      balanced.lakes,
      rivers,
    )
    this.lakeGenerator.updateSeasonalWaterBalance(
      mesh,
      balanced.lakes,
      climate,
      seasonalInflow,
      params,
    )
    return {
      elevation: balanced.elevation,
      landMask: balanced.landMask,
      lakes: balanced.lakes,
      climate,
      rivers,
      regionFeature: features.regionFeature,
      regionFeatureId: features.regionFeatureId,
      landArea: balanced.landArea,
    }
  }

  private generateHuman(
    mesh: SphericalMesh,
    climateElevationMeters: Float32Array,
    hydrology: SphericalHydrologyResult,
    params: GlobeGenParams,
  ): SphericalHumanData {
    return this.humanGenerator.generate(mesh, {
      elevation: hydrology.elevation,
      climateElevationMeters,
      landMask: hydrology.landMask,
      regionFeature: hydrology.regionFeature,
      climate: hydrology.climate,
      rivers: hydrology.rivers,
    }, params)
  }
}
