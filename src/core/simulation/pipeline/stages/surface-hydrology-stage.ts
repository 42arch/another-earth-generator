import type { ISimulationStage, SimulationContext } from '@/core/simulation/pipeline/types'
import { CLIMATE_MONTH_COUNT } from '@/core/climate/climate-data'
import { getOutputClimateMonth } from '@/core/climate/climate-output-projector'
import { MONTH_DAYS } from '@/core/climate/monthly-forcing'
import { SurfaceHydrologyGenerator } from '@/core/hydrology/surface-hydrology-generator'

/** Route climate-derived annual runoff across the finalized output terrain. */
export class SurfaceHydrologyStage implements ISimulationStage {
  name = 'SurfaceHydrology'

  private readonly generator = new SurfaceHydrologyGenerator()

  execute(context: SimulationContext): void {
    const { mesh, referenceMesh, data } = context
    if (!mesh || !referenceMesh || !data?.climate?.monthly)
      throw new Error('Missing output climate in SurfaceHydrologyStage')

    const climateMesh = mesh.numRegions <= referenceMesh.numRegions ? mesh : referenceMesh
    const landMask = data.geography.landMask
    const oceanMask = new Uint8Array(mesh.numRegions)
    const annualRunoff = new Float32Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++)
      oceanMask[region] = landMask[region] ? 0 : 1

    const snowpack = new Float32Array(mesh.numRegions)

    // Run for 24 months to allow snowpack to reach an annual steady state
    for (let month = 0; month < CLIMATE_MONTH_COUNT * 2; month++) {
      const monthIndex = month % CLIMATE_MONTH_COUNT
      const fields = getOutputClimateMonth(
        mesh,
        climateMesh,
        data.geography,
        data.climate,
        monthIndex,
        context.config.climate.axialTiltDeg,
      )
      const days = MONTH_DAYS[monthIndex]
      for (let region = 0; region < mesh.numRegions; region++) {
        if (!landMask[region])
          continue
        const temperature = fields.temperatureC[region]
        const precipitation = fields.precipitationMm[region]

        let availableLiquid = 0
        if (temperature < 0) {
          // Freezing temperatures: precipitation falls as snow
          snowpack[region] += precipitation
        }
        else {
          // Positive temperatures: precipitation falls as rain, and snow melts
          // Degree-day melt factor: roughly 2.5 mm per degree-day
          const meltRate = days * 2.5 * temperature
          const melt = Math.min(snowpack[region], meltRate)
          snowpack[region] -= melt
          availableLiquid = precipitation + melt
        }

        // Only accumulate runoff in the second year (months 12-23)
        if (month >= CLIMATE_MONTH_COUNT) {
          // With no soil reservoir, monthly rain first meets potential evaporation.
          const evaporationDemand = days * 0.015 * Math.max(0, temperature + 5) ** 1.45
          annualRunoff[region] += Math.max(0, availableLiquid - evaporationDemand)
        }
      }
    }

    data.hydrology = this.generator.generate(
      mesh,
      data.geography.elevation,
      oceanMask,
      annualRunoff,
    )
  }
}
