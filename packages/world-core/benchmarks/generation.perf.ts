import { writeFileSync } from 'node:fs'
import { cpus, platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { expect, it } from 'vitest'
import { createMeshPipeline } from '#generation/stages/mesh-stage'
import { GenerationPipeline, StageRegistry } from '#generation/pipeline'

it('records pipeline overhead, MeshStage rebuilds and cache hits without machine-specific thresholds', async () => {
  const empty = new GenerationPipeline(new StageRegistry())
  const emptyInput = { seed: '42', config: {} }
  const overheadStart = performance.now()
  for (let i = 0; i < 1000; i++)
    await empty.execute(emptyInput)
  const emptyPipelineUs = (performance.now() - overheadStart) * 1000 / 1000
  const rows = []
  for (const [level, irregularity] of [[5, 0.5], [6, 0.5], [7, 0.5]] as const) {
    const pipeline = createMeshPipeline()
    const input = { seed: '42', config: { mesh: { subdivisionLevel: level, irregularity }, planet: { physicalRadiusKm: 6371 } } }
    const planStart = performance.now()
    for (let i = 0; i < 1000; i++)
      pipeline.plan(input)
    const planUs = (performance.now() - planStart) * 1000 / 1000
    const firstStart = performance.now()
    const first = await pipeline.execute(input)
    const firstMs = performance.now() - firstStart
    expect(first.plan[0].action).toBe('execute')
    const hitStart = performance.now()
    for (let i = 0; i < 100; i++) {
      const hit = await pipeline.execute(input)
      expect(hit.plan[0].action).toBe('cache-hit')
    }
    const cacheHitUs = (performance.now() - hitStart) * 1000 / 100
    const irrelevant = { seed: '42', config: { ...input.config, climate: { rainFactor: 2 }, view: { style: 'blue' } } }
    expect(pipeline.plan(irrelevant)[0].action).toBe('cache-hit')
    expect(pipeline.plan({ seed: '42', config: { ...input.config, mesh: { ...input.config.mesh, irregularity: 0 } } })[0].action).toBe('execute')
    expect(pipeline.plan({ seed: '100', config: input.config })[0].action).toBe('execute')
    rows.push({ level, irregularity, regionCount: first.getOutput<{ regionCount: number }>('mesh').regionCount, emptyPipelineUs, planUs, firstMs, cacheHitUs, cacheBytes: pipeline.cache.usedBytes })
  }
  const report = { machine: { cpu: cpus()[0]?.model, platform: platform(), node: process.version }, rows }
  const path = join(tmpdir(), 'another-earth-m04-generation-benchmark.json')
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`M0.4 benchmark written to ${path}\n`)
})
