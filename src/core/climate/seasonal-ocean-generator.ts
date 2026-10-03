import type { SeasonalCirculationData } from '@/core/climate/climate-data'
import type SphericalMesh from '@/core/mesh/mesh'
import { CLIMATE_SEASON_COUNT, ITCZ_LONGITUDE_SAMPLES } from '@/core/climate/climate-data'
import { clamp, DEG, graphDistance, smoothMasked, smoothstep } from '@/core/climate/climate-geometry'

interface CoastFields {
  westDistance: Int32Array
  eastDistance: Int32Array
}

function classifyCoasts(mesh: SphericalMesh, ocean: Uint8Array): CoastFields {
  const westSeeds = new Uint8Array(mesh.numRegions)
  const eastSeeds = new Uint8Array(mesh.numRegions)
  for (let region = 0; region < mesh.numRegions; region++) {
    if (!ocean[region])
      continue
    const index = 3 * region
    const x = mesh.regionPosition[index]
    const z = mesh.regionPosition[index + 2]
    const longitude = mesh.regionLongitude[region]
    const eastX = Math.cos(longitude)
    const eastZ = -Math.sin(longitude)
    let landEast = 0
    let hasCoast = false
    for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
      const neighbor = mesh.neighbors[edge]
      if (ocean[neighbor])
        continue
      hasCoast = true
      landEast += (mesh.regionPosition[3 * neighbor] - x) * eastX
        + (mesh.regionPosition[3 * neighbor + 2] - z) * eastZ
    }
    if (hasCoast) {
      if (landEast < 0)
        westSeeds[region] = 1
      else
        eastSeeds[region] = 1
    }
  }
  return {
    westDistance: graphDistance(mesh, ocean, westSeeds),
    eastDistance: graphDistance(mesh, ocean, eastSeeds),
  }
}

function hasCircumpolarChannel(mesh: SphericalMesh, ocean: Uint8Array, hemisphere: number): boolean {
  const covered = new Uint8Array(ITCZ_LONGITUDE_SAMPLES)
  for (let region = 0; region < mesh.numRegions; region++) {
    if (!ocean[region] || Math.abs(mesh.regionLatitude[region] / DEG - 60 * hemisphere) > 5)
      continue
    const bin = clamp(Math.floor((mesh.regionLongitude[region] / DEG + 180) / 5), 0, ITCZ_LONGITUDE_SAMPLES - 1)
    covered[bin] = 1
  }
  return covered.every(Boolean)
}

function itczAtLongitude(itcz: Float32Array, longitude: number): number {
  const position = ((longitude + Math.PI) / (2 * Math.PI) * ITCZ_LONGITUDE_SAMPLES - 0.5 + ITCZ_LONGITUDE_SAMPLES)
    % ITCZ_LONGITUDE_SAMPLES
  const lower = Math.floor(position)
  const fraction = position - lower
  return itcz[lower] * (1 - fraction) + itcz[(lower + 1) % ITCZ_LONGITUDE_SAMPLES] * fraction
}

export function generateSeasonalOcean(
  mesh: SphericalMesh,
  landMask: Uint8Array,
  wind: Pick<SeasonalCirculationData, 'solarDeclination' | 'itczLatitude' | 'windEast' | 'windNorth'>,
): Pick<SeasonalCirculationData, 'oceanEast' | 'oceanNorth' | 'oceanWarmth'> {
  const count = mesh.numRegions
  const ocean = new Uint8Array(count)
  for (let region = 0; region < count; region++)
    ocean[region] = landMask[region] ? 0 : 1
  const { westDistance, eastDistance } = classifyCoasts(mesh, ocean)
  const circumpolarNorth = hasCircumpolarChannel(mesh, ocean, 1)
  const circumpolarSouth = hasCircumpolarChannel(mesh, ocean, -1)
  const coastThreshold = Math.max(5, Math.round(Math.sqrt(count) * 0.035))
  const warmthRange = coastThreshold * 2
  const oceanEast = new Float32Array(count * CLIMATE_SEASON_COUNT)
  const oceanNorth = new Float32Array(oceanEast.length)
  const oceanWarmth = new Float32Array(oceanEast.length)

  for (let season = 0; season < CLIMATE_SEASON_COUNT; season++) {
    const offset = season * count
    const itcz = wind.itczLatitude.subarray(
      season * ITCZ_LONGITUDE_SAMPLES,
      (season + 1) * ITCZ_LONGITUDE_SAMPLES,
    )
    const shiftDeg = wind.solarDeclination[season] / DEG * (5 / 23.5)
    for (let region = 0; region < count; region++) {
      if (!ocean[region])
        continue
      const latitude = mesh.regionLatitude[region]
      const bandLatitude = Math.abs(latitude / DEG - shiftDeg)
      const itczDistance = Math.abs(latitude - itczAtLongitude(itcz, mesh.regionLongitude[region])) / DEG
      const hemisphere = latitude >= 0 ? 1 : -1
      let bandEast: number
      if (itczDistance < 3)
        bandEast = 1 - 2 * smoothstep(0, 3, itczDistance)
      else if (bandLatitude < 30)
        bandEast = -1
      else if (bandLatitude < 35)
        bandEast = -1 + 2 * smoothstep(30, 35, bandLatitude)
      else if (bandLatitude < 58)
        bandEast = 1
      else if (bandLatitude < 65)
        bandEast = 1 - 1.5 * smoothstep(58, 65, bandLatitude)
      else
        bandEast = -0.5

      const index = offset + region
      let east = 0.75 * bandEast + 0.25 * Math.tanh(wind.windEast[index] / 15)
      let north = 0.12 * Math.tanh(wind.windNorth[index] / 15)
      const west = westDistance[region]
      const eastCoast = eastDistance[region]
      if (west >= 0 && west < coastThreshold) {
        const strength = (1 - west / coastThreshold) ** 2
        north += hemisphere * 2 * strength
        east *= 1 - 0.7 * strength
      }
      if (eastCoast >= 0 && eastCoast < coastThreshold) {
        const strength = (1 - eastCoast / coastThreshold) ** 2
        north -= hemisphere * 0.8 * strength
        east *= 1 - 0.5 * strength
      }
      const circumpolar = latitude >= 0 ? circumpolarNorth : circumpolarSouth
      if (circumpolar && bandLatitude >= 55 && bandLatitude <= 75) {
        const strength = 1 - Math.abs(bandLatitude - 65) / 10
        east = east * (1 - strength) + 1.5 * strength
        north *= 1 - 0.8 * strength
      }
      oceanEast[index] = east
      oceanNorth[index] = north

      // Geographic warmth follows the boundary current on each side of a basin.
      let cellSign: number
      if (bandLatitude < 28)
        cellSign = 1
      else if (bandLatitude < 35)
        cellSign = 1 - 2 * smoothstep(28, 35, bandLatitude)
      else if (bandLatitude < 55)
        cellSign = -1
      else if (bandLatitude < 65)
        cellSign = -1 + 2 * smoothstep(55, 65, bandLatitude)
      else
        cellSign = 1
      const westWarmth = west >= 0 && west < warmthRange ? (1 - west / warmthRange) ** 2 : 0
      const eastWarmth = eastCoast >= 0 && eastCoast < warmthRange ? (1 - eastCoast / warmthRange) ** 2 : 0
      oceanWarmth[index] = clamp(cellSign * (westWarmth - eastWarmth), -1, 1)
    }
    smoothMasked(mesh, oceanEast.subarray(offset, offset + count), ocean, 2)
    smoothMasked(mesh, oceanNorth.subarray(offset, offset + count), ocean, 2)
    smoothMasked(mesh, oceanWarmth.subarray(offset, offset + count), ocean, 4)
  }
  return { oceanEast, oceanNorth, oceanWarmth }
}
