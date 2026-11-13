import type { ClimateSurfaceData } from './climate-data'
import type { ClimateMesh } from './climate-mesh'
import type { MonthlyForcing } from './monthly-forcing'
import type { MonthlySpatialFields } from './monthly-spatial-fields'
import { clamp, gaussian, smoothstep } from '#math/math'
import { DEG, smoothMasked } from './climate-geometry'
import { itczAtLongitude, regionalItczLatitude } from './monthly-forcing'

/** Compute one month's air temperature in degrees Celsius. */
export function computeMonthlyTemperature(
  mesh: ClimateMesh,
  surface: ClimateSurfaceData,
  spatial: MonthlySpatialFields,
  forcing: MonthlyForcing,
  precipitationMm?: Float32Array,
  temperatureOffsetC = 0,
): Float32Array {
  const count = mesh.numRegions
  const temperature = new Float32Array(count)
  const coastalWarmth = new Float32Array(forcing.oceanWarmth)
  const all = new Uint8Array(count).fill(1)
  const warmthPasses = Math.max(2, Math.round(450 / spatial.edgeKm))
  smoothMasked(mesh, coastalWarmth, all, warmthPasses)

  for (let region = 0; region < count; region++) {
    const latitude = mesh.regionLatitude[region]
    const longitude = mesh.regionLongitude[region]
    const latitudeDeg = latitude / DEG
    const absLatitude = Math.abs(latitudeDeg)
    const land = surface.landMask[region] === 1
    const continentality = land ? spatial.continentality[region] : 0
    const latitudeFraction = Math.max(0, (absLatitude - 12.4) / 77.6)
    // Match the stronger tropical-to-midlatitude cooling seen in marine
    // 2 m temperature normals while retaining the tropical and polar endpoints.
    let value = 27.8 - 48 * latitudeFraction ** 1.3
    // Approximate unresolved snow/sea-ice albedo and polar heat storage. This
    // cools the high-latitude annual climate and damps its summer temperature
    // peak, while leaving Köppen's formal EF threshold unchanged.
    const polarWeight = smoothstep(62, 88, absLatitude)
    value -= 5.5 * polarWeight

    // ITCZ displacement affects tropical heating; the annual latitude curve
    // remains the primary baseline away from the tropics.
    const itczLatitude = regionalItczLatitude(
      itczAtLongitude(forcing.itczLatitude, longitude),
      forcing.maritimeItczLatitude,
      land ? 0 : spatial.coastDistanceKm[region],
    ) / DEG
    const tropicalWeight = 1 - smoothstep(25, 60, absLatitude)
    value += (absLatitude - Math.abs(latitudeDeg - itczLatitude)) * 0.12 * tropicalWeight

    const latitudeRatio = absLatitude / 90
    const landSeasonalAmplitude = 2.5 + 16 * latitudeRatio ** 1.2 + 12 * continentality * latitudeRatio
    const marineSeasonalAmplitude = 1.5 + 8 * latitudeRatio ** 1.2
    // Subtropical western shores inherit a marine annual range; inland and polar land retain theirs.
    const subtropicalWest = smoothstep(22, 30, absLatitude) * (1 - smoothstep(42, 52, absLatitude))
    const westMaritime = land ? spatial.westCoastInfluence[region] * subtropicalWest : 0
    // Monsoon-facing eastern interiors have a larger summer/winter contrast;
    // concentrate it at strong east exposure and taper it at western shores.
    const easternContinentalSeason = land
      ? 5 * spatial.eastMonsoonExposure[region] ** 2 * (1 - spatial.westCoastInfluence[region]) ** 2
        * gaussian(absLatitude - 45, 10)
      : 0
    const baseSeasonalAmplitude = land
      ? landSeasonalAmplitude * (1 - westMaritime) + marineSeasonalAmplitude * westMaritime + easternContinentalSeason
      : marineSeasonalAmplitude
    const seasonalAmplitude = baseSeasonalAmplitude * (1 - 0.38 * polarWeight)
    const lag = land ? 0.35 : 0.65
    const localSeason = Math.sin(forcing.orbitalPhase - lag) * Math.tanh(latitudeDeg / 10)
    value += seasonalAmplitude * localSeason

    if (land) {
      value -= 8 * continentality * smoothstep(15, 50, absLatitude) * Math.max(0, -localSeason)
      value += 2 * (1 - continentality) * smoothstep(20, 55, absLatitude)
      const moisture = precipitationMm
        ? clamp(precipitationMm[region] / (forcing.days * 6), 0, 1)
        : 0.45
      const lapseRate = 6.9 - 3.4 * moisture
      value -= lapseRate * Math.max(0, surface.elevationKm[region])
      value += coastalWarmth[region] * 8 * Math.exp(-spatial.coastDistanceKm[region] / 550)
    }
    else {
      const currentSpeed = Math.hypot(forcing.oceanEast[region], forcing.oceanNorth[region])
      value += forcing.oceanWarmth[region] * 6 * Math.min(1.2, currentSpeed + 0.3)
    }

    if (precipitationMm) {
      const cloud = smoothstep(1, 7, precipitationMm[region] / forcing.days)
      value += (5 - value) * 0.04 * cloud
    }
    temperature[region] = clamp(value + temperatureOffsetC, -90, 60)
  }
  return temperature
}
