import type { SphericalMesh } from '@another-earth/world-core'
import { createMeshPipeline, createSphericalMesh, MeshQueries } from '@another-earth/world-core'
import { describe, expect, it } from 'vitest'
import { hydrateMesh, transferSnapshot } from './transfer'

describe('mesh Worker transfer', () => {
  it.each([0, 0.5])('preserves a complete Mesh with irregularity %s without detaching the owner', (irregularity) => {
    const original = createSphericalMesh({ subdivisionLevel: 2, irregularity, seed: 'transfer', physicalRadiusKm: 6371 })
    for (let pass = 0; pass < 2; pass++) {
      const { mesh, buffers, bytes } = transferSnapshot(original)
      expect(new Set(buffers).size).toBe(buffers.length)
      expect(bytes).toBeGreaterThan(0)
      const received = hydrateMesh(structuredClone(mesh, { transfer: buffers }))
      expect(received).toEqual(original)
      expect(received.centers).toBeInstanceOf(Float64Array)
      expect(received.neighbors).toBeInstanceOf(Uint32Array)
      expect(received.boundaryCorners).toBeInstanceOf(Uint32Array)
      expect(received.edgeAngularDistances).toBeInstanceOf(Float64Array)
      expect(new MeshQueries(received).getNeighborCount(0)).toBe(new MeshQueries(original).getNeighborCount(0))
      expect(original.centers.byteLength).toBe(original.regionCount * 3 * 8)
    }
  })

  it('keeps a cached Pipeline artifact valid across transfers', async () => {
    const pipeline = createMeshPipeline()
    const input = { seed: '42', config: { planet: { physicalRadiusKm: 6371 }, mesh: { subdivisionLevel: 2, irregularity: 0.5 } } }
    const first = await pipeline.execute(input)
    const original = first.getOutput<SphericalMesh>('mesh')
    for (let pass = 0; pass < 2; pass++) {
      const result = await pipeline.execute(input)
      const snapshot = transferSnapshot(result.getOutput<SphericalMesh>('mesh'))
      hydrateMesh(structuredClone(snapshot.mesh, { transfer: snapshot.buffers }))
      expect(result.plan[0].action).toBe('cache-hit')
      expect(original.triangles.byteLength).toBeGreaterThan(0)
    }
  })

  it('rejects malformed data', () => {
    const mesh = createSphericalMesh({ subdivisionLevel: 0, physicalRadiusKm: 6371 })
    expect(() => hydrateMesh({ ...mesh, boundaryCorners: new Uint32Array(1) })).toThrow('lengths')
  })
})
