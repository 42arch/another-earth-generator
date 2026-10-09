import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldSimulationState } from '@/core/simulation/state'
import { BufferAttribute, BufferGeometry } from 'three'
import { elevationKmToDisplayCoordinate } from '@/core/geography/elevation-units'
import { getSurfaceDaylight } from '@/core/rendering/shared/day-night-lighting'

const ROAD_COLOR = [0.96, 0.68, 0.28] as const
const SEA_COLOR = [0.3, 0.72, 0.95] as const

/** Draws each selected mesh edge once; route entities retain their full paths for inspection. */
export function createTransportLineGeometry(
  mesh: SphericalMesh,
  data: WorldSimulationState,
  radius = 1,
  terrainScale = 0,
  dayNightSunDirection?: readonly [number, number, number],
): BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const seen = new Set<number>()
  for (const route of data.society?.transport?.routes ?? []) {
    for (let index = 1; index < route.regions.length; index++) {
      const from = route.regions[index - 1]
      const to = route.regions[index]
      if (from === to)
        continue
      const seaEdge = route.kind === 'sea'
        && (!data.geography.landMask[from] || !data.geography.landMask[to])
      const color = seaEdge ? SEA_COLOR : ROAD_COLOR
      const key = (Math.min(from, to) * mesh.numRegions + Math.max(from, to)) * 2
        + (seaEdge ? 1 : 0)
      if (seen.has(key))
        continue
      seen.add(key)
      for (const region of [from, to]) {
        const offset = region * 3
        const height = data.geography.landMask[region]
          ? elevationKmToDisplayCoordinate(data.geography.elevation[region]) * terrainScale
          : 0
        const pointRadius = radius + height + (radius === 1 ? 0 : 0.55)
        positions.push(
          mesh.regionPosition[offset] * pointRadius,
          mesh.regionPosition[offset + 1] * pointRadius,
          mesh.regionPosition[offset + 2] * pointRadius,
        )
        const brightness = dayNightSunDirection
          ? getSurfaceDaylight(
              mesh.regionPosition[offset],
              mesh.regionPosition[offset + 1],
              mesh.regionPosition[offset + 2],
              ...dayNightSunDirection,
            )
          : 1
        colors.push(color[0] * brightness, color[1] * brightness, color[2] * brightness)
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  if (positions.length > 0)
    geometry.computeBoundingSphere()
  return geometry
}
