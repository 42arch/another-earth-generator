import { describe, expect, it, vi } from 'vitest'
import { SurfaceHydrologyGenerator } from '@/core/hydrology/surface-hydrology-generator'
import { FibonacciSphereBuilder } from '@/core/mesh/fibonacci-sphere-builder'
import SphericalMesh from '@/core/mesh/mesh'
import { SphericalVoronoiBuilder } from '@/core/mesh/voronoi'

const mesh = new SphericalMesh(new FibonacciSphereBuilder().build(1024, 73, 0.3))

describe('generation reuse', () => {
  it('restores transferred topology and areas without rebuilding Voronoi geometry', () => {
    const snapshot = structuredClone(mesh)
    const build = vi.spyOn(SphericalVoronoiBuilder.prototype, 'build')
    try {
      const restored = new SphericalMesh(snapshot)
      expect(build).not.toHaveBeenCalled()
      expect(restored.regionArea).toBe(snapshot.voronoi.cellArea)
      expect([...restored.forEachNeighborOfRegion(0)]).toEqual([...mesh.forEachNeighborOfRegion(0)])
      const neighbor = mesh.neighbors[mesh.neighborOffsets[0]]
      expect(restored.voronoi.getSharedBoundaryCorners(0, neighbor)).toEqual(mesh.voronoi.getSharedBoundaryCorners(0, neighbor))
      expect(restored.distanceBetweenRegions(0, neighbor)).toBe(mesh.distanceBetweenRegions(0, neighbor))
    }
    finally {
      build.mockRestore()
    }
  })

  it('updates drainage directions after terrain changes while reusing fixed edge distances', () => {
    const oceanMask = Uint8Array.from(mesh.regionLatitude, latitude => latitude < -0.5 ? 1 : 0)
    const elevation = Float32Array.from(oceanMask, ocean => ocean ? -1 : 0.1)
    const runoff = new Float32Array(mesh.numRegions).fill(1000)
    const generator = new SurfaceHydrologyGenerator()
    const first = generator.routeRunoff(mesh, elevation, oceanMask, runoff)
    const region = first.topologicalOrder.find(i => first.downstream[i] >= 0 && !oceanMask[first.downstream[i]])!
    const neighbors = [...mesh.forEachNeighborOfRegion(region)].filter(i => !oceanMask[i])
    const alternate = neighbors.find(i => i !== first.downstream[region])!
    expect(alternate).toBeDefined()
    elevation[region] = 2
    for (const neighbor of neighbors)
      elevation[neighbor] = neighbor === alternate ? 0.1 : 1.9
    const changed = generator.routeRunoff(mesh, elevation, oceanMask, runoff)
    expect(changed.downstream[region]).toBe(alternate)
    for (const i of changed.topologicalOrder) {
      const target = changed.downstream[i]
      if (target >= 0)
        expect(changed.downstreamDistance[i]).toBe(mesh.distanceBetweenRegions(i, target))
    }
  })
})
