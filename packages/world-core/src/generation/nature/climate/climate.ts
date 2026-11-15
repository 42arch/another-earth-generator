import type { TerrainArtifact } from '#generation/nature/geography'
import type { RandomSource } from '#math/random'
import type { SphericalMesh } from '#mesh/spherical-mesh'
import type { ClimateSurfaceData, SeasonalCirculationData } from './climate-data'
import type { ClimateMesh } from './climate-mesh'
import type { MonthlyForcing } from './monthly-forcing'
import type { MonthlySpatialFields } from './monthly-spatial-fields'
import { estimatePotentialEvapotranspirationMm } from '#generation/nature/common/potential-evapotranspiration'
import { DeterministicRandom } from '#math/random'
import { SphericalSpatialIndex } from '#mesh/spatial-index'
import { climateMesh } from './climate-mesh'
import { classifyKoppenSeries } from './koppen-classifier'
import { interpolateMonthlyForcing } from './monthly-forcing'
import { computeMonthlyPrecipitation } from './monthly-precipitation-generator'
import { makeMonthlySpatialFields } from './monthly-spatial-fields'
import { computeMonthlyTemperature } from './monthly-temperature-generator'
import { mapOceanReference } from './ocean-reference'
import { generateSeasonalOcean } from './seasonal-ocean-generator'
import { generateSeasonalWind } from './seasonal-wind-generator'

export interface ClimateParameters {
  readonly rotationPeriodHours: number
  readonly axialTiltDegrees: number
  readonly orbitalPeriodDays: number
  readonly temperatureOffsetC: number
  readonly precipitationScale: number
}

export const DEFAULT_CLIMATE_PARAMETERS: Readonly<ClimateParameters> = Object.freeze({ rotationPeriodHours: 24, axialTiltDegrees: 23.44, orbitalPeriodDays: 365.25, temperatureOffsetC: 0, precipitationScale: 1 })

export const CLIMATE_C0_VERSION = 'climate-c0-v21'

// Area-weighted fits to monthly latitude-band observations. See M1.2-circulation-speed.md.
const WIND_MPS_PER_MODEL_UNIT = 0.257
const OCEAN_MPS_PER_MODEL_UNIT = 0.097

/** C0 is an intermediate artifact, not a published climate snapshot. */
export interface ClimateArtifact {
  readonly meshId: string
  readonly terrainMeshId: string
  readonly algorithmVersion: typeof CLIMATE_C0_VERSION
  readonly monthsPerYear: 12
  readonly layout: 'month-major'
  readonly regionCount: number
  readonly temperatureC: Float32Array
  readonly precipitationMm: Float32Array
  readonly annualMeanTemperatureC: Float32Array
  readonly annualPrecipitationMm: Float32Array
  /** Preliminary C0 Köppen subtype: 0 ocean, 1..31 follow KOPPEN_CODES. */
  readonly koppenClass: Uint8Array
  readonly referenceMeshId: string
  readonly referenceRegionCount: number
  readonly geographicReference: Uint32Array
  /** Ocean reference source per output region. -1 for land or unrepresented water. */
  readonly oceanReference: Int32Array
  readonly circulation: SeasonalCirculationData
}

export function validateClimateArtifact(value: ClimateArtifact, meshId = value.meshId, regionCount = value.regionCount): void {
  const n = regionCount
  if (value.meshId !== meshId || value.terrainMeshId !== meshId || value.algorithmVersion !== CLIMATE_C0_VERSION || value.regionCount !== n || value.monthsPerYear !== 12 || value.layout !== 'month-major'
    || !(value.temperatureC instanceof Float32Array) || value.temperatureC.length !== 12 * n
    || !(value.precipitationMm instanceof Float32Array) || value.precipitationMm.length !== 12 * n
    || !(value.annualMeanTemperatureC instanceof Float32Array) || value.annualMeanTemperatureC.length !== n
    || !(value.annualPrecipitationMm instanceof Float32Array) || value.annualPrecipitationMm.length !== n
    || !(value.koppenClass instanceof Uint8Array) || value.koppenClass.length !== n
    || !value.referenceMeshId || !Number.isInteger(value.referenceRegionCount) || value.referenceRegionCount < 1
    || !(value.geographicReference instanceof Uint32Array) || value.geographicReference.length !== n
    || !value.geographicReference.every(r => r < value.referenceRegionCount)
    || !(value.oceanReference instanceof Int32Array) || value.oceanReference.length !== n
    || !value.oceanReference.every(r => r >= -1 && r < value.referenceRegionCount)) {
    throw new Error('Invalid climate artifact structure')
  }
  const c = value.circulation
  const ref = value.referenceRegionCount
  if (!c || c.regionCount !== ref || !(c.solarDeclination instanceof Float32Array) || c.solarDeclination.length !== 4
    || !(c.itczLatitude instanceof Float32Array) || c.itczLatitude.length !== 4 * 72) {
    throw new Error('Invalid climate circulation structure')
  }
  for (const key of ['pressureHpa', 'windEast', 'windNorth', 'monsoonEast', 'oceanEast', 'oceanNorth', 'oceanWarmth'] as const) {
    const array = c[key]
    if (!(array instanceof Float32Array) || array.length !== 4 * ref || !array.every(Number.isFinite))
      throw new Error(`Invalid climate circulation ${key}`)
  }
  if (!c.solarDeclination.every(Number.isFinite) || !c.itczLatitude.every(Number.isFinite))
    throw new Error('Invalid climate seasonal forcing')
  for (let r = 0; r < n; r++) {
    let temperature = 0
    let rain = 0
    for (let m = 0; m < 12; m++) {
      const index = m * n + r
      const t = value.temperatureC[index]
      const p = value.precipitationMm[index]
      if (!Number.isFinite(t) || t < -273.15 || !Number.isFinite(p) || p < 0)
        throw new Error(`Invalid climate month ${m}, region ${r}`)
      temperature += t / 12
      rain += p
    }
    if (!Number.isFinite(value.annualMeanTemperatureC[r]) || !Number.isFinite(value.annualPrecipitationMm[r])
      || Math.abs(value.annualMeanTemperatureC[r] - temperature) > 0.001
      || Math.abs(value.annualPrecipitationMm[r] - rain) > Math.max(0.01, rain * 1e-5)
      || value.koppenClass[r] > 31
      || (value.koppenClass[r] !== 0 && value.oceanReference[r] !== -1)) {
      throw new Error(`Invalid climate annual values at region ${r}`)
    }
  }
}

export function queryClimateRegion(climate: ClimateArtifact, region: number, month: number) {
  if (!Number.isInteger(region) || region < 0 || region >= climate.regionCount || !Number.isInteger(month) || month < 0 || month >= 12)
    throw new RangeError('Invalid climate region or month')
  const index = month * climate.regionCount + region
  const windEast = sampleClimateCirculation(climate, region, month, 'windEast')
  const windNorth = sampleClimateCirculation(climate, region, month, 'windNorth')
  const oceanEast = sampleClimateCirculation(climate, region, month, 'oceanEast')
  const oceanNorth = sampleClimateCirculation(climate, region, month, 'oceanNorth')
  const oceanCurrentAvailable = climate.oceanReference[region] >= 0
  return {
    month,
    temperatureC: climate.temperatureC[index],
    precipitationMm: climate.precipitationMm[index],
    annualMeanTemperatureC: climate.annualMeanTemperatureC[region],
    annualPrecipitationMm: climate.annualPrecipitationMm[region],
    koppenClass: climate.koppenClass[region],
    windEast,
    windNorth,
    windSpeedMps: Math.hypot(windEast, windNorth) * WIND_MPS_PER_MODEL_UNIT,
    oceanCurrentAvailable,
    oceanEast,
    oceanNorth,
    oceanSpeedMps: oceanCurrentAvailable ? Math.hypot(oceanEast, oceanNorth) * OCEAN_MPS_PER_MODEL_UNIT : null,
    oceanWarmth: sampleClimateCirculation(climate, region, month, 'oceanWarmth'),
  }
}

/** Estimated magnitude of the monthly mean vector. Missing currents have no speed estimate. */
export function sampleClimateSpeedMps(climate: ClimateArtifact, region: number, month: number, kind: 'wind' | 'ocean'): number | null {
  if (kind === 'wind') {
    const east = sampleClimateCirculation(climate, region, month, 'windEast')
    const north = sampleClimateCirculation(climate, region, month, 'windNorth')
    return Math.hypot(east, north) * WIND_MPS_PER_MODEL_UNIT
  }
  const east = sampleClimateCirculation(climate, region, month, 'oceanEast')
  if (climate.oceanReference[region] < 0)
    return null
  const north = sampleClimateCirculation(climate, region, month, 'oceanNorth')
  return Math.hypot(east, north) * OCEAN_MPS_PER_MODEL_UNIT
}

export function sampleClimateCirculation(climate: ClimateArtifact, region: number, month: number, field: 'windEast' | 'windNorth' | 'oceanEast' | 'oceanNorth' | 'oceanWarmth'): number {
  if (!Number.isInteger(region) || region < 0 || region >= climate.regionCount || !Number.isInteger(month) || month < 0 || month >= 12)
    throw new RangeError('Invalid climate region or month')
  const source = field === 'windEast' || field === 'windNorth'
    ? climate.geographicReference[region]
    : climate.oceanReference[region]
  if (source < 0)
    return 0
  const phase = ((month + 0.5) / 12 - 79 / 365 + 1) % 1
  const lower = Math.floor(phase * 4)
  const upper = (lower + 1) % 4
  const t = phase * 4 - lower
  const blend = 0.5 - 0.5 * Math.cos(Math.PI * t)
  const count = climate.referenceRegionCount
  const values = climate.circulation[field]
  return values[lower * count + source] * (1 - blend) + values[upper * count + source] * blend
}

/** Extract calibrated monthly wind and surface ocean velocity fields onto the output mesh. */
export function extractMonthlyCirculation(climate: ClimateArtifact): {
  readonly windEastMps: Float32Array
  readonly windNorthMps: Float32Array
  readonly oceanEastMps: Float32Array
  readonly oceanNorthMps: Float32Array
  readonly oceanWarmth: Float32Array
  readonly oceanAvailable: Uint8Array
} {
  const n = climate.regionCount
  const ref = climate.referenceRegionCount
  const windEastMps = new Float32Array(12 * n)
  const windNorthMps = new Float32Array(12 * n)
  const oceanEastMps = new Float32Array(12 * n)
  const oceanNorthMps = new Float32Array(12 * n)
  const oceanWarmth = new Float32Array(12 * n)
  const oceanAvailable = new Uint8Array(n)
  for (let r = 0; r < n; r++)
    oceanAvailable[r] = climate.oceanReference[r] >= 0 ? 1 : 0
  for (let month = 0; month < 12; month++) {
    const phase = ((month + 0.5) / 12 - 79 / 365 + 1) % 1
    const lower = Math.floor(phase * 4)
    const upper = (lower + 1) % 4
    const t = phase * 4 - lower
    const blend = 0.5 - 0.5 * Math.cos(Math.PI * t)
    const w0 = 1 - blend
    const lowerBase = lower * ref
    const upperBase = upper * ref
    const monthBase = month * n
    for (let r = 0; r < n; r++) {
      const geoSource = climate.geographicReference[r]
      const index = monthBase + r
      windEastMps[index] = (climate.circulation.windEast[lowerBase + geoSource] * w0 + climate.circulation.windEast[upperBase + geoSource] * blend) * WIND_MPS_PER_MODEL_UNIT
      windNorthMps[index] = (climate.circulation.windNorth[lowerBase + geoSource] * w0 + climate.circulation.windNorth[upperBase + geoSource] * blend) * WIND_MPS_PER_MODEL_UNIT
      const oceanSource = climate.oceanReference[r]
      if (oceanSource >= 0) {
        oceanEastMps[index] = (climate.circulation.oceanEast[lowerBase + oceanSource] * w0 + climate.circulation.oceanEast[upperBase + oceanSource] * blend) * OCEAN_MPS_PER_MODEL_UNIT
        oceanNorthMps[index] = (climate.circulation.oceanNorth[lowerBase + oceanSource] * w0 + climate.circulation.oceanNorth[upperBase + oceanSource] * blend) * OCEAN_MPS_PER_MODEL_UNIT
        oceanWarmth[index] = climate.circulation.oceanWarmth[lowerBase + oceanSource] * w0 + climate.circulation.oceanWarmth[upperBase + oceanSource] * blend
      }
    }
  }
  return { windEastMps, windNorthMps, oceanEastMps, oceanNorthMps, oceanWarmth, oceanAvailable }
}

/** Solve the reference-grid year in two passes so land recycling can use annual water availability. */
export function solveClimateYear(
  mesh: ClimateMesh,
  surface: ClimateSurfaceData,
  spatial: MonthlySpatialFields,
  forcingAtMonth: (month: number) => MonthlyForcing,
  parameters: ClimateParameters,
  check?: (fraction: number) => void,
): { temperatureC: Float32Array, precipitationMm: Float32Array } {
  const n = mesh.numRegions
  const temperatureC = new Float32Array(12 * n)
  const precipitationMm = new Float32Array(12 * n)
  const initialAnnualRain = new Float64Array(n)
  const annualPotentialEvapotranspiration = new Float64Array(n)
  for (let month = 0; month < 12; month++) {
    const forcing = forcingAtMonth(month)
    const initialTemperature = computeMonthlyTemperature(mesh, surface, spatial, forcing, undefined, parameters.temperatureOffsetC)
    const initialRain = computeMonthlyPrecipitation(mesh, surface, spatial, forcing, initialTemperature, parameters.precipitationScale)
    precipitationMm.set(initialRain, month * n)
    for (let region = 0; region < n; region++) {
      if (!surface.landMask[region])
        continue
      initialAnnualRain[region] += initialRain[region]
      annualPotentialEvapotranspiration[region] += estimatePotentialEvapotranspirationMm(initialTemperature[region], forcing.days)
    }
    check?.((month + 1) / 24)
  }

  const landWaterAvailability = Float32Array.from(annualPotentialEvapotranspiration, (demand, region) =>
    demand > 0 ? Math.min(1, initialAnnualRain[region] / demand) : 1)
  for (let month = 0; month < 12; month++) {
    const offset = month * n
    const forcing = forcingAtMonth(month)
    // Replace each draft month in place after its final calculation.
    const initialRain = precipitationMm.subarray(offset, offset + n)
    const correctedTemperature = computeMonthlyTemperature(mesh, surface, spatial, forcing, initialRain, parameters.temperatureOffsetC)
    const rain = computeMonthlyPrecipitation(mesh, surface, spatial, forcing, correctedTemperature, parameters.precipitationScale, landWaterAvailability)
    precipitationMm.set(rain, offset)
    temperatureC.set(computeMonthlyTemperature(mesh, surface, spatial, forcing, rain, parameters.temperatureOffsetC), offset)
    check?.((month + 13) / 24)
  }
  return { temperatureC, precipitationMm }
}

/** Equal-duration seasonal bins; month zero is January-like. */
export function generateClimateC0(mesh: SphericalMesh, terrain: Pick<TerrainArtifact, 'meshId' | 'elevationKm' | 'landMask'>, parameters: ClimateParameters, check?: (fraction: number) => void, random: RandomSource = new DeterministicRandom('climate-c0-direct-v2')): ClimateArtifact {
  const n = mesh.regionCount
  if (mesh.physicalRadiusKm !== 6371 || parameters.rotationPeriodHours !== 24)
    throw new RangeError('Earthlike C0 currently requires a 6371 km radius and 24-hour rotation')
  for (const [key, min, max] of [['axialTiltDegrees', 0, 45], ['orbitalPeriodDays', 300, 430], ['temperatureOffsetC', -20, 20], ['precipitationScale', 0, 3]] as const) {
    const value = parameters[key]
    if (!Number.isFinite(value) || value < min || value > max)
      throw new RangeError(`Invalid Earthlike climate parameter ${key}`)
  }
  if (terrain.meshId !== mesh.meshId || terrain.elevationKm.length !== n || terrain.landMask.length !== n)
    throw new Error('Climate terrain mesh mismatch')
  const adapter = climateMesh(mesh)
  const surface = { regionCount: n, elevationKm: terrain.elevationKm, landMask: terrain.landMask }
  const wind = generateSeasonalWind(adapter, surface.elevationKm, surface.landMask, parameters.axialTiltDegrees, random.fork('seasonal-wind'))
  check?.(0.1)
  const ocean = generateSeasonalOcean(adapter, surface.landMask, wind)
  const circulation: SeasonalCirculationData = { regionCount: n, ...wind, ...ocean }
  check?.(0.2)
  const spatial = makeMonthlySpatialFields(adapter, surface)
  const { temperatureC, precipitationMm } = solveClimateYear(
    adapter,
    surface,
    spatial,
    month => interpolateMonthlyForcing(circulation, month, parameters.axialTiltDegrees, parameters.orbitalPeriodDays),
    parameters,
    fraction => check?.(0.2 + 0.8 * fraction),
  )
  const annualMeanTemperatureC = new Float32Array(n)
  const annualPrecipitationMm = new Float32Array(n)
  const koppenClass = new Uint8Array(n)
  for (let month = 0; month < 12; month++) {
    const offset = month * n
    for (let r = 0; r < n; r++) {
      annualMeanTemperatureC[r] += temperatureC[offset + r] / 12
      annualPrecipitationMm[r] += precipitationMm[offset + r]
    }
  }
  classifyKoppen(terrain.landMask, n, temperatureC, precipitationMm, mesh.centers, koppenClass)
  const geographicReference = Uint32Array.from({ length: n }, (_, r) => r)
  const oceanReference = Int32Array.from(geographicReference, r => terrain.landMask[r] ? -1 : r)
  return { meshId: mesh.meshId, terrainMeshId: terrain.meshId, algorithmVersion: CLIMATE_C0_VERSION, monthsPerYear: 12, layout: 'month-major', regionCount: n, temperatureC, precipitationMm, annualMeanTemperatureC, annualPrecipitationMm, koppenClass, referenceMeshId: mesh.meshId, referenceRegionCount: n, geographicReference, oceanReference, circulation }
}

function classifyKoppen(landMask: Uint8Array, n: number, temperatureC: Float32Array, precipitationMm: Float32Array, centers: Float64Array, result: Uint8Array): void {
  const monthlyTemperature = new Float32Array(12)
  const monthlyPrecipitation = new Float32Array(12)
  for (let r = 0; r < n; r++) {
    if (!landMask[r])
      continue
    for (let month = 0; month < 12; month++) {
      monthlyTemperature[month] = temperatureC[month * n + r]
      monthlyPrecipitation[month] = precipitationMm[month * n + r]
    }
    result[r] = classifyKoppenSeries(monthlyTemperature, monthlyPrecipitation, centers[3 * r + 1] < 0)
  }
}

/** Area aggregation; reference cells with no output samples use nearest output region. */
export function aggregateClimateSurface(output: SphericalMesh, reference: SphericalMesh, terrain: Pick<TerrainArtifact, 'meshId' | 'elevationKm' | 'landMask'>, nearestReference: Uint32Array): Pick<TerrainArtifact, 'meshId' | 'elevationKm' | 'landMask'> {
  if (terrain.meshId !== output.meshId || terrain.elevationKm.length !== output.regionCount || terrain.landMask.length !== output.regionCount || nearestReference.length !== output.regionCount || !nearestReference.every(r => r < reference.regionCount))
    throw new Error('Invalid climate reference mapping')
  const area = new Float64Array(reference.regionCount)
  const landArea = new Float64Array(reference.regionCount)
  const elevation = new Float64Array(reference.regionCount)
  for (let r = 0; r < output.regionCount; r++) {
    const source = nearestReference[r]
    const weight = output.areaKm2[r]
    area[source] += weight
    landArea[source] += weight * terrain.landMask[r]
    elevation[source] += weight * terrain.elevationKm[r]
  }
  const elevationKm = new Float32Array(reference.regionCount)
  const landMask = new Uint8Array(reference.regionCount)
  let outputIndex: SphericalSpatialIndex | undefined
  for (let r = 0; r < reference.regionCount; r++) {
    if (area[r]) {
      elevationKm[r] = elevation[r] / area[r]
      landMask[r] = landArea[r] / area[r] >= 0.5 ? 1 : 0
    }
    else {
      outputIndex ??= new SphericalSpatialIndex(output)
      const nearest = outputIndex.findNearestRegion({ x: reference.centers[3 * r], y: reference.centers[3 * r + 1], z: reference.centers[3 * r + 2] })
      elevationKm[r] = terrain.elevationKm[nearest]
      landMask[r] = terrain.landMask[nearest]
    }
  }
  return { meshId: reference.meshId, elevationKm, landMask }
}

/** Three nearby sources, coast-aware weights and monthly global rain-volume correction. */
export function projectClimateC0(output: SphericalMesh, reference: SphericalMesh, terrain: Pick<TerrainArtifact, 'meshId' | 'elevationKm' | 'landMask'>, surface: Pick<TerrainArtifact, 'meshId' | 'elevationKm' | 'landMask'>, source: ClimateArtifact, nearestReference: Uint32Array, check?: (fraction: number) => void): ClimateArtifact {
  if (source.meshId !== reference.meshId || surface.meshId !== reference.meshId || terrain.meshId !== output.meshId || nearestReference.length !== output.regionCount || terrain.elevationKm.length !== output.regionCount || terrain.landMask.length !== output.regionCount || surface.elevationKm.length !== reference.regionCount || surface.landMask.length !== reference.regionCount)
    throw new Error('Climate projection mesh mismatch')
  const n = output.regionCount
  const indices = new Uint32Array(3 * n)
  const weights = new Float32Array(3 * n)
  for (let r = 0; r < n; r++) {
    const center = nearestReference[r]
    if (center >= reference.regionCount)
      throw new Error('Climate source index out of range')
    const candidates = [center]
    for (let edge = reference.neighborOffsets[center]; edge < reference.neighborOffsets[center + 1]; edge++) candidates.push(reference.neighbors[edge])
    const same = candidates.filter(c => surface.landMask[c] === terrain.landMask[r])
    const chosen = (same.length ? same : candidates).map((c) => {
      const dot = output.centers[3 * r] * reference.centers[3 * c] + output.centers[3 * r + 1] * reference.centers[3 * c + 1] + output.centers[3 * r + 2] * reference.centers[3 * c + 2]
      return { c, distance: Math.acos(Math.max(-1, Math.min(1, dot))) }
    }).sort((a, b) => a.distance - b.distance || a.c - b.c).slice(0, 3)
    let total = 0
    for (let i = 0; i < 3; i++) {
      const item = chosen[i] ?? chosen[0]
      indices[3 * r + i] = item.c
      weights[3 * r + i] = i < chosen.length ? 1 / (item.distance + 0.005) : 0
      total += weights[3 * r + i]
    }
    for (let i = 0; i < 3; i++) weights[3 * r + i] /= total
  }
  const temperatureC = new Float32Array(12 * n)
  const precipitationMm = new Float32Array(12 * n)
  const annualMeanTemperatureC = new Float32Array(n)
  const annualPrecipitationMm = new Float32Array(n)
  const koppenClass = new Uint8Array(n)
  for (let month = 0; month < 12; month++) {
    let sourceVolume = 0
    let outputVolume = 0
    for (let s = 0; s < reference.regionCount; s++) sourceVolume += source.precipitationMm[month * reference.regionCount + s] * reference.areaKm2[s]
    for (let r = 0; r < n; r++) {
      let t = 0
      let p = 0
      let sourceElevation = 0
      for (let i = 0; i < 3; i++) {
        const slot = 3 * r + i
        const s = indices[slot]
        const w = weights[slot]
        t += source.temperatureC[month * reference.regionCount + s] * w
        p += source.precipitationMm[month * reference.regionCount + s] * w
        sourceElevation += surface.elevationKm[s] * w
      }
      const landElevationDelta = terrain.landMask[r] ? terrain.elevationKm[r] - sourceElevation : 0
      temperatureC[month * n + r] = Math.max(-273.15, t - 6.2 * Math.max(-2, Math.min(2, landElevationDelta)))
      precipitationMm[month * n + r] = p * Math.max(0.5, Math.min(1.5, 1 + 0.08 * (terrain.elevationKm[r] - sourceElevation)))
      outputVolume += precipitationMm[month * n + r] * output.areaKm2[r]
    }
    if (sourceVolume > 0 && outputVolume <= 0)
      throw new Error('Climate projection lost all precipitation')
    const scale = outputVolume ? sourceVolume / outputVolume : 1
    for (let r = 0; r < n; r++) {
      const index = month * n + r
      precipitationMm[index] *= scale
      annualMeanTemperatureC[r] += temperatureC[index] / 12
      annualPrecipitationMm[r] += precipitationMm[index]
    }
    check?.((month + 1) / 12)
  }
  classifyKoppen(terrain.landMask, n, temperatureC, precipitationMm, output.centers, koppenClass)
  const oceanReference = mapOceanReference(output, reference, terrain.landMask, surface.landMask, nearestReference)
  return { meshId: output.meshId, terrainMeshId: terrain.meshId, algorithmVersion: CLIMATE_C0_VERSION, monthsPerYear: 12, layout: 'month-major', regionCount: n, temperatureC, precipitationMm, annualMeanTemperatureC, annualPrecipitationMm, koppenClass, referenceMeshId: reference.meshId, referenceRegionCount: reference.regionCount, geographicReference: Uint32Array.from(nearestReference), oceanReference, circulation: source.circulation }
}
