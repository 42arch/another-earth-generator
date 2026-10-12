import type SphericalMesh from '@/core/mesh/mesh'
import type { SphericalRegionTopologyBuilder } from '@/core/rendering/shared/spherical-region-topology'
import type { WorldSimulationState } from '@/core/simulation/state'

export type AreaClassificationMode
  = | 'plates'
    | 'continents'
    | 'biome'
    | 'koppen'
    | 'ethnicity'
    | 'languages'
    | 'polities'
    | 'religions'

const OCEAN_REGION_ID = -2147483648

export function isGeoJsonAreaBaseMap(baseMap: string): boolean {
  return baseMap === 'continents'
    || baseMap === 'biome'
    || baseMap === 'koppen'
    || baseMap === 'ethnicity'
    || baseMap === 'languages'
    || baseMap === 'polities'
    || baseMap === 'religions'
}

export function buildDisplayRegionIds(
  mesh: SphericalMesh,
  data: WorldSimulationState,
  mode: AreaClassificationMode,
): Int32Array {
  const regionIds = new Int32Array(mesh.numRegions)
  for (let region = 0; region < mesh.numRegions; region++) {
    if (mode !== 'plates' && data.geography.landMask[region] === 0) {
      regionIds[region] = OCEAN_REGION_ID
      continue
    }
    else if (mode === 'polities') {
      regionIds[region] = data.civilization?.polities?.polityByRegion[region] ?? -1
    }
    else if (mode === 'ethnicity') {
      regionIds[region] = data.civilization?.ethnicity?.dominantGroup[region] ?? -1
    }
    else if (mode === 'languages') {
      regionIds[region] = data.civilization?.ethnicity?.dominantLanguage[region] ?? -1
    }
    else if (mode === 'religions') {
      regionIds[region] = data.civilization?.religions?.dominantAffiliation[region] ?? -1
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

export function buildSmoothedRegionCornersForMode(
  mesh: SphericalMesh,
  data: WorldSimulationState,
  mode: AreaClassificationMode,
  topologyBuilder: SphericalRegionTopologyBuilder,
): Float32Array {
  const regionIds = buildDisplayRegionIds(mesh, data, mode)
  const topology = topologyBuilder.build(mesh, regionIds)
  return topologyBuilder.buildSmoothedCornerPositions(mesh, topology)
}
