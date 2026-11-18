import type { NamingStyleView } from '#content/content-port'
import { DeterministicRandom, normalizeWorldSeed } from '#math/random'

export const NAMING_ALGORITHM_VERSION = 'naming-v1' as const

function requireIdentity(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim())
    throw new RangeError(`${label} cannot be empty`)
}

function ownValue<T>(record: Readonly<Record<string, T>>, key: string, label: string): T {
  if (!Object.prototype.hasOwnProperty.call(record, key))
    throw new RangeError(`${label} is missing`)
  return record[key]!
}

function chooseWeighted<T extends { readonly weight: number }>(entries: readonly T[], random: DeterministicRandom, label: string): T {
  if (!Array.isArray(entries) || entries.length === 0)
    throw new RangeError(`${label} cannot be empty`)
  let total = 0
  let lastPositive: T | undefined
  for (const entry of entries) {
    if (!entry || !Number.isFinite(entry.weight) || entry.weight < 0)
      throw new RangeError(`${label} weights must be finite and nonnegative`)
    total += entry.weight
    if (entry.weight > 0)
      lastPositive = entry
  }
  if (!Number.isFinite(total) || total <= 0)
    throw new RangeError(`${label} total weight must be finite and positive`)

  const target = random.nextFloat() * total
  let cumulative = 0
  for (const entry of entries) {
    cumulative += entry.weight
    if (entry.weight > 0 && target < cumulative)
      return entry
  }
  // Multiplication can round up to the total for subnormal weights.
  return lastPositive!
}

/** Each entity gets an independent stream; templates preserve their literal text. */
export function generateName(input: {
  style: NamingStyleView
  styleSignature: string
  worldSeed: string | number
  entityId: string
  rule: string
}): string {
  const { style, styleSignature, worldSeed, entityId, rule } = input
  requireIdentity(style.id, 'Naming profile id')
  requireIdentity(style.style, 'Naming style family')
  requireIdentity(style.language, 'Naming language')
  requireIdentity(style.version, 'Naming profile version')
  requireIdentity(styleSignature, 'Naming style signature')
  requireIdentity(entityId, 'Entity id')
  requireIdentity(rule, 'Naming rule')
  if (typeof worldSeed !== 'string' && typeof worldSeed !== 'number')
    throw new TypeError('World seed must be a string or number')
  const random = new DeterministicRandom(JSON.stringify([
    NAMING_ALGORITHM_VERSION,
    normalizeWorldSeed(worldSeed),
    entityId,
    style.id,
    style.version,
    styleSignature,
    rule,
  ]))
  const ruleLabel = `Naming rule "${rule}"`
  const template = chooseWeighted(ownValue(style.rules, rule, ruleLabel), random, ruleLabel)
  if (!Array.isArray(template.parts))
    throw new TypeError(`${ruleLabel} parts must be an array`)
  const name = template.parts.map((part) => {
    if (typeof part.literal === 'string' && part.pool === undefined)
      return part.literal
    if (typeof part.pool !== 'string' || part.literal !== undefined)
      throw new TypeError(`${ruleLabel} parts must contain either a pool or a literal`)
    requireIdentity(part.pool, 'Naming pool id')
    const poolLabel = `Naming pool "${part.pool}"`
    const entry = chooseWeighted(ownValue(style.pools, part.pool, poolLabel), random, poolLabel)
    if (typeof entry.value !== 'string')
      throw new TypeError(`${poolLabel} values must be strings`)
    return entry.value
  }).join('')
  if (!name.trim())
    throw new RangeError('Generated name cannot be empty')
  return name
}
