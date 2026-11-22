import type { ContentDefinition, ContentPack, ValidationIssue, ValidationResult } from '../schemas/content'
import type { NamingStyle } from '../schemas/naming-style'
import { parseNamingStyle } from '../names/parse-naming-style'
import { validatePolityTraitReferences } from '../society/polity-traits'

/** Validates typed data; this is not a parser for untrusted JSON. Dependencies must be resolved first. */
export function validateContentPack(pack: ContentPack, dependencies: readonly ContentPack[] = []): ValidationResult {
  const issues: ValidationIssue[] = []
  const add = (code: ValidationIssue['code'], path: string, message: string) => issues.push({ code, path, message })
  const nonempty = (v: string) => typeof v === 'string' && v.trim().length > 0
  const version = (v: string) => /^\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?$/i.test(v)
  const m = pack.manifest
  if (m.schemaVersion !== 1 || !version(m.version))
    add('version', 'manifest', 'Unsupported schema or invalid semantic version')
  const styles: readonly NamingStyle[] = Array.isArray(pack.namingStyles) ? pack.namingStyles : []
  const peoples = Array.isArray(pack.peoples) ? pack.peoples : []
  const polities = Array.isArray(pack.polities) ? pack.polities : []
  if (!Array.isArray(pack.namingStyles))
    add('required', 'namingStyles', 'Schema v1 requires a naming styles array')
  if (!Array.isArray(pack.peoples))
    add('required', 'peoples', 'Schema v1 requires a peoples array')
  if (!Array.isArray(pack.polities))
    add('required', 'polities', 'Schema v1 requires a polities array')
  for (const key of ['id', 'nameKey', 'contentHash'] as const) {
    if (!nonempty(m[key]))
      add('required', `manifest.${key}`, 'Required nonempty string')
  }
  const depIds = new Set<string>()
  for (const [i, dep] of m.dependencies.entries()) {
    if (dep.id === m.id || depIds.has(dep.id))
      add('duplicate', `manifest.dependencies[${i}]`, 'Duplicate or self dependency')
    depIds.add(dep.id)
    if (!dependencies.some(p => p.manifest.id === dep.id && p.manifest.version === dep.version))
      add('reference', `manifest.dependencies[${i}]`, 'Exact dependency version is not resolved')
  }
  const domains = ['names', 'cultures', 'religions', 'resources', 'presets'] as const
  const definitions: ContentDefinition[] = [...domains.flatMap(key => [...pack[key]]), ...peoples, ...polities]
  const ids = new Set<string>()
  for (const [i, d] of definitions.entries()) {
    if (!/^[a-z0-9-]+:[a-z0-9-]+\/[a-z0-9-]+$/.test(d.id))
      add('required', `definitions[${i}].id`, 'Expected namespace:domain/name')
    if (ids.has(d.id))
      add('duplicate', `definitions[${i}].id`, 'Duplicate content ID')
    ids.add(d.id)
    if (!nonempty(d.displayNameKey) || d.tags.some(t => !nonempty(t)))
      add('required', `definitions[${i}]`, 'Invalid name key or tag')
    if (d.description !== undefined && !nonempty(d.description))
      add('required', `definitions[${i}].description`, 'Description must be nonempty text')
  }
  for (const [i, style] of styles.entries()) {
    const parsed = parseNamingStyle(style)
    for (const issue of parsed.issues)
      add(issue.code, `namingStyles[${i}].${issue.path}`, issue.message)
    if (ids.has(style.id))
      add('duplicate', `namingStyles[${i}].id`, 'Duplicate content ID')
    ids.add(style.id)
  }
  const resolved = dependencies.filter(p => m.dependencies.some(d => d.id === p.manifest.id && d.version === p.manifest.version))
  for (const dep of resolved) {
    const entries = [...domains.flatMap(key => [...dep[key]]), ...('namingStyles' in dep ? dep.namingStyles : []), ...('peoples' in dep ? dep.peoples : []), ...('polities' in dep ? dep.polities : [])]
    for (const d of entries) {
      if (ids.has(d.id))
        add('duplicate', 'dependencies', `Conflicting content ID ${d.id}`)
      ids.add(d.id)
    }
  }
  const namingStyles = new Set([...styles, ...resolved.flatMap(p => 'namingStyles' in p ? [...p.namingStyles] : [])].map(style => style.id))
  for (const [i, culture] of pack.cultures.entries()) {
    if (!namingStyles.has(culture.namingStyleId))
      add('reference', `cultures[${i}].namingStyleId`, 'Schema v1 requires a naming style reference')
  }
  const numeric = (v: number, path: string, max = Infinity) => {
    if (!Number.isFinite(v) || v < 0 || v > max)
      add('range', path, 'Number outside supported range')
  }
  for (const [i, n] of pack.names.entries()) {
    if (!n.entries.length)
      add('required', `names[${i}].entries`, 'Name pool cannot be empty')
    n.entries.forEach((e, j) => {
      if (!nonempty(e.value))
        add('required', `names[${i}].entries[${j}]`, 'Empty name')
      numeric(e.weight, `names[${i}].entries[${j}].weight`)
    })
    if (!n.entries.some(e => e.weight > 0))
      add('range', `names[${i}].entries`, 'At least one positive weight required')
  }
  pack.religions.forEach((r, i) => {
    numeric(r.tolerance, `religions[${i}].tolerance`, 1)
    numeric(r.spreadBias, `religions[${i}].spreadBias`, 1)
    numeric(r.weight, `religions[${i}].weight`)
    if (!['decentralized', 'hierarchical'].includes(r.organization))
      add('range', `religions[${i}].organization`, 'Invalid organization')
  })
  const ownTraits = Array.isArray(pack.polityTraits) ? pack.polityTraits : []
  const polityTraits = [...ownTraits, ...resolved.flatMap(dep => Array.isArray(dep.polityTraits) ? dep.polityTraits : [])]
  const traitIds = new Set<string>()
  if (pack.polityTraits !== undefined && !Array.isArray(pack.polityTraits))
    add('dtype', 'polityTraits', 'Expected a trait definition array')
  for (const [i, trait] of polityTraits.entries()) {
    if (typeof trait.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trait.id))
      add('required', `polityTraits[${i}].id`, 'Expected a stable trait ID')
    if (traitIds.has(trait.id))
      add('duplicate', `polityTraits[${i}].id`, 'Duplicate polity trait ID')
    traitIds.add(trait.id)
    if (!['power', 'governance', 'economy', 'territory'].includes(trait.dimension))
      add('range', `polityTraits[${i}].dimension`, 'Invalid polity trait dimension')
    if (trait.dimension === 'territory') {
      const sizes = trait.sizeClasses
      if (!Array.isArray(sizes) || !sizes.length || sizes.some(size => !['city-state', 'regional', 'kingdom', 'empire'].includes(size)) || new Set(sizes).size !== sizes.length)
        add('range', `polityTraits[${i}].sizeClasses`, 'Territory traits require nonempty unique supported size classes')
    }
    else if (trait.sizeClasses !== undefined) {
      add('range', `polityTraits[${i}].sizeClasses`, 'Size conditions are only supported for territory traits')
    }
    if (!nonempty(trait.displayNameKey) || !nonempty(trait.descriptionKey))
      add('required', `polityTraits[${i}]`, 'Trait name and description keys are required')
  }
  polities.forEach((polity, i) => {
    const path = `polities[${i}]`
    issues.push(...validatePolityTraitReferences(polity, path, polityTraits))
    if (!['republic', 'empire', 'dynastic-monarchy', 'federation', 'confederation', 'chiefdom', 'emirate', 'khanate', 'league', 'free-territory', 'kingdom', 'principality', 'theocracy', 'merchant-republic', 'city-state', 'sultanate', 'tribal-confederation', 'military-junta', 'protectorate', 'commune'].includes(polity.politicalForm))
      add('range', `${path}.politicalForm`, 'Invalid political form')
    if (!['centralized', 'parliamentary', 'presidential', 'federal-council', 'confederal-assembly', 'tribal-council', 'theocratic-hierarchy', 'merchant-council', 'military-command', 'rotating-delegation', 'chartered-administration'].includes(polity.governmentOrganization))
      add('range', `${path}.governmentOrganization`, 'Invalid government organization')
    if (!nonempty(polity.headOfStateTitle))
      add('required', `${path}.headOfStateTitle`, 'Head of state title is required')
    if (polity.headOfGovernmentTitle !== null && !nonempty(polity.headOfGovernmentTitle))
      add('required', `${path}.headOfGovernmentTitle`, 'Expected a title or null')
    if (polity.legislatureTitle !== null && !nonempty(polity.legislatureTitle))
      add('required', `${path}.legislatureTitle`, 'Expected a title or null')
    if (!['hereditary', 'elective', 'appointed', 'rotating', 'collective', 'mixed'].includes(polity.succession))
      add('range', `${path}.succession`, 'Invalid succession')
    numeric(polity.weight, `${path}.weight`)
  })
  pack.resources.forEach((r, i) => {
    if (!['mineral', 'biological', 'energy'].includes(r.category))
      add('range', `resources[${i}].category`, 'Invalid category')
  })
  pack.presets.forEach((p, i) => {
    for (const key of ['physicalRadiusKm', 'rotationPeriodHours', 'orbitalPeriodDays'] as const) {
      if (!Number.isFinite(p[key]) || p[key] <= 0)
        add('range', `presets[${i}].${key}`, 'Must be finite and positive')
    }
    numeric(p.axialTiltDegrees, `presets[${i}].axialTiltDegrees`, 180)
    if (!Number.isFinite(p.seaLevelDatumKm))
      add('range', `presets[${i}].seaLevelDatumKm`, 'Must be finite')
  })
  const locales = Object.values(pack.translations)
  if (!locales.length)
    add('required', 'translations', 'At least one locale required')
  for (const [locale, texts] of Object.entries(pack.translations)) {
    for (const key of [m.nameKey, ...definitions.map(d => d.displayNameKey), ...ownTraits.flatMap(t => [t.displayNameKey, t.descriptionKey])]) {
      if (!nonempty(texts[key] ?? ''))
        add('required', `translations.${locale}.${key}`, 'Missing localized text')
    }
  }
  return { valid: issues.length === 0, issues }
}
