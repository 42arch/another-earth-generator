import type { ISimulationStage, SimulationContext } from '@/core/simulation/pipeline/types'
import type { WorldSimulationState } from '@/core/simulation/state'
import {
  normalizedElevationArrayToKm,
  normalizedElevationDeltaArrayToKm,
} from '@/core/geography/elevation-units'
import { TerrainPostProcessor } from '@/core/geography/terrain-post-processor'
import { TectonicElevationGenerator } from '@/core/geology/tectonic-elevation-generator'

export class TerrainStage implements ISimulationStage {
  name = 'ElevationAndTerrain'

  private readonly elevationGenerator = new TectonicElevationGenerator()
  private readonly terrainPostProcessor = new TerrainPostProcessor()

  execute(context: SimulationContext): void {
    const {
      config,
      mesh,
      candidateLandMask,
      tectonics,
      mantle,
      regionPlate,
      regionSuperPlate,
      continentId,
    } = context

    if (!mesh || !candidateLandMask || !tectonics || !mantle || !regionPlate || !regionSuperPlate || !continentId) {
      throw new Error('Missing dependencies in TerrainStage')
    }

    const elevationFields = this.elevationGenerator.generate(
      mesh,
      candidateLandMask,
      tectonics,
      config.core.seed,
      {
        islandArcCount: config.geology.islandArcCount,
        islandDensity: config.geology.islandDensity,
        hotspotCount: config.geology.hotspotCount,
      },
    )

    const terrain = this.terrainPostProcessor.generate(
      mesh,
      elevationFields.elevation,
      candidateLandMask,
      elevationFields.spatialFields,
      elevationFields.classification,
      config.core.seed,
      config.geology.islandDensity,
      config.terrain.roughness,
      config.terrain.terrainWarp,
      config.terrain.smoothing,
      config.terrain.glacialErosion,
      config.terrain.hydraulicErosion,
      config.terrain.ridgeSharpening,
      mantle.elevationDelta,
      elevationFields.phasorRidge,
      elevationFields.edifices.hotspot,
    )

    const landMask = terrain.landMask
    let landArea = 0
    for (let region = 0; region < mesh.numRegions; region++) {
      if (landMask[region] === 1)
        landArea += mesh.regionArea[region]
    }

    const data: WorldSimulationState = {
      geology: {
        regionPlate,
        regionSuperPlate,
        tectonics: {
          ...tectonics,
          plateBaseElevation: normalizedElevationArrayToKm(tectonics.plateBaseElevation),
          regionBaseElevation: normalizedElevationArrayToKm(tectonics.regionBaseElevation),
        },
        edifices: {
          islandArc: normalizedElevationDeltaArrayToKm(elevationFields.edifices.islandArc),
          volcanicArc: normalizedElevationDeltaArrayToKm(elevationFields.edifices.volcanicArc),
          hotspot: normalizedElevationDeltaArrayToKm(elevationFields.edifices.hotspot),
          largeIgneousProvince: normalizedElevationDeltaArrayToKm(
            elevationFields.edifices.largeIgneousProvince,
          ),
          total: normalizedElevationDeltaArrayToKm(elevationFields.edifices.total),
        },
        mantleFlow: mantle.normalizedFlow,
        dynamicTopography: normalizedElevationDeltaArrayToKm(mantle.elevationDelta),
      },
      geography: {
        baseElevation: normalizedElevationArrayToKm(elevationFields.elevation),
        elevation: terrain.elevation,
        terrainNoise: terrain.terrainNoise,
        terrainTexture: terrain.texture,
        terrainFinalization: terrain.finalization,
        terrainErosion: terrain.erosion,
        landMask,
        candidateLandMask,
        continentId,
        terrainFields: elevationFields.spatialFields,
        terrainClassification: elevationFields.classification,
        landArea,
      },
    }

    context.elevationFields = elevationFields
    context.terrain = terrain
    context.landMask = landMask
    context.landArea = landArea
    context.data = data
  }
}
