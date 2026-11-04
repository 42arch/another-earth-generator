import type { ContentPack } from '@another-earth/world-data'
import type { NumericArray } from './fields'
import type { WorldSnapshot } from './world-snapshot'
import { validateWorldSnapshot } from './world-validator'

const ARRAY_TYPES = {
  Float32Array,
  Float64Array,
  Int32Array,
  Uint8Array,
  Uint16Array,
  Uint32Array,
} as const
type ArrayType = keyof typeof ARRAY_TYPES

function checksum(value: string): string {
  let hash = 0x811C9DC5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function assertValid(snapshot: WorldSnapshot, packs: readonly ContentPack[]): void {
  const result = validateWorldSnapshot(snapshot, packs)
  if (!result.valid)
    throw new Error(`Invalid world snapshot: ${result.issues[0]?.path}: ${result.issues[0]?.message}`)
}

/** M0 JSON round trip. The format is versioned and checked, but is not the M4 binary .aearth format. */
export function encodeWorldArchive(snapshot: WorldSnapshot, packs: readonly ContentPack[]): string {
  assertValid(snapshot, packs)
  const payload = JSON.stringify(snapshot, (_, value: unknown) => {
    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
      const array = value as NumericArray
      return { $typedArray: array.constructor.name, values: Array.from(array) }
    }
    return value
  })
  return JSON.stringify({ format: 'another-earth-m0-json', version: 1, checksum: checksum(payload), payload })
}

export function decodeWorldArchive(archive: string, packs: readonly ContentPack[]): WorldSnapshot {
  try {
    const envelope: unknown = JSON.parse(archive)
    if (!envelope || typeof envelope !== 'object')
      throw new Error('Invalid envelope')
    const record = envelope as Record<string, unknown>
    if (record.format !== 'another-earth-m0-json' || record.version !== 1 || typeof record.payload !== 'string' || record.checksum !== checksum(record.payload))
      throw new Error('Unsupported or corrupted archive')
    const snapshot = JSON.parse(record.payload, (_, value: unknown) => {
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, '$typedArray'))
        return value
      const marker = value as { $typedArray?: unknown, values?: unknown }
      const type = marker.$typedArray as ArrayType
      const ArrayConstructor = Object.hasOwn(ARRAY_TYPES, type) ? ARRAY_TYPES[type] : undefined
      const max = type === 'Uint8Array' ? 255 : type === 'Uint16Array' ? 65535 : type === 'Uint32Array' ? 4294967295 : type === 'Int32Array' ? 2147483647 : undefined
      const min = type === 'Int32Array' ? -2147483648 : 0
      if (!ArrayConstructor || !Array.isArray(marker.values) || !marker.values.every((number: unknown) => typeof number === 'number' && Number.isFinite(number) && (max === undefined || (Number.isInteger(number) && number >= min && number <= max))))
        throw new Error('Invalid typed array')
      return new ArrayConstructor(marker.values)
    }) as WorldSnapshot
    assertValid(snapshot, packs)
    return snapshot
  }
  catch (error) {
    throw new Error('Cannot decode world archive', { cause: error })
  }
}
