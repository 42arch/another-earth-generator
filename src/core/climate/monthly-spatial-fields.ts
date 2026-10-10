import type { ClimateSurfaceData } from '@/core/climate/climate-data'
import type SphericalMesh from '@/core/mesh/mesh'
import { averageEdgeKm, EARTH_RADIUS_KM, graphDistance, smoothMasked } from '@/core/climate/climate-geometry'
import { clamp, smoothstep } from '@/core/math/math'

export interface MonthlySpatialFields {
  coastDistanceKm: Float32Array
  continentality: Float32Array
  /** Inland reach of west-facing coasts exposed to the winter westerlies. */
  westCoastInfluence: Float32Array
  /** East-facing continental shores and adjacent ocean exposed to monsoon flow. */
  eastMonsoonExposure: Float32Array
  /** Tangent elevation gradient, kilometres of rise per kilometre travelled. */
  elevationGradientEast: Float32Array
  elevationGradientNorth: Float32Array
  edgeKm: number
}

export function makeElevationGradients(mesh: SphericalMesh, elevationKm: Float32Array): {
  east: Float32Array
  north: Float32Array
} {
  const count = mesh.numRegions
  const smoothedElevation = new Float32Array(count)
  for (let region = 0; region < count; region++)
    smoothedElevation[region] = Math.max(0, elevationKm[region])
  const all = new Uint8Array(count).fill(1)
  smoothMasked(mesh, smoothedElevation, all, 2)
  for (let region = 0; region < count; region++)
    smoothedElevation[region] = 0.7 * smoothedElevation[region] + 0.3 * Math.max(0, elevationKm[region])

  const east = new Float32Array(count)
  const north = new Float32Array(count)
  for (let region = 0; region < count; region++) {
    const latitude = mesh.regionLatitude[region]
    const longitude = mesh.regionLongitude[region]
    const eastX = Math.cos(longitude)
    const eastZ = -Math.sin(longitude)
    const northX = -Math.sin(latitude) * Math.sin(longitude)
    const northY = Math.cos(latitude)
    const northZ = -Math.sin(latitude) * Math.cos(longitude)
    const index = 3 * region
    const x = mesh.regionPosition[index]
    const y = mesh.regionPosition[index + 1]
    const z = mesh.regionPosition[index + 2]
    let eastRise = 0
    let eastSpan = 0
    let northRise = 0
    let northSpan = 0
    for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
      const neighbor = mesh.neighbors[edge]
      const neighborIndex = 3 * neighbor
      const dx = mesh.regionPosition[neighborIndex] - x
      const dy = mesh.regionPosition[neighborIndex + 1] - y
      const dz = mesh.regionPosition[neighborIndex + 2] - z
      const de = (dx * eastX + dz * eastZ) * EARTH_RADIUS_KM
      const dn = (dx * northX + dy * northY + dz * northZ) * EARTH_RADIUS_KM
      const rise = smoothedElevation[neighbor] - smoothedElevation[region]
      eastRise += de * rise
      eastSpan += de * de
      northRise += dn * rise
      northSpan += dn * dn
    }
    east[region] = eastSpan > 1e-8 ? eastRise / eastSpan : 0
    north[region] = northSpan > 1e-8 ? northRise / northSpan : 0
  }
  return { east, north }
}

/** Coast exposure is shared by seasonal winds and monthly moisture transport. */
export function makeClimateCoastFields(mesh: SphericalMesh, landMask: Uint8Array): Pick<
  MonthlySpatialFields,
  'coastDistanceKm' | 'continentality' | 'westCoastInfluence' | 'eastMonsoonExposure' | 'edgeKm'
> {
  const count = mesh.numRegions
  const coast = new Uint8Array(count)
  const westCoast = new Uint8Array(count)
  const eastCoast = new Uint8Array(count)
  const westCoastSeed = new Float32Array(count)
  const eastCoastFacing = new Float32Array(count)
  const ocean = new Uint8Array(count)
  for (let region = 0; region < count; region++) {
    if (!landMask[region]) {
      ocean[region] = 1
      continue
    }
    const longitude = mesh.regionLongitude[region]
    const eastX = Math.cos(longitude)
    const eastZ = -Math.sin(longitude)
    const index = 3 * region
    let oceanEast = 0
    let oceanSpan = 0
    for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
      const neighbor = mesh.neighbors[edge]
      if (!landMask[neighbor]) {
        coast[region] = 1
        const dx = mesh.regionPosition[3 * neighbor] - mesh.regionPosition[index]
        const dy = mesh.regionPosition[3 * neighbor + 1] - mesh.regionPosition[index + 1]
        const dz = mesh.regionPosition[3 * neighbor + 2] - mesh.regionPosition[index + 2]
        oceanEast += dx * eastX + dz * eastZ
        oceanSpan += Math.hypot(dx, dy, dz)
      }
    }
    const facing = oceanSpan > 0 ? clamp(oceanEast / oceanSpan, -1, 1) : 0
    if (facing < 0) {
      westCoast[region] = 1
      westCoastSeed[region] = smoothstep(0, 0.65, -facing)
    }
    else if (facing > 0) {
      eastCoast[region] = 1
      eastCoastFacing[region] = smoothstep(0, 0.65, facing)
    }
  }
  const distance = graphDistance(mesh, landMask, coast)
  const westDistance = graphDistance(mesh, landMask, westCoast)
  const edgeKm = averageEdgeKm(count)
  const coastDistanceKm = new Float32Array(count)
  const continentality = new Float32Array(count)
  const westCoastInfluence = new Float32Array(count)
  const eastMonsoonExposure = new Float32Array(count)
  const eastCoastStrength = new Float32Array(count)
  const oceanSeed = new Float32Array(count)
  for (let region = 0; region < count; region++) {
    if (!landMask[region])
      continue
    const km = distance[region] < 0 ? Infinity : distance[region] * edgeKm
    coastDistanceKm[region] = km
    continentality[region] = smoothstep(0, 2200, km)
    if (eastCoast[region] && westDistance[region] >= 0) {
      // A nearby opposite shore identifies a small island or narrow peninsula.
      const strength = smoothstep(120, 650, westDistance[region] * edgeKm)
      eastCoastStrength[region] = strength
      eastMonsoonExposure[region] = strength
      for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
        const neighbor = mesh.neighbors[edge]
        if (ocean[neighbor])
          oceanSeed[neighbor] = Math.max(oceanSeed[neighbor], strength)
      }
    }
  }

  // Westerly moisture enters through a west-facing shore and loses strength
  // inland. The directional spread avoids wetting the opposite shore equally.
  westCoastInfluence.set(westCoastSeed)
  const westNext = new Float32Array(count)
  const westRetention = Math.exp(-edgeKm / 360)
  for (let pass = 0; pass < 8; pass++) {
    for (let region = 0; region < count; region++) {
      if (!landMask[region])
        continue
      const index = 3 * region
      const longitude = mesh.regionLongitude[region]
      const eastX = Math.cos(longitude)
      const eastZ = -Math.sin(longitude)
      let influence = westCoastSeed[region]
      for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
        const neighbor = mesh.neighbors[edge]
        if (!landMask[neighbor])
          continue
        const other = 3 * neighbor
        const dx = mesh.regionPosition[index] - mesh.regionPosition[other]
        const dy = mesh.regionPosition[index + 1] - mesh.regionPosition[other + 1]
        const dz = mesh.regionPosition[index + 2] - mesh.regionPosition[other + 2]
        const length = Math.hypot(dx, dy, dz)
        const eastward = length > 0 ? (dx * eastX + dz * eastZ) / length : 0
        if (eastward < -0.1)
          continue
        const direction = 0.6 + 0.4 * smoothstep(-0.1, 0.5, eastward)
        influence = Math.max(influence, westCoastInfluence[neighbor] * westRetention * direction)
      }
      westNext[region] = influence
    }
    westCoastInfluence.set(westNext)
  }
  for (let region = 0; region < count; region++) {
    if (landMask[region])
      westCoastInfluence[region] *= 1 - 0.75 * eastCoastFacing[region]
  }

  // Carry the eastern continental signal inland and over its coastal ocean.
  const next = new Float32Array(count)
  const landRetention = Math.exp(-edgeKm / 850)
  for (let pass = 0; pass < 8; pass++) {
    for (let region = 0; region < count; region++) {
      if (!landMask[region])
        continue
      let influence = eastCoastStrength[region]
      for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
        const neighbor = mesh.neighbors[edge]
        if (landMask[neighbor])
          influence = Math.max(influence, eastMonsoonExposure[neighbor] * landRetention)
      }
      next[region] = influence
    }
    eastMonsoonExposure.set(next)
  }
  const oceanExposure = new Float32Array(oceanSeed)
  const oceanRetention = Math.exp(-edgeKm / 550)
  for (let pass = 0; pass < 5; pass++) {
    for (let region = 0; region < count; region++) {
      if (!ocean[region])
        continue
      let influence = oceanSeed[region]
      for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
        const neighbor = mesh.neighbors[edge]
        if (ocean[neighbor])
          influence = Math.max(influence, oceanExposure[neighbor] * oceanRetention)
      }
      next[region] = influence
    }
    oceanExposure.set(next)
  }
  for (let region = 0; region < count; region++) {
    if (ocean[region])
      eastMonsoonExposure[region] = oceanExposure[region]
  }

  return { coastDistanceKm, continentality, westCoastInfluence, eastMonsoonExposure, edgeKm }
}

export function makeMonthlySpatialFields(mesh: SphericalMesh, surface: ClimateSurfaceData): MonthlySpatialFields {
  const coast = makeClimateCoastFields(mesh, surface.landMask)
  const gradients = makeElevationGradients(mesh, surface.elevationKm)
  return {
    ...coast,
    elevationGradientEast: gradients.east,
    elevationGradientNorth: gradients.north,
  }
}
