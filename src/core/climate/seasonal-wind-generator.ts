import type { SeasonalCirculationData } from '@/core/climate/climate-data'
import type SphericalMesh from '@/core/mesh/mesh'
import alea from 'alea'
import { createNoise3D } from 'simplex-noise'
import { CLIMATE_SEASON_COUNT, ITCZ_LONGITUDE_SAMPLES } from '@/core/climate/climate-data'
import { averageEdgeKm, clamp, DEG, gaussian, graphDistance, smoothMasked, smoothstep } from '@/core/climate/climate-geometry'
import { makeClimateCoastFields } from '@/core/climate/monthly-spatial-fields'

const LAT_BINS = 36
const LON_BINS = ITCZ_LONGITUDE_SAMPLES
const PRESSURE_BASE_HPA = 1013

interface GeoBins {
  area: Float64Array
  landArea: Float64Array
  landHeight: Float64Array
}

function makeGeoBins(mesh: SphericalMesh, elevationKm: Float32Array, landMask: Uint8Array): GeoBins {
  const area = new Float64Array(LAT_BINS * LON_BINS)
  const landArea = new Float64Array(area.length)
  const landHeight = new Float64Array(area.length)
  for (let region = 0; region < mesh.numRegions; region++) {
    const latBin = clamp(Math.floor((mesh.regionLatitude[region] / DEG + 90) / 5), 0, LAT_BINS - 1)
    const lonBin = clamp(Math.floor((mesh.regionLongitude[region] / DEG + 180) / 5), 0, LON_BINS - 1)
    const index = latBin * LON_BINS + lonBin
    const weight = mesh.regionArea[region]
    area[index] += weight
    if (landMask[region]) {
      landArea[index] += weight
      landHeight[index] += Math.max(0, elevationKm[region]) * weight
    }
  }
  return { area, landArea, landHeight }
}

function sampleGeography(bins: GeoBins, latitude: number, longitude: number, radiusDeg: number): [number, number] {
  const latDeg = latitude / DEG
  const lonDeg = longitude / DEG
  const latFirst = clamp(Math.floor((latDeg - radiusDeg + 90) / 5), 0, LAT_BINS - 1)
  const latLast = clamp(Math.floor((latDeg + radiusDeg + 90) / 5), 0, LAT_BINS - 1)
  const lonSpan = Math.min(180, radiusDeg / Math.max(0.1, Math.cos(latitude)))
  const lonFirst = Math.floor((lonDeg - lonSpan + 180) / 5)
  const lonLast = Math.floor((lonDeg + lonSpan + 180) / 5)
  const sinLat = Math.sin(latitude)
  const cosLat = Math.cos(latitude)
  const cosRadius = Math.cos((radiusDeg + 3) * DEG)
  let area = 0
  let land = 0
  let height = 0
  for (let latBin = latFirst; latBin <= latLast; latBin++) {
    const sampleLat = (-87.5 + 5 * latBin) * DEG
    for (let lonBin = lonFirst; lonBin <= lonLast; lonBin++) {
      const wrappedLon = ((lonBin % LON_BINS) + LON_BINS) % LON_BINS
      const sampleLon = (-177.5 + 5 * wrappedLon) * DEG
      const cosDistance = sinLat * Math.sin(sampleLat)
        + cosLat * Math.cos(sampleLat) * Math.cos(sampleLon - longitude)
      if (cosDistance < cosRadius)
        continue
      const index = latBin * LON_BINS + wrappedLon
      area += bins.area[index]
      land += bins.landArea[index]
      height += bins.landHeight[index]
    }
  }
  return area > 0 ? [land / area, height / area] : [0, 0]
}

function computeItcz(bins: GeoBins, thermalDeclination: number): Float32Array {
  const result = new Float32Array(LON_BINS)
  const summerSign = Math.sign(thermalDeclination)
  for (let lonBin = 0; lonBin < LON_BINS; lonBin++) {
    const longitude = (-177.5 + lonBin * 5) * DEG
    let bestLatitude = thermalDeclination
    let bestScore = -Infinity
    for (let latitudeDeg = -30; latitudeDeg <= 30; latitudeDeg += 2.5) {
      const latitude = latitudeDeg * DEG
      const [localLand] = sampleGeography(bins, latitude, longitude, 5)
      const [wideLand, heightKm] = sampleGeography(bins, latitude, longitude, 30)
      const [polewardLand] = sampleGeography(bins, latitude + summerSign * 15 * DEG, longitude, 30)
      const continentalScale = smoothstep(0.2, 0.45, Math.max(wideLand, polewardLand * 0.7)) ** 2
      const landGate = smoothstep(0.25, 0.55, localLand)
      const landBoost = 0.58 * landGate * continentalScale
      const solarScore = gaussian(latitudeDeg - thermalDeclination / DEG, 25)
      const elevationBoost = Math.min(0.3, heightKm * 0.12) * continentalScale
      const score = solarScore + landBoost + elevationBoost
      if (score > bestScore) {
        bestScore = score
        bestLatitude = latitude
      }
    }
    result[lonBin] = clamp(bestLatitude, -20 * DEG, 20 * DEG)
  }

  const next = new Float32Array(LON_BINS)
  for (let pass = 0; pass < 5; pass++) {
    for (let index = 0; index < LON_BINS; index++) {
      next[index] = 0.2 * result[(index + LON_BINS - 2) % LON_BINS]
        + 0.2 * result[(index + LON_BINS - 1) % LON_BINS]
        + 0.2 * result[index]
        + 0.2 * result[(index + 1) % LON_BINS]
        + 0.2 * result[(index + 2) % LON_BINS]
    }
    result.set(next)
  }
  return result
}

function sampleItcz(itcz: Float32Array, longitude: number): number {
  const position = ((longitude + Math.PI) / (2 * Math.PI) * LON_BINS - 0.5 + LON_BINS) % LON_BINS
  const lower = Math.floor(position)
  const fraction = position - lower
  return itcz[lower] * (1 - fraction) + itcz[(lower + 1) % LON_BINS] * fraction
}

function continentality(mesh: SphericalMesh, landMask: Uint8Array): Float32Array {
  const coast = new Uint8Array(mesh.numRegions)
  for (let region = 0; region < mesh.numRegions; region++) {
    if (!landMask[region])
      continue
    for (let index = mesh.neighborOffsets[region]; index < mesh.neighborOffsets[region + 1]; index++) {
      if (!landMask[mesh.neighbors[index]]) {
        coast[region] = 1
        break
      }
    }
  }
  const distance = graphDistance(mesh, landMask, coast)
  const result = new Float32Array(mesh.numRegions)
  const edgeKm = averageEdgeKm(mesh.numRegions)
  for (let region = 0; region < mesh.numRegions; region++) {
    if (landMask[region])
      result[region] = distance[region] < 0 ? 1 : smoothstep(0, 2476, distance[region] * edgeKm)
  }
  const all = new Uint8Array(mesh.numRegions).fill(1)
  smoothMasked(mesh, result, all, 1)
  return result
}

export function generateSeasonalWind(
  mesh: SphericalMesh,
  elevationKm: Float32Array,
  landMask: Uint8Array,
  axialTiltDeg: number,
  seed: number,
): Pick<SeasonalCirculationData, 'solarDeclination' | 'itczLatitude' | 'pressureHpa' | 'windEast' | 'windNorth' | 'monsoonEast'> {
  const count = mesh.numRegions
  const seasonalCount = count * CLIMATE_SEASON_COUNT
  const solarDeclination = new Float32Array(CLIMATE_SEASON_COUNT)
  const itczLatitude = new Float32Array(CLIMATE_SEASON_COUNT * LON_BINS)
  const pressureHpa = new Float32Array(seasonalCount)
  const windEast = new Float32Array(seasonalCount)
  const windNorth = new Float32Array(seasonalCount)
  const monsoonEast = new Float32Array(seasonalCount)
  const bins = makeGeoBins(mesh, elevationKm, landMask)
  const continental = continentality(mesh, landMask)
  const eastMonsoonExposure = makeClimateCoastFields(mesh, landMask).eastMonsoonExposure
  const all = new Uint8Array(count).fill(1)
  const noise = createNoise3D(alea(seed + 3179))
  const gradientEast = new Float32Array(count)
  const gradientNorth = new Float32Array(count)
  const tiltRadians = clamp(axialTiltDeg, 0, 90) * DEG
  const seasonalContrast = clamp(Math.sin(tiltRadians) / Math.sin(23.5 * DEG), 0, 1.5)

  for (let season = 0; season < CLIMATE_SEASON_COUNT; season++) {
    const phase = season * Math.PI / 2
    const solarPhase = Math.sin(phase)
    // Continental heating follows the sun with a small thermal lag.
    const thermalPhase = Math.sin(phase - 0.15)
    const declination = tiltRadians * solarPhase
    solarDeclination[season] = declination
    const itcz = computeItcz(bins, tiltRadians * thermalPhase)
    itczLatitude.set(itcz, season * LON_BINS)
    const offset = season * count

    for (let region = 0; region < count; region++) {
      const latDeg = mesh.regionLatitude[region] / DEG
      const lon = mesh.regionLongitude[region]
      const itczDeg = sampleItcz(itcz, lon) / DEG
      const highShift = 8 * solarPhase
      const subtropical = 11.9 * (1 - 0.34 * continental[region])
      const absLat = Math.abs(latDeg)
      const thermalLatitude = smoothstep(15, 40, absLat) * (1 - smoothstep(75, 90, absLat))
      const summerStrength = thermalPhase * Math.tanh(latDeg / 12)
      const thermalPressure = continental[region] * thermalLatitude
        * (summerStrength >= 0 ? -15.4 * summerStrength : -17.6 * summerStrength)
      // The continental thermal low draws onshore flow in summer; the winter
      // high reverses it across the eastern shore and adjacent ocean.
      monsoonEast[offset + region] = clamp(
        -summerStrength * seasonalContrast * eastMonsoonExposure[region]
        * gaussian(absLat - 38, 17),
        -1,
        1,
      )
      const index = region * 3
      const x = mesh.regionPosition[index]
      const y = mesh.regionPosition[index + 1]
      const z = mesh.regionPosition[index + 2]
      pressureHpa[offset + region] = PRESSURE_BASE_HPA
        - 8.3 * gaussian(latDeg - itczDeg, 8.8)
        + subtropical * gaussian(latDeg - (31.3 + highShift), 13.7)
        + subtropical * gaussian(latDeg - (-31.3 + highShift), 13.7)
        - 12.1 * gaussian(absLat - 54.6, 5.2)
        + 3.6 * gaussian(absLat - 85, 8)
        + thermalPressure
        - 3 * Math.max(0, elevationKm[region])
        + noise(x * 2, y * 2, z * 2) * 2
    }

    const pressure = pressureHpa.subarray(offset, offset + count)
    smoothMasked(mesh, pressure, all, 1)
    for (let region = 0; region < count; region++) {
      const lat = mesh.regionLatitude[region]
      const lon = mesh.regionLongitude[region]
      const eastX = Math.cos(lon)
      const eastZ = -Math.sin(lon)
      const northX = -Math.sin(lat) * Math.sin(lon)
      const northY = Math.cos(lat)
      const northZ = -Math.sin(lat) * Math.cos(lon)
      const index = 3 * region
      const x = mesh.regionPosition[index]
      const y = mesh.regionPosition[index + 1]
      const z = mesh.regionPosition[index + 2]
      let eastDelta = 0
      let eastSpan = 0
      let northDelta = 0
      let northSpan = 0
      for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
        const neighbor = mesh.neighbors[edge]
        const neighborIndex = 3 * neighbor
        const dx = mesh.regionPosition[neighborIndex] - x
        const dy = mesh.regionPosition[neighborIndex + 1] - y
        const dz = mesh.regionPosition[neighborIndex + 2] - z
        const de = dx * eastX + dz * eastZ
        const dn = dx * northX + dy * northY + dz * northZ
        const dp = pressure[neighbor] - pressure[region]
        eastDelta += de * dp
        eastSpan += de * de
        northDelta += dn * dp
        northSpan += dn * dn
      }
      gradientEast[region] = eastSpan > 1e-12 ? eastDelta / eastSpan : 0
      gradientNorth[region] = northSpan > 1e-12 ? northDelta / northSpan : 0
    }

    for (let region = 0; region < count; region++) {
      const sinLat = Math.sin(mesh.regionLatitude[region])
      const geostrophic = 68.4 * DEG * smoothstep(0, Math.sin(5 * DEG), Math.abs(sinLat))
      const rotation = (sinLat >= 0 ? -1 : 1) * Math.max(0, geostrophic - 19.9 * DEG)
      const cosAngle = Math.cos(rotation)
      const sinAngle = Math.sin(rotation)
      const forceE = -gradientEast[region]
      const forceN = -gradientNorth[region]
      windEast[offset + region] = 0.6 * (forceE * cosAngle - forceN * sinAngle)
      windNorth[offset + region] = 0.6 * (forceE * sinAngle + forceN * cosAngle)
    }
  }

  return { solarDeclination, itczLatitude, pressureHpa, windEast, windNorth, monsoonEast }
}
