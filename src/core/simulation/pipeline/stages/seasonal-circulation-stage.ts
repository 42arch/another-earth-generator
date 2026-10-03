import type SphericalMesh from '@/core/mesh/mesh'
import type { ISimulationStage, SimulationContext } from '@/core/simulation/pipeline/types'
import { generateSeasonalOcean } from '@/core/climate/seasonal-ocean-generator'
import { generateSeasonalWind } from '@/core/climate/seasonal-wind-generator'

interface ClimateSurface {
  mesh: SphericalMesh
  elevationKm: Float32Array
  landMask: Uint8Array
}

/** Builds a climate surface from the finalized output terrain. */
function climateSurface(context: SimulationContext): ClimateSurface {
  const { mesh, referenceMesh, projector, data } = context
  if (!mesh || !referenceMesh || !projector || !data)
    throw new Error('Missing dependencies in SeasonalCirculationStage')
  if (mesh.numRegions <= referenceMesh.numRegions) {
    return {
      mesh,
      elevationKm: data.geography.elevation,
      landMask: data.geography.landMask,
    }
  }

  const count = referenceMesh.numRegions
  const elevationSum = new Float64Array(count)
  const landArea = new Float64Array(count)
  const areaSum = new Float64Array(count)
  const elevationKm = new Float32Array(count)
  const landMask = new Uint8Array(count)
  const outputToClimate = projector.project(mesh.regionPosition)
  context.climateOutputToReference = outputToClimate
  for (let region = 0; region < mesh.numRegions; region++) {
    const target = outputToClimate[region]
    const area = mesh.regionArea[region]
    areaSum[target] += area
    elevationSum[target] += data.geography.elevation[region] * area
    if (data.geography.landMask[region])
      landArea[target] += area
  }

  const queue = new Uint32Array(count)
  let tail = 0
  for (let region = 0; region < count; region++) {
    if (areaSum[region] <= 0)
      continue
    landMask[region] = landArea[region] >= 0.5 * areaSum[region] ? 1 : 0
    const meanElevation = elevationSum[region] / areaSum[region]
    elevationKm[region] = landMask[region]
      ? Math.max(0, meanElevation)
      : Math.min(0, meanElevation)
    queue[tail++] = region
  }
  // At output resolutions near the reference size, some reference cells can
  // receive no output site. Fill them from adjacent sampled cells.
  for (let head = 0; head < tail; head++) {
    const region = queue[head]
    for (let index = referenceMesh.neighborOffsets[region]; index < referenceMesh.neighborOffsets[region + 1]; index++) {
      const neighbor = referenceMesh.neighbors[index]
      if (areaSum[neighbor] > 0)
        continue
      areaSum[neighbor] = 1
      elevationKm[neighbor] = elevationKm[region]
      landMask[neighbor] = landMask[region]
      queue[tail++] = neighbor
    }
  }
  return { mesh: referenceMesh, elevationKm, landMask }
}

export class SeasonalCirculationStage implements ISimulationStage {
  name = 'SeasonalCirculation'

  execute(context: SimulationContext): void {
    if (!context.data)
      throw new Error('Missing terrain in SeasonalCirculationStage')
    const { mesh, elevationKm, landMask } = climateSurface(context)
    const wind = generateSeasonalWind(
      mesh,
      elevationKm,
      landMask,
      context.config.climate.axialTiltDeg,
      context.config.core.seed,
    )
    const ocean = generateSeasonalOcean(mesh, landMask, wind)
    context.data.climate = {
      surface: {
        regionCount: mesh.numRegions,
        landMask,
        elevationKm,
      },
      circulation: {
        regionCount: mesh.numRegions,
        ...wind,
        ...ocean,
      },
    }
  }
}
