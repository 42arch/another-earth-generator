import type { NamingStyleView } from '#content/content-port'
import type { GeographicRegionsArtifact } from './geographic-regions'
import { generateName } from '#generation/names/naming'
import { DeterministicRandom, normalizeWorldSeed } from '#math/random'

export const GEOGRAPHIC_NAMES_VERSION = 'geographic-names-v4' as const

type GeographicRule = 'continent' | 'ocean'

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

/** Distinct strings the rule can emit. Zero-weight entries and duplicate spellings count once. */
function distinctNames(style: NamingStyleView, rule: GeographicRule): readonly string[] {
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
        sequences = sequences.map(sequence => [...sequence, part.literal])
        continue
      }
      if (typeof part.pool !== 'string' || part.literal !== undefined)
        throw new TypeError(`${ruleLabel} parts must contain either a pool or a literal`)
      if (!part.pool.trim())
        throw new RangeError('Naming pool id cannot be empty')
      const values = valuesOf(style, part.pool)
      const next: string[][] = []
      for (const sequence of sequences) {
        for (const value of values)
          next.push([...sequence, value])
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

/** Names are facts attached to stable geographic IDs; the classification arrays remain unchanged. */
export function nameGeographicRegions(regions: GeographicRegionsArtifact, worldSeed: string, style: NamingStyleView, styleSignature: string): GeographicRegionsArtifact {
  if (!worldSeed?.trim() || !styleSignature?.trim() || !style?.id?.trim())
    throw new Error('Geographic naming requires a seed, style and style signature')
  for (const rule of ['continent', 'ocean'] as const) {
    if (!style.rules || !Object.hasOwn(style.rules, rule) || !Array.isArray(style.rules[rule]) || style.rules[rule].length === 0)
      throw new Error(`Geographic naming rule "${rule}" is missing or empty`)
  }
  const names = new Map<string, string>()
  const used = new Set<string>()
  const catalogs = new Map<GeographicRule, readonly string[]>()
  const pending = [
    ...regions.continents.map(region => ({ rule: 'continent' as const, region })),
    ...regions.oceans.map(region => ({ rule: 'ocean' as const, region })),
  ].sort((a, b) => a.region.id < b.region.id ? -1 : a.region.id > b.region.id ? 1 : 0)
  for (const item of pending) {
    const preferred = generateName({ style, rule: item.rule, worldSeed, entityId: item.region.id, styleSignature })
    let name = preferred
    if (used.has(name)) {
      let catalog = catalogs.get(item.rule)
      if (!catalog) {
        catalog = distinctNames(style, item.rule)
        catalogs.set(item.rule, catalog)
      }
      const remaining = catalog.filter(candidate => !used.has(candidate))
      if (remaining.length === 0)
        throw new Error(`Geographic naming rule "${item.rule}" cannot assign a unique name`)
      const random = new DeterministicRandom(JSON.stringify([
        GEOGRAPHIC_NAMES_VERSION,
        normalizeWorldSeed(worldSeed),
        item.region.id,
        style.id,
        style.version,
        styleSignature,
        item.rule,
        'unique-name',
      ]))
      name = remaining[random.nextInt(0, remaining.length)]!
    }
    used.add(name)
    names.set(`${item.rule}\0${item.region.id}`, name)
  }
  return {
    ...regions,
    nameStyleId: style.id,
    nameStyleSignature: styleSignature,
    continents: regions.continents.map(region => ({ ...region, name: names.get(`continent\0${region.id}`)! })),
    oceans: regions.oceans.map(region => ({ ...region, name: names.get(`ocean\0${region.id}`)! })),
  }
}
