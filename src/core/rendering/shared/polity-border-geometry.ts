import type { BufferAttribute } from 'three'
import type { SphericalLinePath, SphericalPoint } from '@/core/math/polyline'
import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldSimulationState } from '@/core/simulation/state'
import { stitchSphericalSegments } from '@/core/math/polyline'
import { SphericalCellBoundaryGeometry } from '@/core/rendering/shared/cell-boundary-geometry'

import { SphericalRegionTopologyBuilder } from '@/core/rendering/shared/spherical-region-topology'

/** Borders are derived from neighboring ownership, never stored as simulation state. */
export function createPolityBorderGeometry(
  mesh: SphericalMesh,
  data: WorldSimulationState,
  radius: number,
  terrainScale = 0,
  oceanDepthScale = 1,
  cornerPositions?: Float32Array,
) {
  const owners = data.society?.polities?.polityByRegion
  const edges: number[] = []
  if (owners) {
    const adjacent = mesh.voronoi.edgeRegions
    for (let edge = 0; edge < adjacent.length / 2; edge++) {
      const a = adjacent[edge * 2]
      const b = adjacent[edge * 2 + 1]
      if (data.geography.landMask[a] && data.geography.landMask[b]
        && owners[a] !== owners[b] && (owners[a] >= 0 || owners[b] >= 0)) {
        edges.push(edge)
      }
    }
  }
  return new SphericalCellBoundaryGeometry().create(
    mesh,
    radius,
    Number.POSITIVE_INFINITY,
    terrainScale > 0 ? data.geography.elevation : undefined,
    terrainScale,
    oceanDepthScale,
    undefined,
    Uint32Array.from(edges),
    cornerPositions,
  )
}

/** Labels used by the polity surface, including separate ocean and unassigned land categories. */
export function createPolityRegionIds(mesh: SphericalMesh, data: WorldSimulationState): Int32Array {
  const regionIds = new Int32Array(mesh.numRegions)
  const owners = data.society?.polities?.polityByRegion
  for (let region = 0; region < mesh.numRegions; region++) {
    regionIds[region] = data.geography.landMask[region] === 0
      ? -2147483648
      : owners?.[region] ?? -1
  }
  return regionIds
}

/** Compute the same smoothed corners used when the polity layer is the active base map. */
export function createPolitySmoothedCornerPositions(
  mesh: SphericalMesh,
  data: WorldSimulationState,
  topologyBuilder = new SphericalRegionTopologyBuilder(),
): Float32Array {
  const topology = topologyBuilder.build(mesh, createPolityRegionIds(mesh, data))
  return topologyBuilder.buildSmoothedCornerPositions(mesh, topology)
}

/** Stitch the selected Voronoi border edges into continuous spherical paths. */
export function createPolityBorderPaths(
  mesh: SphericalMesh,
  data: WorldSimulationState,
  radius: number,
  terrainScale = 0,
  oceanDepthScale = 1,
  cornerPositions?: Float32Array,
): SphericalLinePath[] {
  const source = createPolityBorderGeometry(mesh, data, radius, terrainScale, oceanDepthScale, cornerPositions)
  const positions = source.getAttribute('position') as BufferAttribute
  const segments: { start: string, end: string }[] = []
  const pointByKey = new Map<string, SphericalPoint>()
  const keyFor = (point: SphericalPoint) => point.map(value => value.toFixed(5)).join(',')
  for (let vertex = 0; vertex + 1 < positions.count; vertex += 2) {
    const start: [number, number, number] = [positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)]
    const end: [number, number, number] = [positions.getX(vertex + 1), positions.getY(vertex + 1), positions.getZ(vertex + 1)]
    const startKey = keyFor(start)
    const endKey = keyFor(end)
    pointByKey.set(startKey, start)
    pointByKey.set(endKey, end)
    segments.push({ start: startKey, end: endKey })
  }
  source.dispose()
  return stitchSphericalSegments(segments, pointByKey)
}
