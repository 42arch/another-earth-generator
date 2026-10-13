import type { GeoJsonFeature, GeoJsonFeatureCollection, GeoJsonPosition } from '@/core/data-source/geojson'
import type SphericalMesh from '@/core/mesh/mesh'
import type { SphericalAreaRing } from '@/core/mesh/spherical-region-topology'
import type { WorldSimulationState } from '@/core/simulation/state'
import { geoContains } from 'd3-geo'
import { buildDisplayRegionIds, getLandAreaGeometry } from '@/core/data-source/utils/region-classification'
import { SphericalRegionTopologyBuilder } from '@/core/mesh/spherical-region-topology'
import { cartesianToGeographic } from '@/core/projections/projection-math'
import { KOPPEN_CODES, KOPPEN_LABELS } from '@/core/simulation/climate/koppen-climate-classifier'
import { BIOME_LABELS } from '@/core/simulation/ecology/biome-data'

export type AreaSourceId
  = | 'plate-areas'
    | 'continent-areas'
    | 'koppen-areas'
    | 'biome-areas'
    | 'polity-areas'
    | 'ethnicity-areas'
    | 'language-areas'
    | 'religion-areas'

const sourceModes = {
  'plate-areas': 'plates',
  'continent-areas': 'continents',
  'koppen-areas': 'koppen',
  'biome-areas': 'biome',
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
  const polygons = polygonsFromRings(area.rings, smoothedCorners, outerSign)
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
  if (id === 'plate-areas')
    return { groupId, name: `板块 ${groupId + 1}` }
  if (id === 'continent-areas')
    return { groupId, name: `大陆 ${groupId + 1}` }
  if (id === 'koppen-areas')
    return { groupId, name: KOPPEN_LABELS[groupId] ?? KOPPEN_CODES[groupId] ?? '未知气候' }
  if (id === 'biome-areas')
    return { groupId, name: BIOME_LABELS[groupId] ?? '未知群系' }
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
  topologyBuilder = new SphericalRegionTopologyBuilder(),
): GeoJsonFeatureCollection {
  const mode = sourceModes[id]
  const hasData = id === 'plate-areas'
    ? Boolean(data.geology.regionSuperPlate)
    : id === 'continent-areas'
      ? Boolean(data.geography.visibleContinentId)
      : id === 'koppen-areas'
        ? Boolean(data.climate?.koppen?.climateClass)
        : id === 'biome-areas'
          ? Boolean(data.biome?.biomeClass)
          : id === 'polity-areas'
            ? Boolean(data.civilization?.polities)
            : id === 'religion-areas'
              ? Boolean(data.civilization?.religions)
              : Boolean(data.civilization?.ethnicity)
  if (!hasData)
    return { type: 'FeatureCollection', features: [] }
  const regionIds = buildDisplayRegionIds(mesh, data, mode)
  const topology = topologyBuilder.build(mesh, regionIds)
  const positions = topologyBuilder.buildSmoothedCornerPositions(mesh, topology)
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
