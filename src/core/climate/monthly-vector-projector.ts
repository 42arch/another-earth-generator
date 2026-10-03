import type { ClimateData, ClimateVectorDisplayData } from '@/core/climate/climate-data'
import type SphericalMesh from '@/core/mesh/mesh'
import type { GeographyData } from '@/core/simulation/state'
import { interpolateMonthlyForcing } from '@/core/climate/monthly-forcing'
import { makeMonthlyWind } from '@/core/climate/monthly-precipitation-generator'

/** Interpolate a circulation month and sample its tangent vectors on the final cells. */
export function projectMonthlyVectorField(
  outputMesh: SphericalMesh,
  climateMesh: SphericalMesh,
  geography: GeographyData,
  climate: ClimateData,
  month: number,
  axialTiltDeg: number,
  kind: ClimateVectorDisplayData['kind'],
): ClimateVectorDisplayData {
  const forcing = interpolateMonthlyForcing(climate.circulation, month, axialTiltDeg)
  const source = kind === 'wind'
    ? makeMonthlyWind(climateMesh, forcing)
    : { east: forcing.oceanEast, north: forcing.oceanNorth }
  const count = outputMesh.numRegions
  const east = new Float32Array(count)
  const north = new Float32Array(count)
  const warmth = kind === 'ocean-current' ? new Float32Array(count) : undefined
  const projection = climate.outputProjection
  if (!projection) {
    if (count !== climateMesh.numRegions)
      throw new Error('Missing output climate vector projection')
    east.set(source.east)
    north.set(source.north)
    warmth?.set(forcing.oceanWarmth)
  }
  else {
    if (projection.outputRegionCount !== count || projection.climateRegionCount !== climateMesh.numRegions)
      throw new Error('Output climate vector projection mesh sizes do not match')
    for (let region = 0; region < count; region++) {
      if (kind === 'ocean-current' && geography.landMask[region])
        continue
      const offset = region * 3
      for (let sample = 0; sample < 3; sample++) {
        const index = offset + sample
        const sourceRegion = projection.sourceRegion[index]
        const weight = projection.sourceWeight[index] / 65535
        east[region] += source.east[sourceRegion] * weight
        north[region] += source.north[sourceRegion] * weight
        if (warmth)
          warmth[region] += forcing.oceanWarmth[sourceRegion] * weight
      }
    }
  }
  return { month, kind, east, north, warmth }
}
