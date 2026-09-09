import type { HydrologyDiagnostics } from '@/core/spherical/hydrology/coupling-data'
import type { GlobeGenParams } from '@/core/spherical/config'
import type { SphericalClimateData } from '@/core/spherical/climate/climate-data'
import type { SphericalLakeData, SphericalRiverData } from '@/core/spherical/hydrology/hydrology-data'
import type { SphericalHumanData } from '@/core/spherical/society/society-data'
import type { SphericalWorldData } from '@/core/spherical/spherical-world-data'
import { SphericalClimateGenerator } from '@/core/spherical/climate/climate-generator'
import { SphericalFeatureGenerator } from '@/core/spherical/geography/feature-generator'
import { SphericalElevationGenerator } from '@/core/spherical/geology/elevation-generator'
import { physicalElevationToRender } from '@/core/spherical/geology/elevation-scale'
import { SphericalLandmassGenerator } from '@/core/spherical/geology/landmass-generator'
import { SphericalPlateGenerator } from '@/core/spherical/geology/plate-generator'
import { SphericalLakeGenerator } from '@/core/spherical/hydrology/lake-generator'
import { HYDROLOGY_INFLOW_TOLERANCE, MAX_HYDROLOGY_ITERATIONS } from '@/core/spherical/hydrology/coupling-data'
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
  hydrologyElevationMeters: Float32Array
  diagnostics: HydrologyDiagnostics
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
  onProgress?: (stage: string) => void

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
    this.onProgress?.('mesh')
    const mesh = new SphericalMesh(
      this.meshBuilder.build(params.subdivision, params.seed),
    )
    this.onProgress?.('tectonics')
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
    this.onProgress?.('elevation')
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
      elevationData.physicalElevationMeters,
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
      hydrologyElevationMeters: hydrology.hydrologyElevationMeters,
      hydrologyDiagnostics: hydrology.diagnostics,
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
    this.onProgress?.('tectonics')
    data.tectonics = this.plateGenerator.generate(mesh, params)
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
    this.onProgress?.('elevation')
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
      data.physicalElevationMeters,
      data.climateElevationMeters,
      data.continentality,
      data.baseLandMask,
      params,
    )
    data.hydrologyElevationMeters = hydrology.hydrologyElevationMeters
    data.hydrologyDiagnostics = hydrology.diagnostics
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
      data.hydrologyElevationMeters,
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
    this.onProgress?.('human')
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
    this.onProgress?.('transport')
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
    this.onProgress?.('trade')
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
    this.onProgress?.('cultures')
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
    this.onProgress?.('polities')
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
    this.onProgress?.('religions')
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
    this.onProgress?.('naming')
    data.human.naming = this.namingGenerator.generate(mesh, {
      climateElevationMeters: data.climateElevationMeters,
      rivers: data.rivers,
      human: data.human,
    }, params)
  }

  private generateHydrology(
    mesh: SphericalMesh,
    baseElevation: Float32Array,
    physicalElevationMeters: Float32Array,
    climateElevationMeters: Float32Array,
    continentality: Float32Array,
    baseLandMask: Uint8Array,
    params: GlobeGenParams,
  ): SphericalHydrologyResult {
    this.onProgress?.('lakes')
    const topographic = this.lakeGenerator.generate(mesh, physicalElevationMeters, baseLandMask, params)
    this.onProgress?.('climate')
    // Ocean circulation and temperature do not depend on the changing lake mask.
    const background = this.climateGenerator.prepareBackground(
      mesh, climateElevationMeters, continentality, baseLandMask, params,
    )
    let balanced = topographic
    const calculateClimate = () => {
      this.onProgress?.('climate')
      return this.climateGenerator.generate(
        mesh, balanced.elevation, climateElevationMeters, continentality,
        balanced.landMask, baseLandMask, params, background,
      )
    }
    let climate = calculateClimate()
    const calculateRivers = () => {
      this.onProgress?.('rivers')
      return this.riverGenerator.generate(
        mesh, balanced.elevation, balanced.landMask,
        climate.runoff, climate.seasonalRunoff, params, balanced.lakes,
      )
    }
    let rivers = calculateRivers()
    let estimate = this.riverGenerator.calculateLakeInflow(balanced.landMask, balanced.lakes, rivers)
    const diagnostics: HydrologyDiagnostics = {
      iterations: 0, converged: estimate.length === 0,
      maximumRelativeInflowChange: 0, changedLakeRegions: 0,
    }
    for (let iteration = 0; iteration < MAX_HYDROLOGY_ITERATIONS && estimate.length > 0; iteration++) {
      const previousMask = balanced.lakes.lakeMask
      this.onProgress?.('lakes')
      balanced = this.lakeGenerator.balanceWater(
        mesh, physicalElevationMeters, baseLandMask, topographic, estimate, climate, params,
      )
      climate = calculateClimate()
      rivers = calculateRivers()
      const actual = this.riverGenerator.calculateLakeInflow(balanced.landMask, balanced.lakes, rivers)
      // Keep original basin IDs while L2 shrinks/removes and renumbers active lakes.
      const activeToBasin = new Int32Array(balanced.lakes.area.length).fill(-1)
      let changedRegions = 0
      for (let region = 0; region < mesh.numRegions; region++) {
        const lake = balanced.lakes.regionLakeId[region]
        if (lake >= 0)
          activeToBasin[lake] = topographic.lakes.regionLakeId[region]
        changedRegions += previousMask[region] !== balanced.lakes.lakeMask[region] ? 1 : 0
      }
      // Dry basins can recover: evaluate their potential catchment under final rainfall.
      const next = balanced.lakes.area.length === estimate.length
        ? new Float32Array(estimate)
        : this.riverGenerator.calculateLakeInflow(
            topographic.landMask, topographic.lakes,
            this.riverGenerator.generate(mesh, topographic.elevation, topographic.landMask,
              climate.runoff, climate.seasonalRunoff, params, topographic.lakes),
          )
      for (let lake = 0; lake < actual.length; lake++) {
        const basin = activeToBasin[lake]
        if (basin >= 0)
          next[basin] = actual[lake]
      }
      let residual = 0
      for (let basin = 0; basin < estimate.length; basin++) {
        residual = Math.max(residual, Math.abs(next[basin] - estimate[basin])
          / Math.max(1e-6, next[basin], estimate[basin]))
      }
      diagnostics.iterations = iteration + 1
      diagnostics.maximumRelativeInflowChange = residual
      diagnostics.changedLakeRegions = changedRegions
      diagnostics.converged = residual <= HYDROLOGY_INFLOW_TOLERANCE && changedRegions === 0
      balanced.lakes.inflow = actual
      if (diagnostics.converged)
        break
      // Damping limits wet/dry oscillations at discrete lake shores.
      for (let basin = 0; basin < estimate.length; basin++)
        next[basin] = (next[basin] + estimate[basin]) * 0.5
      estimate = next
    }
    balanced.lakes.inflow = this.riverGenerator.calculateLakeInflow(balanced.landMask, balanced.lakes, rivers)
    const seasonalInflow = this.riverGenerator.calculateSeasonalLakeInflow(balanced.landMask, balanced.lakes, rivers)
    this.lakeGenerator.updateSeasonalWaterBalance(mesh, balanced.lakes, climate, seasonalInflow, params)
    const features = this.featureGenerator.generate(mesh, balanced.landMask)
    // Only the presentation field uses the non-linear elevation mapping.
    const elevation = new Float32Array(baseElevation)
    for (let region = 0; region < mesh.numRegions; region++) {
      if (balanced.lakes.lakeMask[region])
        elevation[region] = physicalElevationToRender(balanced.elevation[region])
    }
    return {
      elevation,
      hydrologyElevationMeters: balanced.elevation,
      diagnostics,
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
    this.onProgress?.('human')
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
