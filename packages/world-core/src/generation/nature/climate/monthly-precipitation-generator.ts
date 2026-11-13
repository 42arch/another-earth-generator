import type { ClimateSurfaceData } from './climate-data'
import type { ClimateMesh } from './climate-mesh'
import type { MonthlyForcing } from './monthly-forcing'
import type { MonthlySpatialFields } from './monthly-spatial-fields'
import { clamp, gaussian, smoothstep } from '#math/math'
import { DEG, smoothMasked } from './climate-geometry'
import { itczAtLongitude, regionalItczLatitude } from './monthly-forcing'

export interface MonthlyWind {
  east: Float32Array
  north: Float32Array
  x: Float32Array
  y: Float32Array
  z: Float32Array
}

const FLAT_MOISTURE_DECAY_KM = 20000
const MOISTURE_TRANSPORT_REACH_KM = 3400
const RELIEF_MOISTURE_DECAY_PER_KM = 0.55

export function makeMonthlyWind(mesh: ClimateMesh, surface: ClimateSurfaceData, spatial: MonthlySpatialFields, forcing: MonthlyForcing): MonthlyWind {
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
    const itcz = regionalItczLatitude(
      itczAtLongitude(forcing.itczLatitude, longitude),
      forcing.maritimeItczLatitude,
      surface.landMask[region] ? 0 : spatial.coastDistanceKm[region],
    )
    const localSolar = forcing.solarDeclination * Math.tanh(latitude / (10 * DEG))
    const summerFraction = smoothstep(-10 * DEG, 10 * DEG, localSolar)
    // Trades and westerlies move poleward in local summer and equatorward in winter.
    const maritime = surface.landMask[region] ? 0 : smoothstep(0, 550, spatial.coastDistanceKm[region])
    const tradeEdge = 24 + (10 - 6 * maritime) * summerFraction
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

function windConvergence(mesh: ClimateMesh, wind: MonthlyWind, edgeKm: number): Float32Array {
  const count = mesh.numRegions
  const convergence = new Float32Array(count)
  const edgeRadians = edgeKm / mesh.physicalRadiusKm
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
  mesh: ClimateMesh,
  surface: ClimateSurfaceData,
  spatial: MonthlySpatialFields,
  forcing: MonthlyForcing,
  temperatureC: Float32Array,
  wind: MonthlyWind,
  convergence: Float32Array,
  landWaterAvailability?: Float32Array,
): Float32Array {
  const count = mesh.numRegions
  let source = new Float32Array(count)
  let target = new Float32Array(count)
  const flatRetention = new Float32Array(count)
  const edgeRetention = new Float32Array(mesh.neighbors.length)
  for (let region = 0; region < count; region++) {
    const warmth = forcing.oceanWarmth[region]
    if (surface.landMask[region]) {
      const temperature = temperatureC[region]
      const latitude = mesh.regionLatitude[region]
      const absLatitude = Math.abs(latitude / DEG)
      const itcz = itczAtLongitude(forcing.itczLatitude, mesh.regionLongitude[region])
      const dryBelt = gaussian(absLatitude - 28, 13)
      const frontalAscent = gaussian(absLatitude - 50, 13)
      const convectiveAscent = gaussian(Math.abs(latitude - itcz) / DEG, 11)
      // Geography and season set the potential; the annual climate limits the supply.
      const landEvaporationPotential = clamp(
        0.6 - 0.4 * spatial.continentality[region]
        - 0.25 * dryBelt + 0.2 * convectiveAscent,
        0,
        0.8,
      )
      const thawedSupply = smoothstep(-12, 10, temperature)
      // Suppress local recycling in the driest continental interiors.
      const dryInterior = dryBelt * spatial.continentality[region]
        * (1 - smoothstep(0, 0.35, landEvaporationPotential))
      const evapSupply = (0.05 + 0.13 * Math.sqrt(landEvaporationPotential))
        * smoothstep(0, 0.1, landEvaporationPotential) * (1 - dryInterior)
      const potentialSupply = evapSupply * thawedSupply
        + 0.02 * smoothstep(0, 30, temperature) * (1 - spatial.continentality[region])
      source[region] = potentialSupply * (landWaterAvailability?.[region] ?? 1)
      // Warm subtropical land entrains dry air as moisture travels over it.
      const drySubtropicalLand = dryBelt * (1 - landEvaporationPotential)
        * smoothstep(8, 25, temperature)
      const coldLand = 1 - smoothstep(-8, 10, temperature)
      // Dry-air mixing acts during travel. Weak winds spend longer crossing the same
      // distance, while the nominal background flow (speed 1) keeps the reference decay.
      const transportSpeed = Math.min(1, Math.hypot(wind.east[region], wind.north[region]))
      const landDecayPerKm = drySubtropicalLand / MOISTURE_TRANSPORT_REACH_KM
        + 9 * coldLand / FLAT_MOISTURE_DECAY_KM
      const landRetention = landDecayPerKm > 0 ? Math.exp(-spatial.edgeKm * landDecayPerKm / transportSpeed) : 1
      const rainout = 0.08 * convectiveAscent + 0.04 * frontalAscent
        + 0.05 * smoothstep(0, 0.7, convergence[region])
      flatRetention[region] = Math.exp(-spatial.edgeKm * (1 / FLAT_MOISTURE_DECAY_KM + rainout / 2500))
      const elevation = Math.max(0, surface.elevationKm[region])
      for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
        const upstream = mesh.neighbors[edge]
        const overLand = surface.landMask[upstream] === 1
        const descent = overLand ? Math.max(0, surface.elevationKm[upstream] - elevation) : 0
        // Descending air warms on the lee side. Reduce its effective moisture
        // supply along the warm, dry path before mixing it with other inflow.
        edgeRetention[edge] = overLand
          ? landRetention * Math.exp(-RELIEF_MOISTURE_DECAY_PER_KM * descent * drySubtropicalLand)
          : 1
      }
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
  const hops = clamp(Math.round(MOISTURE_TRANSPORT_REACH_KM / spatial.edgeKm), 8, 24)
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
        incoming += source[neighbor] * alignment * edgeRetention[edge]
        sourceHeight += Math.max(0, surface.elevationKm[neighbor]) * alignment
        weight += alignment
      }
      if (weight > 0) {
        const rise = Math.max(0, surface.elevationKm[region] - sourceHeight / weight)
        const carried = incoming / weight * flatRetention[region] * Math.exp(-RELIEF_MOISTURE_DECAY_PER_KM * rise)
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
  mesh: ClimateMesh,
  surface: ClimateSurfaceData,
  spatial: MonthlySpatialFields,
  forcing: MonthlyForcing,
  temperatureC: Float32Array,
  precipitationScale = 1,
  landWaterAvailability?: Float32Array,
): Float32Array {
  const count = mesh.numRegions
  const wind = makeMonthlyWind(mesh, surface, spatial, forcing)
  const convergence = windConvergence(mesh, wind, spatial.edgeKm)
  const moisture = advectMoisture(mesh, surface, spatial, forcing, temperatureC, wind, convergence, landWaterAvailability)
  const precipitationMm = new Float32Array(count)
  for (let region = 0; region < count; region++) {
    const latitude = mesh.regionLatitude[region]
    const longitude = mesh.regionLongitude[region]
    const land = surface.landMask[region] === 1
    const absLatitude = Math.abs(latitude / DEG)
    const itcz = regionalItczLatitude(
      itczAtLongitude(forcing.itczLatitude, longitude),
      forcing.maritimeItczLatitude,
      land ? 0 : spatial.coastDistanceKm[region],
    )
    const itczDistance = Math.abs(latitude - itcz) / DEG
    const humidity = moisture[region]
    const localSolar = forcing.solarDeclination * Math.tanh(latitude / (10 * DEG))
    const summerFraction = smoothstep(-10 * DEG, 10 * DEG, localSolar)
    const subtropicalCenter = 25 + (land ? 12 : 4) * summerFraction
    const subtropicalHigh = gaussian(absLatitude - subtropicalCenter, 10)
    const westCoast = land ? spatial.westCoastInfluence[region] : 0
    // Confine the Mediterranean seasonal contrast to coasts with clear western exposure.
    const exposedWestCoast = smoothstep(0.25, 0.8, westCoast)
    // Subtropical subsidence limits summer fronts without removing them entirely.
    const frontalStrength = gaussian(absLatitude - (44 + 8 * summerFraction), 15)
      * (1 - 0.5 * summerFraction * subtropicalHigh * exposedWestCoast)
    const itczStrength = gaussian(itczDistance, 11)
    const convergenceStrength = smoothstep(0, 0.7, convergence[region])
    // Move rainfall from the overactive tropical ocean belt toward the
    // underfed midlatitude storm tracks in the 1991–2020 GPCP comparison.
    let rate = humidity * (1.3 + (land ? 5.2 : 3.5) * itczStrength + 3.8 * frontalStrength + 1.4 * convergenceStrength)

    rate *= 1 - 0.62 * subtropicalHigh
    rate *= 1 - 0.22 * smoothstep(0, 12, forcing.pressureHpa[region] - 1013)

    if (land) {
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
      rate += 0.25 * frontalStrength * humidity
      // Winter westerlies bring ocean moisture and frontal storms onto west coasts.
      const winterOnshore = smoothstep(-0.1, 0.35, wind.east[region])
      rate += humidity * 0.65 * (1 - summerFraction)
        * gaussian(absLatitude - 38, 11) * exposedWestCoast * winterOnshore
      // Summer subtropical subsidence also suppresses orographic and local rain.
      rate *= 1 - 0.3 * summerFraction * subtropicalHigh * exposedWestCoast

      // Eastern continental shores reverse from a dry winter outflow to an
      // onshore summer monsoon, including latitudes beyond the ITCZ rain belt.
      const monsoonEast = forcing.monsoonEast[region]
      const summerOnshore = Math.max(0, -monsoonEast) * summerFraction
        * smoothstep(0.05, 0.45, -wind.east[region])
      const summerOnshoreGain = 3.2 + spatial.eastMonsoonExposure[region] ** 2
      rate += humidity * summerOnshoreGain * summerOnshore
      const winterOutflow = Math.max(0, monsoonEast) * (1 - summerFraction)
        * (1 - smoothstep(0, 12, temperatureC[region]))
        * (1 - westCoast)
      const winterOutflowDrying = 0.82 + 0.16 * spatial.eastMonsoonExposure[region] ** 2
      rate *= 1 - winterOutflowDrying * winterOutflow
    }
    precipitationMm[region] = clamp(rate * precipitationScale, 0, 18) * forcing.days
  }
  return precipitationMm
}
