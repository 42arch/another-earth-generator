import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import process from 'node:process'
import { assembleWorld, createWorldPipeline, DEFAULT_CIVILIZATION_PARAMETERS, DEFAULT_CLIMATE_PARAMETERS, DEFAULT_GEOLOGY_PARAMETERS, DEFAULT_HYDROLOGY_PARAMETERS, DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS } from '@another-earth/world-core'
import { builtinContentPacks, builtinContentPort, builtinPipelineContent } from '../src/lib/generation/builtin-content'

function statistics(areas: number[]) {
  const sorted = [...areas].sort((a, b) => a - b)
  const total = sorted.reduce((sum, value) => sum + value, 0)
  const mean = total / sorted.length
  const gini = sorted.reduce((sum, value, i) => sum + (2 * (i + 1) - sorted.length - 1) * value, 0) / (sorted.length * total)
  return { minKm2: sorted[0], maxKm2: sorted.at(-1), totalKm2: total, gini,
    coefficientOfVariation: Math.sqrt(sorted.reduce((sum, area) => sum + (area - mean) ** 2, 0) / sorted.length) / mean }
}

async function main() {
  const level = Number(process.argv[2] ?? 6)
  const tag = process.argv[3] ?? 'exact'
  if (![4, 5, 6].includes(level) || !/^[\w-]+$/.test(tag))
    throw new Error('Usage: bun benchmarks/civilization-layout.ts <4..6> <report-tag> [seeds...]')
  const reports = []
  for (const seed of process.argv.length > 4 ? process.argv.slice(4) : ['1024', '42', 'm2-civilization-seed']) {
    const pipeline = createWorldPipeline()
    let baselinePopulation: number | undefined
    const scenarios = []
    for (const [count, variation] of [[60, 0], [60, 0.5], [60, 1], [1, 0.5], [200, 0.5]] as const) {
      const civilization = { ...DEFAULT_CIVILIZATION_PARAMETERS, polityCount: count, politySizeVariation: variation }
      const config = {
        ecology: true as const,
        planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
        mesh: { subdivisionLevel: level, irregularity: 0.45 }, reference: { subdivisionLevel: 6 },
        geology: DEFAULT_GEOLOGY_PARAMETERS, landforms: DEFAULT_LANDFORM_PARAMETERS, terrain: DEFAULT_TERRAIN_PARAMETERS,
        climate: DEFAULT_CLIMATE_PARAMETERS, hydrology: DEFAULT_HYDROLOGY_PARAMETERS, civilization,
      }
      const input = { seed, config, ...builtinPipelineContent }
      const started = performance.now()
      const result = await pipeline.execute(input)
      const world = assembleWorld(input, result, pipeline.registry, { snapshotId: `snapshot:layout:${seed}:${count}:${variation}`, worldId: 'world:layout', name: 'Polity layout validation', createdAt: '2026-11-22T00:00:00Z' }, builtinContentPacks, builtinContentPort)
      if (world.civilization.polities.length !== count)
        throw new Error(`Requested ${count} countries, got ${world.civilization.polities.length}`)
      const population = world.civilization.population.values.reduce((sum, value) => sum + value, 0)
      if (baselinePopulation !== undefined && population !== baselinePopulation)
        throw new Error('Layout parameters changed population')
      baselinePopulation = population
      const executed = result.plan.filter(stage => stage.action === 'execute').map(stage => stage.stageId)
      if (scenarios.length && JSON.stringify(executed) !== JSON.stringify(['polities-religions']))
        throw new Error('Layout parameters invalidated upstream stages')
      const areas = new Array<number>(count).fill(0)
      let unownedAreaKm2 = 0
      for (let r = 0; r < world.mesh.regionCount; r++) {
        if (world.nature.geography.landMask.values[r] !== 1 || world.nature.hydrology.lakeIndex.values[r]! >= 0)
          continue
        const owner = world.civilization.territoryPolityIndex.values[r]!
        if (owner >= 0)
          areas[owner]! += world.mesh.areaKm2[r]!
        else
          unownedAreaKm2 += world.mesh.areaKm2[r]!
      }
      const ownerArray = world.civilization.territoryPolityIndex.values
      const ownershipFingerprint = createHash('sha256').update(new Uint8Array(ownerArray.buffer, ownerArray.byteOffset, ownerArray.byteLength)).digest('hex')
      const resultRow = { ownershipFingerprint, count, variation, actualCount: world.civilization.polities.length, area: statistics(areas), areasKm2: areas,
        unownedAreaKm2, population, elapsedMs: performance.now() - started, executedStages: executed,
        capitals: world.civilization.polities.map(p => p.capitalSettlementId), traits: world.civilization.polities.map(p => p.traits),
        schemaVersion: world.schemaVersion, versions: world.metadata.provenance.stageVersions }
      scenarios.push(resultRow)
      process.stdout.write(`${JSON.stringify({ seed, count, variation, area: resultRow.area, elapsedMs: resultRow.elapsedMs })}\n`)
    }
    if (scenarios[2]!.area.gini <= scenarios[0]!.area.gini || scenarios[2]!.area.coefficientOfVariation <= scenarios[0]!.area.coefficientOfVariation)
      throw new Error(`Increasing size variation did not widen actual country areas for ${seed}`)
    for (const scenario of scenarios.slice(1, 3)) {
      if (JSON.stringify(scenario.capitals) !== JSON.stringify(scenarios[0]!.capitals) || JSON.stringify(scenario.traits) !== JSON.stringify(scenarios[0]!.traits))
        throw new Error('Size variation changed country origins or traits')
    }
    // Repeating the first scenario checks deterministic ownership, including islands.
    const repeatedInput = {
      seed,
      config: { ecology: true as const, planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 }, mesh: { subdivisionLevel: level, irregularity: 0.45 }, reference: { subdivisionLevel: 6 },
        geology: DEFAULT_GEOLOGY_PARAMETERS, landforms: DEFAULT_LANDFORM_PARAMETERS, terrain: DEFAULT_TERRAIN_PARAMETERS, climate: DEFAULT_CLIMATE_PARAMETERS, hydrology: DEFAULT_HYDROLOGY_PARAMETERS,
        civilization: { ...DEFAULT_CIVILIZATION_PARAMETERS, polityCount: 60, politySizeVariation: 0 } },
      ...builtinPipelineContent,
    }
    const repeated = await pipeline.execute(repeatedInput, { force: true })
    const artifact = repeated.getOutput<{ territoryPolityIndex: Int32Array }>('polities-religions')
    const repeatedAreas = new Array<number>(60).fill(0)
    const mesh = repeated.getOutput<{ regionCount: number, areaKm2: Float64Array }>('mesh')
    const terrain = repeated.getOutput<{ landMask: Uint8Array }>('terrain')
    const lakes = repeated.getOutput<{ lakeIndex: Int32Array }>('static-lakes-l1')
    for (let r = 0; r < mesh.regionCount; r++) {
      const owner = artifact.territoryPolityIndex[r]!
      if (owner >= 0 && terrain.landMask[r] === 1 && lakes.lakeIndex[r]! < 0)
        repeatedAreas[owner]! += mesh.areaKm2[r]!
    }
    const repeatedFingerprint = createHash('sha256').update(new Uint8Array(artifact.territoryPolityIndex.buffer, artifact.territoryPolityIndex.byteOffset, artifact.territoryPolityIndex.byteLength)).digest('hex')
    if (repeatedFingerprint !== scenarios[0]!.ownershipFingerprint || JSON.stringify(repeatedAreas) !== JSON.stringify(scenarios[0]!.areasKm2))
      throw new Error('Forced layout regeneration changed physical area results')
    reports.push({ seed, level, referenceLevel: 6, planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 }, mesh: { subdivisionLevel: level, irregularity: 0.45 }, reference: { subdivisionLevel: 6 }, naturalParameters: { geology: DEFAULT_GEOLOGY_PARAMETERS, landforms: DEFAULT_LANDFORM_PARAMETERS, terrain: DEFAULT_TERRAIN_PARAMETERS, climate: DEFAULT_CLIMATE_PARAMETERS, hydrology: DEFAULT_HYDROLOGY_PARAMETERS },
      defaultCivilization: DEFAULT_CIVILIZATION_PARAMETERS, contentSignatures: builtinPipelineContent.contentSignatures,
      validation: 'All scenarios passed complete assembly/domain validation, exact counts, population conservation, local invalidation, origin independence, increasing dispersion and forced-repeat ownership/area equality', scenarios })
  }
  writeFileSync(new URL(`../../../docs/benchmarks/CIV-03-layout-${tag}-L${level}.json`, import.meta.url), `${JSON.stringify({ method: 'Production content; physical country land area excludes lakes and oceans. Geographic constraints may prevent target shares. This is a behavior comparison, not a performance benchmark or historical calibration.', reports }, null, 2)}\n`)
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
