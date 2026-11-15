/* eslint-disable antfu/no-top-level-await -- This diagnostic runs as a standalone jiti entry point. */
import type { ClimateArtifact, EcologyArtifact, GeologyArtifact, SphericalMesh, TerrainArtifact } from '../src/index'
import process from 'node:process'
import { NATURAL_BIOME_DEFINITIONS } from '@another-earth/world-data'
import { aggregateClimateSurface } from '../src/generation/nature/climate/climate'
import {
  createEcologyPipeline,
  DEFAULT_CLIMATE_PARAMETERS,
  DEFAULT_GEOLOGY_PARAMETERS,
  DEFAULT_LANDFORM_PARAMETERS,
  DEFAULT_TERRAIN_PARAMETERS,
  KOPPEN_CODES,
  sampleClimateCirculation,
  SphericalSpatialIndex,
} from '../src/index'

interface WeightedValue { value: number, area: number }
interface Location { region: number, latitude: number, longitude: number, elevationKm: number, temperatureC: number, precipitationMm: number }
interface MonthlyAccumulator { areaKm2: number, temperatureC: Float64Array, precipitationMm: Float64Array }

function summary(values: WeightedValue[]) {
  let area = 0
  let total = 0
  let minimum = Infinity
  let maximum = -Infinity
  for (const { value, area: weight } of values) {
    area += weight
    total += value * weight
    minimum = Math.min(minimum, value)
    maximum = Math.max(maximum, value)
  }
  values.sort((a, b) => a.value - b.value)
  const percentile = (fraction: number) => {
    const target = area * fraction
    let cumulative = 0
    for (const item of values) {
      cumulative += item.area
      if (cumulative >= target)
        return item.value
    }
    return values.at(-1)?.value ?? null
  }
  return {
    areaKm2: area,
    mean: area > 0 ? total / area : null,
    min: area > 0 ? minimum : null,
    p01: percentile(0.01),
    p05: percentile(0.05),
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: area > 0 ? maximum : null,
  }
}

function put(map: Map<string, WeightedValue[]>, key: string, value: number, area: number) {
  let entries = map.get(key)
  if (!entries) {
    entries = []
    map.set(key, entries)
  }
  entries.push({ value, area })
}

function summarizeGroups(groups: Map<string, WeightedValue[]>, totalArea: number) {
  return Object.fromEntries([...groups].map(([key, values]) => {
    const result = summary(values)
    return [key, { ...result, areaShare: totalArea > 0 ? result.areaKm2 / totalArea : 0 }]
  }))
}

function addMonthly(group: Map<string, MonthlyAccumulator>, key: string, month: number, temperatureC: number, precipitationMm: number, areaKm2: number) {
  let accumulator = group.get(key)
  if (!accumulator) {
    accumulator = { areaKm2: 0, temperatureC: new Float64Array(12), precipitationMm: new Float64Array(12) }
    group.set(key, accumulator)
  }
  if (month === 0)
    accumulator.areaKm2 += areaKm2
  accumulator.temperatureC[month] += temperatureC * areaKm2
  accumulator.precipitationMm[month] += precipitationMm * areaKm2
}

function monthlyGroups(group: Map<string, MonthlyAccumulator>) {
  return Object.fromEntries([...group].sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, Array.from({ length: 12 }, (_, month) => ({
    month: month + 1,
    temperatureC: entry.temperatureC[month] / entry.areaKm2,
    precipitationMm: entry.precipitationMm[month] / entry.areaKm2,
  }))]))
}

const seed = process.argv[2] ?? '1024'
const config = {
  planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
  mesh: { subdivisionLevel: Number(process.argv[3] ?? 7), irregularity: 0.75 },
  geology: { ...DEFAULT_GEOLOGY_PARAMETERS },
  landforms: { ...DEFAULT_LANDFORM_PARAMETERS },
  terrain: { ...DEFAULT_TERRAIN_PARAMETERS },
  climate: { ...DEFAULT_CLIMATE_PARAMETERS, axialTiltDegrees: 23.5, precipitationScale: 1.8 },
  ecology: true as const,
}
const result = await createEcologyPipeline().execute({ seed, config })
const mesh = result.getOutput<SphericalMesh>('mesh')
const terrain = result.getOutput<TerrainArtifact>('terrain')
const climate = result.getOutput<ClimateArtifact>('climate-c0')
const ecology = result.getOutput<EcologyArtifact>('ecology-e0')
const geology = result.getOutput<GeologyArtifact>('geology')
const reference = result.getOutput<SphericalMesh>('reference-mesh')
const referenceSurface = aggregateClimateSurface(mesh, reference, terrain, geology.geographicReference)
const temperature: Record<string, WeightedValue[]> = { global: [], land: [], ocean: [] }
const precipitation: Record<string, WeightedValue[]> = { global: [], land: [], ocean: [] }
const latitudeTemperature = new Map<string, WeightedValue[]>()
const latitudePrecipitation = new Map<string, WeightedValue[]>()
const elevationTemperature = new Map<string, WeightedValue[]>()
const elevationPrecipitation = new Map<string, WeightedValue[]>()
const oceanDepthTemperature = new Map<string, WeightedValue[]>()
const landTemperatureBands = new Map<string, WeightedValue[]>()
const landPrecipitationBands = new Map<string, WeightedValue[]>()
const koppenArea = new Map<string, number>()
const biomeArea = new Map<string, number>()
const monthly = Array.from({ length: 12 }, () => ({ land: { temperature: 0, precipitation: 0 }, ocean: { temperature: 0, precipitation: 0 } }))
const monthlyHemisphere = new Map<string, MonthlyAccumulator>()
const monthlyLatitude = new Map<string, MonthlyAccumulator>()
const landMonthlyIndicators = new Map<string, WeightedValue[]>()
const tropicalEligibility = { areaKm2: 0, rainAbove1700Km2: 0, driestAbove45Km2: 0, driestAbove60Km2: 0, bothBiomeRainCriteriaKm2: 0 }
const monthlyThresholdAreaKm2 = { driestBelow1mm: 0, driestBelow5mm: 0, driestBelow10mm: 0, driestBelow60mm: 0, warmestBelow0C: 0, warmestBelow10C: 0 }
const extremes = { hottestOcean: [] as Location[], driestLand: [] as Location[], wettestLand: [] as Location[] }
let landArea = 0
let oceanArea = 0

for (let region = 0; region < mesh.regionCount; region++) {
  const area = mesh.areaKm2[region]
  const land = Boolean(terrain.landMask[region])
  const domain = land ? 'land' : 'ocean'
  const annualTemperature = climate.annualMeanTemperatureC[region]
  const annualPrecipitation = climate.annualPrecipitationMm[region]
  temperature.global.push({ value: annualTemperature, area })
  temperature[domain].push({ value: annualTemperature, area })
  precipitation.global.push({ value: annualPrecipitation, area })
  precipitation[domain].push({ value: annualPrecipitation, area })
  if (land)
    landArea += area
  else
    oceanArea += area

  const latitude = Math.asin(mesh.centers[3 * region + 1]) * 180 / Math.PI
  const lowerLatitude = Math.max(-90, Math.min(75, Math.floor(latitude / 15) * 15))
  const latitudeKey = `${lowerLatitude}..${lowerLatitude + 15}/${domain}`
  put(latitudeTemperature, latitudeKey, annualTemperature, area)
  put(latitudePrecipitation, latitudeKey, annualPrecipitation, area)

  const location = { region, latitude, longitude: Math.atan2(mesh.centers[3 * region], mesh.centers[3 * region + 2]) * 180 / Math.PI, elevationKm: terrain.elevationKm[region], temperatureC: annualTemperature, precipitationMm: annualPrecipitation }
  if (!land) {
    const depthKey = terrain.elevationKm[region] < -4 ? '<-4 km' : terrain.elevationKm[region] < -2 ? '-4..-2 km' : '-2..0 km'
    put(oceanDepthTemperature, depthKey, annualTemperature, area)
    extremes.hottestOcean.push(location)
    extremes.hottestOcean.sort((a, b) => b.temperatureC - a.temperatureC)
    extremes.hottestOcean.length = Math.min(extremes.hottestOcean.length, 5)
  }

  if (land) {
    let warmest = -Infinity
    let coldest = Infinity
    let driest = Infinity
    let wettest = -Infinity
    let summerRain = 0
    let monthsAbove10 = 0
    let monthsBelow0 = 0
    let dryMonthsBelow10 = 0
    for (let month = 0; month < 12; month++) {
      const index = month * mesh.regionCount + region
      const monthlyTemperature = climate.temperatureC[index]
      const monthlyRain = climate.precipitationMm[index]
      warmest = Math.max(warmest, monthlyTemperature)
      coldest = Math.min(coldest, monthlyTemperature)
      driest = Math.min(driest, monthlyRain)
      wettest = Math.max(wettest, monthlyRain)
      monthsAbove10 += Number(monthlyTemperature > 10)
      monthsBelow0 += Number(monthlyTemperature < 0)
      dryMonthsBelow10 += Number(monthlyRain < 10)
      const summer = latitude < 0 ? month >= 9 || month <= 2 : month >= 3 && month <= 8
      if (summer)
        summerRain += monthlyRain
    }
    for (const [key, value] of Object.entries({ warmestMonthC: warmest, coldestMonthC: coldest, temperatureRangeC: warmest - coldest, driestMonthMm: driest, wettestMonthMm: wettest, wettestMonthShare: wettest / annualPrecipitation, summerPrecipitationShare: summerRain / annualPrecipitation, monthsAbove10C: monthsAbove10, monthsBelow0C: monthsBelow0, monthsBelow10mm: dryMonthsBelow10 }))
      put(landMonthlyIndicators, key, value, area)
    monthlyThresholdAreaKm2.driestBelow1mm += driest < 1 ? area : 0
    monthlyThresholdAreaKm2.driestBelow5mm += driest < 5 ? area : 0
    monthlyThresholdAreaKm2.driestBelow10mm += driest < 10 ? area : 0
    monthlyThresholdAreaKm2.driestBelow60mm += driest < 60 ? area : 0
    monthlyThresholdAreaKm2.warmestBelow0C += warmest < 0 ? area : 0
    monthlyThresholdAreaKm2.warmestBelow10C += warmest < 10 ? area : 0
    if (coldest >= 18) {
      tropicalEligibility.areaKm2 += area
      tropicalEligibility.rainAbove1700Km2 += annualPrecipitation >= 1700 ? area : 0
      tropicalEligibility.driestAbove45Km2 += driest >= 45 ? area : 0
      tropicalEligibility.driestAbove60Km2 += driest >= 60 ? area : 0
      tropicalEligibility.bothBiomeRainCriteriaKm2 += annualPrecipitation >= 1700 && driest >= 45 ? area : 0
    }
    extremes.driestLand.push(location)
    extremes.driestLand.sort((a, b) => a.precipitationMm - b.precipitationMm)
    extremes.driestLand.length = Math.min(extremes.driestLand.length, 5)
    extremes.wettestLand.push(location)
    extremes.wettestLand.sort((a, b) => b.precipitationMm - a.precipitationMm)
    extremes.wettestLand.length = Math.min(extremes.wettestLand.length, 5)
    const elevation = terrain.elevationKm[region]
    const elevationKey = elevation < 1 ? '0..1 km' : elevation < 2.5 ? '1..2.5 km' : '>=2.5 km'
    put(elevationTemperature, elevationKey, annualTemperature, area)
    put(elevationPrecipitation, elevationKey, annualPrecipitation, area)
    const temperatureKey = annualTemperature < -20 ? '<-20 C' : annualTemperature < 0 ? '-20..0 C' : annualTemperature < 10 ? '0..10 C' : annualTemperature < 20 ? '10..20 C' : annualTemperature < 30 ? '20..30 C' : '>=30 C'
    const precipitationKey = annualPrecipitation < 50 ? '<50 mm' : annualPrecipitation < 250 ? '50..250 mm' : annualPrecipitation < 500 ? '250..500 mm' : annualPrecipitation < 1000 ? '500..1000 mm' : annualPrecipitation < 2000 ? '1000..2000 mm' : annualPrecipitation < 3000 ? '2000..3000 mm' : '>=3000 mm'
    put(landTemperatureBands, temperatureKey, annualTemperature, area)
    put(landPrecipitationBands, precipitationKey, annualPrecipitation, area)
    const koppen = KOPPEN_CODES[climate.koppenClass[region]]
    const biome = NATURAL_BIOME_DEFINITIONS[ecology.potentialBiomeIndex[region]].code
    koppenArea.set(koppen, (koppenArea.get(koppen) ?? 0) + area)
    biomeArea.set(biome, (biomeArea.get(biome) ?? 0) + area)
  }

  for (let month = 0; month < 12; month++) {
    const index = month * mesh.regionCount + region
    const monthlyTemperature = climate.temperatureC[index]
    const monthlyRain = climate.precipitationMm[index]
    monthly[month][domain].temperature += area * monthlyTemperature
    monthly[month][domain].precipitation += area * monthlyRain
    addMonthly(monthlyHemisphere, `${latitude < 0 ? 'south' : 'north'}/${domain}`, month, monthlyTemperature, monthlyRain, area)
    addMonthly(monthlyLatitude, latitudeKey, month, monthlyTemperature, monthlyRain, area)
  }
}

const totalArea = landArea + oceanArea
const areaShares = (entries: Map<string, number>) => Object.fromEntries([...entries].sort((a, b) => b[1] - a[1]).map(([key, area]) => [key, area / landArea]))
const projectionCorrection = { land: 0, ocean: 0, oceanMaximumC: -Infinity }
const tropicalOceanRain = Array.from({ length: 12 }, () => ({ volume: 0, latitudeMoment: 0 }))
function spatialPreview() {
  const index = new SphericalSpatialIndex(mesh)
  const resolutionDegrees = 2
  const columns = 360 / resolutionDegrees
  const rows = 180 / resolutionDegrees
  const fields = ['windEast', 'windNorth', 'oceanEast', 'oceanNorth'] as const
  const cells = Array.from({ length: rows * columns }, (_, cell) => {
    const latitude = (Math.floor(cell / columns) + 0.5) * resolutionDegrees - 90
    const longitude = (cell % columns + 0.5) * resolutionDegrees - 180
    const phi = latitude * Math.PI / 180
    const lambda = longitude * Math.PI / 180
    const region = index.findNearestRegion({ x: Math.cos(phi) * Math.sin(lambda), y: Math.sin(phi), z: Math.cos(phi) * Math.cos(lambda) })
    const vectors = fields.map((field) => {
      const months = Array.from({ length: 12 }, (_, m) => sampleClimateCirculation(climate, region, m, field))
      return [months.reduce((sum, value) => sum + value / 12, 0), months[0], months[6]]
    })
    return {
      land: terrain.landMask[region] === 1,
      temperatureC: climate.annualMeanTemperatureC[region],
      precipitationMm: climate.annualPrecipitationMm[region],
      koppen: climate.koppenClass[region],
      biome: ecology.potentialBiomeIndex[region],
      vectors,
    }
  })
  return { resolutionDegrees, columns, rows, fields, samples: ['annual', 'January', 'July'], cells }
}
function sourceElevationAt(region: number) {
  const center = climate.geographicReference[region]
  const candidates = [center]
  for (let edge = reference.neighborOffsets[center]; edge < reference.neighborOffsets[center + 1]; edge++)
    candidates.push(reference.neighbors[edge])
  const same = candidates.filter(candidate => referenceSurface.landMask[candidate] === terrain.landMask[region])
  const chosen = (same.length ? same : candidates).map((candidate) => {
    const dot = mesh.centers[3 * region] * reference.centers[3 * candidate]
      + mesh.centers[3 * region + 1] * reference.centers[3 * candidate + 1]
      + mesh.centers[3 * region + 2] * reference.centers[3 * candidate + 2]
    return { candidate, distance: Math.acos(Math.max(-1, Math.min(1, dot))) }
  }).sort((a, b) => a.distance - b.distance || a.candidate - b.candidate).slice(0, 3)
  const weights = chosen.map(item => 1 / (item.distance + 0.005))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  return chosen.reduce((sum, item, index) => sum + referenceSurface.elevationKm[item.candidate] * weights[index] / totalWeight, 0)
}
for (let region = 0; region < mesh.regionCount; region++) {
  const sourceElevation = sourceElevationAt(region)
  const domain = terrain.landMask[region] ? 'land' : 'ocean'
  const correction = domain === 'land' ? -6.2 * Math.max(-2, Math.min(2, terrain.elevationKm[region] - sourceElevation)) : 0
  projectionCorrection[domain] += correction * mesh.areaKm2[region]
  if (domain === 'ocean')
    projectionCorrection.oceanMaximumC = Math.max(projectionCorrection.oceanMaximumC, correction)
  const hot = extremes.hottestOcean.find(item => item.region === region)
  if (hot)
    Object.assign(hot, { sourceElevationKm: sourceElevation, projectionCorrectionC: correction, temperatureWithoutCorrectionC: hot.temperatureC - correction })
  const latitude = Math.asin(mesh.centers[3 * region + 1]) * 180 / Math.PI
  if (domain === 'ocean' && Math.abs(latitude) < 20) {
    for (let month = 0; month < 12; month++) {
      const volume = climate.precipitationMm[month * mesh.regionCount + region] * mesh.areaKm2[region]
      tropicalOceanRain[month].volume += volume
      tropicalOceanRain[month].latitudeMoment += volume * latitude
    }
  }
}
process.stdout.write(`${JSON.stringify({
  command: 'node_modules/.bin/jiti packages/world-core/benchmarks/climate-default-diagnosis.ts',
  seed,
  config,
  versions: { terrain: terrain.algorithmVersion, climate: climate.algorithmVersion, ecology: ecology.algorithmVersion },
  regionCount: mesh.regionCount,
  area: { totalKm2: totalArea, landKm2: landArea, landShare: landArea / totalArea },
  temperatureC: Object.fromEntries(Object.entries(temperature).map(([key, values]) => [key, summary(values)])),
  precipitationMmPerYear: Object.fromEntries(Object.entries(precipitation).map(([key, values]) => [key, summary(values)])),
  latitudeTemperatureC: summarizeGroups(latitudeTemperature, totalArea),
  latitudePrecipitationMmPerYear: summarizeGroups(latitudePrecipitation, totalArea),
  landElevationTemperatureC: summarizeGroups(elevationTemperature, landArea),
  landElevationPrecipitationMmPerYear: summarizeGroups(elevationPrecipitation, landArea),
  oceanDepthTemperatureC: summarizeGroups(oceanDepthTemperature, oceanArea),
  landTemperatureBands: summarizeGroups(landTemperatureBands, landArea),
  landPrecipitationBands: summarizeGroups(landPrecipitationBands, landArea),
  landKoppenAreaShares: areaShares(koppenArea),
  landBiomeAreaShares: areaShares(biomeArea),
  landMonthlyIndicators: summarizeGroups(landMonthlyIndicators, landArea),
  monthlyThresholdLandShares: Object.fromEntries(Object.entries(monthlyThresholdAreaKm2).map(([key, area]) => [key, area / landArea])),
  tropicalEligibility: { ...tropicalEligibility, shareOfLand: tropicalEligibility.areaKm2 / landArea, rainAbove1700Share: tropicalEligibility.rainAbove1700Km2 / tropicalEligibility.areaKm2, driestAbove45Share: tropicalEligibility.driestAbove45Km2 / tropicalEligibility.areaKm2, driestAbove60Share: tropicalEligibility.driestAbove60Km2 / tropicalEligibility.areaKm2, bothBiomeRainCriteriaShare: tropicalEligibility.bothBiomeRainCriteriaKm2 / tropicalEligibility.areaKm2 },
  projectionElevationCorrectionC: { landMean: projectionCorrection.land / landArea, oceanMean: projectionCorrection.ocean / oceanArea, oceanMaximum: projectionCorrection.oceanMaximumC, globalMeanWithoutOceanCorrection: summary(temperature.global).mean! - projectionCorrection.ocean / totalArea },
  extremes,
  monthly: monthly.map((entry, month) => ({
    month: month + 1,
    land: { temperatureC: entry.land.temperature / landArea, precipitationMm: entry.land.precipitation / landArea },
    ocean: { temperatureC: entry.ocean.temperature / oceanArea, precipitationMm: entry.ocean.precipitation / oceanArea },
  })),
  monthlyByHemisphere: monthlyGroups(monthlyHemisphere),
  monthlyByLatitude: monthlyGroups(monthlyLatitude),
  tropicalOceanRainCentroidDegrees: tropicalOceanRain.map(({ volume, latitudeMoment }) => volume ? latitudeMoment / volume : null),
  spatialPreview: process.argv.includes('--spatial') ? spatialPreview() : undefined,
}, null, 2)}\n`)
