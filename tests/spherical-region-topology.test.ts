import { expect, it } from 'vitest'
import { FibonacciSphereBuilder } from '@/core/mesh/fibonacci-sphere-builder'
import SphericalMesh from '@/core/mesh/mesh'
import { SphericalRegionTopologyBuilder } from '@/core/mesh/spherical-region-topology'

it('closes region borders from Delaunay adjacency when cell corners are geometrically misordered', () => {
  const mesh = new SphericalMesh(new FibonacciSphereBuilder().build(42, 9))
  const region = Array.from({ length: mesh.numRegions }, (_, index) => index)
    .find(index => mesh.voronoi.cellCornerOffsets[index + 1] - mesh.voronoi.cellCornerOffsets[index] >= 5)!
  const start = mesh.voronoi.cellCornerOffsets[region]
  const corners = mesh.voronoi.cellCorners
  const displaced = corners[start + 1]
  corners[start + 1] = corners[start + 3]
  corners[start + 3] = displaced

  const labels = new Int32Array(mesh.numRegions)
  labels[region] = 1
  const topology = new SphericalRegionTopologyBuilder().build(mesh, labels)
  const boundaryCount = topology.boundaryEdges.length

  expect(boundaryCount).toBeGreaterThanOrEqual(5)
  for (const label of [0, 1]) {
    const polygon = topology.polygons.find(item => item.regionId === label)
    expect(polygon).toBeDefined()
    const ringEdges = polygon!.rings.flatMap(ring => [...ring.edgeIndices])
    expect(ringEdges.length).toBe(boundaryCount)
    expect(new Set(ringEdges)).toEqual(new Set(topology.boundaryEdges))
  }
})
