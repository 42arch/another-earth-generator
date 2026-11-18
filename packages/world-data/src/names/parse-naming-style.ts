import type { ValidationIssue } from '../schemas/content'
import type { NamingStyle, NamingStyleParseResult } from '../schemas/naming-style'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const localId = (value: string) => /^[a-z][a-z0-9-]*$/.test(value)

/** Parse unknown data before it reaches the typed content-pack validator. */
export function parseNamingStyle(value: unknown): NamingStyleParseResult {
  const issues: ValidationIssue[] = []
  const add = (code: ValidationIssue['code'], path: string, message: string) => issues.push({ code, path, message })
  const keys = (item: Record<string, unknown>, allowed: readonly string[], path: string) => {
    for (const key of Object.keys(item)) {
      if (!allowed.includes(key))
        add('range', `${path}.${key}`, 'Unknown field')
    }
  }
  const weight = (item: unknown, path: string): number => {
    if (typeof item !== 'number' || !Number.isFinite(item) || item < 0) {
      add('range', path, 'Weight must be finite and nonnegative')
      return 0
    }
    return item
  }
  const totalWeight = (total: number, path: string) => {
    if (!Number.isFinite(total) || total <= 0)
      add('range', path, 'Total weight must be finite and positive')
  }
  if (!record(value))
    return { valid: false, issues: [{ code: 'dtype', path: '$', message: 'Expected a naming style object' }] }
  keys(value, ['format', 'schemaVersion', 'id', 'style', 'language', 'version', 'displayName', 'author', 'source', 'pools', 'rules'], '$')
  if (value.format !== 'another-earth/naming-style')
    add('version', 'format', 'Unsupported naming style format')
  if (value.schemaVersion !== 2)
    add('version', 'schemaVersion', 'Unsupported naming style schema')
  if (typeof value.id !== 'string' || !/^[a-z0-9-]+:naming-style\/[a-z0-9-]+$/.test(value.id))
    add('required', 'id', 'Expected namespace:naming-style/name')
  if (typeof value.style !== 'string' || !/^[a-z][a-z0-9-]*$/.test(value.style))
    add('required', 'style', 'Expected a lowercase naming style identifier')
  if (typeof value.language !== 'string' || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/i.test(value.language))
    add('required', 'language', 'Expected a BCP 47 language tag')
  if (typeof value.id === 'string' && typeof value.style === 'string' && typeof value.language === 'string'
    && value.id.split('/').at(-1) !== `${value.style}-${value.language.toLowerCase()}`)
    add('reference', 'id', 'Profile ID must match its style and language pair')
  if (typeof value.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?$/i.test(value.version))
    add('version', 'version', 'Expected a semantic version')
  for (const key of ['author', 'source'] as const) {
    if (Object.prototype.hasOwnProperty.call(value, key) && !nonempty(value[key]))
      add('required', key, 'Expected nonempty text')
  }
  if (!record(value.displayName) || !Object.keys(value.displayName).length) {
    add('required', 'displayName', 'At least one localized display name is required')
  }
  else {
    for (const [locale, text] of Object.entries(value.displayName)) {
      if (!nonempty(locale) || !nonempty(text))
        add('required', `displayName.${locale}`, 'Expected a locale and nonempty display name')
    }
  }

  const pools = record(value.pools) ? value.pools : {}
  const validPools = new Set<string>()
  if (!Object.keys(pools).length)
    add('required', 'pools', 'At least one pool is required')
  for (const [id, entries] of Object.entries(pools)) {
    const path = `pools.${id}`
    if (!localId(id))
      add('required', path, 'Expected a lowercase local pool ID')
    if (!Array.isArray(entries) || !entries.length) {
      add('required', path, 'Expected a nonempty entry array')
      continue
    }
    const before = issues.length
    let total = 0
    Array.from(entries).forEach((entry: unknown, index) => {
      const entryPath = `${path}[${index}]`
      if (!record(entry)) {
        add('dtype', entryPath, 'Expected a weighted name entry')
        return
      }
      keys(entry, ['value', 'weight'], entryPath)
      if (!nonempty(entry.value))
        add('required', `${entryPath}.value`, 'Expected a nonempty name')
      total += weight(entry.weight, `${entryPath}.weight`)
    })
    totalWeight(total, path)
    if (issues.length === before)
      validPools.add(id)
  }

  const rules = record(value.rules) ? value.rules : {}
  if (!Object.keys(rules).length)
    add('required', 'rules', 'At least one naming rule is required')
  for (const [id, templates] of Object.entries(rules)) {
    const path = `rules.${id}`
    if (!localId(id))
      add('required', path, 'Expected a lowercase local rule ID')
    if (!Array.isArray(templates) || !templates.length) {
      add('required', path, 'Expected a nonempty template array')
      continue
    }
    let total = 0
    Array.from(templates).forEach((template: unknown, index) => {
      const templatePath = `${path}[${index}]`
      if (!record(template)) {
        add('dtype', templatePath, 'Expected a weighted template')
        return
      }
      keys(template, ['weight', 'parts'], templatePath)
      total += weight(template.weight, `${templatePath}.weight`)
      if (!Array.isArray(template.parts) || !template.parts.length) {
        add('required', `${templatePath}.parts`, 'Expected nonempty template parts')
        return
      }
      let producesName = false
      Array.from(template.parts).forEach((part: unknown, partIndex) => {
        const partPath = `${templatePath}.parts[${partIndex}]`
        if (!record(part) || Object.keys(part).length !== 1) {
          add('dtype', partPath, 'Expected exactly one pool or literal field')
          return
        }
        if (Object.prototype.hasOwnProperty.call(part, 'pool')) {
          if (typeof part.pool !== 'string' || !validPools.has(part.pool))
            add('reference', `${partPath}.pool`, 'Missing or invalid local name pool')
          else
            producesName = true
        }
        else if (Object.prototype.hasOwnProperty.call(part, 'literal') && typeof part.literal === 'string') {
          producesName ||= part.literal.trim().length > 0
        }
        else {
          add('dtype', partPath, 'Expected a pool reference or literal text')
        }
      })
      if (!producesName)
        add('required', `${templatePath}.parts`, 'Every template must produce a nonempty name')
    })
    totalWeight(total, path)
  }
  if (issues.length)
    return { valid: false, issues }
  return { valid: true, value: JSON.parse(JSON.stringify(value)) as NamingStyle, issues: [] }
}
