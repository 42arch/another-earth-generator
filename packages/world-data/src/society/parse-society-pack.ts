import type { ContentId, ValidationIssue } from '../schemas/content'
import type { SocietyPackDocument, SocietyPackParseResult } from '../schemas/society-pack'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const version = (value: unknown) => typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?$/i.test(value)
const contentId = (value: unknown): value is ContentId => typeof value === 'string' && /^[a-z0-9-]+:[a-z0-9-]+\/[a-z0-9-]+$/.test(value)
const locale = (value: unknown): value is string => typeof value === 'string' && /^[a-z]{2,3}(?:-[A-Z0-9]{2,8})*$/i.test(value)
const politicalForms = ['republic', 'empire', 'dynastic-monarchy', 'federation', 'confederation', 'chiefdom', 'emirate', 'khanate', 'league', 'free-territory', 'kingdom', 'principality', 'theocracy', 'merchant-republic', 'city-state', 'sultanate', 'tribal-confederation', 'military-junta', 'protectorate', 'commune']
const governmentOrganizations = ['centralized', 'parliamentary', 'presidential', 'federal-council', 'confederal-assembly', 'tribal-council', 'theocratic-hierarchy', 'merchant-council', 'military-command', 'rotating-delegation', 'chartered-administration']
const successions = ['hereditary', 'elective', 'appointed', 'rotating', 'collective', 'mixed']

/** Parse an independent, language-specific society pack author document. */
export function parseSocietyPack(value: unknown): SocietyPackParseResult {
  const issues: ValidationIssue[] = []
  const add = (code: ValidationIssue['code'], path: string, message: string) => issues.push({ code, path, message })
  const keys = (item: Record<string, unknown>, allowed: readonly string[], path: string) => {
    for (const key of Object.keys(item)) {
      if (!allowed.includes(key))
        add('range', `${path}.${key}`, 'Unknown field')
    }
  }
  const strings = (item: unknown, path: string) => {
    if (!Array.isArray(item)) {
      add('dtype', path, 'Expected an array of strings')
      return
    }
    Array.from(item).forEach((text: unknown, index) => {
      if (!nonempty(text))
        add('required', `${path}[${index}]`, 'Expected nonempty text')
    })
  }
  if (!record(value))
    return { valid: false, issues: [{ code: 'dtype', path: '$', message: 'Expected a society pack object' }] }

  keys(value, ['format', 'schemaVersion', 'id', 'version', 'language', 'displayName', 'dependencies', 'peoples', 'cultures', 'states'], '$')
  if (value.format !== 'another-earth/society-pack')
    add('version', 'format', 'Unsupported society pack format')
  if (value.schemaVersion !== 1)
    add('version', 'schemaVersion', 'Unsupported society pack schema')
  if (!nonempty(value.id) || !/^[a-z0-9-]+$/.test(value.id))
    add('required', 'id', 'Expected a lowercase pack ID')
  if (!version(value.version))
    add('version', 'version', 'Expected a semantic version')
  if (!locale(value.language))
    add('required', 'language', 'Expected a language tag')
  if (!nonempty(value.displayName))
    add('required', 'displayName', 'Expected a pack display name')
  const languageSuffix = typeof value.language === 'string' ? value.language.toLowerCase() : ''
  if (languageSuffix && typeof value.id === 'string' && !value.id.endsWith(`-${languageSuffix}`))
    add('reference', 'id', 'Pack ID must identify its language')

  if (!Array.isArray(value.dependencies)) {
    add('dtype', 'dependencies', 'Expected a dependency array')
  }
  else {
    const seen = new Set<string>()
    Array.from(value.dependencies).forEach((dependency: unknown, index) => {
      const path = `dependencies[${index}]`
      if (!record(dependency)) {
        add('dtype', path, 'Expected a dependency object')
        return
      }
      keys(dependency, ['id', 'version'], path)
      if (!nonempty(dependency.id))
        add('required', `${path}.id`, 'Expected a dependency ID')
      else if (seen.has(dependency.id) || dependency.id === value.id)
        add('duplicate', `${path}.id`, 'Duplicate or self dependency')
      else
        seen.add(dependency.id)
      if (!version(dependency.version))
        add('version', `${path}.version`, 'Expected a semantic version')
    })
  }

  const domains = ['peoples', 'cultures', 'states'] as const
  const selected = domains.filter(domain => Object.hasOwn(value, domain))
  if (selected.length !== 1)
    add('required', 'definitions', 'Expected exactly one society definition domain')
  const ids = new Set<string>()
  for (const domain of selected) {
    const entries = value[domain]
    if (!Array.isArray(entries) || !entries.length) {
      add('required', domain, 'Expected a nonempty definition array')
      continue
    }
    Array.from(entries).forEach((entry: unknown, index) => {
      const path = `${domain}[${index}]`
      if (!record(entry)) {
        add('dtype', path, 'Expected a definition object')
        return
      }
      const allowed = domain === 'peoples'
        ? ['id', 'displayName', 'description', 'tags']
        : domain === 'cultures'
          ? ['id', 'displayName', 'description', 'tags', 'traits', 'namingStyleId']
          : ['id', 'displayName', 'description', 'tags', 'politicalForm', 'governmentOrganization', 'headOfStateTitle', 'headOfGovernmentTitle', 'legislatureTitle', 'succession', 'weight']
      keys(entry, allowed, path)
      const expectedDomain = domain === 'peoples' ? 'people' : domain === 'cultures' ? 'culture' : 'state'
      if (!contentId(entry.id) || !entry.id.includes(`:${expectedDomain}/`) || !entry.id.endsWith(`-${languageSuffix}`))
        add('required', `${path}.id`, `Expected a language-specific ID in the ${expectedDomain} definition domain`)
      else if (ids.has(entry.id))
        add('duplicate', `${path}.id`, 'Duplicate definition ID')
      else
        ids.add(entry.id)
      if (!nonempty(entry.displayName))
        add('required', `${path}.displayName`, 'Expected a display name')
      if (!nonempty(entry.description))
        add('required', `${path}.description`, 'Expected a localized description')
      strings(entry.tags, `${path}.tags`)
      if (domain === 'cultures') {
        strings(entry.traits, `${path}.traits`)
        if (!contentId(entry.namingStyleId) || !entry.namingStyleId.includes(':naming-style/') || !entry.namingStyleId.endsWith(`-${languageSuffix}`))
          add('reference', `${path}.namingStyleId`, 'Expected a naming style ID for this language')
        else if (!Array.isArray(value.dependencies) || !value.dependencies.some((dependency: unknown) => record(dependency) && dependency.id === entry.namingStyleId))
          add('reference', `${path}.namingStyleId`, 'Naming style must be a declared dependency')
      }
      if (domain === 'states') {
        if (!politicalForms.includes(entry.politicalForm as string))
          add('range', `${path}.politicalForm`, 'Invalid political form')
        if (!governmentOrganizations.includes(entry.governmentOrganization as string))
          add('range', `${path}.governmentOrganization`, 'Invalid government organization')
        if (!nonempty(entry.headOfStateTitle))
          add('required', `${path}.headOfStateTitle`, 'Head of state title is required')
        for (const field of ['headOfGovernmentTitle', 'legislatureTitle'] as const) {
          if (entry[field] !== null && !nonempty(entry[field]))
            add('required', `${path}.${field}`, 'Expected a title or null')
        }
        if (!successions.includes(entry.succession as string))
          add('range', `${path}.succession`, 'Invalid succession')
        if (typeof entry.weight !== 'number' || !Number.isFinite(entry.weight) || entry.weight < 0)
          add('range', `${path}.weight`, 'Weight must be finite and nonnegative')
      }
    })
  }
  if (issues.length)
    return { valid: false, issues }
  try {
    return { valid: true, value: JSON.parse(JSON.stringify(value)) as SocietyPackDocument, issues: [] }
  }
  catch {
    return { valid: false, issues: [{ code: 'dtype', path: '$', message: 'Expected JSON-compatible data' }] }
  }
}
