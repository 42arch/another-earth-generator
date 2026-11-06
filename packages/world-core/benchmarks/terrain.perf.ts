import type { PipelineEvent } from '#generation/pipeline'
import type { SphericalMesh } from '#mesh/spherical-mesh'
import type { TerrainArtifact } from '#generation/nature/geography'
import type { GeologyArtifact } from '#generation/nature/geology'
import type { ElevationFields } from '#generation/nature/geology/tectonics/tectonic-elevation-generator'
import { writeFileSync } from 'node:fs'
import { cpus, platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { expect, it } from 'vitest'
import { DEFAULT_GEOLOGY_PARAMETERS } from '#generation/stages/geology-stage'
import { createTerrainPipeline, DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS, TERRAIN_RANDOM_VERSION } from '#generation/stages/terrain-stage'
import { stableHash, stageRandom } from '#math/random'
import { icosphereRegionCount } from '#mesh/icosphere'
import { normalizedElevationArrayToKm, TerrainPostProcessor } from '#generation/nature/geography'
import { algorithmMesh } from '#generation/nature/common'
import { summarizeRoughnessProtection, summarizeTerrain } from './terrain-quality'

it('records tectonic terrain stages, fixed-seed field summaries and postprocessing cache reuse', async () => {
  const rows = []
  const levels = process.env.TERRAIN_BENCH_LEVELS?.split(',').map(Number) ?? [4, 5, 6]
  levels.forEach(icosphereRegionCount)
  const roughness = Number(process.env.TERRAIN_BENCH_ROUGHNESS ?? DEFAULT_TERRAIN_PARAMETERS.roughness)
  const terrainWarp = Number(process.env.TERRAIN_BENCH_WARP ?? DEFAULT_TERRAIN_PARAMETERS.terrainWarp)
  const seeds = process.env.TERRAIN_BENCH_SEEDS?.split(',') ?? ['42']
  for (const seed of seeds) {
    for (const level of levels) {
      const pipeline = createTerrainPipeline()
      const input = { seed, config: { planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 }, mesh: { subdivisionLevel: level, irregularity: 0.5 }, geology: DEFAULT_GEOLOGY_PARAMETERS, landforms: DEFAULT_LANDFORM_PARAMETERS, terrain: { ...DEFAULT_TERRAIN_PARAMETERS, roughness, terrainWarp } } }
      const events: PipelineEvent[] = []
      const start = performance.now()
      const first = await pipeline.execute(input, { onEvent: event => events.push(event) })
      const coldMs = performance.now() - start
      const terrain = first.getOutput<TerrainArtifact>('terrain')
      const hitStart = performance.now()
      const hit = await pipeline.execute(input)
      const hitMs = performance.now() - hitStart
      expect(hit.plan.every(stage => stage.action === 'cache-hit')).toBe(true)
      const changedStart = performance.now()
      const changed = await pipeline.execute({ ...input, config: { ...input.config, terrain: { ...input.config.terrain, roughness: 0.1 } } })
      const changedMs = performance.now() - changedStart
      const changedStages = changed.plan.filter(stage => stage.action === 'execute').map(stage => stage.stageId)
      expect(changedStages).toEqual(['terrain'])
      const quality = process.env.TERRAIN_BENCH_QUALITY === '1'
      const mesh = first.getOutput<SphericalMesh>('mesh')
      const candidateLandMask = first.getOutput<GeologyArtifact>('geology').candidateLandMask
      const steps: { step: string, summary: ReturnType<typeof summarizeTerrain> }[] = []
      if (quality) {
        const { fields } = first.getOutput<{ fields: ElevationFields }>('tectonic-elevation')
        const tectonics = first.getOutput<{ mantleElevationCoordinate: Float32Array }>('tectonics')
        steps.push({ step: 'skeleton', summary: summarizeTerrain(mesh, normalizedElevationArrayToKm(fields.elevation), candidateLandMask) })
        // Reuse exactly the production terrain stream and frozen upstream fields.
        new TerrainPostProcessor().generate(algorithmMesh(mesh), fields.elevation, candidateLandMask, fields.spatialFields, fields.classification, stageRandom(seed, 'terrain', TERRAIN_RANDOM_VERSION), input.config.landforms.islandDensity, input.config.terrain.roughness, input.config.terrain.terrainWarp, input.config.terrain.smoothing, input.config.terrain.ridgeSharpening, tectonics.mantleElevationCoordinate, fields.phasorRidge, fields.edifices.hotspot, fields.edifices.total, (step, values) => steps.push({ step, summary: summarizeTerrain(mesh, normalizedElevationArrayToKm(values), candidateLandMask) }))
      }
      rows.push({ seed, steps, roughnessProtection: quality ? summarizeRoughnessProtection(mesh, terrain.elevationKm, terrain.roughnessWeight) : undefined, lowRoughnessSummary: quality ? summarizeTerrain(mesh, changed.getOutput<TerrainArtifact>('terrain').elevationKm, candidateLandMask) : undefined, algorithmVersion: terrain.algorithmVersion, level, coldMs, hitMs, changedMs, changedStages, stageMs: Object.fromEntries(events.filter(event => event.type === 'stage-completed').map(event => [event.stageId, event.durationMs])), cacheBytes: pipeline.cache.usedBytes, artifactBytes: Object.values(terrain).reduce((sum, value) => sum + (ArrayBuffer.isView(value) ? value.byteLength : 0), 0), statistics: terrain.statistics, elevationHash: stableHash(Array.from(terrain.elevationKm).join(',')), landMaskHash: stableHash(Array.from(terrain.landMask).join(',')) })
    }
  }
  const report = { date: new Date().toISOString(), algorithmVersion: rows[0]?.algorithmVersion, seeds, config: { referenceSubdivisionLevel: 6, irregularity: 0.5, physicalRadiusKm: 6371, seaLevelDatumKm: 0, geology: DEFAULT_GEOLOGY_PARAMETERS, landforms: DEFAULT_LANDFORM_PARAMETERS, terrain: { ...DEFAULT_TERRAIN_PARAMETERS, roughness, terrainWarp } }, machine: { cpu: cpus()[0]?.model, platform: platform(), node: process.version }, rows }
  const path = join(tmpdir(), 'another-earth-m11b-terrain-benchmark.json')
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`M1.1B benchmark written to ${path}\n`)
})
