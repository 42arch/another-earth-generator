/* eslint-disable antfu/no-top-level-await -- Standalone fixed-seed diagnostic. */
import type { ClimateArtifact, EcologyArtifact, SphericalMesh, TerrainArtifact } from '../src/index'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import process from 'node:process'
import { NATURAL_BIOME_DEFINITIONS, NATURAL_LAND_COVER_DEFINITIONS } from '@another-earth/world-data'
import {
  createEcologyPipeline,
  DEFAULT_CLIMATE_PARAMETERS,
  DEFAULT_GEOLOGY_PARAMETERS,
  DEFAULT_LANDFORM_PARAMETERS,
  DEFAULT_TERRAIN_PARAMETERS,
  KOPPEN_CODES,
  validateEcologyArtifact,
} from '../src/index'

const seed = process.argv[2] ?? '1024'
const level = Number(process.argv[3] ?? 7)
if (!Number.isInteger(level) || level < 0 || level > 8)
  throw new RangeError('Mesh level must be an integer in [0, 8]')
const input = {
  seed,
  config: {
    ecology: true as const,
    planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
    mesh: { subdivisionLevel: level, irregularity: 0.75 },
    geology: DEFAULT_GEOLOGY_PARAMETERS,
    landforms: DEFAULT_LANDFORM_PARAMETERS,
    terrain: DEFAULT_TERRAIN_PARAMETERS,
    climate: { ...DEFAULT_CLIMATE_PARAMETERS, axialTiltDegrees: 23.5, precipitationScale: 1.8 },
  },
}
const pipeline = createEcologyPipeline()
const result = await pipeline.execute(input)
const mesh = result.getOutput<SphericalMesh>('mesh')
const terrain = result.getOutput<TerrainArtifact>('terrain')
const climate = result.getOutput<ClimateArtifact>('climate-c0')
const ecology = result.getOutput<EcologyArtifact>('ecology-e0')
validateEcologyArtifact(ecology, mesh.meshId, mesh.regionCount)

const biome = NATURAL_BIOME_DEFINITIONS.map(definition => ({ code: definition.code, areaKm2: 0, temperatureArea: 0, precipitationArea: 0, latitudeArea: 0, largestComponentKm2: 0, componentCount: 0 }))
const forestBiomes = new Set(['TropicalRainforest', 'TropicalSeasonalForest', 'TemperateSeasonalForest', 'TemperateRainforest', 'BorealForest'])
const visited = new Uint8Array(mesh.regionCount)
const stack: number[] = []
let landAreaKm2 = 0
let oceanAreaKm2 = 0
let mismatchedCoverRegions = 0
let oceanClassificationErrors = 0
let desertKoppenAreaKm2 = 0
let desertBiomeAreaKm2 = 0
let efAreaKm2 = 0
let iceSheetAreaKm2 = 0

for (let region = 0; region < mesh.regionCount; region++) {
  const area = mesh.areaKm2[region]
  const land = terrain.landMask[region] === 1
  const biomeIndex = ecology.potentialBiomeIndex[region]
  const biomeCode = NATURAL_BIOME_DEFINITIONS[biomeIndex].code
  const coverCode = NATURAL_LAND_COVER_DEFINITIONS[ecology.landCoverIndex[region]].code
  if ((biomeCode === 'Ocean') !== !land || (coverCode === 'Ocean') !== !land)
    oceanClassificationErrors++
  if (!land) {
    oceanAreaKm2 += area
    continue
  }
  landAreaKm2 += area
  let expectedCover = 'Tundra'
  if (biomeCode === 'IceSheet')
    expectedCover = 'SnowIce'
  else if (forestBiomes.has(biomeCode))
    expectedCover = 'Forest'
  else if (biomeCode === 'HotDesert' || biomeCode === 'ColdDesert')
    expectedCover = 'Desert'
  else if (biomeCode === 'Steppe' || biomeCode === 'TemperateGrassland')
    expectedCover = 'Grassland'
  else if (biomeCode === 'MediterraneanShrubland')
    expectedCover = 'Shrubland'
  else if (biomeCode === 'Savanna')
    expectedCover = 'Savanna'
  if (coverCode !== expectedCover)
    mismatchedCoverRegions++
  const row = biome[biomeIndex]
  row.areaKm2 += area
  row.temperatureArea += area * climate.annualMeanTemperatureC[region]
  row.precipitationArea += area * climate.annualPrecipitationMm[region]
  row.latitudeArea += area * Math.abs(Math.asin(mesh.centers[region * 3 + 1]) * 180 / Math.PI)
  if (KOPPEN_CODES[climate.koppenClass[region]] === 'BWh' || KOPPEN_CODES[climate.koppenClass[region]] === 'BWk')
    desertKoppenAreaKm2 += area
  if (biomeCode === 'HotDesert' || biomeCode === 'ColdDesert')
    desertBiomeAreaKm2 += area
  if (KOPPEN_CODES[climate.koppenClass[region]] === 'EF')
    efAreaKm2 += area
  if (biomeCode === 'IceSheet')
    iceSheetAreaKm2 += area
}

for (let region = 0; region < mesh.regionCount; region++) {
  if (!terrain.landMask[region] || visited[region])
    continue
  const biomeIndex = ecology.potentialBiomeIndex[region]
  let componentAreaKm2 = 0
  stack.push(region)
  visited[region] = 1
  while (stack.length) {
    const current = stack.pop()!
    componentAreaKm2 += mesh.areaKm2[current]
    for (let at = mesh.neighborOffsets[current]; at < mesh.neighborOffsets[current + 1]; at++) {
      const neighbor = mesh.neighbors[at]
      if (!visited[neighbor] && terrain.landMask[neighbor] && ecology.potentialBiomeIndex[neighbor] === biomeIndex) {
        visited[neighbor] = 1
        stack.push(neighbor)
      }
    }
  }
  biome[biomeIndex].componentCount++
  biome[biomeIndex].largestComponentKm2 = Math.max(biome[biomeIndex].largestComponentKm2, componentAreaKm2)
}

if (oceanClassificationErrors || mismatchedCoverRegions)
  throw new Error(`E0 classification mismatch: ocean=${oceanClassificationErrors}, cover=${mismatchedCoverRegions}`)
const digest = (array: Uint16Array) => createHash('sha256').update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)).digest('hex')
process.stdout.write(`${JSON.stringify({
  seed,
  level,
  meshId: mesh.meshId,
  versions: { terrain: terrain.algorithmVersion, climate: climate.algorithmVersion, ecology: ecology.algorithmVersion },
  regionCount: mesh.regionCount,
  landAreaKm2,
  oceanAreaKm2,
  oceanClassificationErrors,
  mismatchedCoverRegions,
  desertKoppenShare: desertKoppenAreaKm2 / landAreaKm2,
  desertBiomeShare: desertBiomeAreaKm2 / landAreaKm2,
  efShare: efAreaKm2 / landAreaKm2,
  iceSheetShare: iceSheetAreaKm2 / landAreaKm2,
  biomeHash: digest(ecology.potentialBiomeIndex),
  coverHash: digest(ecology.landCoverIndex),
  ...(process.argv[4] === '--labels' ? { biomeLabelsBase64: Buffer.from(ecology.potentialBiomeIndex.buffer).toString('base64') } : {}),
  biome: biome.filter(row => row.areaKm2 > 0).map(row => ({
    code: row.code,
    areaShare: row.areaKm2 / landAreaKm2,
    meanTemperatureC: row.temperatureArea / row.areaKm2,
    meanPrecipitationMm: row.precipitationArea / row.areaKm2,
    meanAbsoluteLatitudeDegrees: row.latitudeArea / row.areaKm2,
    componentCount: row.componentCount,
    largestComponentShareOfClass: row.largestComponentKm2 / row.areaKm2,
  })),
}, null, 2)}\n`)
