import type { GeneratedSphericalWorld } from '@/core/simulation/pipeline/types'
import type { WorldConfig } from '@/core/simulation/config'
import { getOutputClimateMonth } from '@/core/climate/climate-output-projector'
import { projectMonthlyVectorField } from '@/core/climate/monthly-vector-projector'

export function prepareClimateDisplayFields(world: GeneratedSphericalWorld | null, config: WorldConfig): void {
  const climate = world?.data.climate
  if (!world || !climate)
    return

  const mode = config.appearance.baseMap
  const month = config.appearance.climateMonth
  const climateMesh = world.mesh.numRegions <= world.referenceMesh.numRegions
    ? world.mesh
    : world.referenceMesh

  if (mode === 'wind' || mode === 'ocean-current') {
    if (climate.displayVector?.month !== month || climate.displayVector.kind !== mode) {
      climate.displayVector = projectMonthlyVectorField(
        world.mesh,
        climateMesh,
        world.data.geography,
        climate,
        month,
        config.climate.axialTiltDeg,
        mode,
      )
    }
  }
  else if (mode === 'temperature' || mode === 'precipitation') {
    if (climate.displayMonth?.month === month)
      return
    climate.displayMonth = {
      month,
      ...getOutputClimateMonth(
        world.mesh,
        climateMesh,
        world.data.geography,
        climate,
        month,
        config.climate.axialTiltDeg,
      ),
    }
  }
}
