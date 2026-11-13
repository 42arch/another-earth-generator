import type { ClimateArtifact, SphericalMesh } from '../src/index'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { cpus, platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { expect, it } from 'vitest'
import { createClimatePipeline, DEFAULT_CLIMATE_PARAMETERS, DEFAULT_GEOLOGY_PARAMETERS, DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS, StageCache } from '../src/index'

function digest(array: Float32Array | Int32Array): string {
  return createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex')
}

it('records C0 fixed-seed output, stage reuse, area statistics and resource bytes', async () => {
  const seeds = process.env.CLIMATE_BENCH_SEEDS?.split(',') ?? ['42']
  const levels = process.env.CLIMATE_BENCH_LEVELS?.split(',').map(Number) ?? [4, 5, 6]
  const uiDefaults = process.env.CLIMATE_BENCH_UI_DEFAULTS === '1'
  const irregularity = uiDefaults ? 0.75 : 0.5
  const climateParameters = uiDefaults
    ? { ...DEFAULT_CLIMATE_PARAMETERS, axialTiltDegrees: 23.5, precipitationScale: 1.8 }
    : DEFAULT_CLIMATE_PARAMETERS
  const rows = []
  for (const seed of seeds) {
    for (const level of levels) {
      const pipeline = createClimatePipeline(new StageCache(512 * 2 ** 20))
      const input = { seed, config: { planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 }, mesh: { subdivisionLevel: level, irregularity }, reference: { subdivisionLevel: 6 }, geology: DEFAULT_GEOLOGY_PARAMETERS, landforms: DEFAULT_LANDFORM_PARAMETERS, terrain: DEFAULT_TERRAIN_PARAMETERS, climate: climateParameters } }
      const started = performance.now()
      const cold = await pipeline.execute(input)
      const coldMs = performance.now() - started
      const climate = cold.getOutput<ClimateArtifact>('climate-c0')
      const mesh = cold.getOutput<SphericalMesh>('mesh')
      const temperatureHash = digest(climate.temperatureC)
      const precipitationHash = digest(climate.precipitationMm)
      const hitStarted = performance.now()
      const hit = await pipeline.execute(input)
      const hitMs = performance.now() - hitStarted
      expect(hit.plan.every(stage => stage.action === 'cache-hit')).toBe(true)
      const changedStarted = performance.now()
      const changed = await pipeline.execute({ ...input, config: { ...input.config, climate: { ...input.config.climate, temperatureOffsetC: 2 } } })
      const changedMs = performance.now() - changedStarted
      expect(changed.plan.filter(stage => stage.action === 'execute').map(stage => stage.stageId)).toEqual(['climate-c0'])
      const forceStarted = performance.now()
      const forced = await pipeline.execute(input, { force: true })
      const forceMs = performance.now() - forceStarted
      const recomputed = forced.getOutput<ClimateArtifact>('climate-c0')
      expect(digest(recomputed.temperatureC)).toBe(temperatureHash)
      expect(digest(recomputed.precipitationMm)).toBe(precipitationHash)
      expect(digest(recomputed.oceanReference)).toBe(digest(climate.oceanReference))
      expect(digest(recomputed.circulation.oceanEast)).toBe(digest(climate.circulation.oceanEast))
      expect(digest(recomputed.circulation.oceanWarmth)).toBe(digest(climate.circulation.oceanWarmth))
      expect(digest(recomputed.circulation.windEast)).toBe(digest(climate.circulation.windEast))
      let totalArea = 0
      let weightedRain = 0
      for (let r = 0; r < mesh.regionCount; r++) {
        totalArea += mesh.areaKm2[r]
        weightedRain += mesh.areaKm2[r] * climate.annualPrecipitationMm[r]
      }
      const climateArrayBytes = [...Object.values(climate), ...Object.values(climate.circulation)]
        .reduce<number>((bytes, value) => bytes + (ArrayBuffer.isView(value) ? value.byteLength : 0), 0)
      rows.push({ seed, level, algorithmVersion: climate.algorithmVersion, coldMs, hitMs, changedMs, forceMs, temperatureHash, precipitationHash, cacheHitStages: hit.plan.filter(stage => stage.action === 'cache-hit').map(stage => stage.stageId), changedStages: changed.plan.filter(stage => stage.action === 'execute').map(stage => stage.stageId), cacheBytes: pipeline.cache.usedBytes, climateArrayBytes, areaWeightedAnnualRainMm: weightedRain / totalArea })
    }
  }
  const report = { date: new Date().toISOString(), machine: { cpu: cpus()[0]?.model, platform: platform(), node: process.version }, config: { seeds, levels, physicalRadiusKm: 6371, irregularity, referenceLevel: 6, climate: climateParameters }, processPeakRssKiB: process.resourceUsage().maxRSS, rows }
  const path = join(tmpdir(), `another-earth-m12-climate-${Date.now()}.json`)
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`M1.2 climate benchmark written to ${path}\n`)
})
