import type { EcologyGenerationConfig } from '../src/index'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { it } from 'vitest'
import { NATURAL_BIOME_DEFINITIONS } from '@another-earth/world-data'
import {
  createEcologyPipeline,
  DEFAULT_CLIMATE_PARAMETERS,
  DEFAULT_GEOLOGY_PARAMETERS,
  DEFAULT_LANDFORM_PARAMETERS,
  DEFAULT_TERRAIN_PARAMETERS,
  KOPPEN_CODES,
  StageCache,
  type ClimateArtifact,
  type EcologyArtifact,
  type SphericalMesh,
  type TerrainArtifact,
} from '../src/index'

const LEGACY_MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const
const LEGACY_BIOME_CODES = [
  'Ocean', 'TropicalRainforest', 'TropicalSeasonalForest', 'Savanna', 'HotDesert', 'ColdDesert', 'Steppe',
  'MediterraneanShrubland', 'TemperateGrassland', 'TemperateSeasonalForest', 'TemperateRainforest', 'BorealForest',
  'Tundra', 'IceSheet', 'AlpineTundra',
] as const

interface LegacyClassification {
  readonly code: typeof LEGACY_BIOME_CODES[number]
  readonly annualMeanTemperatureC: number
  readonly annualPrecipitationMm: number
  readonly potentialEvapotranspirationMm: number
  readonly aridityIndex: number
  readonly growingSeasonMonths: number
}

function classifyLegacyOnC0Bins(
  temperatureC: ArrayLike<number>,
  precipitationMm: ArrayLike<number>,
  southern: boolean,
  elevationKm: number,
  koppenCode: string,
  absoluteLatitudeDegrees: number,
): LegacyClassification {
  let temperatureTotal = 0
  let annualPrecipitationMm = 0
  let potentialEvapotranspirationMm = 0
  let summerPrecipitationMm = 0
  let coldSeasonSnowfallMm = 0
  let meltDegreeDays = 0
  let coldest = Infinity
  let warmest = -Infinity
  let driest = Infinity
  let growingSeasonMonths = 0

  for (let month = 0; month < 12; month++) {
    const temperature = temperatureC[month]
    const precipitation = precipitationMm[month]
    const days = LEGACY_MONTH_DAYS[month]
    temperatureTotal += temperature * days
    annualPrecipitationMm += precipitation
    potentialEvapotranspirationMm += days * 0.015 * Math.max(0, temperature + 5) ** 1.45
    coldest = Math.min(coldest, temperature)
    warmest = Math.max(warmest, temperature)
    driest = Math.min(driest, precipitation)
    if (temperature <= 0)
      coldSeasonSnowfallMm += precipitation
    else
      meltDegreeDays += temperature * days
    if (temperature > 5)
      growingSeasonMonths++
    const summer = southern ? month >= 9 || month <= 2 : month >= 3 && month <= 8
    if (summer)
      summerPrecipitationMm += precipitation
  }

  const annualMeanTemperatureC = temperatureTotal / 365
  const aridityIndex = annualPrecipitationMm / Math.max(potentialEvapotranspirationMm, 1)
  const summerPrecipitationShare = annualPrecipitationMm > 0 ? summerPrecipitationMm / annualPrecipitationMm : 0
  let code: LegacyClassification['code']

  if ((annualPrecipitationMm === 0 && potentialEvapotranspirationMm === 0) || warmest < 0) {
    code = 'IceSheet'
  }
  else if (elevationKm >= 2.8 && warmest < 15) {
    code = 'AlpineTundra'
  }
  else if (absoluteLatitudeDegrees >= 76 && warmest < 4 && coldest < -20
    && coldSeasonSnowfallMm >= Math.max(20, meltDegreeDays * 0.45)) {
    code = 'IceSheet'
  }
  else if (koppenCode === 'BWh') {
    code = 'HotDesert'
  }
  else if (koppenCode === 'BWk') {
    code = 'ColdDesert'
  }
  else if (koppenCode === 'BSh' || koppenCode === 'BSk') {
    code = 'Steppe'
  }
  else if (aridityIndex < 0.12) {
    code = annualMeanTemperatureC >= 18 ? 'HotDesert' : 'ColdDesert'
  }
  else if (aridityIndex < 0.32) {
    code = 'Steppe'
  }
  else if (warmest < 10 || growingSeasonMonths < 3) {
    code = 'Tundra'
  }
  else if (coldest >= 18) {
    if (annualPrecipitationMm >= 1700 && driest >= 45)
      code = 'TropicalRainforest'
    else if (annualPrecipitationMm >= 950 && (driest >= 25 || aridityIndex >= 0.65))
      code = 'TropicalSeasonalForest'
    else
      code = 'Savanna'
  }
  else if (coldest > 0 && summerPrecipitationShare < 0.28 && driest < 60) {
    code = 'MediterraneanShrubland'
  }
  else if (coldest <= 0) {
    code = 'BorealForest'
  }
  else if (annualPrecipitationMm >= 1500 && aridityIndex >= 0.65) {
    code = 'TemperateRainforest'
  }
  else if (annualPrecipitationMm < 700 || growingSeasonMonths < 5) {
    code = 'TemperateGrassland'
  }
  else {
    code = 'TemperateSeasonalForest'
  }

  return { code, annualMeanTemperatureC, annualPrecipitationMm, potentialEvapotranspirationMm, aridityIndex, growingSeasonMonths }
}

function summarize(values: number[]) {
  if (values.length === 0)
    return { count: 0, mean: null, median: null, minimum: null, maximum: null }
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
  return {
    count: values.length,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median,
    minimum: sorted[0],
    maximum: sorted.at(-1)!,
  }
}

function countByCode(counts: Map<string, number>, code: string): void {
  counts.set(code, (counts.get(code) ?? 0) + 1)
}

it('writes a fixed-seed legacy classifier comparison on identical C0 monthly inputs', async () => {
  const seed = '42'
  const level = 6
  const irregularity = 0.5
  const orbitalPeriodDays = DEFAULT_CLIMATE_PARAMETERS.orbitalPeriodDays
  const input = {
    seed,
    config: {
      ecology: true,
      planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
      mesh: { subdivisionLevel: level, irregularity },
      reference: { subdivisionLevel: 6 },
      geology: { ...DEFAULT_GEOLOGY_PARAMETERS },
      landforms: { ...DEFAULT_LANDFORM_PARAMETERS },
      terrain: { ...DEFAULT_TERRAIN_PARAMETERS },
      climate: { ...DEFAULT_CLIMATE_PARAMETERS },
    } satisfies EcologyGenerationConfig,
  }
  const pipeline = createEcologyPipeline(new StageCache(512 * 2 ** 20))
  const result = await pipeline.execute(input)
  const mesh = result.getOutput<SphericalMesh>('mesh')
  const terrain = result.getOutput<TerrainArtifact>('terrain')
  const climate = result.getOutput<ClimateArtifact>('climate-c0')
  const ecology = result.getOutput<EcologyArtifact>('ecology-e0')
  const legacyCounts = new Map<string, number>()
  const currentCounts = new Map<string, number>()
  const transitions = new Map<string, number>()
  const annualTemperatureDifferences: number[] = []
  const petRelativeDifferences: number[] = []
  const aridityDifferences: number[] = []
  const annualPrecipitationDifferences: number[] = []
  let landRegionCount = 0

  const temperature = new Float32Array(12)
  const precipitation = new Float32Array(12)
  for (let region = 0; region < mesh.regionCount; region++) {
    if (!terrain.landMask[region])
      continue
    landRegionCount++

    let equalBinMeanTemperatureC = 0
    let currentPotentialEvapotranspirationMm = 0
    let annualPrecipitationMm = 0
    for (let month = 0; month < 12; month++) {
      const offset = month * mesh.regionCount + region
      temperature[month] = climate.temperatureC[offset]
      precipitation[month] = climate.precipitationMm[offset]
      equalBinMeanTemperatureC += temperature[month] / 12
      annualPrecipitationMm += precipitation[month]
      currentPotentialEvapotranspirationMm += orbitalPeriodDays / 12 * 0.015 * Math.max(0, temperature[month] + 5) ** 1.45
    }
    const currentBiomeIndex = ecology.potentialBiomeIndex[region]
    const currentCode = NATURAL_BIOME_DEFINITIONS[currentBiomeIndex].code
    const currentAridity = ecology.aridityIndex[region]
    const koppenClass = climate.koppenClass[region]
    const koppenCode = KOPPEN_CODES[koppenClass]
    const latitudeRadians = Math.asin(Math.max(-1, Math.min(1, mesh.centers[region * 3 + 1])))
    const legacy = classifyLegacyOnC0Bins(
      temperature,
      precipitation,
      latitudeRadians < 0,
      terrain.elevationKm[region],
      koppenCode,
      Math.abs(latitudeRadians * 180 / Math.PI),
    )
    countByCode(legacyCounts, legacy.code)
    countByCode(currentCounts, currentCode)
    annualTemperatureDifferences.push(equalBinMeanTemperatureC - legacy.annualMeanTemperatureC)
    annualPrecipitationDifferences.push(annualPrecipitationMm - legacy.annualPrecipitationMm)
    aridityDifferences.push(currentAridity - legacy.aridityIndex)
    if (currentPotentialEvapotranspirationMm > 0) {
      petRelativeDifferences.push((currentPotentialEvapotranspirationMm - legacy.potentialEvapotranspirationMm) / legacy.potentialEvapotranspirationMm)
    }
    const transition = `${legacy.code} -> ${currentCode}`
    countByCode(transitions, transition)
  }

  const resultRows = [
    ...LEGACY_BIOME_CODES.map(code => ({ code, legacy: legacyCounts.get(code) ?? 0, current: currentCounts.get(code) ?? 0 })),
    ...[...currentCounts.keys()].filter(code => !LEGACY_BIOME_CODES.includes(code as typeof LEGACY_BIOME_CODES[number])).map(code => ({ code, legacy: legacyCounts.get(code) ?? 0, current: currentCounts.get(code) ?? 0 })),
  ]
  const classificationChanged = [...transitions.entries()].reduce((sum, [transition, count]) => {
    const [legacyCode, currentCode] = transition.split(' -> ')
    return sum + (legacyCode !== currentCode ? count : 0)
  }, 0)
  const report = {
    benchmark: 'M1.4 legacy classifier replay on current C0 climate bins',
    comparisonScope: `Compares old calendar-day-weighted classifier math with ${ecology.algorithmVersion} on identical current C0 monthly fields for every land region. E0 has no hydrology or static-lake dependency. Does not run the legacy climate generator, so it does not measure old-vs-current climate-field differences. Both classifiers use the mesh Y axis for latitude.`,
    generatedAt: new Date().toISOString(),
    input: {
      seed,
      meshLevel: level,
      irregularity,
      referenceLevel: 6,
      physicalRadiusKm: 6371,
      climate: DEFAULT_CLIMATE_PARAMETERS,
      oldMonthDays: LEGACY_MONTH_DAYS,
      currentBinDays: orbitalPeriodDays / 12,
      excludedOceanRegions: mesh.regionCount - landRegionCount,
      terrestrialRegionsCompared: landRegionCount,
      algorithmVersions: {
        terrain: terrain.algorithmVersion,
        climate: climate.algorithmVersion,
        ecology: ecology.algorithmVersion,
      },
      plannedStages: result.plan.map(stage => stage.stageId),
      hydrologyStagesPlanned: result.plan.some(stage => ['cryosphere-i0', 'hydrology-h0', 'static-lakes-l1'].includes(stage.stageId)),
    },
    summary: {
      changedClassRegions: classificationChanged,
      changedClassShare: classificationChanged / Math.max(landRegionCount, 1),
      oldClassCounts: Object.fromEntries([...legacyCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
      currentClassCounts: Object.fromEntries([...currentCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
      classTransitions: Object.fromEntries([...transitions.entries()].sort(([a], [b]) => a.localeCompare(b))),
      annualMeanTemperatureDifferenceC: summarize(annualTemperatureDifferences),
      annualPrecipitationDifferenceMm: summarize(annualPrecipitationDifferences),
      potentialEvapotranspirationRelativeDifference: summarize(petRelativeDifferences),
      aridityIndexDifference: summarize(aridityDifferences),
      classCountRows: resultRows,
    },
  }
  const defaultOutputPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/benchmarks/M1.4-E0-legacy-comparison.json')
  const outputPath = resolve(process.env.ECOLOGY_LEGACY_BENCH_OUTPUT ?? defaultOutputPath)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`M1.4 legacy classifier comparison written to ${outputPath}\n`)
})
