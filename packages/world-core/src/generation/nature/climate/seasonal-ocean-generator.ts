import type { SeasonalCirculationData } from './climate-data'
import type { ClimateMesh } from './climate-mesh'
import { clamp, smoothstep } from '#math/math'
import { CLIMATE_SEASON_COUNT, ITCZ_LONGITUDE_SAMPLES } from './climate-data'
import { DEG, graphDistance, smoothMasked } from './climate-geometry'
import { transportOceanWarmth } from './ocean-heat-transport'

interface CoastFields {
  westDistance: Int32Array
  eastDistance: Int32Array
}

function classifyCoasts(mesh: ClimateMesh, ocean: Uint8Array): CoastFields {
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

export function circumpolarWaters(mesh: ClimateMesh, ocean: Uint8Array, hemisphere: number): Uint8Array {
  const band = ocean.map((water, region) =>
    water && Math.abs(mesh.regionLatitude[region] / DEG - 60 * hemisphere) <= 5 ? 1 : 0)
  const longitudeTurns = new Int32Array(mesh.numRegions)
  const seen = new Uint8Array(mesh.numRegions)
  const connected = new Uint8Array(mesh.numRegions)
  const queue = new Uint32Array(mesh.numRegions)
  for (let start = 0; start < mesh.numRegions; start++) {
    if (!band[start] || seen[start])
      continue
    queue[0] = start
    seen[start] = 1
    let end = 1
    let windsAroundPole = false
    for (let head = 0; head < end; head++) {
      const region = queue[head]
      for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
        const neighbor = mesh.neighbors[edge]
        if (!band[neighbor])
          continue
        const delta = mesh.regionLongitude[neighbor] - mesh.regionLongitude[region]
        const turns = longitudeTurns[region] - Math.round(delta / (2 * Math.PI))
        if (seen[neighbor]) {
          // Returning to the same cell after a full longitude turn proves a
          // connected loop, unlike merely finding water in every longitude bin.
          if (longitudeTurns[neighbor] !== turns)
            windsAroundPole = true
          continue
        }
        seen[neighbor] = 1
        longitudeTurns[neighbor] = turns
        queue[end++] = neighbor
      }
    }
    if (windsAroundPole) {
      for (let i = 0; i < end; i++)
        connected[queue[i]] = 1
    }
  }
  let end = 0
  for (let region = 0; region < mesh.numRegions; region++) {
    if (connected[region])
      queue[end++] = region
  }
  for (let head = 0; head < end; head++) {
    const region = queue[head]
    for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
      const neighbor = mesh.neighbors[edge]
      if (!ocean[neighbor] || connected[neighbor])
        continue
      connected[neighbor] = 1
      queue[end++] = neighbor
    }
  }
  return connected
}

function itczAtLongitude(itcz: Float32Array, longitude: number): number {
  const position = ((longitude + Math.PI) / (2 * Math.PI) * ITCZ_LONGITUDE_SAMPLES - 0.5 + ITCZ_LONGITUDE_SAMPLES)
    % ITCZ_LONGITUDE_SAMPLES
  const lower = Math.floor(position)
  const fraction = position - lower
  return itcz[lower] * (1 - fraction) + itcz[(lower + 1) % ITCZ_LONGITUDE_SAMPLES] * fraction
}

export function generateSeasonalOcean(
  mesh: ClimateMesh,
  landMask: Uint8Array,
  wind: Pick<SeasonalCirculationData, 'solarDeclination' | 'itczLatitude' | 'windEast' | 'windNorth'>,
): Pick<SeasonalCirculationData, 'oceanEast' | 'oceanNorth' | 'oceanWarmth'> {
  const count = mesh.numRegions
  const ocean = new Uint8Array(count)
  for (let region = 0; region < count; region++)
    ocean[region] = landMask[region] ? 0 : 1
  const { westDistance, eastDistance } = classifyCoasts(mesh, ocean)
  const circumpolarNorth = circumpolarWaters(mesh, ocean, 1)
  const circumpolarSouth = circumpolarWaters(mesh, ocean, -1)
  const coastThreshold = Math.max(5, Math.round(Math.sqrt(count) * 0.035))
  const warmthRange = coastThreshold * 2
  const oceanEast = new Float32Array(count * CLIMATE_SEASON_COUNT)
  const oceanNorth = new Float32Array(oceanEast.length)
  const oceanWarmth = new Float32Array(oceanEast.length)
  // The surface return current responds to persistent trade forcing. It does
  // not follow the atmospheric rain belt to its solstitial position.
  const meanItcz = new Float32Array(ITCZ_LONGITUDE_SAMPLES)
  for (let longitude = 0; longitude < meanItcz.length; longitude++) {
    for (let season = 0; season < CLIMATE_SEASON_COUNT; season++)
      meanItcz[longitude] += wind.itczLatitude[season * meanItcz.length + longitude] / CLIMATE_SEASON_COUNT
  }
  const equatorialReturn = new Float32Array(count)
  for (let region = 0; region < count; region++) {
    const west = westDistance[region]
    const east = eastDistance[region]
    if (!ocean[region] || west < 0 || east < 0 || west + east <= 2 * coastThreshold)
      continue
    const distance = Math.abs(mesh.regionLatitude[region] - itczAtLongitude(meanItcz, mesh.regionLongitude[region])) / DEG
    equatorialReturn[region] = 1.5 * (1 - smoothstep(0, 3, distance))
      * smoothstep(0, coastThreshold, Math.min(west, east))
  }

  for (let season = 0; season < CLIMATE_SEASON_COUNT; season++) {
    const offset = season * count
    const shiftDeg = wind.solarDeclination[season] / DEG * (5 / 23.5)
    for (let region = 0; region < count; region++) {
      if (!ocean[region])
        continue
      const latitude = mesh.regionLatitude[region]
      const bandLatitude = Math.abs(latitude / DEG - shiftDeg)
      const hemisphere = latitude >= 0 ? 1 : -1
      const west = westDistance[region]
      const eastCoast = eastDistance[region]
      let bandEast: number
      if (bandLatitude < 30)
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
      const circumpolar = latitude >= 0 ? circumpolarNorth[region] : circumpolarSouth[region]
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
    // Apply the narrow jet after smoothing the broad flow bands.
    for (let region = 0; region < count; region++)
      oceanEast[offset + region] += equatorialReturn[region]
    const warmth = oceanWarmth.subarray(offset, offset + count)
    smoothMasked(mesh, warmth, ocean, 4)
    transportOceanWarmth(mesh, ocean, oceanEast.subarray(offset, offset + count), oceanNorth.subarray(offset, offset + count), warmth, warmthRange)
  }
  return { oceanEast, oceanNorth, oceanWarmth }
}
