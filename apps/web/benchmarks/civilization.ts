import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import process from 'node:process'
import { assembleWorld, createWorldPipeline, DEFAULT_CIVILIZATION_PARAMETERS, DEFAULT_CLIMATE_PARAMETERS, DEFAULT_GEOLOGY_PARAMETERS, DEFAULT_HYDROLOGY_PARAMETERS, DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS } from '@another-earth/world-core'
import { builtinContentPacks, builtinContentPort, builtinPipelineContent } from '../src/lib/generation/builtin-content'
import { applyCivilizationPreset, CIVILIZATION_PRESETS } from '../src/ui/hud/civilization-presets'

async function main(): Promise<void> {
  const [levelText = '6', seed = 'm2-civilization-seed', tag = 'current', scenario = 'industrial-mercantile'] = process.argv.slice(2)
  const level = Number(levelText)
  const preset = CIVILIZATION_PRESETS.find(preset => preset.id === scenario)
  if (![4, 5, 6, 7, 8].includes(level) || !/^[\w-]+$/.test(tag) || !preset)
    throw new Error('Usage: bun benchmarks/civilization.ts <4..8> <seed> <report-tag> [preset-id]')
  const pipeline = createWorldPipeline()
  const config = {
    ecology: true as const,
    planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
    mesh: { subdivisionLevel: level, irregularity: 0.45 },
    reference: { subdivisionLevel: 6 },
    geology: DEFAULT_GEOLOGY_PARAMETERS,
    landforms: DEFAULT_LANDFORM_PARAMETERS,
    terrain: DEFAULT_TERRAIN_PARAMETERS,
    climate: DEFAULT_CLIMATE_PARAMETERS,
    hydrology: DEFAULT_HYDROLOGY_PARAMETERS,
    civilization: scenario === 'industrial-mercantile' ? DEFAULT_CIVILIZATION_PARAMETERS : applyCivilizationPreset(preset.id, true),
  }
  const input = { seed, config, ...builtinPipelineContent }
  const stages: { id: string, durationMs: number, rssBytes: number }[] = []
  const startedAt = new Date().toISOString()
  const start = performance.now()
  let lastUpdate = 0
  const result = await pipeline.execute(input, { onEvent(event) {
    if (event.type === 'stage-completed') {
      stages.push({ id: event.stageId!, durationMs: event.durationMs!, rssBytes: process.memoryUsage().rss })
      process.stdout.write(`${event.stageId} ${(event.durationMs! / 1000).toFixed(2)}s RSS ${(process.memoryUsage().rss / 2 ** 20).toFixed(0)} MiB\n`)
    }
    else if (event.type === 'stage-progress' && performance.now() - lastUpdate > 15_000) {
      lastUpdate = performance.now()
      process.stdout.write(`${event.stageId} ${Math.round(event.stageProgress! * 100)}%\n`)
    }
  } })
  const pipelineMs = performance.now() - start
  const assemblyStart = performance.now()
  const world = assembleWorld(input, result, pipeline.registry, {
    snapshotId: `snapshot:civ-benchmark:${level}:${seed}`,
    worldId: 'world:civ-benchmark',
    name: 'CIV-01 benchmark',
    createdAt: '2026-11-22T00:00:00Z',
  }, builtinContentPacks, builtinContentPort)
  const assemblyValidationMs = performance.now() - assemblyStart
  const totalMs = performance.now() - start
  let landAreaKm2 = 0
  let populatedAreaKm2 = 0
  let coastalPopulation = 0
  let population = 0
  const hab = result.getOutput<{ coastalMask: Uint8Array }>('habitability')
  for (let r = 0; r < world.mesh.regionCount; r++) {
    const pop = world.civilization.population.values[r]!
    population += pop
    if (world.nature.geography.landMask.values[r] === 1)
      landAreaKm2 += world.mesh.areaKm2[r]!
    if (pop > 0)
      populatedAreaKm2 += world.mesh.areaKm2[r]!
    if (hab.coastalMask[r])
      coastalPopulation += pop
  }
  const sitePopulation = world.civilization.settlements.reduce((sum, site) => sum + site.population, 0)
  const fingerprint = createHash('sha256')
  for (const array of [world.mesh.centers, world.civilization.population.values, world.civilization.territoryPolityIndex.values])
    fingerprint.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength))
  fingerprint.update(JSON.stringify(world.civilization.settlements))
  for (const route of world.civilization.transport.routes) {
    fingerprint.update(`${route.id}:${route.cost}:`)
    fingerprint.update(Buffer.from(route.regions.buffer, route.regions.byteOffset, route.regions.byteLength))
  }
  const report = {
    startedAt,
    tag,
    seed,
    level,
    schemaVersion: world.schemaVersion,
    environment: { bun: Bun.version, platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, totalMemoryBytes: totalmem() },
    contentSignatures: input.contentSignatures,
    config,
    versions: world.metadata.provenance.stageVersions,
    validation: 'Full assembly and domain validation passed',
    fingerprint: fingerprint.digest('hex'),
    performance: { pipelineMs, assemblyValidationMs, totalMs, peakRssKiB: process.resourceUsage().maxRSS, finalMemory: process.memoryUsage(), stages },
    metrics: { regions: world.mesh.regionCount, population, landAreaKm2, populatedAreaKm2, peoplePerLandKm2: population / landAreaKm2, earthLandEquivalentPopulation: population / landAreaKm2 * 148_940_000, namedSettlementPopulation: sitePopulation, namedSettlementShare: sitePopulation / population, coastalPopulationShare: coastalPopulation / population, settlements: world.civilization.settlements.length, polities: world.civilization.polities.length, cultures: world.civilization.cultures.length, routes: world.civilization.transport.routes.length, seaRoutes: world.civilization.transport.routes.filter(route => route.mode === 'sea').length },
  }
  const directory = new URL('../../../docs/benchmarks/', import.meta.url)
  mkdirSync(directory, { recursive: true })
  writeFileSync(new URL(`CIV-01-${tag}-L${level}-${seed}.json`, directory), `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(report.metrics)}\n${JSON.stringify(report.performance, (key, value) => key === 'stages' ? undefined : value)}\n`)
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
