import { writeFileSync } from 'node:fs'
import process from 'node:process'
import { assembleWorld, createWorldPipeline, DEFAULT_CIVILIZATION_PARAMETERS, DEFAULT_CLIMATE_PARAMETERS, DEFAULT_GEOLOGY_PARAMETERS, DEFAULT_HYDROLOGY_PARAMETERS, DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS } from '@another-earth/world-core'
import { builtinContentPacks, builtinContentPort, builtinPipelineContent } from '../src/lib/generation/builtin-content'

async function main() {
  const tag = process.argv[2] ?? 'after'
  if (!/^[\w-]+$/.test(tag))
    throw new Error('Expected a report tag')
  const compactForms = new Set(['free-territory', 'chiefdom', 'commune', 'city-state'])
  const cityStateAreaLimitKm2 = 3 * (4 * Math.PI * 6371 ** 2) / (10 * 4 ** 6 + 2)
  const archetypes = new Map(builtinPipelineContent.content['civilization-content'].polities.map(arch => [arch.id, arch]))
  const reports = []
  for (const seed of ['1024', '42', 'm2-civilization-seed']) {
    const pipeline = createWorldPipeline()
    for (const polityCount of [60, 1, 200]) {
      const config = {
        ecology: true as const, planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
        mesh: { subdivisionLevel: 6, irregularity: 0.45 }, reference: { subdivisionLevel: 6 },
        geology: DEFAULT_GEOLOGY_PARAMETERS, landforms: DEFAULT_LANDFORM_PARAMETERS, terrain: DEFAULT_TERRAIN_PARAMETERS,
        climate: DEFAULT_CLIMATE_PARAMETERS, hydrology: DEFAULT_HYDROLOGY_PARAMETERS,
        civilization: { ...DEFAULT_CIVILIZATION_PARAMETERS, polityCount },
      }
      const input = { seed, config, ...builtinPipelineContent }
      const result = await pipeline.execute(input)
      const world = assembleWorld(input, result, pipeline.registry, {
        snapshotId: `snapshot:polity-size:${seed}:${polityCount}`, worldId: 'world:polity-size', name: 'Polity size constraints', createdAt: '2026-11-23T00:00:00Z',
      }, builtinContentPacks, builtinContentPort)
      const areas = new Float64Array(polityCount)
      const settlementCounts = new Int32Array(polityCount)
      const owners = world.civilization.territoryPolityIndex.values
      for (let r = 0; r < world.mesh.regionCount; r++) {
        if (owners[r]! >= 0 && world.nature.geography.landMask.values[r] === 1 && world.nature.hydrology.lakeIndex.values[r]! < 0)
          areas[owners[r]!]! += world.mesh.areaKm2[r]!
      }
      for (const s of world.civilization.settlements) {
        if (owners[s.regionId]! >= 0)
          settlementCounts[owners[s.regionId]!]!++
      }
      const polities = world.civilization.polities.map((polity, p) => ({ id: polity.id, name: polity.name, politicalForm: archetypes.get(polity.archetypeId)!.politicalForm,
        traits: polity.traits, sizeClass: polity.sizeClass, areaKm2: areas[p], settlements: settlementCounts[p] }))
      const oversized = polities.filter(p => compactForms.has(p.politicalForm) && p.areaKm2! > cityStateAreaLimitKm2)
      for (const polity of polities) {
        if (tag === 'trait') {
          if (polity.traits.includes('small-area') !== (polity.areaKm2! <= cityStateAreaLimitKm2))
            throw new Error('Small-area trait disagrees with physical land area')
          if (compactForms.has(polity.politicalForm) && !polity.traits.includes('small-area'))
            throw new Error('Compact polity is missing its required small-area trait')
        }
      }
      if (polities.length !== polityCount)
        throw new Error('Country count changed')
      if (tag !== 'before' && oversized.length)
        throw new Error(`Oversized compact polities: ${JSON.stringify(oversized)}`)
      const row = { seed, config, versions: world.metadata.provenance.stageVersions, contentSignatures: input.contentSignatures,
        count: polities.length, oversized, polities, validation: 'Complete snapshot assembly/domain validation; exact count; physical land area excludes lakes and ocean' }
      reports.push(row)
      process.stdout.write(`${JSON.stringify({ seed, count: polities.length, compact: polities.filter(p => compactForms.has(p.politicalForm)).length, oversized: oversized.length })}\n`)
    }
  }
  writeFileSync(new URL(`../../../docs/benchmarks/CIV-04-polity-size-${tag}-L6.json`, import.meta.url), `${JSON.stringify({ cityStateAreaLimitKm2, method: 'Built-in production content, core default natural parameters, L6/reference L6, irregularity 0.45, three seeds and counts 1/60/200; not a performance benchmark.', reports }, null, 2)}\n`)
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
