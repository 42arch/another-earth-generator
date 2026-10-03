import type { ClimateData, MonthlyClimateData } from '@/core/climate/climate-data'
import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import { CLIMATE_MONTH_COUNT } from '@/core/climate/climate-data'
import { interpolateMonthlyForcing } from '@/core/climate/monthly-forcing'
import { computeMonthlyPrecipitation } from '@/core/climate/monthly-precipitation-generator'
import { makeMonthlySpatialFields } from '@/core/climate/monthly-spatial-fields'
import { computeMonthlyTemperature } from '@/core/climate/monthly-temperature-generator'

/** Four circulation anchors drive twelve independent monthly T/P solutions. */
export function generateMonthlyClimate(
  mesh: SphericalMesh,
  climate: ClimateData,
  settings: WorldConfig['climate'],
): MonthlyClimateData {
  const count = mesh.numRegions
  if (climate.surface.regionCount !== count || climate.circulation.regionCount !== count)
    throw new Error('Climate surface and circulation mesh sizes do not match')
  const spatial = makeMonthlySpatialFields(mesh, climate.surface)
  const temperatureC = new Float32Array(count * CLIMATE_MONTH_COUNT)
  const precipitationMm = new Float32Array(temperatureC.length)

  for (let month = 0; month < CLIMATE_MONTH_COUNT; month++) {
    const forcing = interpolateMonthlyForcing(climate.circulation, month, settings.axialTiltDeg)
    const initialTemperature = computeMonthlyTemperature(
      mesh,
      climate.surface,
      spatial,
      forcing,
      undefined,
      settings.temperatureOffsetC,
    )
    const initialPrecipitation = computeMonthlyPrecipitation(
      mesh,
      climate.surface,
      spatial,
      forcing,
      initialTemperature,
      settings.precipitationScale,
    )
    const correctedTemperature = computeMonthlyTemperature(
      mesh,
      climate.surface,
      spatial,
      forcing,
      initialPrecipitation,
      settings.temperatureOffsetC,
    )
    const precipitation = computeMonthlyPrecipitation(
      mesh,
      climate.surface,
      spatial,
      forcing,
      correctedTemperature,
      settings.precipitationScale,
    )
    const temperature = computeMonthlyTemperature(
      mesh,
      climate.surface,
      spatial,
      forcing,
      precipitation,
      settings.temperatureOffsetC,
    )
    const offset = month * count
    temperatureC.set(temperature, offset)
    precipitationMm.set(precipitation, offset)
  }
  return { regionCount: count, temperatureC, precipitationMm }
}
