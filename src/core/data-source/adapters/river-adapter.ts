import type { GeoJsonFeatureCollection, GeoJsonPosition } from '@/core/data-source/geojson'
import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldSimulationState } from '@/core/simulation/state'
import { cartesianToGeographic } from '@/core/projections/projection-math'
import { extractRiverStrokePaths } from '@/core/simulation/hydrology/river-paths'

/** Simulation river paths expressed as portable coordinates and per-vertex flow data. */
export function createRiverGeoJsonSource(
  mesh: SphericalMesh,
  data: WorldSimulationState,
): GeoJsonFeatureCollection {
  if (!data.hydrology)
    return { type: 'FeatureCollection', features: [] }
  const altitudes = new Float32Array(mesh.numRegions)
  for (let region = 0; region < mesh.numRegions; region++) {
    altitudes[region] = data.geography.elevation[region] * 1000
  }
  const paths = extractRiverStrokePaths(mesh, data, altitudes)
  return {
    type: 'FeatureCollection',
    features: paths.map((path, index) => {
      const flows = path.points.map(point => point.flowAccumulation ?? 0)
      const maximumFlow = flows.reduce((maximum, flow) => Math.max(maximum, flow), 0)
      return {
        type: 'Feature' as const,
        id: `river:${index}`,
        geometry: {
          type: 'LineString' as const,
          coordinates: path.points.map((point): GeoJsonPosition => {
            const { longitude, latitude } = cartesianToGeographic(...point.position)
            return [longitude * 180 / Math.PI, latitude * 180 / Math.PI, point.surfaceOffset ?? 0]
          }),
        },
        properties: {
          flowAccumulation: maximumFlow,
          order: Math.floor(Math.log2(Math.max(1, maximumFlow))),
          widths: path.points.map(point => point.width),
          widthFloorScales: path.points.map(point => point.widthFloorScale ?? 1),
          flows,
        },
      }
    }),
  }
}
