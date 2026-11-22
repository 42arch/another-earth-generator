import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { assembleWorld, createWorldPipeline, DEFAULT_CLIMATE_PARAMETERS, DEFAULT_GEOLOGY_PARAMETERS, DEFAULT_HYDROLOGY_PARAMETERS, DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS } from '@another-earth/world-core'
import { builtinContentPacks, builtinContentPort, builtinPipelineContent } from '../src/lib/generation/builtin-content'
import { CIVILIZATION_PRESETS } from '../src/ui/hud/civilization-presets'

const monarchies = new Set(['kingdom', 'dynastic-monarchy', 'empire', 'principality', 'emirate', 'sultanate', 'khanate'])
const compact = new Set(['free-territory', 'chiefdom', 'commune', 'city-state'])
const fingerprint = (values: ArrayBufferView) => createHash('sha256').update(new Uint8Array(values.buffer, values.byteOffset, values.byteLength)).digest('hex')

async function main() {
  const tag = process.argv[2] ?? 'after'
  if (!['before', 'after'].includes(tag))
    throw new Error('Usage: bun benchmarks/polity-weights.ts <before|after>')
  const bundle = builtinPipelineContent.content['civilization-content']
  const archetypes = new Map(bundle.polities.map(arch => [arch.id, arch]))
  const reports = []
  const run = async (pipeline: ReturnType<typeof createWorldPipeline>, seed: string, preset: typeof CIVILIZATION_PRESETS[number], level: number) => {
    const config = {
      ecology: true as const, planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
      mesh: { subdivisionLevel: level, irregularity: 0.75 }, reference: { subdivisionLevel: 6 },
      geology: DEFAULT_GEOLOGY_PARAMETERS, landforms: DEFAULT_LANDFORM_PARAMETERS, terrain: DEFAULT_TERRAIN_PARAMETERS,
      climate: { ...DEFAULT_CLIMATE_PARAMETERS, axialTiltDegrees: 23.5, precipitationScale: 1.8 }, hydrology: DEFAULT_HYDROLOGY_PARAMETERS,
      civilization: preset.parameters,
    }
    const input = { seed, config, ...builtinPipelineContent }
    const result = await pipeline.execute(input)
    const world = assembleWorld(input, result, pipeline.registry, {
      snapshotId: `snapshot:weights:${seed}:${preset.id}:L${level}`, worldId: 'world:weights', name: 'Polity weight comparison', createdAt: '2026-11-23T00:00:00Z',
    }, builtinContentPacks, builtinContentPort)
    const forms: Record<string, number> = {}
    for (const polity of world.civilization.polities) {
      const arch = archetypes.get(polity.archetypeId)!
      forms[arch.politicalForm] = (forms[arch.politicalForm] ?? 0) + 1
      if (compact.has(arch.politicalForm) && !polity.traits.includes('small-area'))
        throw new Error('Compact polity lost its required small-area trait')
    }
    if (world.civilization.polities.length !== config.civilization.polityCount)
      throw new Error('Exact country count changed')
    const facts = {
      territory: fingerprint(world.civilization.territoryPolityIndex.values), population: fingerprint(world.civilization.population.values),
      capitals: world.civilization.polities.map(p => p.capitalSettlementId), traits: world.civilization.polities.map(p => p.traits),
    }
    const row = { seed, preset: preset.id, level, config, forms, monarchyCount: Object.entries(forms).reduce((sum, [form, count]) => sum + (monarchies.has(form) ? count : 0), 0),
      count: world.civilization.polities.length, facts, contentSignatures: input.contentSignatures, versions: world.metadata.provenance.stageVersions,
      schemaVersion: world.schemaVersion, validation: 'Complete snapshot/domain validation; exact country count; small-area requirements' }
    reports.push(row)
    process.stdout.write(`${JSON.stringify({ seed, preset: preset.id, level, count: row.count, monarchies: row.monarchyCount, kingdoms: forms.kingdom ?? 0, forms })}\n`)
  }
  for (const seed of ['1024', '42', 'm2-civilization-seed']) {
    const pipeline = createWorldPipeline()
    for (const preset of CIVILIZATION_PRESETS)
      await run(pipeline, seed, preset, 6)
  }
  // Independent seed and the actual initial workbench L7 configuration.
  await run(createWorldPipeline(), 'polity-weight-holdout', CIVILIZATION_PRESETS[3], 6)
  await run(createWorldPipeline(), '1024', CIVILIZATION_PRESETS[3], 7)
  if (tag === 'after') {
    const before = JSON.parse(readFileSync(new URL('../../../docs/benchmarks/CIV-05-polity-weights-before.json', import.meta.url), 'utf8')) as { reports: typeof reports }
    if (before.reports.length !== reports.length)
      throw new Error('Mismatched comparison scenarios')
    for (let i = 0; i < reports.length; i++) {
      const baseline = before.reports[i]!
      const current = reports[i]!
      if (baseline.seed !== current.seed || baseline.preset !== current.preset || baseline.level !== current.level || JSON.stringify(baseline.config) !== JSON.stringify(current.config))
        throw new Error('Comparison input changed')
      if (JSON.stringify(baseline.facts) !== JSON.stringify(current.facts))
        throw new Error('Polity weights changed territory, population, capitals or traits')
    }
  }
  writeFileSync(new URL(`../../../docs/benchmarks/CIV-05-polity-weights-${tag}.json`, import.meta.url), `${JSON.stringify({
    method: 'Production content; four presets x three seeds at L6, one independent seed and initial Web defaults at L7. Web natural defaults, reference L6. No forced political-form quotas or historical proportion calibration.',
    polityPacks: builtinContentPacks.filter(pack => pack.polities.length).map(pack => pack.manifest), candidates: bundle.polities, reports,
  }, null, 2)}\n`)
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
