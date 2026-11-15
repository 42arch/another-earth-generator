/* eslint-disable antfu/no-top-level-await -- This diagnostic runs as a standalone jiti entry point. */
import type { ClimateArtifact, GeologyArtifact, SphericalMesh, TerrainArtifact } from '../src/index'
import process from 'node:process'
import { aggregateClimateSurface } from '../src/generation/nature/climate/climate'
import { climateMesh } from '../src/generation/nature/climate/climate-mesh'
import { interpolateMonthlyForcing } from '../src/generation/nature/climate/monthly-forcing'
import { makeMonthlyWind } from '../src/generation/nature/climate/monthly-precipitation-generator'
import { makeMonthlySpatialFields } from '../src/generation/nature/climate/monthly-spatial-fields'
import {
  createClimatePipeline,
  DEFAULT_CLIMATE_PARAMETERS,
  DEFAULT_GEOLOGY_PARAMETERS,
  DEFAULT_LANDFORM_PARAMETERS,
  DEFAULT_TERRAIN_PARAMETERS,
  sampleClimateCirculation,
} from '../src/index'

interface VectorSummary {
  areaKm2: number
  east: number
  north: number
  speed: number
  warmth: number
  eastPositiveAreaKm2: number
  weakAreaKm2: number
  annualVectorSpeed: number
  reversingAreaKm2: number
}

function emptySummary(): VectorSummary {
  return { areaKm2: 0, east: 0, north: 0, speed: 0, warmth: 0, eastPositiveAreaKm2: 0, weakAreaKm2: 0, annualVectorSpeed: 0, reversingAreaKm2: 0 }
}

function add(map: Map<string, VectorSummary>, key: string, area: number, east: number, north: number, warmth: number, annualVectorSpeed = 0, reversing = false, speedOverride?: number) {
  let entry = map.get(key)
  if (!entry) {
    entry = emptySummary()
    map.set(key, entry)
  }
  const speed = speedOverride ?? Math.hypot(east, north)
  entry.areaKm2 += area
  entry.east += east * area
  entry.north += north * area
  entry.speed += speed * area
  entry.warmth += warmth * area
  entry.eastPositiveAreaKm2 += east > 0 ? area : 0
  entry.weakAreaKm2 += speed < 0.05 ? area : 0
  entry.annualVectorSpeed += annualVectorSpeed * area
  entry.reversingAreaKm2 += reversing ? area : 0
}

function finish(map: Map<string, VectorSummary>) {
  return Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => {
    const area = value.areaKm2
    const east = value.east / area
    const north = value.north / area
    const meanMonthlySpeed = value.speed / area
    return [key, {
      areaKm2: area,
      meanEast: east,
      meanNorth: north,
      spatialMeanVectorSpeed: Math.hypot(east, north),
      meanMonthlySpeed,
      meanWarmth: value.warmth / area,
      eastwardAreaShare: value.eastPositiveAreaKm2 / area,
      weakAreaShare: value.weakAreaKm2 / area,
      meanAnnualVectorSpeed: value.annualVectorSpeed / area,
      annualPersistence: meanMonthlySpeed > 0 ? value.annualVectorSpeed / value.speed : 0,
      eastSignReversalAreaShare: value.reversingAreaKm2 / area,
    }]
  }))
}

const seed = process.argv[2] ?? '1024'
const config = {
  planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
  mesh: { subdivisionLevel: Number(process.argv[3] ?? 7), irregularity: 0.75 },
  geology: { ...DEFAULT_GEOLOGY_PARAMETERS },
  landforms: { ...DEFAULT_LANDFORM_PARAMETERS },
  terrain: { ...DEFAULT_TERRAIN_PARAMETERS },
  climate: { ...DEFAULT_CLIMATE_PARAMETERS, axialTiltDegrees: 23.5, precipitationScale: 1.8 },
}
const result = await createClimatePipeline().execute({ seed, config })
const mesh = result.getOutput<SphericalMesh>('mesh')
const reference = result.getOutput<SphericalMesh>('reference-mesh')
const geology = result.getOutput<GeologyArtifact>('geology')
const terrain = result.getOutput<TerrainArtifact>('terrain')
const climate = result.getOutput<ClimateArtifact>('climate-c0')
const surface = aggregateClimateSurface(mesh, reference, terrain, geology.geographicReference)
const fields = climate.circulation
const count = climate.referenceRegionCount
const monthlyWind = new Map<string, VectorSummary>()
const monthlyTransportWind = new Map<string, VectorSummary>()
const monthlyCurrent = new Map<string, VectorSummary>()
const annualWind = new Map<string, VectorSummary>()
const annualCurrent = new Map<string, VectorSummary>()
const monthlyAlignment = new Map<string, { area: number, dot: number }>()
let coastMismatchAreaKm2 = 0
let outputOceanAreaKm2 = 0
let outputLandAreaKm2 = 0
let oceanWithZeroCurrentAreaKm2 = 0
let landWithCurrentAreaKm2 = 0
let oceanWithoutReferenceAreaKm2 = 0

const phases = Array.from({ length: 12 }, (_, month) => {
  const phase = ((month + 0.5) / 12 - 79 / 365 + 1) % 1
  const lower = Math.floor(phase * 4)
  const upper = (lower + 1) % 4
  const t = phase * 4 - lower
  const blend = 0.5 - 0.5 * Math.cos(Math.PI * t)
  return { lower, upper, blend }
})
const referenceAdapter = climateMesh(reference)
const referenceSurface = { ...surface, regionCount: count }
const spatial = makeMonthlySpatialFields(referenceAdapter, referenceSurface)
const transportWinds = phases.map((_, month) => makeMonthlyWind(
  referenceAdapter,
  referenceSurface,
  spatial,
  interpolateMonthlyForcing(fields, month, config.climate.axialTiltDegrees, config.climate.orbitalPeriodDays),
))
function sample(values: Float32Array, source: number, month: number) {
  const { lower, upper, blend } = phases[month]
  return values[lower * count + source] * (1 - blend) + values[upper * count + source] * blend
}
function addAlignment(key: string, area: number, windE: number, windN: number, currentE: number, currentN: number) {
  const windSpeed = Math.hypot(windE, windN)
  const currentSpeed = Math.hypot(currentE, currentN)
  if (windSpeed < 0.05 || currentSpeed < 0.05)
    return
  let entry = monthlyAlignment.get(key)
  if (!entry) {
    entry = { area: 0, dot: 0 }
    monthlyAlignment.set(key, entry)
  }
  entry.area += area
  entry.dot += area * (windE * currentE + windN * currentN) / (windSpeed * currentSpeed)
}

for (let region = 0; region < mesh.regionCount; region++) {
  const area = mesh.areaKm2[region]
  const source = climate.geographicReference[region]
  const land = Boolean(terrain.landMask[region])
  const sourceLand = Boolean(surface.landMask[source])
  const currentAvailable = climate.oceanReference[region] >= 0
  const domain = land ? 'land' : 'ocean'
  const latitude = Math.asin(mesh.centers[3 * region + 1]) * 180 / Math.PI
  const lowerLatitude = Math.max(-90, Math.min(75, Math.floor(latitude / 15) * 15))
  const band = `${lowerLatitude}..${lowerLatitude + 15}/${domain}`
  const bands = [band]
  if (Math.abs(latitude) < 15) {
    const narrowLower = Math.floor(latitude / 5) * 5
    bands.push(`${narrowLower}..${narrowLower + 5}/${domain}`)
  }
  if (land)
    outputLandAreaKm2 += area
  else
    outputOceanAreaKm2 += area
  if (land !== sourceLand)
    coastMismatchAreaKm2 += area
  if (!land && !currentAvailable)
    oceanWithoutReferenceAreaKm2 += area

  let annualWindE = 0
  let annualWindN = 0
  let annualCurrentE = 0
  let annualCurrentN = 0
  let annualWarmth = 0
  let meanWindSpeed = 0
  let meanCurrentSpeed = 0
  let minimumWindE = Infinity
  let maximumWindE = -Infinity
  let minimumCurrentE = Infinity
  let maximumCurrentE = -Infinity
  let hasCurrent = false
  for (let month = 0; month < 12; month++) {
    const windE = sample(fields.windEast, source, month)
    const windN = sample(fields.windNorth, source, month)
    const currentE = sampleClimateCirculation(climate, region, month, 'oceanEast')
    const currentN = sampleClimateCirculation(climate, region, month, 'oceanNorth')
    const warmth = sampleClimateCirculation(climate, region, month, 'oceanWarmth')
    annualWindE += windE / 12
    annualWindN += windN / 12
    annualCurrentE += currentE / 12
    annualCurrentN += currentN / 12
    annualWarmth += warmth / 12
    meanWindSpeed += Math.hypot(windE, windN) / 12
    meanCurrentSpeed += Math.hypot(currentE, currentN) / 12
    minimumWindE = Math.min(minimumWindE, windE)
    maximumWindE = Math.max(maximumWindE, windE)
    minimumCurrentE = Math.min(minimumCurrentE, currentE)
    maximumCurrentE = Math.max(maximumCurrentE, currentE)
    hasCurrent ||= Math.hypot(currentE, currentN) >= 0.05
    add(monthlyWind, `${month + 1}/${domain}`, area, windE, windN, 0)
    add(monthlyTransportWind, `${month + 1}/${domain}`, area, transportWinds[month].east[source], transportWinds[month].north[source], 0)
    for (const key of bands) {
      add(monthlyWind, `${month + 1}/${key}`, area, windE, windN, 0)
      add(monthlyTransportWind, `${month + 1}/${key}`, area, transportWinds[month].east[source], transportWinds[month].north[source], 0)
    }
    if (!land && currentAvailable) {
      add(monthlyCurrent, `${month + 1}/ocean`, area, currentE, currentN, warmth)
      for (const key of bands)
        add(monthlyCurrent, `${month + 1}/${key}`, area, currentE, currentN, warmth)
      addAlignment(`${month + 1}/ocean`, area, windE, windN, currentE, currentN)
      for (const key of bands)
        addAlignment(`${month + 1}/${key}`, area, windE, windN, currentE, currentN)
    }
  }
  if (land && hasCurrent)
    landWithCurrentAreaKm2 += area
  if (!land && currentAvailable && !hasCurrent)
    oceanWithZeroCurrentAreaKm2 += area
  const windReverses = minimumWindE < 0 && maximumWindE > 0
  const currentReverses = minimumCurrentE < 0 && maximumCurrentE > 0
  for (const key of [domain, ...bands])
    add(annualWind, key, area, annualWindE, annualWindN, 0, Math.hypot(annualWindE, annualWindN), windReverses, meanWindSpeed)
  if (!land && currentAvailable) {
    for (const key of ['ocean', ...bands])
      add(annualCurrent, key, area, annualCurrentE, annualCurrentN, annualWarmth, Math.hypot(annualCurrentE, annualCurrentN), currentReverses, meanCurrentSpeed)
  }
}

const monthlyItczLatitude = phases.map(({ lower, upper, blend }, month) => {
  let sum = 0
  let minimum = Infinity
  let maximum = -Infinity
  for (let longitude = 0; longitude < 72; longitude++) {
    const value = (fields.itczLatitude[lower * 72 + longitude] * (1 - blend) + fields.itczLatitude[upper * 72 + longitude] * blend) * 180 / Math.PI
    sum += value
    minimum = Math.min(minimum, value)
    maximum = Math.max(maximum, value)
  }
  return { month: month + 1, longitudeMeanDegrees: sum / 72, minimumDegrees: minimum, maximumDegrees: maximum }
})

process.stdout.write(`${JSON.stringify({
  command: 'node_modules/.bin/jiti packages/world-core/benchmarks/circulation-default-diagnosis.ts',
  seed,
  config,
  versions: { terrain: terrain.algorithmVersion, climate: climate.algorithmVersion },
  scope: 'Wind and current are source-reference model-relative vector components sampled onto the output Mesh; annual vectors are the mean of twelve equal-duration bins, not a published artifact.',
  regionCount: mesh.regionCount,
  referenceRegionCount: count,
  area: { landKm2: outputLandAreaKm2, oceanKm2: outputOceanAreaKm2, coastMaskMismatchShare: coastMismatchAreaKm2 / (outputLandAreaKm2 + outputOceanAreaKm2), oceanZeroCurrentShare: oceanWithZeroCurrentAreaKm2 / outputOceanAreaKm2, oceanWithoutReferenceShare: oceanWithoutReferenceAreaKm2 / outputOceanAreaKm2, landCurrentLeakShare: landWithCurrentAreaKm2 / outputLandAreaKm2 },
  annualWind: finish(annualWind),
  annualCurrent: finish(annualCurrent),
  monthlyWind: finish(monthlyWind),
  monthlyTransportWind: finish(monthlyTransportWind),
  monthlyCurrent: finish(monthlyCurrent),
  monthlyWindCurrentAlignment: Object.fromEntries([...monthlyAlignment].map(([key, entry]) => [key, entry.dot / entry.area])),
  monthlyItczLatitude,
}, null, 2)}\n`)
