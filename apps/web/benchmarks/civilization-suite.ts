import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'

const directory = new URL('../../../docs/benchmarks/', import.meta.url)
const script = new URL('./civilization.ts', import.meta.url).pathname
const mode = process.argv[2]

function readReport(level: number, seed: string, tag: string) {
  return JSON.parse(readFileSync(new URL(`CIV-01-${tag}-L${level}-${seed}.json`, directory), 'utf8'))
}

async function run(level: number, seed: string, tag: string, preset = 'industrial-mercantile') {
  const command = [process.execPath, script, String(level), seed, tag, preset]
  const child = Bun.spawn(command, { stdout: 'inherit', stderr: 'pipe' })
  const stderr = await new Response(child.stderr).text()
  if (await child.exited !== 0)
    throw new Error(`Benchmark failed: ${level}/${seed}/${tag}\n${stderr}`)
  const report = readReport(level, seed, tag)
  return { file: `CIV-01-${tag}-L${level}-${seed}.json`, ...report }
}

async function main(): Promise<void> {
  if (mode === 'calibration') {
    const targetPopulation = 1_650_000_000
    const seeds = ['civ-calibration-a', 'civ-calibration-b', 'civ-calibration-c']
    const before = seeds.map(seed => readReport(5, seed, 'before'))
    const beforeMean = before.reduce((sum, report) => sum + report.metrics.earthLandEquivalentPopulation, 0) / seeds.length
    const fittedScale = targetPopulation / beforeMean
    const after = []
    for (const seed of seeds)
      after.push(await run(5, seed, 'calibrated'))
    const holdout = await run(6, 'civ-validation', 'calibrated')
    for (let i = 0; i < before.length; i++) {
      if (before[i].versions.habitability !== 'habitability-v3' || after[i].versions.habitability !== 'habitability-v4'
        || JSON.stringify(before[i].config) !== JSON.stringify(after[i].config)
        || JSON.stringify(before[i].contentSignatures) !== JSON.stringify(after[i].contentSignatures)
        || before[i].metrics.landAreaKm2 !== after[i].metrics.landAreaKm2) {
        throw new Error('Calibration comparison mixed incompatible inputs or algorithm versions')
      }
    }
    const afterMean = after.reduce((sum, report) => sum + report.metrics.earthLandEquivalentPopulation, 0) / seeds.length
    // Broad scenario checks are not statistical confidence intervals.
    if (Math.abs(afterMean / targetPopulation - 1) > 0.15 || Math.abs(holdout.metrics.earthLandEquivalentPopulation / targetPopulation - 1) > 0.25)
      throw new Error('Circa-1900 reference density exceeded calibration/holdout acceptance envelope')
    const scenarios = [after[0]]
    for (const preset of ['agrarian', 'mercantile-city-states', 'regional-kingdoms'])
      scenarios.push(await run(5, seeds[0]!, `preset-${preset}`, preset))
    const [modern, agrarian, cityStates, kingdoms] = scenarios
    if (!(modern.metrics.population > kingdoms.metrics.population && kingdoms.metrics.population > cityStates.metrics.population && cityStates.metrics.population > agrarian.metrics.population)
      || cityStates.metrics.polities <= kingdoms.metrics.polities
      || scenarios.some(report => report.metrics.cultures !== modern.metrics.cultures)) {
      throw new Error('Preset scenario behavior failed')
    }
    writeFileSync(new URL('CIV-01-calibration.json', directory), `${JSON.stringify({ targetPopulation, referenceYear: 1900, referenceLandAreaKm2: 148_940_000, method: 'Fit a joint density scale on three L5 seeds; round food/industry coefficients; independent L6 holdout. Named-settlement share is not urbanization.', fittedScale, fittedFoodCoefficient: fittedScale * 145, fittedIndustryCoefficient: fittedScale * 45, roundedCoefficients: { food: 22, industry: 7 }, beforeMean, afterMean, meanErrorFraction: afterMean / targetPopulation - 1, holdoutErrorFraction: holdout.metrics.earthLandEquivalentPopulation / targetPopulation - 1, sources: [
      { title: 'UN: The World at Six Billion (1999), 1900 population 1.65 billion', url: 'https://www.un.org/development/desa/pd/sites/www.un.org.development.desa.pd/files/files/documents/2020/Jan/un_1999_6billion.pdf' },
      { title: 'CIA: The Physical World (2024), land surface 148.94 million km²', url: 'https://www.cia.gov/the-world-factbook/about/archives/2024/static/6c4d9b9a41b27707b6720720df7161d6/Physical_World.pdf' },
    ], before, after, holdout, scenarios }, null, 2)}\n`)
    process.stdout.write(`Calibration passed: mean ${(afterMean / 1e9).toFixed(3)} billion; holdout ${(holdout.metrics.earthLandEquivalentPopulation / 1e9).toFixed(3)} billion\n`)
  }
  else if (mode === 'performance') {
    const results = []
    for (const level of [6, 7, 8]) {
      const runs = []
      for (let repeat = 1; repeat <= 3; repeat++)
        runs.push(await run(level, 'civ-validation', `perf-${repeat}`))
      if (new Set(runs.map(run => run.fingerprint)).size !== 1)
        throw new Error(`Determinism check failed at L${level}`)
      const times = runs.map(run => run.performance.totalMs).sort((a, b) => a - b)
      results.push({ level, regions: runs[0].metrics.regions, coldRuns: 3, medianTotalMs: times[1], minTotalMs: times[0], maxTotalMs: times[2], maxPeakRssBytes: Math.max(...runs.map(run => run.performance.peakRssKiB * 1024)), runs })
    }
    writeFileSync(new URL('CIV-01-performance.json', directory), `${JSON.stringify({
      method: 'Three sequential fresh-process cold runs per level, reference L6, built-in production content, full assembly/domain validation. Total excludes startup, metric collection and hashing. Peak RSS uses process.resourceUsage().maxRSS (KiB), a process high-water mark. No rendering/Worker-transfer/browser memory measurement.',
      fingerprintScope: 'Mesh centers, population, territory ownership, settlements and transport paths/costs',
      results,
    }, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify(results.map(({ runs: _runs, ...summary }) => summary))}\n`)
  }
  else {
    throw new Error('Usage: bun benchmarks/civilization-suite.ts <calibration|performance>')
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
