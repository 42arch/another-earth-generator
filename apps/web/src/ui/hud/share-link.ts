import {
  CIVILIZATION_CAPABILITY_RANGES,
  CIVILIZATION_SOCIETY_RANGES,
  DEFAULT_CIVILIZATION_PARAMETERS,
  DEFAULT_CLIMATE_PARAMETERS,
  DEFAULT_GEOLOGY_PARAMETERS,
  DEFAULT_HYDROLOGY_PARAMETERS,
  DEFAULT_LANDFORM_PARAMETERS,
  DEFAULT_TERRAIN_PARAMETERS,
  TEMPERATURE_OFFSET_MAX_C,
  TEMPERATURE_OFFSET_MIN_C,
} from '@another-earth/world-core'

/** Current parameter-link version. v2–v14 belong to previous field layouts or defaults and are not applied. */
const SHARE_VERSION = 15

const SHARE_FIELDS = [
  'seed',
  'level',
  'irregularity',
  'primaryPlateCount',
  'microPlateCount',
  'plateSizeVariety',
  'continentCount',
  'continentSizeVariety',
  'candidateLandCoverage',
  'islandArcCount',
  'islandDensity',
  'hotspotCount',
  'roughness',
  'terrainWarp',
  'smoothing',
  'glacialErosion',
  'hydraulicErosion',
  'ridgeSharpening',
  'axialTiltDegrees',
  'orbitalPeriodDays',
  'temperatureOffsetC',
  'precipitationScale',
  'degreeDayMeltFactorMmPerCMonth',
  'evapotranspirationFactorMmPerCMonth',
  'riverDensityMultiplier',
  'minimumRiverDrainageAreaKm2',
  'minimumLakeAreaKm2',
  'civilizationEnabled',
  'populationScale',
  'settlementDensity',
  'urbanConcentration',
  'polityCount',
  'politySizeVariation',
  'culturalDiversity',
  'administrativeCapacity',
  'agriculturalProductivity',
  'industrialCapability',
  'landTransportCapability',
  'seafaringCapability',
] as const

export type ShareField = (typeof SHARE_FIELDS)[number]

export type ShareParameters = Record<ShareField, number | string | boolean>

/** Values the workbench starts with. Climate tilt and precipitation follow the UI, not the core defaults. */
export const SHARE_DEFAULT_PARAMETERS: ShareParameters = {
  seed: '1024',
  level: 7,
  irregularity: 0.75,
  primaryPlateCount: DEFAULT_GEOLOGY_PARAMETERS.primaryPlateCount,
  microPlateCount: DEFAULT_GEOLOGY_PARAMETERS.microPlateCount,
  plateSizeVariety: DEFAULT_GEOLOGY_PARAMETERS.plateSizeVariety,
  continentCount: DEFAULT_GEOLOGY_PARAMETERS.continentCount,
  continentSizeVariety: DEFAULT_GEOLOGY_PARAMETERS.continentSizeVariety,
  candidateLandCoverage: DEFAULT_GEOLOGY_PARAMETERS.candidateLandCoverage,
  islandArcCount: DEFAULT_LANDFORM_PARAMETERS.islandArcCount,
  islandDensity: DEFAULT_LANDFORM_PARAMETERS.islandDensity,
  hotspotCount: DEFAULT_LANDFORM_PARAMETERS.hotspotCount,
  roughness: DEFAULT_TERRAIN_PARAMETERS.roughness,
  terrainWarp: DEFAULT_TERRAIN_PARAMETERS.terrainWarp,
  smoothing: DEFAULT_TERRAIN_PARAMETERS.smoothing,
  glacialErosion: DEFAULT_TERRAIN_PARAMETERS.glacialErosion,
  hydraulicErosion: DEFAULT_TERRAIN_PARAMETERS.hydraulicErosion,
  ridgeSharpening: DEFAULT_TERRAIN_PARAMETERS.ridgeSharpening,
  axialTiltDegrees: 23.5,
  orbitalPeriodDays: DEFAULT_CLIMATE_PARAMETERS.orbitalPeriodDays,
  temperatureOffsetC: DEFAULT_CLIMATE_PARAMETERS.temperatureOffsetC,
  precipitationScale: 1.8,
  degreeDayMeltFactorMmPerCMonth: DEFAULT_HYDROLOGY_PARAMETERS.degreeDayMeltFactorMmPerCMonth,
  evapotranspirationFactorMmPerCMonth: DEFAULT_HYDROLOGY_PARAMETERS.evapotranspirationFactorMmPerCMonth,
  riverDensityMultiplier: DEFAULT_HYDROLOGY_PARAMETERS.riverDensityMultiplier,
  minimumRiverDrainageAreaKm2: DEFAULT_HYDROLOGY_PARAMETERS.minimumRiverDrainageAreaKm2,
  minimumLakeAreaKm2: DEFAULT_HYDROLOGY_PARAMETERS.minimumLakeAreaKm2,
  civilizationEnabled: DEFAULT_CIVILIZATION_PARAMETERS.enabled,
  populationScale: DEFAULT_CIVILIZATION_PARAMETERS.populationScale,
  settlementDensity: DEFAULT_CIVILIZATION_PARAMETERS.settlementDensity,
  urbanConcentration: DEFAULT_CIVILIZATION_PARAMETERS.urbanConcentration,
  polityCount: DEFAULT_CIVILIZATION_PARAMETERS.polityCount,
  politySizeVariation: DEFAULT_CIVILIZATION_PARAMETERS.politySizeVariation,
  culturalDiversity: DEFAULT_CIVILIZATION_PARAMETERS.culturalDiversity,
  administrativeCapacity: DEFAULT_CIVILIZATION_PARAMETERS.capabilities.administrativeCapacity,
  agriculturalProductivity: DEFAULT_CIVILIZATION_PARAMETERS.capabilities.agriculturalProductivity,
  industrialCapability: DEFAULT_CIVILIZATION_PARAMETERS.capabilities.industrialCapability,
  landTransportCapability: DEFAULT_CIVILIZATION_PARAMETERS.capabilities.landTransportCapability,
  seafaringCapability: DEFAULT_CIVILIZATION_PARAMETERS.capabilities.seafaringCapability,
}

const NUMBER_RANGES: Record<Exclude<ShareField, 'seed' | 'civilizationEnabled'>, readonly [number, number, boolean?]> = {
  level: [4, 8, true],
  irregularity: [0, 1],
  primaryPlateCount: [2, 100, true],
  microPlateCount: [0, 100, true],
  plateSizeVariety: [0, 1],
  continentCount: [1, 100, true],
  continentSizeVariety: [0, 1],
  candidateLandCoverage: [0, 1],
  islandArcCount: [0, 100, true],
  islandDensity: [0, 1],
  hotspotCount: [0, 100, true],
  roughness: [0, 0.5],
  terrainWarp: [0, 1],
  smoothing: [0, 1],
  glacialErosion: [0, 1],
  hydraulicErosion: [0, 1],
  ridgeSharpening: [0, 1],
  axialTiltDegrees: [0, 45],
  orbitalPeriodDays: [300, 430],
  temperatureOffsetC: [TEMPERATURE_OFFSET_MIN_C, TEMPERATURE_OFFSET_MAX_C],
  precipitationScale: [0, 3],
  degreeDayMeltFactorMmPerCMonth: [0, 100],
  evapotranspirationFactorMmPerCMonth: [0, 100],
  riverDensityMultiplier: [0.25, 2],
  minimumRiverDrainageAreaKm2: [0, 10_000_000],
  minimumLakeAreaKm2: [0, 10_000_000],
  populationScale: [0.1, 4],
  settlementDensity: [0.25, 4],
  urbanConcentration: CIVILIZATION_SOCIETY_RANGES.urbanConcentration,
  polityCount: [...CIVILIZATION_SOCIETY_RANGES.polityCount, true],
  politySizeVariation: CIVILIZATION_SOCIETY_RANGES.politySizeVariation,
  culturalDiversity: CIVILIZATION_SOCIETY_RANGES.culturalDiversity,
  administrativeCapacity: CIVILIZATION_CAPABILITY_RANGES.administrativeCapacity,
  agriculturalProductivity: CIVILIZATION_CAPABILITY_RANGES.agriculturalProductivity,
  industrialCapability: CIVILIZATION_CAPABILITY_RANGES.industrialCapability,
  landTransportCapability: CIVILIZATION_CAPABILITY_RANGES.landTransportCapability,
  seafaringCapability: CIVILIZATION_CAPABILITY_RANGES.seafaringCapability,
}

function isValidFieldValue(field: ShareField, value: unknown): boolean {
  if (field === 'seed')
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 64
  if (field === 'civilizationEnabled')
    return typeof value === 'boolean'

  const range = NUMBER_RANGES[field]
  if (typeof value !== 'number' || !Number.isFinite(value))
    return false
  const [min, max, integer] = range
  return value >= min && value <= max && (!integer || Number.isInteger(value))
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function pipeBytes(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  // Read while writing. Closing the writer before anyone reads the output never finishes.
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const buffer = await new Response(new Blob([source as ArrayBuffer]).stream().pipeThrough(stream)).arrayBuffer()
  return new Uint8Array(buffer)
}

/** `#w=15.<payload>` — only fields that differ from the workbench defaults, raw-deflated like the previous share hash. */
export async function createShareHash(parameters: ShareParameters): Promise<string> {
  const changedFields: [number, string | number | boolean][] = []
  for (let index = 0; index < SHARE_FIELDS.length; index++) {
    const field = SHARE_FIELDS[index]
    const value = parameters[field]
    if (!Object.is(value, SHARE_DEFAULT_PARAMETERS[field]))
      changedFields.push([index, value])
  }
  const payload = new TextEncoder().encode(JSON.stringify([changedFields]))
  const compressed = await pipeBytes(payload, new CompressionStream('deflate-raw'))
  return `#w=${SHARE_VERSION}.${toBase64Url(compressed)}`
}

export async function createShareUrl(parameters: ShareParameters): Promise<string> {
  const hash = await createShareHash(parameters)
  const url = new URL(window.location.href)
  url.hash = hash.slice(1)
  return url.toString()
}

export async function applyShareHash(hash: string): Promise<ShareParameters | null> {
  const match = /^#w=15\.([\w-]+)$/.exec(hash)
  if (!match)
    return null

  try {
    const compressed = fromBase64Url(match[1])
    const payload = JSON.parse(new TextDecoder().decode(await pipeBytes(compressed, new DecompressionStream('deflate-raw')))) as unknown
    if (!Array.isArray(payload) || payload.length !== 1 || !Array.isArray(payload[0]))
      return null

    const next: ShareParameters = { ...SHARE_DEFAULT_PARAMETERS }
    const seenFields = new Set<number>()
    for (const entry of payload[0]) {
      if (!Array.isArray(entry) || entry.length !== 2)
        return null
      const [fieldIndex, value] = entry as [unknown, unknown]
      if (typeof fieldIndex !== 'number' || !Number.isInteger(fieldIndex) || fieldIndex < 0 || fieldIndex >= SHARE_FIELDS.length || seenFields.has(fieldIndex))
        return null
      const field = SHARE_FIELDS[fieldIndex]
      if (!isValidFieldValue(field, value))
        return null
      seenFields.add(fieldIndex)
      next[field] = value as string | number | boolean
    }

    if (Number(next.primaryPlateCount) + Number(next.microPlateCount) > 100)
      return null
    return next
  }
  catch {
    return null
  }
}
