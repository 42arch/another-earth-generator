import type { GeologyArtifact } from '#generation/nature/geology'
import type { SphericalMesh } from '#mesh/spherical-mesh'
import { queryGeologyRegion, validateGeologyArtifact } from '#generation/nature/geology'
import { describe, expect, it } from 'vitest'
import { createGeologyPipeline, DEFAULT_GEOLOGY_PARAMETERS } from './geology-stage'

const input = () => ({ seed: 'M1.1A-fixed', config: { planet: { physicalRadiusKm: 6371 }, mesh: { subdivisionLevel: 2, irregularity: 0.5 }, reference: { subdivisionLevel: 2 }, geology: { ...DEFAULT_GEOLOGY_PARAMETERS } } })

describe('m1.1A geology pipeline', () => {
  it('generates real typed geology, preserves dependencies and reproduces forced/cold outputs', async () => {
    const pipeline = createGeologyPipeline()
    const first = await pipeline.execute(input())
    const geology = first.getOutput<GeologyArtifact>('geology')
    expect(Array.from(geology.geographicReference)).toEqual(Array.from({ length: geology.plateIndex.length }, (_, i) => i))
    const reference = first.getOutput<SphericalMesh>('reference-mesh')
    const topology = first.getOutput<{ topology: { regionPlate: Int16Array, plateCount: number } }>('plate-topology').topology
    for (let plate = 0; plate < topology.plateCount; plate++) {
      const start = topology.regionPlate.indexOf(plate)
      expect(start).toBeGreaterThanOrEqual(0)
      const queue = [start]
      const visited = new Set(queue)
      for (let head = 0; head < queue.length; head++) {
        const r = queue[head]
        for (let i = reference.neighborOffsets[r]; i < reference.neighborOffsets[r + 1]; i++) {
          const neighbor = reference.neighbors[i]
          if (topology.regionPlate[neighbor] === plate && !visited.has(neighbor)) {
            visited.add(neighbor)
            queue.push(neighbor)
          }
        }
      }
      expect(visited.size).toBe(topology.regionPlate.filter(p => p === plate).length)
    }
    validateGeologyArtifact(geology)
    const copy = structuredClone(geology)
    const second = await pipeline.execute(input())
    expect(second.plan.every(stage => stage.action === 'cache-hit')).toBe(true)
    expect(second.getOutput('geology')).toBe(geology)
    expect((await pipeline.execute(input(), { force: true })).getOutput('geology')).toEqual(copy)
    expect((await createGeologyPipeline().execute(input())).getOutput('geology')).toEqual(copy)
    expect(geology).toEqual(copy)
    expect(queryGeologyRegion(geology, 0).plateId).toBe(geology.plates[geology.plateIndex[0]].id)
    expect(() => queryGeologyRegion(geology, -1)).toThrow()
  })

  it('keeps reference geology across output resolution and candidate-land changes', async () => {
    const pipeline = createGeologyPipeline()
    const base = input()
    await pipeline.execute(base)
    const landChange = { ...base, config: { ...base.config, geology: { ...base.config.geology, candidateLandCoverage: 0.6 } } }
    const land = await pipeline.execute(landChange)
    expect(land.plan.filter(s => s.action === 'execute').map(s => s.stageId)).toEqual(['continental-crust', 'geology'])
    const resolution = { ...landChange, config: { ...landChange.config, mesh: { ...base.config.mesh, subdivisionLevel: 1 } } }
    const resized = await pipeline.execute(resolution)
    expect(resized.plan.filter(s => s.action === 'execute').map(s => s.stageId)).toEqual(['mesh', 'geological-mapping', 'geology'])
    expect(resized.getOutput<GeologyArtifact>('geology').plateIndex.length).toBe(42)
    const display = { ...resolution, config: { ...resolution.config, appearance: { color: 'green' } } }
    expect(pipeline.plan(display).every(stage => stage.action === 'cache-hit')).toBe(true)
  })

  it.each([0, 1])('supports candidate coverage %s without invalid references', async (coverage) => {
    const base = input()
    base.config.geology.candidateLandCoverage = coverage
    const geology = (await createGeologyPipeline().execute(base)).getOutput<GeologyArtifact>('geology')
    expect(geology.candidateLandMask.every(v => v === coverage)).toBe(true)
    expect(geology.statistics.referenceCandidateLandCoverage).toBeCloseTo(coverage)
    if (coverage === 0) {
      expect(geology.continents).toHaveLength(0)
      expect(geology.continentIndex.every(v => v === -1)).toBe(true)
    }
  })

  it.each([[2, 0, 1, 0.05], [100, 0, 100, 0.95], [2, 98, 100, 0.5]])('validates extreme plate/continent combinations %s/%s/%s/%s', async (primary, micro, continents, coverage) => {
    const base = input()
    base.config.mesh.subdivisionLevel = 0
    base.config.geology = { ...DEFAULT_GEOLOGY_PARAMETERS, primaryPlateCount: primary, microPlateCount: micro, continentCount: continents, candidateLandCoverage: coverage }
    const geology = (await createGeologyPipeline().execute(base)).getOutput<GeologyArtifact>('geology')
    validateGeologyArtifact(geology)
    expect(geology.plateIndex.length).toBe(12)
    expect(geology.statistics.actualMicroPlateCount).toBeLessThanOrEqual(micro)
  })

  it('rejects invalid plate counts, bad mapping and mismatched meshes', async () => {
    const base = input()
    base.config.geology.primaryPlateCount = 101
    await expect(createGeologyPipeline().execute(base)).rejects.toThrow('primaryPlateCount')
    const geology = (await createGeologyPipeline().execute(input())).getOutput<GeologyArtifact>('geology')
    expect(() => validateGeologyArtifact(geology, 'other-mesh')).toThrow()
    const broken = structuredClone(geology)
    broken.geologicalReference[0] = broken.referenceRegionCount
    expect(() => validateGeologyArtifact(broken)).toThrow('region 0')
  })
})
