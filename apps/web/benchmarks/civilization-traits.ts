import type { PolityPowerDiagnostic } from '@another-earth/world-core'
import { writeFileSync } from 'node:fs'
import process from 'node:process'
import { assembleWorld, createWorldPipeline, DEFAULT_CIVILIZATION_PARAMETERS, DEFAULT_CLIMATE_PARAMETERS, DEFAULT_GEOLOGY_PARAMETERS, DEFAULT_HYDROLOGY_PARAMETERS, DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS, generatePolitiesReligions } from '@another-earth/world-core'
import { builtinContentPacks, builtinContentPort, builtinPipelineContent } from '../src/lib/generation/builtin-content'

type Inputs = Parameters<typeof generatePolitiesReligions>

function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (p: number) => sorted[Math.floor((sorted.length - 1) * p)] ?? null
  return { min: sorted[0] ?? null, p10: at(0.1), median: at(0.5), p90: at(0.9), max: sorted.at(-1) ?? null }
}

async function main() {
  const level = Number(process.argv[2] ?? 6)
  const tag = process.argv[3] ?? 'current'
  const seeds = process.argv.slice(4)
  if (![4, 5, 6].includes(level) || !/^[\w-]+$/.test(tag))
    throw new Error('Usage: bun benchmarks/civilization-traits.ts <4..6> <report-tag> [seeds...]')
  const reports = []
  for (const seed of seeds.length ? seeds : ['1024', '42', 'm2-civilization-seed']) {
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
      civilization: DEFAULT_CIVILIZATION_PARAMETERS,
    }
    const input = { seed, config, ...builtinPipelineContent }
    const result = await pipeline.execute(input)
    const world = assembleWorld(input, result, pipeline.registry, {
      snapshotId: `snapshot:trait-diagnostic:${seed}`,
      worldId: 'world:trait-diagnostic',
      name: 'Polity trait diagnostic',
      createdAt: '2026-11-22T00:00:00Z',
    }, builtinContentPacks, builtinContentPort)
    const diagnostics: PolityPowerDiagnostic[] = []
    const observed = generatePolitiesReligions(
      builtinPipelineContent.content['civilization-content'],
      builtinPipelineContent.contentSignatures['civilization-content'],
      result.getOutput<Inputs[2]>('mesh'),
      result.getOutput<Inputs[3]>('terrain'),
      result.getOutput<Inputs[4]>('static-lakes-l1'),
      result.getOutput<Inputs[5]>('resource-potential'),
      result.getOutput<Inputs[6]>('habitability'),
      result.getOutput<Inputs[7]>('population-settlements'),
      result.getOutput<Inputs[8]>('transport-network'),
      result.getOutput<Inputs[9]>('peoples-cultures'),
      config.civilization,
      seed,
      undefined,
      {
        hydrology: result.getOutput('hydrology-h0'),
        ecology: result.getOutput('ecology-e0'),
        onPowerEvaluated: diagnostic => diagnostics.push(diagnostic),
      },
    )
    const facts = world.civilization
    if (JSON.stringify(observed.polities) !== JSON.stringify(facts.polities)
      || JSON.stringify(observed.settlements) !== JSON.stringify(facts.settlements)
      || observed.territoryPolityIndex.some((owner, r) => owner !== facts.territoryPolityIndex.values[r]))
      throw new Error('Diagnostic callback changed generated facts')
    const traitCounts: Record<string, number> = {}
    for (const polity of facts.polities) {
      for (const trait of polity.traits)
        traitCounts[trait] = (traitCounts[trait] ?? 0) + 1
    }
    const keys = Object.keys(diagnostics[0]?.signals ?? {}) as (keyof PolityPowerDiagnostic['signals'])[]
    const signalSummary = Object.fromEntries(keys.map(key => [key, summarize(diagnostics.map(d => d.signals[key]))]))
    const report = { seed, level, config, contentSignatures: input.contentSignatures, versions: world.metadata.provenance.stageVersions,
      validation: 'Full snapshot validation; diagnostic replay matches polities, settlements and territory',
      polities: facts.polities.length, traitCounts, signalSummary, diagnostics }
    reports.push(report)
    process.stdout.write(`${JSON.stringify({ seed, polities: report.polities, traitCounts, signalSummary })}\n`)
  }
  writeFileSync(new URL(`../../../docs/benchmarks/CIV-02-traits-${tag}-L${level}.json`, import.meta.url), `${JSON.stringify({ method: 'Built-in production content, default civilization parameters, reference L6. Diagnostic replay compared to fully validated pipeline snapshot. No prescribed trait proportions.', reports }, null, 2)}\n`)
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
