import type { ClimateSurfaceData } from '@/core/climate/climate-data'
import type { MonthlyForcing } from '@/core/climate/monthly-forcing'
import type { MonthlySpatialFields } from '@/core/climate/monthly-spatial-fields'
import type SphericalMesh from '@/core/mesh/mesh'
import { DEG, EARTH_RADIUS_KM, smoothMasked } from '@/core/climate/climate-geometry'
import { clamp, gaussian, smoothstep } from '@/core/math/math'
import { itczAtLongitude } from '@/core/climate/monthly-forcing'

export interface MonthlyWind {
  east: Float32Array
  north: Float32Array
  x: Float32Array
  y: Float32Array
  z: Float32Array
}

const FLAT_MOISTURE_DECAY_KM = 20000

export function makeMonthlyWind(mesh: SphericalMesh, forcing: MonthlyForcing): MonthlyWind {
  const count = mesh.numRegions
  const east = new Float32Array(count)
  const north = new Float32Array(count)
  const x = new Float32Array(count)
  const y = new Float32Array(count)
  const z = new Float32Array(count)
  for (let region = 0; region < count; region++) {
    const latitude = mesh.regionLatitude[region]
    const longitude = mesh.regionLongitude[region]
    const absLatitude = Math.abs(latitude / DEG)
    const itcz = itczAtLongitude(forcing.itczLatitude, longitude)
    const localSolar = forcing.solarDeclination * Math.tanh(latitude / (10 * DEG))
    const summerFraction = smoothstep(-10 * DEG, 10 * DEG, localSolar)
    // Trades and westerlies move poleward in local summer and equatorward in winter.
    const tradeEdge = 24 + 10 * summerFraction
    let zonal: number
    if (absLatitude < tradeEdge)
      zonal = -0.9
    else if (absLatitude < tradeEdge + 8)
      zonal = -0.9 + 1.9 * smoothstep(tradeEdge, tradeEdge + 8, absLatitude)
    else if (absLatitude < 58)
      zonal = 1
    else if (absLatitude < 68)
      zonal = 1 - 1.5 * smoothstep(58, 68, absLatitude)
    else
      zonal = -0.5
    const meridional = absLatitude < 30
      ? clamp((itcz - latitude) / (18 * DEG), -1, 1) * 0.3
      : 0
    east[region] = 0.55 * Math.tanh(forcing.windEast[region] / 18)
      + 0.45 * zonal + 1.2 * forcing.monsoonEast[region]
    north[region] = 0.55 * Math.tanh(forcing.windNorth[region] / 18) + 0.45 * meridional

    const length = Math.hypot(east[region], north[region]) || 1
    const unitEast = east[region] / length
    const unitNorth = north[region] / length
    const sinLat = Math.sin(latitude)
    const cosLat = Math.cos(latitude)
    const sinLon = Math.sin(longitude)
    const cosLon = Math.cos(longitude)
    x[region] = unitEast * cosLon - unitNorth * sinLat * sinLon
    y[region] = unitNorth * cosLat
    z[region] = -unitEast * sinLon - unitNorth * sinLat * cosLon
  }
  return { east, north, x, y, z }
}

function windConvergence(mesh: SphericalMesh, wind: MonthlyWind, edgeKm: number): Float32Array {
  const count = mesh.numRegions
  const convergence = new Float32Array(count)
  const edgeRadians = edgeKm / EARTH_RADIUS_KM
  const neighborDx = mesh.neighborDx
  const neighborDy = mesh.neighborDy
  const neighborDz = mesh.neighborDz
  for (let region = 0; region < count; region++) {
    let inward = 0
    let neighbors = 0
    for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
      const neighbor = mesh.neighbors[edge]
      const dx = -neighborDx[edge]
      const dy = -neighborDy[edge]
      const dz = -neighborDz[edge]
      inward -= (wind.x[neighbor] + wind.x[region]) * dx
        + (wind.y[neighbor] + wind.y[region]) * dy
        + (wind.z[neighbor] + wind.z[region]) * dz
      neighbors++
    }
    convergence[region] = neighbors > 0
      ? clamp(inward / (neighbors * edgeRadians * 1.5), -1, 1)
      : 0
  }
  const all = new Uint8Array(count).fill(1)
  smoothMasked(mesh, convergence, all, 2)
  return convergence
}

function advectMoisture(
  mesh: SphericalMesh,
  surface: ClimateSurfaceData,
  spatial: MonthlySpatialFields,
  forcing: MonthlyForcing,
  temperatureC: Float32Array,
  wind: MonthlyWind,
  convergence: Float32Array,
): Float32Array {
  const count = mesh.numRegions
  let source = new Float32Array(count)
  let target = new Float32Array(count)
  const flatRetention = new Float32Array(count)
  for (let region = 0; region < count; region++) {
    const warmth = forcing.oceanWarmth[region]
    if (surface.landMask[region]) {
      const temperature = temperatureC[region]
      const latitude = mesh.regionLatitude[region]
      const absLatitude = Math.abs(latitude / DEG)
      const itcz = itczAtLongitude(forcing.itczLatitude, mesh.regionLongitude[region])
      const frontalAscent = gaussian(absLatitude - 50, 13)
      const convectiveAscent = gaussian(Math.abs(latitude - itcz) / DEG, 11)
      // Geographic and seasonal evaporation potential replaces stored soil water.
      const landEvaporationPotential = clamp(
        0.6 - 0.4 * spatial.continentality[region]
        - 0.25 * gaussian(absLatitude - 28, 13) + 0.2 * convectiveAscent,
        0.1,
        0.8,
      )
      const thawedSupply = 0.12 + 0.88 * smoothstep(-12, 10, temperature)
      const evapSupply = 0.05 + 0.13 * Math.sqrt(landEvaporationPotential)
      source[region] = evapSupply * thawedSupply
        + 0.02 * smoothstep(0, 30, temperature) * (1 - spatial.continentality[region])
      // Warm, dry subtropical interiors entrain dry air along the flow.
      const drySubtropicalInterior = gaussian(absLatitude - 28, 13)
        * (1 - landEvaporationPotential) * spatial.continentality[region]
        * smoothstep(8, 25, temperature)
      // Cold continental air loses imported moisture much sooner than warm air.
      const coldInterior = (1 - smoothstep(-8, 10, temperature)) * spatial.continentality[region]
      const decayKm = FLAT_MOISTURE_DECAY_KM / (1 + 9 * coldInterior + 2 * drySubtropicalInterior)
      const rainout = 0.08 * convectiveAscent + 0.04 * frontalAscent
        + 0.05 * smoothstep(0, 0.7, convergence[region])
      flatRetention[region] = Math.exp(-spatial.edgeKm / decayKm - rainout * spatial.edgeKm / 2500)
    }
    else {
      source[region] = clamp(
        0.28 + 0.55 * smoothstep(-5, 32, temperatureC[region]) + 0.12 * warmth,
        0.12,
        1,
      )
    }
  }
  const localSupply = new Float32Array(source)
  const hops = clamp(Math.round(3400 / spatial.edgeKm), 8, 24)
  const neighborDx = mesh.neighborDx
  const neighborDy = mesh.neighborDy
  const neighborDz = mesh.neighborDz
  for (let pass = 0; pass < hops; pass++) {
    for (let region = 0; region < count; region++) {
      if (!surface.landMask[region]) {
        target[region] = localSupply[region]
        continue
      }
      let incoming = 0
      let weight = 0
      let sourceHeight = 0
      for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
        const neighbor = mesh.neighbors[edge]
        const dx = neighborDx[edge]
        const dy = neighborDy[edge]
        const dz = neighborDz[edge]
        const alignment = wind.x[neighbor] * dx + wind.y[neighbor] * dy + wind.z[neighbor] * dz
        if (alignment <= 0)
          continue
        incoming += source[neighbor] * alignment
        sourceHeight += Math.max(0, surface.elevationKm[neighbor]) * alignment
        weight += alignment
      }
      if (weight > 0) {
        const rise = Math.max(0, surface.elevationKm[region] - sourceHeight / weight)
        const carried = incoming / weight * flatRetention[region] * Math.exp(-0.55 * rise)
        target[region] = Math.max(localSupply[region], carried)
      }
      else {
        target[region] = localSupply[region]
      }
    }
    const previous = source
    source = target
    target = previous
  }
  return source
}

/** Compute one month's precipitation as accumulated millimetres. */
export function computeMonthlyPrecipitation(
  mesh: SphericalMesh,
  surface: ClimateSurfaceData,
  spatial: MonthlySpatialFields,
  forcing: MonthlyForcing,
  temperatureC: Float32Array,
  precipitationScale = 1,
): Float32Array {
  const count = mesh.numRegions
  const wind = makeMonthlyWind(mesh, forcing)
  const convergence = windConvergence(mesh, wind, spatial.edgeKm)
  const moisture = advectMoisture(mesh, surface, spatial, forcing, temperatureC, wind, convergence)
  const precipitationMm = new Float32Array(count)
  for (let region = 0; region < count; region++) {
    const latitude = mesh.regionLatitude[region]
    const longitude = mesh.regionLongitude[region]
    const absLatitude = Math.abs(latitude / DEG)
    const itcz = itczAtLongitude(forcing.itczLatitude, longitude)
    const itczDistance = Math.abs(latitude - itcz) / DEG
    const humidity = moisture[region]
    const localSolar = forcing.solarDeclination * Math.tanh(latitude / (10 * DEG))
    const summerFraction = smoothstep(-10 * DEG, 10 * DEG, localSolar)
    const frontalStrength = gaussian(absLatitude - (44 + 12 * summerFraction), 13)
    const itczStrength = gaussian(itczDistance, 11)
    const convergenceStrength = smoothstep(0, 0.7, convergence[region])
    let rate = humidity * (1.3 + 5.2 * itczStrength + 1.6 * frontalStrength + 1.4 * convergenceStrength)

    const subtropicalCenter = 25 + 12 * summerFraction
    const subtropicalHigh = gaussian(absLatitude - subtropicalCenter, 10)
    rate *= 1 - 0.62 * subtropicalHigh
    rate *= 1 - 0.22 * smoothstep(0, 12, forcing.pressureHpa[region] - 1013)

    if (surface.landMask[region]) {
      const slope = wind.east[region] * spatial.elevationGradientEast[region]
        + wind.north[region] * spatial.elevationGradientNorth[region]
      if (slope > 0)
        rate += humidity * 3.2 * smoothstep(0, 0.012, slope)
      else
        rate *= 1 - 0.78 * smoothstep(0, 0.012, -slope)

      const polewardOfItcz = Math.sign(latitude) * (latitude - itcz) / DEG
      if (localSolar > 0 && polewardOfItcz > 0 && polewardOfItcz < 25) {
        const monsoon = smoothstep(0, 10 * DEG, localSolar)
          * (1 - smoothstep(0, 25, polewardOfItcz))
          * Math.exp(-spatial.coastDistanceKm[region] / 1800)
        rate += humidity * 1.5 * monsoon
      }
      rate *= 1 - 0.2 * spatial.continentality[region] ** 2
      rate += 0.25 * frontalStrength * (0.2 + humidity)
      // Winter westerlies bring ocean moisture and frontal storms onto west coasts.
      const westCoast = spatial.westCoastInfluence[region]
      const winterOnshore = smoothstep(-0.1, 0.35, wind.east[region])
      rate += humidity * 0.65 * (1 - summerFraction)
        * gaussian(absLatitude - 38, 11) * westCoast * winterOnshore
      // Summer subtropical subsidence also suppresses orographic and local rain.
      rate *= 1 - 0.3 * summerFraction * subtropicalHigh * westCoast

      // Eastern continental shores reverse from a dry winter outflow to an
      // onshore summer monsoon, including latitudes beyond the ITCZ rain belt.
      const monsoonEast = forcing.monsoonEast[region]
      const summerOnshore = Math.max(0, -monsoonEast) * summerFraction
        * smoothstep(0.05, 0.45, -wind.east[region])
      rate += humidity * 3.2 * summerOnshore
      const winterOutflow = Math.max(0, monsoonEast) * (1 - summerFraction)
        * (1 - smoothstep(0, 12, temperatureC[region]))
        * (1 - westCoast)
      rate *= 1 - 0.82 * winterOutflow
    }
    precipitationMm[region] = clamp(rate * precipitationScale, 0, 18) * forcing.days
  }
  return precipitationMm
}
