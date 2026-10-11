import type { GeoJsonFeature, GeoJsonFeatureCollection, GeoJsonPosition } from '@/core/data-source/geojson'
import type SphericalMesh from '@/core/mesh/mesh'
import type { SphericalAreaRing, SphericalRegionTopology } from '@/core/rendering/shared/spherical-region-topology'
import type { WorldSimulationState } from '@/core/simulation/state'
import { geoContains } from 'd3-geo'
import { resolveRasterCellSource } from '@/core/data-source/data-sources'
import { cartesianToGeographic } from '@/core/projections/projection-math'
import { buildDisplayRegionIds } from '@/core/rendering/shared/region-display'
import { SphericalRegionTopologyBuilder } from '@/core/rendering/shared/spherical-region-topology'

export type AreaSourceId = 'polity-areas' | 'ethnicity-areas' | 'language-areas' | 'religion-areas'
export type AreaBoundaryMode = 'raw' | 'smoothed'

export interface LandAreaGeometry {
  landMask: Uint8Array
  topology: SphericalRegionTopology
  smoothedCorners: Float32Array
}

const landAreaCache = new WeakMap<SphericalMesh, WeakMap<object, LandAreaGeometry>>()

export function getLandAreaGeometry(mesh: SphericalMesh, data: WorldSimulationState): LandAreaGeometry {
  const sourceMask = resolveRasterCellSource('world-surface', mesh, data)?.fields.isLand ?? data.geography.landMask
  let byMask = landAreaCache.get(mesh)
  if (!byMask) {
    byMask = new WeakMap()
    landAreaCache.set(mesh, byMask)
  }
  const cached = byMask.get(sourceMask)
  if (cached)
    return cached

  const landMask = Uint8Array.from(sourceMask, value => value ? 1 : 0)
  const regionIds = Int32Array.from(landMask)
  const builder = new SphericalRegionTopologyBuilder()
  const topology = builder.build(mesh, regionIds)
  const result = {
    landMask,
    topology,
    smoothedCorners: builder.buildSmoothedCornerPositions(mesh, topology),
  }
  byMask.set(sourceMask, result)
  return result
}

const sourceModes = {
  'polity-areas': 'polities',
  'ethnicity-areas': 'ethnicity',
  'language-areas': 'languages',
  'religion-areas': 'religions',
} as const

function ringPositions(ring: SphericalAreaRing, positions: Float32Array): GeoJsonPosition[] {
  const coordinates: GeoJsonPosition[] = []
  for (const corner of ring.corners) {
    const index = corner * 3
    const point = cartesianToGeographic(positions[index], positions[index + 1], positions[index + 2])
    coordinates.push([point.longitude * 180 / Math.PI, point.latitude * 180 / Math.PI])
  }
  if (coordinates.length > 0)
    coordinates.push([...coordinates[0]] as GeoJsonPosition)
  return coordinates
}

function sphericalWinding(corners: Uint32Array, positions: Float32Array): number {
  let crossX = 0
  let crossY = 0
  let crossZ = 0
  let centerX = 0
  let centerY = 0
  let centerZ = 0
  for (let index = 0; index < corners.length; index++) {
    const a = corners[index] * 3
    const b = corners[(index + 1) % corners.length] * 3
    const ax = positions[a]
    const ay = positions[a + 1]
    const az = positions[a + 2]
    const bx = positions[b]
    const by = positions[b + 1]
    const bz = positions[b + 2]
    crossX += ay * bz - az * by
    crossY += az * bx - ax * bz
    crossZ += ax * by - ay * bx
    centerX += ax
    centerY += ay
    centerZ += az
  }
  return crossX * centerX + crossY * centerY + crossZ * centerZ
}

function polygonsFromRings(rings: SphericalAreaRing[], positions: Float32Array, expectedOuterSign?: number): GeoJsonPosition[][][] {
  const entries = rings.map(ring => ({
    coordinates: ringPositions(ring, positions),
    winding: sphericalWinding(ring.corners, positions),
    length: ring.corners.length,
  })).filter(entry => entry.coordinates.length >= 4)
  if (entries.length === 0)
    return []
  const largest = entries.reduce((best, entry, index) => entry.length > entries[best].length ? index : best, 0)
  const outerSign = expectedOuterSign ?? (Math.sign(entries[largest].winding) || 1)
  const polygons: GeoJsonPosition[][][] = []
  const holes: GeoJsonPosition[][] = []
  for (const entry of entries) {
    if ((Math.sign(entry.winding) || outerSign) === outerSign)
      polygons.push([outerSign > 0 ? entry.coordinates : [...entry.coordinates].reverse()])
    else
      holes.push(outerSign > 0 ? entry.coordinates : [...entry.coordinates].reverse())
  }
  for (const hole of holes) {
    const polygon = polygons.find(item => geoContains(
      { type: 'Polygon', coordinates: [[...item[0]].reverse()] },
      [hole[0][0], hole[0][1]],
    ))
    if (polygon)
      polygon.push(hole)
    else
      polygons.push([[...hole].reverse()])
  }
  return polygons
}

export function createLandGeoJsonSource(
  mesh: SphericalMesh,
  data: WorldSimulationState,
  boundaryMode: AreaBoundaryMode,
): GeoJsonFeatureCollection {
  const { landMask, topology, smoothedCorners } = getLandAreaGeometry(mesh, data)
  const area = topology.polygons.find(polygon => polygon.regionId === 1)
  if (!area)
    return { type: 'FeatureCollection', features: [] }

  const firstLandRegion = landMask.findIndex(value => value !== 0)
  const start = mesh.voronoi.cellCornerOffsets[firstLandRegion]
  const end = mesh.voronoi.cellCornerOffsets[firstLandRegion + 1]
  const cellCorners = mesh.voronoi.cellCorners.subarray(start, end)
  const outerSign = Math.sign(sphericalWinding(cellCorners, mesh.voronoi.cornerPosition)) || 1
  const positions = boundaryMode === 'smoothed' ? smoothedCorners : mesh.voronoi.cornerPosition
  const polygons = polygonsFromRings(area.rings, positions, outerSign)
  if (polygons.length === 0)
    return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      id: 'land',
      geometry: polygons.length === 1
        ? { type: 'Polygon', coordinates: polygons[0] }
        : { type: 'MultiPolygon', coordinates: polygons },
      properties: { kind: 'land' },
    }],
  }
}

function propertiesFor(id: AreaSourceId, groupId: number, data: WorldSimulationState): Record<string, unknown> {
  if (id === 'polity-areas') {
    const polity = data.civilization?.polities?.polities.find(item => item.id === groupId)
    return { groupId, name: polity?.name ?? '', population: polity?.population ?? 0 }
  }
  if (id === 'ethnicity-areas')
    return { groupId, name: data.civilization?.ethnicity?.groups.find(item => item.id === groupId)?.name ?? '' }
  if (id === 'language-areas')
    return { groupId, name: data.civilization?.ethnicity?.languages.find(item => item.id === groupId)?.name ?? '' }
  return { groupId, name: data.civilization?.religions?.religions.find(item => item.id === groupId)?.name ?? '' }
}

export function createAreaGeoJsonSource(
  id: AreaSourceId,
  mesh: SphericalMesh,
  data: WorldSimulationState,
  boundaryMode: AreaBoundaryMode,
  topologyBuilder = new SphericalRegionTopologyBuilder(),
): GeoJsonFeatureCollection {
  const mode = sourceModes[id]
  const hasData = id === 'polity-areas'
    ? Boolean(data.civilization?.polities)
    : id === 'religion-areas'
      ? Boolean(data.civilization?.religions)
      : Boolean(data.civilization?.ethnicity)
  if (!hasData)
    return { type: 'FeatureCollection', features: [] }
  const regionIds = buildDisplayRegionIds(mesh, data, mode)
  const topology = topologyBuilder.build(mesh, regionIds)
  const positions = boundaryMode === 'smoothed'
    ? topologyBuilder.buildSmoothedCornerPositions(mesh, topology)
    : mesh.voronoi.cornerPosition
  const features: GeoJsonFeature[] = []
  for (const area of topology.polygons) {
    if (area.regionId < 0)
      continue
    const polygons = polygonsFromRings(area.rings, positions)
    if (polygons.length === 0)
      continue
    features.push({
      type: 'Feature',
      id: area.regionId,
      geometry: polygons.length === 1
        ? { type: 'Polygon', coordinates: polygons[0] }
        : { type: 'MultiPolygon', coordinates: polygons },
      properties: propertiesFor(id, area.regionId, data),
    })
  }
  return { type: 'FeatureCollection', features }
}
