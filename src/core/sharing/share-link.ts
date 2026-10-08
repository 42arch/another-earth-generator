import type { WorldConfig } from '@/core/simulation/config'
import { deflateSync, inflateSync } from 'fflate'
import { DEFAULT_WORLD_CONFIG } from '@/core/simulation/config'

// Legacy indices are immutable because v2 and v3 links store field positions.
const LEGACY_SHARE_FIELDS = [
  ['core', 'seed'],
  ['core', 'detail'],
  ['core', 'irregularity'],
  ['geology', 'plateCount'],
  ['geology', 'continentCount'],
  ['geology', 'continentSizeVariety'],
  ['geology', 'landCoverage'],
  ['geology', 'islandArcCount'],
  ['geology', 'islandDensity'],
  ['geology', 'hotspotCount'],
  ['terrain', 'roughness'],
  ['terrain', 'terrainWarp'],
  ['terrain', 'smoothing'],
  ['terrain', 'glacialErosion'],
  ['terrain', 'hydraulicErosion'],
  ['terrain', 'ridgeSharpening'],
] as const

const SHARE_FIELDS_V3 = [
  ...LEGACY_SHARE_FIELDS,
  ['geology', 'primaryPlateCount'],
  ['geology', 'microPlateCount'],
  ['geology', 'plateSizeVariety'],
] as const

const SHARE_FIELDS = [
  ['core', 'seed'],
  ['core', 'detail'],
  ['core', 'irregularity'],
  ['geology', 'continentCount'],
  ['geology', 'continentSizeVariety'],
  ['geology', 'landCoverage'],
  ['geology', 'islandArcCount'],
  ['geology', 'islandDensity'],
  ['geology', 'hotspotCount'],
  ['terrain', 'roughness'],
  ['terrain', 'terrainWarp'],
  ['terrain', 'smoothing'],
  ['terrain', 'glacialErosion'],
  ['terrain', 'hydraulicErosion'],
  ['terrain', 'ridgeSharpening'],
  ['geology', 'primaryPlateCount'],
  ['geology', 'microPlateCount'],
  ['geology', 'plateSizeVariety'],
] as const

const LEGACY_DEFAULT_MICRO_PLATE_COUNT = 6
const LEGACY_DEFAULT_CONTINENT_COUNT = 6

type ShareField = typeof SHARE_FIELDS_V3[number]

const NUMBER_RANGES: Record<string, readonly [number, number, boolean?]> = {
  'core.seed': [1, 99999, true],
  'core.detail': [40962, 655362, true],
  'core.irregularity': [0, 1],
  'geology.plateCount': [4, 120, true],
  'geology.primaryPlateCount': [2, 24, true],
  'geology.microPlateCount': [0, 20, true],
  'geology.plateSizeVariety': [0, 1],
  'geology.continentCount': [1, 30, true],
  'geology.continentSizeVariety': [0, 1],
  'geology.landCoverage': [0, 1],
  'geology.islandArcCount': [0, 12, true],
  'geology.islandDensity': [0, 1],
  'geology.hotspotCount': [0, 10, true],
  'terrain.roughness': [0, 0.5],
  'terrain.terrainWarp': [0, 1],
  'terrain.smoothing': [0, 1],
  'terrain.glacialErosion': [0, 1],
  'terrain.hydraulicErosion': [0, 1],
  'terrain.ridgeSharpening': [0, 1],
}

function readField(config: WorldConfig, [category, key]: ShareField): unknown {
  return (config[category] as unknown as Record<string, unknown>)[key]
}

function writeField(config: WorldConfig, [category, key]: ShareField, value: unknown): void {
  if (category === 'geology' && key === 'plateCount')
    return
  (config[category] as unknown as Record<string, unknown>)[key] = value
}

function isValidFieldValue(field: ShareField, value: unknown): boolean {
  const [category, key] = field
  const fieldId = `${category}.${key}`
  if (fieldId === 'core.detail')
    return value === 40962 || value === 163842 || value === 655362

  const range = NUMBER_RANGES[fieldId]
  if (!range || typeof value !== 'number' || !Number.isFinite(value))
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

export function createShareHash(config: WorldConfig): string {
  const changedFields: [number, unknown][] = []
  for (let index = 0; index < SHARE_FIELDS.length; index++) {
    const field = SHARE_FIELDS[index]
    const value = readField(config, field)
    if (!Object.is(value, readField(DEFAULT_WORLD_CONFIG, field)))
      changedFields.push([index, value])
  }

  const payload = JSON.stringify([changedFields])
  const compressed = deflateSync(new TextEncoder().encode(payload))
  return `#w=6.${toBase64Url(compressed)}`
}

export function applyShareHash(config: WorldConfig, hash: string): boolean {
  const match = /^#w=([2-6])\.([\w-]+)$/.exec(hash)
  if (!match)
    return false

  try {
    const fields: readonly ShareField[] = match[1] === '2'
      ? LEGACY_SHARE_FIELDS
      : match[1] === '3' ? SHARE_FIELDS_V3 : SHARE_FIELDS
    const compressed = fromBase64Url(match[2])
    const payload = JSON.parse(new TextDecoder().decode(inflateSync(compressed))) as unknown
    if (!Array.isArray(payload) || payload.length !== 1)
      return false

    const [changedFields] = payload as [unknown]
    if (!Array.isArray(changedFields))
      return false

    const seenFields = new Set<number>()
    const validatedChanges: { field: ShareField, value: unknown }[] = []
    for (const entry of changedFields) {
      if (!Array.isArray(entry) || entry.length !== 2)
        return false
      const [fieldIndex, value] = entry as [unknown, unknown]
      if (typeof fieldIndex !== 'number'
        || !Number.isInteger(fieldIndex)
        || fieldIndex < 0
        || fieldIndex >= fields.length
        || seenFields.has(fieldIndex)) {
        return false
      }
      const field = fields[fieldIndex]
      if (!isValidFieldValue(field, value))
        return false
      seenFields.add(fieldIndex)
      validatedChanges.push({ field, value })
    }

    if (Number(match[1]) < 5)
      config.geology.microPlateCount = LEGACY_DEFAULT_MICRO_PLATE_COUNT
    if (Number(match[1]) < 6)
      config.geology.continentCount = LEGACY_DEFAULT_CONTINENT_COUNT
    for (const { field, value } of validatedChanges)
      writeField(config, field, value)
    return true
  }
  catch {
    return false
  }
}
