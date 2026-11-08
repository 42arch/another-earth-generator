import type { EcologyClassDefinition } from '@another-earth/world-data'
import type { ClimateArtifact } from '#generation/nature/climate/climate'
import type { TerrainArtifact } from '#generation/nature/geography'
import type { SphericalMesh } from '#mesh/spherical-mesh'
import { NATURAL_BIOME_DEFINITIONS, NATURAL_LAND_COVER_DEFINITIONS } from '@another-earth/world-data'
import { KOPPEN_CODES } from '#generation/nature/climate/koppen-classifier'

const ALGORITHM_VERSION = 'ecology-e0-v2' as const
const PET_FACTOR_MM_PER_DAY_C = 0.015
const BIOME_INDEX = new Map(NATURAL_BIOME_DEFINITIONS.map((definition, index) => [definition.code, index] as const))
const LAND_COVER_INDEX = new Map(NATURAL_LAND_COVER_DEFINITIONS.map((definition, index) => [definition.code, index] as const))

export interface EcologyArtifact {
  readonly meshId: string
  readonly terrainMeshId: string
  readonly climateMeshId: string
  readonly algorithmVersion: typeof ALGORITHM_VERSION
  readonly regionCount: number
  readonly potentialBiomeIds: readonly string[]
  readonly landCoverIds: readonly string[]
  readonly potentialBiomeIndex: Uint16Array
  readonly landCoverIndex: Uint16Array
  /** Annual precipitation / temperature-index potential evapotranspiration; dimensionless. */
  readonly aridityIndex: Float32Array
  /** Number of equal-duration C0 bins with mean temperature above 5 °C; 0..12. */
  readonly growingSeasonMonths: Uint8Array
}

export interface BiomeSeriesResult {
  readonly potentialBiomeCode: string
  readonly aridityIndex: number
  readonly growingSeasonMonths: number
}

function biomeCode(code: string): number {
  const index = BIOME_INDEX.get(code)
  if (index === undefined)
    throw new Error(`Unknown natural biome code ${code}`)
  return index
}

function landCoverCode(code: string): number {
  const index = LAND_COVER_INDEX.get(code)
  if (index === undefined)
    throw new Error(`Unknown natural land-cover code ${code}`)
  return index
}

function requireSeries(temperatureC: ArrayLike<number>, precipitationMm: ArrayLike<number>): void {
  if (temperatureC.length !== 12 || precipitationMm.length !== 12)
    throw new Error('Ecology classification requires twelve equal-duration climate bins')
  for (let month = 0; month < 12; month++) {
    if (!Number.isFinite(temperatureC[month]) || temperatureC[month] < -273.15 || !Number.isFinite(precipitationMm[month]) || precipitationMm[month] < 0)
      throw new Error(`Ecology classification received invalid climate at month ${month}`)
  }
}

/** Adapted from the read-only feat-society classifier to equal-duration C0 bins. */
export function classifyBiomeSeries(
  temperatureC: ArrayLike<number>,
  precipitationMm: ArrayLike<number>,
  southernHemisphere: boolean,
  elevationKm: number,
  koppenClass: number,
  absoluteLatitudeDegrees: number,
  orbitalPeriodDays: number,
  annualMeanTemperatureC?: number,
): BiomeSeriesResult {
  requireSeries(temperatureC, precipitationMm)
  if (!Number.isFinite(elevationKm) || !Number.isInteger(koppenClass) || koppenClass < 0 || koppenClass >= KOPPEN_CODES.length
    || !Number.isFinite(absoluteLatitudeDegrees) || absoluteLatitudeDegrees < 0 || absoluteLatitudeDegrees > 90
    || !Number.isFinite(orbitalPeriodDays) || orbitalPeriodDays <= 0
    || (annualMeanTemperatureC !== undefined && !Number.isFinite(annualMeanTemperatureC))) {
    throw new Error('Ecology classification received invalid region metadata')
  }

  let annualPrecipitationMm = 0
  let annualTemperatureC = 0
  let annualPotentialEvapotranspirationMm = 0
  let summerPrecipitationMm = 0
  let coldSeasonSnowfallMm = 0
  let meltDegreeDays = 0
  let warmestMonthC = -Infinity
  let coldestMonthC = Infinity
  let driestMonthMm = Infinity
  let growingSeasonMonths = 0
  const equalBinDays = orbitalPeriodDays / 12

  for (let month = 0; month < 12; month++) {
    const temperature = temperatureC[month]
    const precipitation = precipitationMm[month]
    annualTemperatureC += temperature
    annualPrecipitationMm += precipitation
    annualPotentialEvapotranspirationMm += equalBinDays * PET_FACTOR_MM_PER_DAY_C * Math.max(0, temperature + 5) ** 1.45
    warmestMonthC = Math.max(warmestMonthC, temperature)
    coldestMonthC = Math.min(coldestMonthC, temperature)
    driestMonthMm = Math.min(driestMonthMm, precipitation)
    if (temperature <= 0)
      coldSeasonSnowfallMm += precipitation
    else
      meltDegreeDays += temperature * equalBinDays
    if (temperature > 5)
      growingSeasonMonths++
    const summer = southernHemisphere ? month >= 9 || month <= 2 : month >= 3 && month <= 8
    if (summer)
      summerPrecipitationMm += precipitation
  }

  const aridityIndex = annualPrecipitationMm / Math.max(annualPotentialEvapotranspirationMm, 1)
  const summerPrecipitationShare = annualPrecipitationMm > 0 ? summerPrecipitationMm / annualPrecipitationMm : 0
  const koppenCode = KOPPEN_CODES[koppenClass]
  let potentialBiomeCode: string

  if ((annualPrecipitationMm === 0 && annualPotentialEvapotranspirationMm === 0) || warmestMonthC < 0) {
    potentialBiomeCode = 'IceSheet'
  }
  else if (elevationKm >= 2.8 && warmestMonthC < 15) {
    potentialBiomeCode = 'AlpineTundra'
  }
  else if (absoluteLatitudeDegrees >= 76 && warmestMonthC < 4 && coldestMonthC < -20
    && coldSeasonSnowfallMm >= Math.max(20, meltDegreeDays * 0.45)) {
    potentialBiomeCode = 'IceSheet'
  }
  else if (koppenCode === 'BWh') {
    potentialBiomeCode = 'HotDesert'
  }
  else if (koppenCode === 'BWk') {
    potentialBiomeCode = 'ColdDesert'
  }
  else if (koppenCode === 'BSh' || koppenCode === 'BSk') {
    potentialBiomeCode = 'Steppe'
  }
  else if (aridityIndex < 0.12) {
    potentialBiomeCode = (annualMeanTemperatureC ?? annualTemperatureC / 12) >= 18 ? 'HotDesert' : 'ColdDesert'
  }
  else if (aridityIndex < 0.32) {
    potentialBiomeCode = 'Steppe'
  }
  else if (warmestMonthC < 10 || growingSeasonMonths < 3) {
    potentialBiomeCode = 'Tundra'
  }
  else if (coldestMonthC >= 18) {
    if (annualPrecipitationMm >= 1700 && driestMonthMm >= 45)
      potentialBiomeCode = 'TropicalRainforest'
    else if (annualPrecipitationMm >= 950 && (driestMonthMm >= 25 || aridityIndex >= 0.65))
      potentialBiomeCode = 'TropicalSeasonalForest'
    else
      potentialBiomeCode = 'Savanna'
  }
  else if (coldestMonthC > 0 && summerPrecipitationShare < 0.28 && driestMonthMm < 60) {
    potentialBiomeCode = 'MediterraneanShrubland'
  }
  else if (coldestMonthC <= 0) {
    potentialBiomeCode = 'BorealForest'
  }
  else if (annualPrecipitationMm >= 1500 && aridityIndex >= 0.65) {
    potentialBiomeCode = 'TemperateRainforest'
  }
  else if (annualPrecipitationMm < 700 || growingSeasonMonths < 5) {
    potentialBiomeCode = 'TemperateGrassland'
  }
  else {
    potentialBiomeCode = 'TemperateSeasonalForest'
  }

  return { potentialBiomeCode, aridityIndex, growingSeasonMonths }
}

function landCoverForBiome(code: string): string {
  if (code === 'IceSheet') return 'SnowIce'
  if (['TropicalRainforest', 'TropicalSeasonalForest', 'TemperateSeasonalForest', 'TemperateRainforest', 'BorealForest'].includes(code)) return 'Forest'
  if (code === 'Savanna') return 'Savanna'
  if (code === 'HotDesert' || code === 'ColdDesert') return 'Desert'
  if (code === 'Steppe' || code === 'TemperateGrassland') return 'Grassland'
  if (code === 'MediterraneanShrubland') return 'Shrubland'
  return 'Tundra'
}

function ids(definitions: readonly EcologyClassDefinition[]): readonly string[] {
  return Object.freeze(definitions.map(definition => definition.id))
}

const potentialBiomeIds = ids(NATURAL_BIOME_DEFINITIONS)
const landCoverIds = ids(NATURAL_LAND_COVER_DEFINITIONS)

export type EcologyClimateInput = Pick<ClimateArtifact,
  'meshId' | 'terrainMeshId' | 'monthsPerYear' | 'layout' | 'regionCount' | 'temperatureC' | 'precipitationMm' | 'annualMeanTemperatureC' | 'annualPrecipitationMm' | 'koppenClass'>

export function generateEcologyE0(
  mesh: Pick<SphericalMesh, 'meshId' | 'regionCount' | 'centers'>,
  terrain: Pick<TerrainArtifact, 'meshId' | 'elevationKm' | 'landMask'>,
  climate: EcologyClimateInput,
  orbitalPeriodDays: number,
  check?: (fraction: number) => void,
): EcologyArtifact {
  const n = mesh.regionCount
  if (!mesh.meshId || !Number.isInteger(n) || n < 1 || !(mesh.centers instanceof Float64Array) || mesh.centers.length !== 3 * n
    || terrain.meshId !== mesh.meshId || !(terrain.elevationKm instanceof Float32Array) || terrain.elevationKm.length !== n
    || !(terrain.landMask instanceof Uint8Array) || terrain.landMask.length !== n
    || climate.meshId !== mesh.meshId || climate.terrainMeshId !== mesh.meshId || climate.regionCount !== n || climate.monthsPerYear !== 12 || climate.layout !== 'month-major'
    || !(climate.temperatureC instanceof Float32Array) || climate.temperatureC.length !== 12 * n
    || !(climate.precipitationMm instanceof Float32Array) || climate.precipitationMm.length !== 12 * n
    || !(climate.annualMeanTemperatureC instanceof Float32Array) || climate.annualMeanTemperatureC.length !== n
    || !(climate.annualPrecipitationMm instanceof Float32Array) || climate.annualPrecipitationMm.length !== n
    || !(climate.koppenClass instanceof Uint8Array) || climate.koppenClass.length !== n
    || !Number.isFinite(orbitalPeriodDays) || orbitalPeriodDays <= 0) {
    throw new Error('Ecology input mesh or artifact mismatch')
  }

  const potentialBiomeIndex = new Uint16Array(n)
  const landCoverIndex = new Uint16Array(n)
  const aridityIndex = new Float32Array(n)
  const growingSeasonMonths = new Uint8Array(n)
  const temperatures = new Float32Array(12)
  const precipitation = new Float32Array(12)

  for (let region = 0; region < n; region++) {
    if ((region & 1023) === 0)
      check?.(region / n)
    if (!terrain.landMask[region]) {
      potentialBiomeIndex[region] = biomeCode('Ocean')
      landCoverIndex[region] = landCoverCode('Ocean')
      continue
    }

    let monthlyPrecipitation = 0
    let monthlyTemperature = 0
    for (let month = 0; month < 12; month++) {
      const index = month * n + region
      temperatures[month] = climate.temperatureC[index]
      precipitation[month] = climate.precipitationMm[index]
      monthlyTemperature += temperatures[month]
      monthlyPrecipitation += precipitation[month]
    }
    const annualMeanTemperature = climate.annualMeanTemperatureC[region]
    const annualPrecipitation = climate.annualPrecipitationMm[region]
    if (!Number.isFinite(annualMeanTemperature) || Math.abs(monthlyTemperature / 12 - annualMeanTemperature) > 0.001
      || !Number.isFinite(annualPrecipitation) || annualPrecipitation < 0
      || Math.abs(monthlyPrecipitation - annualPrecipitation) > Math.max(0.01, annualPrecipitation * 1e-5)) {
      throw new Error(`Invalid annual climate aggregation at region ${region}`)
    }
    const latitudeRadians = Math.asin(Math.max(-1, Math.min(1, mesh.centers[region * 3 + 2])))
    const result = classifyBiomeSeries(
      temperatures,
      precipitation,
      latitudeRadians < 0,
      terrain.elevationKm[region],
      climate.koppenClass[region],
      Math.abs(latitudeRadians * 180 / Math.PI),
      orbitalPeriodDays,
      annualMeanTemperature,
    )
    potentialBiomeIndex[region] = biomeCode(result.potentialBiomeCode)
    landCoverIndex[region] = landCoverCode(landCoverForBiome(result.potentialBiomeCode))
    aridityIndex[region] = result.aridityIndex
    growingSeasonMonths[region] = result.growingSeasonMonths
  }

  check?.(1)
  const artifact: EcologyArtifact = {
    meshId: mesh.meshId,
    terrainMeshId: terrain.meshId,
    climateMeshId: climate.meshId,
    algorithmVersion: ALGORITHM_VERSION,
    regionCount: n,
    potentialBiomeIds,
    landCoverIds,
    potentialBiomeIndex,
    landCoverIndex,
    aridityIndex,
    growingSeasonMonths,
  }
  validateEcologyArtifact(artifact, mesh.meshId, n)
  return artifact
}

export function validateEcologyArtifact(value: EcologyArtifact | null | undefined, meshId = value?.meshId, regionCount = value?.regionCount): asserts value is EcologyArtifact {
  const n = regionCount
  if (!value || !meshId || !Number.isInteger(n) || n! < 1 || value.meshId !== meshId || value.terrainMeshId !== meshId
    || value.climateMeshId !== meshId || value.algorithmVersion !== ALGORITHM_VERSION || value.regionCount !== n
    || !Array.isArray(value.potentialBiomeIds) || value.potentialBiomeIds.length !== potentialBiomeIds.length || value.potentialBiomeIds.some((id, index) => id !== potentialBiomeIds[index])
    || !Array.isArray(value.landCoverIds) || value.landCoverIds.length !== landCoverIds.length || value.landCoverIds.some((id, index) => id !== landCoverIds[index])
    || !(value.potentialBiomeIndex instanceof Uint16Array) || value.potentialBiomeIndex.length !== n
    || !(value.landCoverIndex instanceof Uint16Array) || value.landCoverIndex.length !== n
    || !(value.aridityIndex instanceof Float32Array) || value.aridityIndex.length !== n
    || !(value.growingSeasonMonths instanceof Uint8Array) || value.growingSeasonMonths.length !== n) {
    throw new Error('Invalid ecology artifact structure')
  }
  for (let region = 0; region < n!; region++) {
    if (value.potentialBiomeIndex[region] >= value.potentialBiomeIds.length || value.landCoverIndex[region] >= value.landCoverIds.length
      || !Number.isFinite(value.aridityIndex[region]) || value.aridityIndex[region] < 0 || value.growingSeasonMonths[region] > 12) {
      throw new Error(`Invalid ecology artifact values at region ${region}`)
    }
  }
}

export function queryEcologyRegion(ecology: EcologyArtifact, region: number) {
  if (!Number.isInteger(region) || region < 0 || region >= ecology.regionCount)
    throw new RangeError('Invalid ecology region')
  const biomeIndex = ecology.potentialBiomeIndex[region]
  const landCoverIndex = ecology.landCoverIndex[region]
  return Object.freeze({
    region,
    potentialBiomeId: ecology.potentialBiomeIds[biomeIndex],
    potentialBiomeCode: NATURAL_BIOME_DEFINITIONS[biomeIndex].code,
    potentialBiomeLabel: NATURAL_BIOME_DEFINITIONS[biomeIndex].nameZh,
    landCoverId: ecology.landCoverIds[landCoverIndex],
    landCoverCode: NATURAL_LAND_COVER_DEFINITIONS[landCoverIndex].code,
    landCoverLabel: NATURAL_LAND_COVER_DEFINITIONS[landCoverIndex].nameZh,
    aridityIndex: ecology.aridityIndex[region],
    growingSeasonMonths: ecology.growingSeasonMonths[region],
  })
}
