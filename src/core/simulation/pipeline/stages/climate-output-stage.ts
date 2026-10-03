import type { MonthlyClimateData } from '@/core/climate/climate-data'
import type { ISimulationStage, SimulationContext } from '@/core/simulation/pipeline/types'
import { CLIMATE_MONTH_COUNT } from '@/core/climate/climate-data'
import { buildClimateOutputProjection, projectClimateMonth } from '@/core/climate/climate-output-projector'

const MAX_MATERIALIZED_REGIONS = 250000

export class ClimateOutputStage implements ISimulationStage {
  name = 'ClimateOutputProjection'

  execute(context: SimulationContext): void {
    const { mesh, referenceMesh, data } = context
    if (!mesh || !referenceMesh || !data?.climate?.monthly)
      throw new Error('Missing dependencies in ClimateOutputStage')
    const climate = data.climate
    const climateMesh = mesh.numRegions <= referenceMesh.numRegions ? mesh : referenceMesh
    if (mesh === climateMesh) {
      climate.outputMonthly = climate.monthly
      return
    }
    if (!context.climateOutputToReference)
      throw new Error('Missing geographic climate mapping')

    climate.outputProjection = buildClimateOutputProjection(
      mesh,
      climateMesh,
      context.climateOutputToReference,
      data.geography.landMask,
      data.geography.elevation,
      climate.surface.landMask,
      climate.surface.elevationKm,
    )
    if (mesh.numRegions > MAX_MATERIALIZED_REGIONS) {
      // Keep only conservation factors; the classifier samples each cell on demand.
      for (let month = 0; month < CLIMATE_MONTH_COUNT; month++)
        projectClimateMonth(mesh, climateMesh, data.geography, climate, month, context.config.climate.axialTiltDeg)
      return
    }

    const count = mesh.numRegions
    const output: MonthlyClimateData = {
      regionCount: count,
      temperatureC: new Float32Array(count * CLIMATE_MONTH_COUNT),
      precipitationMm: new Float32Array(count * CLIMATE_MONTH_COUNT),
    }
    for (let month = 0; month < CLIMATE_MONTH_COUNT; month++) {
      const fields = projectClimateMonth(
        mesh,
        climateMesh,
        data.geography,
        climate,
        month,
        context.config.climate.axialTiltDeg,
      )
      output.temperatureC.set(fields.temperatureC, month * count)
      output.precipitationMm.set(fields.precipitationMm, month * count)
    }
    climate.outputMonthly = output
  }
}
