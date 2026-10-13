import type SphericalMesh from '@/core/mesh/mesh'
import type { SphericalRegionTopology } from '@/core/mesh/spherical-region-topology'
import type { WorldSimulationState } from '@/core/simulation/state'
import { resolveRasterCellSource } from '@/core/data-source/runtime/data-source-manager'
import { SphericalRegionTopologyBuilder } from '@/core/mesh/spherical-region-topology'

export type AreaClassificationMode
  = | 'plates'
    | 'continents'
    | 'biome'
    | 'koppen'
    | 'ethnicity'
    | 'languages'
    | 'polities'
    | 'religions'

export const OCEAN_REGION_ID = -2147483648

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

export interface LandAreaGeometry {
  landMask: Uint8Array
  topology: SphericalRegionTopology
  smoothedCorners: Float32Array
}

const landAreaCache = new WeakMap<SphericalMesh, WeakMap<object, LandAreaGeometry>>()

export function getLandAreaGeometry(mesh: SphericalMesh, data: WorldSimulationState): LandAreaGeometry {
  const sourceMask = resolveRasterCellSource('world-surface', mesh, data)?.fields.isLand ?? data.geography.landMask
  let byMask = landAreaCache.get(mesh)
  if (!byMask) {
    byMask = new WeakMap()
    landAreaCache.set(mesh, byMask)
  }
  const cached = byMask.get(sourceMask)
  if (cached)
    return cached

  const landMask = Uint8Array.from(sourceMask, value => value ? 1 : 0)
  const regionIds = Int32Array.from(landMask)
  const builder = new SphericalRegionTopologyBuilder()
  const topology = builder.build(mesh, regionIds)
  const result = {
    landMask,
    topology,
    smoothedCorners: builder.buildSmoothedCornerPositions(mesh, topology),
  }
  byMask.set(sourceMask, result)
  return result
}
