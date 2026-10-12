import type { WorldConfig } from '@/core/simulation/config'
import type { GeneratedSphericalWorld } from '@/core/simulation/pipeline/types'
import { getOutputClimateMonth } from '@/core/simulation/climate/climate-output-projector'
import { projectMonthlyVectorField } from '@/core/simulation/climate/monthly-vector-projector'

export function prepareClimateDisplayFields(world: GeneratedSphericalWorld | null, config: WorldConfig): void {
  const climate = world?.data.climate
  if (!world || !climate)
    return

  const surfaceField = config.appearance.surfaceField
  const mode = (surfaceField && surfaceField !== 'default')
    ? surfaceField
    : config.appearance.baseMap
  const month = config.appearance.climateMonth
  const climateMesh = world.mesh.numRegions <= world.referenceMesh.numRegions
    ? world.mesh
    : world.referenceMesh

  if (mode === 'wind') {
    if (climate.displayWindVector?.month !== month) {
      climate.displayWindVector = projectMonthlyVectorField(
        world.mesh,
        climateMesh,
        world.data.geography,
        climate,
        month,
        config.climate.axialTiltDeg,
        'wind',
      )
    }
    climate.displayVector = climate.displayWindVector
  }
  else if (mode === 'ocean-current') {
    if (climate.displayOceanVector?.month !== month) {
      climate.displayOceanVector = projectMonthlyVectorField(
        world.mesh,
        climateMesh,
        world.data.geography,
        climate,
        month,
        config.climate.axialTiltDeg,
        'ocean-current',
      )
    }
    climate.displayVector = climate.displayOceanVector
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
