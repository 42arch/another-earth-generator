import type { NamingStyleView } from '#content/content-port'
import { generateName } from '#generation/names/naming'
import { DeterministicRandom, normalizeWorldSeed } from '#math/random'

function valuesOf(style: NamingStyleView, poolId: string): readonly string[] {
  const poolLabel = `Naming pool "${poolId}"`
  if (!Object.hasOwn(style.pools, poolId))
    throw new RangeError(`${poolLabel} is missing`)
  const pool = style.pools[poolId]!
  if (!Array.isArray(pool) || pool.length === 0)
    throw new RangeError(`${poolLabel} cannot be empty`)
  const values: string[] = []
  const seen = new Set<string>()
  for (const entry of pool) {
    if (!entry || !Number.isFinite(entry.weight) || entry.weight < 0)
      throw new RangeError(`${poolLabel} weights must be finite and nonnegative`)
    if (entry.weight <= 0 || seen.has(entry.value))
      continue
    if (typeof entry.value !== 'string')
      throw new TypeError(`${poolLabel} values must be strings`)
    seen.add(entry.value)
    values.push(entry.value)
  }
  if (values.length === 0)
    throw new RangeError(`${poolLabel} total weight must be finite and positive`)
  return values
}

export function distinctRuleNames(style: NamingStyleView, rule: string, maxExpand = 30000): readonly string[] {
  const ruleLabel = `Naming rule "${rule}"`
  if (!Object.hasOwn(style.rules, rule))
    throw new RangeError(`${ruleLabel} is missing`)
  const templates = style.rules[rule]!
  const names = new Set<string>()
  for (const template of templates) {
    if (!template || !Number.isFinite(template.weight) || template.weight < 0)
      throw new RangeError(`${ruleLabel} weights must be finite and nonnegative`)
    if (template.weight <= 0)
      continue
    if (!Array.isArray(template.parts))
      throw new TypeError(`${ruleLabel} parts must be an array`)
    let sequences: string[][] = [[]]
    for (const part of template.parts) {
      if (typeof part.literal === 'string' && part.pool === undefined) {
        sequences = sequences.map(sequence => [...sequence, part.literal!])
        continue
      }
      if (typeof part.pool !== 'string' || part.literal !== undefined)
        throw new TypeError(`${ruleLabel} parts must contain either a pool or a literal`)
      if (!part.pool.trim())
        throw new RangeError('Naming pool id cannot be empty')
      const values = valuesOf(style, part.pool)
      const next: string[][] = []
      for (const sequence of sequences) {
        for (const value of values) {
          next.push([...sequence, value])
          if (next.length >= maxExpand)
            break
        }
        if (next.length >= maxExpand)
          break
      }
      sequences = next
    }
    for (const sequence of sequences) {
      const name = sequence.join('')
      if (name.trim())
        names.add(name)
    }
  }
  return [...names].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
}

export class UniqueNameAllocator {
  readonly #used = new Set<string>()
  readonly #catalogs = new Map<string, readonly string[]>()
  readonly #worldSeed: string

  constructor(worldSeed: string | number, preallocated: Iterable<string> = []) {
    this.#worldSeed = normalizeWorldSeed(worldSeed)
    for (const existing of preallocated)
      this.#used.add(existing)
  }

  allocate(style: NamingStyleView, styleSignature: string, entityId: string, rule: string): string {
    const preferred = generateName({ style, styleSignature, worldSeed: this.#worldSeed, entityId, rule })
    if (!this.#used.has(preferred)) {
      this.#used.add(preferred)
      return preferred
    }
    for (let attempt = 1; attempt <= 24; attempt++) {
      const candidate = generateName({
        style,
        styleSignature,
        worldSeed: this.#worldSeed,
        entityId: `${entityId}#alt:${attempt}`,
        rule,
      })
      if (!this.#used.has(candidate)) {
        this.#used.add(candidate)
        return candidate
      }
    }
    const cacheKey = `${style.id}\0${styleSignature}\0${rule}`
    let catalog = this.#catalogs.get(cacheKey)
    if (!catalog) {
      catalog = distinctRuleNames(style, rule)
      this.#catalogs.set(cacheKey, catalog)
    }
    const remaining = catalog.filter(candidate => !this.#used.has(candidate))
    if (remaining.length === 0)
      throw new Error(`Naming rule "${rule}" in style "${style.id}" exhausted unique candidates for ${entityId}`)
    const random = new DeterministicRandom(JSON.stringify([
      'unique-name-v1',
      this.#worldSeed,
      entityId,
      style.id,
      style.version,
      styleSignature,
      rule,
    ]))
    const picked = remaining[random.nextInt(0, remaining.length)]!
    this.#used.add(picked)
    return picked
  }
}
