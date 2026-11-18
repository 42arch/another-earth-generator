import type { SphericalMesh } from '#mesh/spherical-mesh'
import type { WorldGenerationConfig } from './mesh-stage'
import { describe, expect, it } from 'vitest'
import { AleaRandom } from '#math/random'
import { MeshQueries } from '#mesh/queries'
import { createSphericalMesh } from '#mesh/spherical-mesh'
import { validateSphericalMesh } from '#mesh/validation'
import { createMeshGenerationRecord, createMeshPipeline } from './mesh-stage'

function config(subdivisionLevel = 2, irregularity = 0): WorldGenerationConfig {
  return { planet: { physicalRadiusKm: 6371 }, mesh: { subdivisionLevel, irregularity } }
}
async function mesh(pipeline: ReturnType<typeof createMeshPipeline>, seed: string, value: WorldGenerationConfig): Promise<SphericalMesh> {
  return (await pipeline.execute({ seed, config: value })).getOutput<SphericalMesh>('mesh')
}

describe('real MeshStage integration', () => {
  it('preserves regular and irregular M0.3 geometry and supports queries', async () => {
    const pipeline = createMeshPipeline()
    for (const irregularity of [0, 0.75]) {
      const actual = await mesh(pipeline, '42', config(2, irregularity))
      const direct = createSphericalMesh({ subdivisionLevel: 2, physicalRadiusKm: 6371, irregularity, seed: '42' })
      const injected = createSphericalMesh({ subdivisionLevel: 2, physicalRadiusKm: 6371, irregularity, seed: '42', random: new AleaRandom('42') })
      expect(actual.centers).toEqual(direct.centers)
      expect(injected.centers).toEqual(direct.centers)
      expect(actual.triangles).toEqual(direct.triangles)
      expect(actual.boundaryCorners).toEqual(direct.boundaryCorners)
      expect(actual.areaKm2).toEqual(direct.areaKm2)
      expect(validateSphericalMesh(actual).valid).toBe(true)
      expect(new MeshQueries(actual).getNeighborCount(0)).toBeGreaterThanOrEqual(5)
    }
  })

  it('hits identical inputs and rebuilds for mesh changes or world seed changes', async () => {
    const pipeline = createMeshPipeline()
    const first = await mesh(pipeline, '42', config(2, 0.5))
    expect(pipeline.plan({ seed: '42', config: config(2, 0.5) })[0].action).toBe('cache-hit')
    const second = await mesh(pipeline, '42', config(2, 0.5))
    expect(second).toBe(first)
    expect(second.centers).toEqual(first.centers)
    expect(pipeline.plan({ seed: '42', config: config(3, 0.5) })[0].action).toBe('execute')
    expect(pipeline.plan({ seed: '42', config: config(2, 0) })[0].action).toBe('execute')
    expect(pipeline.plan({ seed: '100', config: config(2, 0.5) })[0].action).toBe('execute')
    const higher = await mesh(pipeline, '42', config(3, 0.5))
    expect(higher.regionCount).toBe(642)
    const regular = await mesh(pipeline, '42', config(2, 0))
    expect(regular.irregularity).toBe(0)
    expect(regular.triangles).not.toEqual(first.triangles)
    const unrelated = { ...config(2, 0.5), climate: { rainFactor: 99 }, civilization: { count: 100 }, mapStyle: 'purple' }
    expect(pipeline.plan({ seed: '42', config: unrelated })[0].action).toBe('cache-hit')
    const changed = await mesh(pipeline, '100', config(2, 0.5))
    expect(changed.centers).not.toEqual(first.centers)
    expect((await mesh(pipeline, '42', config(2, 0.5))).centers).toEqual(first.centers)
    const sameRegularGeometryNewSeed = await mesh(pipeline, '100', config(2, 0))
    expect(sameRegularGeometryNewSeed).not.toBe(regular)
    expect(sameRegularGeometryNewSeed.triangles).toEqual(regular.triangles)
  })

  it('allows an explicit mesh seed override and validates input', async () => {
    const pipeline = createMeshPipeline()
    const withOverride = { ...config(2, 1), mesh: { subdivisionLevel: 2, irregularity: 1, seed: 'stable-mesh' } }
    const result = await mesh(pipeline, 'world-a', withOverride)
    expect(result.seed).toBe('stable-mesh')
    expect(result.centers).toEqual(createSphericalMesh({ subdivisionLevel: 2, physicalRadiusKm: 6371, irregularity: 1, seed: 'stable-mesh' }).centers)
    await expect(mesh(pipeline, '42', config(9, 0))).rejects.toMatchObject({ name: 'InvalidStageInputError', stageId: 'mesh' })
    await expect(mesh(pipeline, '42', { ...config(), mesh: { subdivisionLevel: 2, irregularity: 1, seed: '' } })).rejects.toMatchObject({ name: 'InvalidStageInputError', stageId: 'mesh' })
    await expect(mesh(pipeline, '', config())).rejects.toMatchObject({ name: 'InvalidStageInputError', stageId: 'pipeline' })
  })
  it('captures the executed mesh configuration and provenance for a future snapshot', async () => {
    const pipeline = createMeshPipeline()
    const input = { seed: '42', config: config(2, 0.5) }
    const result = await pipeline.execute(input)
    const planet = { physicalRadiusKm: 6371, rotationPeriodHours: 24, orbitalPeriodDays: 365, axialTiltDegrees: 23.4, seaLevelDatumKm: 0 }
    const record = createMeshGenerationRecord(input, result, planet, false)
    expect(record.generationConfig.mesh).toEqual(input.config.mesh)
    expect(record.generationConfig.regionCount).toBe(162)
    expect(record.provenance.stageVersions.mesh).toBe('1')
    expect(record.provenance.artifactSignatures.mesh).toBe(result.plan[0].inputSignature)
    expect(() => createMeshGenerationRecord({ seed: 'different', config: input.config }, result, planet, false)).toThrow()
  })
})
