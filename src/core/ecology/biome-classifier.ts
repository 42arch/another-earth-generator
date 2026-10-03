import type { ClimateData } from '@/core/climate/climate-data'
import type { BiomeCode, BiomeData } from '@/core/ecology/biome-data'
import type SphericalMesh from '@/core/mesh/mesh'
import type { GeographyData } from '@/core/simulation/state'
import { createOutputClimateRegionSampler } from '@/core/climate/climate-output-projector'
import { KOPPEN_CODES } from '@/core/climate/koppen-climate-classifier'
import { MONTH_DAYS } from '@/core/climate/monthly-forcing'
import { BIOME_CODES } from '@/core/ecology/biome-data'

const BIOME_ID = Object.fromEntries(BIOME_CODES.map((code, id) => [code, id])) as Record<BiomeCode, number>

/** Classify one annual monthly climate series using thermal and water-balance limits. */
export function classifyBiomeSeries(
  temperatureC: ArrayLike<number>,
  precipitationMm: ArrayLike<number>,
  southern: boolean,
  elevationKm: number,
  koppenClass?: number,
  absoluteLatitudeDeg = 0,
): { biomeClass: number, annualTemperatureC: number, annualPrecipitationMm: number, aridityIndex: number, growingSeasonMonths: number } {
  if (temperatureC.length !== 12 || precipitationMm.length !== 12)
    throw new Error('Biome classification requires exactly twelve monthly values')

  let temperatureTotal = 0
  let annualPrecipitation = 0
  let annualPet = 0
  let summerPrecipitation = 0
  let coldSeasonSnowfallMm = 0
  let meltDegreeDays = 0
  let coldest = Infinity
  let warmest = -Infinity
  let driest = Infinity
  let growingSeasonMonths = 0

  for (let month = 0; month < 12; month++) {
    const temperature = temperatureC[month]
    const precipitation = precipitationMm[month]
    if (!Number.isFinite(temperature) || !Number.isFinite(precipitation) || precipitation < 0)
      throw new Error('Biome classification received invalid monthly climate data')

    const days = MONTH_DAYS[month]
    temperatureTotal += temperature * days
    annualPrecipitation += precipitation
    annualPet += days * 0.015 * Math.max(0, temperature + 5) ** 1.45
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
      summerPrecipitation += precipitation
  }

  const annualTemperatureC = temperatureTotal / 365
  const aridityIndex = annualPrecipitation / Math.max(annualPet, 1)
  const summerPrecipitationShare = annualPrecipitation > 0
    ? summerPrecipitation / annualPrecipitation
    : 0
  const koppenCode = koppenClass === undefined ? undefined : KOPPEN_CODES[koppenClass]
  let biomeClass: number

  if (annualPrecipitation === 0 && annualPet === 0) {
    biomeClass = BIOME_ID.IceSheet
  }
  else if (warmest < 0) {
    biomeClass = BIOME_ID.IceSheet
  }
  else if (elevationKm >= 2.8 && warmest < 15) {
    biomeClass = BIOME_ID.AlpineTundra
  }
  else if (
    absoluteLatitudeDeg >= 76
    && warmest < 4
    && coldest < -20
    && coldSeasonSnowfallMm >= Math.max(20, meltDegreeDays * 0.45)
  ) {
    // A simple annual snow-retention proxy allows persistent polar ice where
    // summer means briefly exceed 0 °C, without redefining Köppen EF.
    biomeClass = BIOME_ID.IceSheet
  }
  // Köppen B classes use the same monthly climate but a different dry-climate
  // balance than this lightweight PET estimate. Preserve their desert/steppe
  // signal so dry regions cannot fall through to temperate grassland.
  else if (koppenCode === 'BWh') {
    biomeClass = BIOME_ID.HotDesert
  }
  else if (koppenCode === 'BWk') {
    biomeClass = BIOME_ID.ColdDesert
  }
  else if (koppenCode === 'BSh' || koppenCode === 'BSk') {
    biomeClass = BIOME_ID.Steppe
  }
  else if (aridityIndex < 0.12) {
    biomeClass = annualTemperatureC >= 18 ? BIOME_ID.HotDesert : BIOME_ID.ColdDesert
  }
  else if (aridityIndex < 0.32) {
    biomeClass = BIOME_ID.Steppe
  }
  else if (warmest < 10 || growingSeasonMonths < 3) {
    biomeClass = BIOME_ID.Tundra
  }
  else if (coldest >= 18) {
    if (annualPrecipitation >= 1700 && driest >= 45)
      biomeClass = BIOME_ID.TropicalRainforest
    else if (annualPrecipitation >= 950 && (driest >= 25 || aridityIndex >= 0.65))
      biomeClass = BIOME_ID.TropicalSeasonalForest
    else
      biomeClass = BIOME_ID.Savanna
  }
  else if (coldest > 0 && summerPrecipitationShare < 0.28 && driest < 60) {
    biomeClass = BIOME_ID.MediterraneanShrubland
  }
  else if (coldest <= 0) {
    biomeClass = BIOME_ID.BorealForest
  }
  else if (annualPrecipitation >= 1500 && aridityIndex >= 0.65) {
    biomeClass = BIOME_ID.TemperateRainforest
  }
  else if (annualPrecipitation < 700 || growingSeasonMonths < 5) {
    biomeClass = BIOME_ID.TemperateGrassland
  }
  else {
    biomeClass = BIOME_ID.TemperateSeasonalForest
  }

  return {
    biomeClass,
    annualTemperatureC,
    annualPrecipitationMm: annualPrecipitation,
    aridityIndex,
    growingSeasonMonths,
  }
}

/** Classify the final output mesh while sampling each monthly field only once per region. */
export function classifyOutputBiomes(
  outputMesh: SphericalMesh,
  climateMesh: SphericalMesh,
  geography: GeographyData,
  climate: ClimateData,
  axialTiltDeg: number,
): BiomeData {
  const count = outputMesh.numRegions
  const biomeClass = new Uint8Array(count)
  const annualTemperatureC = new Float32Array(count)
  const annualPrecipitationMm = new Float32Array(count)
  const aridityIndex = new Float32Array(count)
  const growingSeasonMonths = new Uint8Array(count)
  const sample = createOutputClimateRegionSampler(climate, geography, axialTiltDeg, climateMesh)
  const temperature = new Float32Array(12)
  const precipitation = new Float32Array(12)
  const sampleTarget = { temperatureC: 0, precipitationMm: 0 }

  for (let region = 0; region < count; region++) {
    if (!geography.landMask[region])
      continue
    for (let month = 0; month < 12; month++) {
      const fields = sample(region, month, sampleTarget)
      temperature[month] = fields.temperatureC
      precipitation[month] = fields.precipitationMm
    }
    const result = classifyBiomeSeries(
      temperature,
      precipitation,
      outputMesh.regionLatitude[region] < 0,
      geography.elevation[region],
      climate.koppen?.climateClass[region],
      Math.abs(outputMesh.regionLatitude[region] / (Math.PI / 180)),
    )
    biomeClass[region] = result.biomeClass
    annualTemperatureC[region] = result.annualTemperatureC
    annualPrecipitationMm[region] = result.annualPrecipitationMm
    aridityIndex[region] = result.aridityIndex
    growingSeasonMonths[region] = result.growingSeasonMonths
  }

  return { biomeClass, annualTemperatureC, annualPrecipitationMm, aridityIndex, growingSeasonMonths }
}
