import type { GeoJsonFeatureCollection, GeoJsonPosition } from '@/core/data-source/geojson'
import type { SphericalStrokePath } from '@/core/math/polyline'
import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldSimulationState } from '@/core/simulation/state'
import { cartesianToGeographic, geographicToCartesian } from '@/core/projections/projection-math'
import { RiverGeometry } from '@/core/rendering/shared/river-geometry'
import { elevationKmToDisplayCoordinate } from '@/core/simulation/geography/elevation-units'

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
  const paths = new RiverGeometry().createStrokePaths(mesh, data, altitudes)
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

/** Compiles any river LineString source to the shared 2D/3D ribbon input. */
export function riverStrokePaths(
  source: GeoJsonFeatureCollection,
  colorForFlow: (flowAccumulation: number, order: number) => readonly [number, number, number],
  terrainVerticalScale = 0,
  styleWidth = 1,
): SphericalStrokePath[] {
  const paths: SphericalStrokePath[] = []
  for (const feature of source.features) {
    const lines = feature.geometry.type === 'LineString'
      ? [feature.geometry.coordinates]
      : feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : []
    const widths = Array.isArray(feature.properties.widths) ? feature.properties.widths : []
    const floorScales = Array.isArray(feature.properties.widthFloorScales) ? feature.properties.widthFloorScales : []
    const flows = Array.isArray(feature.properties.flows) ? feature.properties.flows : []
    let firstIndex = 0
    for (const line of lines) {
      if (line.length < 2)
        continue
      const points = line.map((coordinate, localIndex) => {
        const index = firstIndex + localIndex
        const flowAccumulation = Number(flows[index] ?? feature.properties.flowAccumulation ?? 0)
        const order = Math.floor(Math.log2(Math.max(1, flowAccumulation)))
        return {
          position: [...geographicToCartesian(coordinate[0] * Math.PI / 180, coordinate[1] * Math.PI / 180)] as [number, number, number],
          width: Number(widths[index] ?? 0.001) * styleWidth,
          widthFloorScale: Number(floorScales[index] ?? 1),
          color: colorForFlow(flowAccumulation, order),
          surfaceOffset: terrainVerticalScale
            ? elevationKmToDisplayCoordinate((coordinate[2] ?? 0) / 1000) * terrainVerticalScale
            : undefined,
        }
      })
      paths.push({ points, closed: false })
      firstIndex += line.length
    }
  }
  return paths
}
