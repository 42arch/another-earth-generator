import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldSimulationState } from '@/core/simulation/state'
import { SphericalRegionTopologyBuilder } from '@/core/rendering/shared/spherical-region-topology'

export type RegionSmoothingMode =
  | 'plates'
  | 'continents'
  | 'biome'
  | 'koppen'
  | 'ethnicity'
  | 'languages'
  | 'polities'
  | 'religions'

const OCEAN_REGION_ID = -2147483648

export function getRegionSmoothingMode(baseMap: string): RegionSmoothingMode | null {
  switch (baseMap) {
    case 'plates-smoothed':
      return 'plates'
    case 'continents-smoothed':
      return 'continents'
    case 'biome-smoothed':
      return 'biome'
    case 'koppen-smoothed':
      return 'koppen'
    case 'ethnicity':
    case 'ethnicity-smoothed':
      return 'ethnicity'
    case 'languages':
    case 'languages-smoothed':
      return 'languages'
    case 'polities':
    case 'polities-smoothed':
      return 'polities'
    case 'religions':
    case 'religions-smoothed':
      return 'religions'
    default:
      return null
  }
}

export function buildDisplayRegionIds(
  mesh: SphericalMesh,
  data: WorldSimulationState,
  mode: RegionSmoothingMode,
): Int32Array {
  const regionIds = new Int32Array(mesh.numRegions)
  for (let region = 0; region < mesh.numRegions; region++) {
    if (data.geography.landMask[region] === 0
      && (mode === 'ethnicity' || mode === 'languages' || mode === 'religions')) {
      regionIds[region] = OCEAN_REGION_ID
    }
    else if (mode === 'polities') {
      regionIds[region] = data.geography.landMask[region] === 0
        ? OCEAN_REGION_ID
        : data.society?.polities?.polityByRegion[region] ?? -1
    }
    else if (mode === 'ethnicity') {
      regionIds[region] = data.society?.ethnicity?.dominantGroup[region] ?? -1
    }
    else if (mode === 'languages') {
      regionIds[region] = data.society?.ethnicity?.dominantLanguage[region] ?? -1
    }
    else if (mode === 'religions') {
      regionIds[region] = data.society?.religions?.dominantAffiliation[region] ?? -1
    }
    else if (mode === 'plates') {
      regionIds[region] = data.geology.regionSuperPlate[region]
    }
    else if (mode === 'biome') {
      regionIds[region] = data.biome?.biomeClass[region] ?? -1
    }
    else if (mode === 'koppen') {
      regionIds[region] = data.climate?.koppen?.climateClass[region] ?? -1
    }
    else {
      regionIds[region] = data.geography.landMask[region] === 0
        ? -2
        : data.geography.visibleContinentId[region]
    }
  }
  return regionIds
}

export function buildSmoothedRegionCorners(
  mesh: SphericalMesh,
  data: WorldSimulationState,
  baseMap: string,
  topologyBuilder: SphericalRegionTopologyBuilder,
): Float32Array | null {
  const mode = getRegionSmoothingMode(baseMap)
  if (!mode)
    return null

  return buildSmoothedRegionCornersForMode(mesh, data, mode, topologyBuilder)
}

export function buildSmoothedRegionCornersForMode(
  mesh: SphericalMesh,
  data: WorldSimulationState,
  mode: RegionSmoothingMode,
  topologyBuilder: SphericalRegionTopologyBuilder,
): Float32Array {
  const regionIds = buildDisplayRegionIds(mesh, data, mode)
  const topology = topologyBuilder.build(mesh, regionIds)
  return topologyBuilder.buildSmoothedCornerPositions(mesh, topology)
}
