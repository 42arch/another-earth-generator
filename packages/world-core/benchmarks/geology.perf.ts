import type { GeologyArtifact } from '#generation/nature/geology'
import type { PipelineEvent } from '#generation/pipeline'
import { writeFileSync } from 'node:fs'
import { cpus, platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { createGeologyPipeline, DEFAULT_GEOLOGY_PARAMETERS } from '#generation/stages/geology-stage'
import { stableHash } from '#math/random'
import { expect, it } from 'vitest'

it('records fixed-seed reference/output geology costs and quality summaries', async () => {
  const rows = []
  for (const level of [4, 5, 6]) {
    const pipeline = createGeologyPipeline()
    const input = { seed: '42', config: { planet: { physicalRadiusKm: 6371 }, mesh: { subdivisionLevel: level, irregularity: 0.5 }, geology: DEFAULT_GEOLOGY_PARAMETERS } }
    const events: PipelineEvent[] = []
    const start = performance.now()
    const first = await pipeline.execute(input, { onEvent: event => events.push(event) })
    const coldMs = performance.now() - start
    const geology = first.getOutput<GeologyArtifact>('geology')
    const hitStart = performance.now()
    const hit = await pipeline.execute(input)
    const hitMs = performance.now() - hitStart
    expect(hit.plan.every(stage => stage.action === 'cache-hit')).toBe(true)
    const changedInput = { ...input, config: { ...input.config, geology: { ...DEFAULT_GEOLOGY_PARAMETERS, continentCount: 3 } } }
    const changedStart = performance.now()
    const changed = await pipeline.execute(changedInput)
    const changedMs = performance.now() - changedStart
    const changedStages = changed.plan.filter(stage => stage.action === 'execute').map(stage => stage.stageId)
    expect(changedStages).toEqual(['continental-crust', 'geology'])
    rows.push({
      level,
      coldMs,
      hitMs,
      changedMs,
      changedStages,
      stageMs: Object.fromEntries(events.filter(event => event.type === 'stage-completed').map(event => [event.stageId, event.durationMs])),
      cacheBytes: pipeline.cache.usedBytes,
      artifactBytes: Object.values(geology).reduce((sum, value) => sum + (ArrayBuffer.isView(value) ? value.byteLength : 0), 0),
      plates: geology.plates.length,
      continents: geology.continents.length,
      statistics: geology.statistics,
      plateIndexHash: stableHash(Array.from(geology.plateIndex).join(',')),
      candidateMaskHash: stableHash(Array.from(geology.candidateLandMask).join(',')),
    })
  }
  const report = { date: new Date().toISOString(), algorithmVersion: 'geology-v2', seed: '42', config: { referenceSubdivisionLevel: 6, irregularity: 0.5, physicalRadiusKm: 6371, geology: DEFAULT_GEOLOGY_PARAMETERS }, machine: { cpu: cpus()[0]?.model, platform: platform(), node: process.version }, rows }
  const path = join(tmpdir(), 'another-earth-m11a-geology-benchmark.json')
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`M1.1A benchmark written to ${path}\n`)
})
