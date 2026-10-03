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

    for (let month = 0; month < CLIMATE_MONTH_COUNT; month++) {
      const fields = getOutputClimateMonth(
        mesh,
        climateMesh,
        data.geography,
        data.climate,
        month,
        context.config.climate.axialTiltDeg,
      )
      const days = MONTH_DAYS[month]
      for (let region = 0; region < mesh.numRegions; region++) {
        if (!landMask[region])
          continue
        const temperature = fields.temperatureC[region]
        const precipitation = fields.precipitationMm[region]
        // With no soil reservoir, monthly rain first meets potential evaporation.
        const evaporationDemand = days * 0.015 * Math.max(0, temperature + 5) ** 1.45
        annualRunoff[region] += Math.max(0, precipitation - evaporationDemand)
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
