import { writeFileSync } from 'node:fs'
import process from 'node:process'
import { testContentPack, testContentPort, testPipelineContent } from '#content/test-content'
import {
  assembleWorld,
  createWorldPipeline,
  DEFAULT_CLIMATE_PARAMETERS,
  DEFAULT_GEOLOGY_PARAMETERS,
  DEFAULT_HYDROLOGY_PARAMETERS,
  DEFAULT_LANDFORM_PARAMETERS,
  DEFAULT_TERRAIN_PARAMETERS,
  resolveCivilizationParameters,
} from '../src/index'

async function main(): Promise<void> {
  const pipeline = createWorldPipeline()
  const config = {
    ecology: true as const,
    planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
    mesh: { subdivisionLevel: 4, irregularity: 0.45 },
    reference: { subdivisionLevel: 4 },
    geology: DEFAULT_GEOLOGY_PARAMETERS,
    landforms: DEFAULT_LANDFORM_PARAMETERS,
    terrain: DEFAULT_TERRAIN_PARAMETERS,
    climate: DEFAULT_CLIMATE_PARAMETERS,
    hydrology: DEFAULT_HYDROLOGY_PARAMETERS,
  }
  const cases = [
    ['baseline', {}],
    ['agriculture-low', { capabilities: { agriculturalProductivity: 0.5 } }],
    ['agriculture-high', { capabilities: { agriculturalProductivity: 1.5 } }],
    ['industry-zero', { capabilities: { industrialCapability: 0 } }],
    ['industry-high', { capabilities: { industrialCapability: 2 } }],
    ['land-slow', { capabilities: { landTransportCapability: 0.5 } }],
    ['land-fast', { capabilities: { landTransportCapability: 2 } }],
    ['no-seafaring', { capabilities: { seafaringCapability: 0 } }],
    ['urban-low', { urbanConcentration: 0 }],
    ['urban-high', { urbanConcentration: 1 }],
    ['polities-low', { polityCount: 10 }],
    ['polities-high', { polityCount: 30 }],
    ['cultures-low', { culturalDiversity: 0.5 }],
    ['cultures-high', { culturalDiversity: 2 }],
    ['administration-low', { capabilities: { administrativeCapacity: 0 } }],
    ['administration-high', { capabilities: { administrativeCapacity: 1 } }],
  ] as const
  const sum = (values: Float64Array) => values.reduce((total, value) => total + value, 0)
  const results: unknown[] = []
  let baselinePopulation = 0
  let baselineOwners: Int32Array | undefined
  let versions: unknown
  for (const [name, overrides] of cases) {
    const civilization = resolveCivilizationParameters(overrides)
    const input = { seed: 'm2-civilization-seed', config: { ...config, civilization }, ...testPipelineContent() }
    const result = await pipeline.execute(input)
    const world = assembleWorld(input, result, pipeline.registry, {
      snapshotId: `snapshot:civ-check:${name}`,
      worldId: 'world:civ-check',
      name: 'CIV-01 validation',
      createdAt: '2026-11-22T00:00:00Z',
    }, [testContentPack], testContentPort)
    const population = sum(world.civilization.population.values)
    if (name === 'baseline') {
      baselinePopulation = population
      baselineOwners = world.civilization.territoryPolityIndex.values.slice()
      versions = world.metadata.provenance.stageVersions
    }
    if (name.startsWith('urban-') && Math.abs(population - baselinePopulation) > Math.max(1e-6, baselinePopulation * 1e-12))
      throw new Error('Urban concentration changed total population')
    const natureStages = result.plan.filter(stage => !['habitability', 'population-settlements', 'transport-network', 'peoples-cultures', 'polities-religions'].includes(stage.stageId))
    if (name !== 'baseline' && natureStages.some(stage => stage.action !== 'cache-hit'))
      throw new Error('Civilization parameter invalidated natural/resource stages')
    const seaRoutes = world.civilization.transport.routes.filter(route => route.mode === 'sea').length
    if (name === 'no-seafaring' && seaRoutes !== 0)
      throw new Error('Zero seafaring generated a sea route')
    const urban = world.civilization.settlements.reduce((total, site) => total + site.population, 0)
    results.push({ name, civilization, population, urbanPopulation: urban, urbanShare: urban / population, settlements: world.civilization.settlements.length, polities: world.civilization.polities.length, cultures: world.civilization.cultures.length, roadRiverRoutes: world.civilization.transport.routes.length - seaRoutes, seaRoutes, ownerIndexChanges: world.civilization.territoryPolityIndex.values.reduce((total, owner, r) => total + Number(owner !== baselineOwners![r]), 0), executedStages: result.plan.filter(stage => stage.action === 'execute').map(stage => stage.stageId) })
    process.stdout.write(`${name} ${JSON.stringify({ population, urbanShare: Number((urban / population).toFixed(4)), polities: world.civilization.polities.length, cultures: world.civilization.cultures.length, seaRoutes })}\n`)
  }
  writeFileSync(new URL('../../../docs/benchmarks/CIV-01-parameters.json', import.meta.url), `${JSON.stringify({
    date: '2026-11-22',
    schemaVersion: 9,
    seed: 'm2-civilization-seed',
    config,
    content: 'testContentPack',
    note: 'L4 deterministic parameter comparison using core test content; not historical calibration or a performance benchmark. Each snapshot passed full assembly validation.',
    versions,
    results,
  }, null, 2)}\n`)
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
