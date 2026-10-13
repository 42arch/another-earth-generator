import type { GeoJsonFeature, GeoJsonFeatureCollection, GeoJsonPosition } from '@/core/data-source/geojson'
import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldSimulationState } from '@/core/simulation/state'
import { buildSmoothedRegionCornersForMode } from '@/core/data-source/utils/region-classification'
import { SphericalRegionTopologyBuilder } from '@/core/mesh/spherical-region-topology'
import { cartesianToGeographic } from '@/core/projections/projection-math'

export interface GeoJsonLineSourceContext {
  mesh: SphericalMesh
  data: WorldSimulationState
}

export type GeoJsonLineSourceAdapter = (context: GeoJsonLineSourceContext) => GeoJsonFeatureCollection

function regionPosition(mesh: SphericalMesh, data: WorldSimulationState, region: number): GeoJsonPosition {
  return [mesh.regionLongitude[region] * 180 / Math.PI, mesh.regionLatitude[region] * 180 / Math.PI, data.geography.elevation[region] * 1000]
}

function cornerPosition(positions: Float32Array, corner: number, altitudeMeters = 0): GeoJsonPosition {
  const index = corner * 3
  const geographic = cartesianToGeographic(positions[index], positions[index + 1], positions[index + 2])
  return [geographic.longitude * 180 / Math.PI, geographic.latitude * 180 / Math.PI, altitudeMeters]
}

function polityBoundaries({ mesh, data }: GeoJsonLineSourceContext): GeoJsonFeatureCollection {
  const polities = data.civilization?.polities
  if (!polities)
    return { type: 'FeatureCollection', features: [] }
  const positions = buildSmoothedRegionCornersForMode(mesh, data, 'polities', new SphericalRegionTopologyBuilder())
  const grouped = new Map<string, { properties: Record<string, unknown>, coordinates: GeoJsonPosition[][] }>()
  const cornerElevation = new Float32Array(positions.length / 3)
  const cornerCount = new Uint8Array(cornerElevation.length)
  for (let region = 0; region < mesh.numRegions; region++) {
    const start = mesh.voronoi.cellCornerOffsets[region]
    const end = mesh.voronoi.cellCornerOffsets[region + 1]
    for (let index = start; index < end; index++) {
      const corner = mesh.voronoi.cellCorners[index]
      cornerElevation[corner] += data.geography.elevation[region] * 1000
      cornerCount[corner]++
    }
  }
  for (let corner = 0; corner < cornerElevation.length; corner++) {
    if (cornerCount[corner] > 0)
      cornerElevation[corner] /= cornerCount[corner]
  }
  const edgeRegions = mesh.voronoi.edgeRegions
  const edgeCorners = mesh.voronoi.edgeCorners
  for (let edge = 0; edge < edgeRegions.length / 2; edge++) {
    const a = edgeRegions[edge * 2]
    const b = edgeRegions[edge * 2 + 1]
    if (!data.geography.landMask[a] || !data.geography.landMask[b])
      continue
    const ownerA = polities.polityByRegion[a]
    const ownerB = polities.polityByRegion[b]
    if (ownerA === ownerB || (ownerA < 0 && ownerB < 0))
      continue
    const first = Math.min(ownerA, ownerB)
    const second = Math.max(ownerA, ownerB)
    const disputed = polities.controlStrength[a] < 0.65 || polities.controlStrength[b] < 0.65
    const key = `${first}:${second}:${disputed}`
    let group = grouped.get(key)
    if (!group) {
      group = { properties: { ownerA: first, ownerB: second, disputed }, coordinates: [] }
      grouped.set(key, group)
    }
    group.coordinates.push([
      cornerPosition(positions, edgeCorners[edge * 2], cornerElevation[edgeCorners[edge * 2]]),
      cornerPosition(positions, edgeCorners[edge * 2 + 1], cornerElevation[edgeCorners[edge * 2 + 1]]),
    ])
  }
  return {
    type: 'FeatureCollection',
    features: [...grouped].map(([id, group]): GeoJsonFeature => ({
      type: 'Feature',
      id: `border:${id}`,
      geometry: { type: 'MultiLineString', coordinates: group.coordinates },
      properties: group.properties,
    })),
  }
}

function transportNetwork({ mesh, data }: GeoJsonLineSourceContext): GeoJsonFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: (data.civilization?.transport?.routes ?? [])
      .filter(route => route.regions.length >= 2)
      .map((route): GeoJsonFeature => ({
        type: 'Feature',
        id: route.id,
        geometry: { type: 'LineString', coordinates: Array.from(route.regions, region => regionPosition(mesh, data, region)) },
        properties: { kind: route.kind, distanceKm: route.distanceKm, costKm: route.costKm },
      })),
  }
}

export const GEOJSON_LINE_SOURCE_ADAPTERS: Record<string, GeoJsonLineSourceAdapter> = {
  'polity-boundaries': polityBoundaries,
  'transport-network': transportNetwork,
}
