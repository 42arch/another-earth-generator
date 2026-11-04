import alea from 'alea'

export interface RandomSource {
  readonly identity: string
  readonly algorithmVersion: string
  nextFloat: () => number
  nextInt: (minInclusive: number, maxExclusive: number) => number
  fork: (namespace: string) => RandomSource
}

export const RANDOM_SEED_DERIVATION_VERSION = 'utf16-fnv1a64-v1' as const
export const MULBERRY32_VERSION = 'mulberry32-v1' as const
export const ALEA_VERSION = 'alea-v1' as const

/** FNV-1a 64 over UTF-16 code units encoded as two little-endian bytes. Stable across JS runtimes. */
export function stableHash(text: string): string {
  let hash = 0xCBF29CE484222325n
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i)
    hash = BigInt.asUintN(64, (hash ^ BigInt(unit & 0xFF)) * 0x100000001B3n)
    hash = BigInt.asUintN(64, (hash ^ BigInt(unit >>> 8)) * 0x100000001B3n)
  }
  return hash.toString(16).padStart(16, '0')
}

export function normalizeWorldSeed(seed: string | number): string {
  if (typeof seed === 'number' && !Number.isSafeInteger(seed))
    throw new RangeError('Numeric world seed must be a safe integer')
  const text = String(seed)
  if (!text.trim())
    throw new RangeError('World seed cannot be empty')
  return text
}

function boundedInt(source: RandomSource, minInclusive: number, maxExclusive: number): number {
  if (!Number.isSafeInteger(minInclusive) || !Number.isSafeInteger(maxExclusive) || !(maxExclusive > minInclusive) || maxExclusive - minInclusive > 0x100000000)
    throw new RangeError('Integer range must be nonempty and at most 2^32')
  return minInclusive + Math.floor(source.nextFloat() * (maxExclusive - minInclusive))
}

/** Mulberry32. Forks derive from the immutable stream identity, never from its current state. */
export class DeterministicRandom implements RandomSource {
  readonly identity: string
  readonly algorithmVersion = MULBERRY32_VERSION
  #state: number

  constructor(identity: string) {
    if (!identity)
      throw new RangeError('Random identity cannot be empty')
    this.identity = identity
    const hash = stableHash(identity)
    this.#state = (Number.parseInt(hash.slice(0, 8), 16) ^ Number.parseInt(hash.slice(8), 16)) >>> 0
  }

  nextFloat(): number {
    this.#state = (this.#state + 0x6D2B79F5) >>> 0
    let value = this.#state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }

  nextInt(minInclusive: number, maxExclusive: number): number {
    return boundedInt(this, minInclusive, maxExclusive)
  }

  fork(namespace: string): DeterministicRandom {
    if (!namespace)
      throw new RangeError('Random namespace cannot be empty')
    return new DeterministicRandom(JSON.stringify([this.identity, namespace]))
  }
}

/** Fresh alea stream for M0.3 compatibility. Root draws match alea(seed) exactly. */
export class AleaRandom implements RandomSource {
  readonly identity: string
  readonly algorithmVersion = ALEA_VERSION
  #next: () => number

  constructor(seed: string | number) {
    this.identity = normalizeWorldSeed(seed)
    this.#next = alea(this.identity)
  }

  nextFloat(): number {
    return this.#next()
  }

  nextInt(minInclusive: number, maxExclusive: number): number {
    return boundedInt(this, minInclusive, maxExclusive)
  }

  fork(namespace: string): AleaRandom {
    if (!namespace)
      throw new RangeError('Random namespace cannot be empty')
    return new AleaRandom(stableHash(JSON.stringify([RANDOM_SEED_DERIVATION_VERSION, this.algorithmVersion, this.identity, namespace])))
  }
}

export function stageRandom(worldSeed: string | number, stageId: string, stageVersion: string): DeterministicRandom {
  return new DeterministicRandom(JSON.stringify([normalizeWorldSeed(worldSeed), stageId, stageVersion]))
}
