import type { ContentDefinition, ContentPack, ValidationIssue, ValidationResult } from '../schemas/content'

/** Validates typed data; this is not a parser for untrusted JSON. Dependencies must be resolved first. */
export function validateContentPack(pack: ContentPack, dependencies: readonly ContentPack[] = []): ValidationResult {
  const issues: ValidationIssue[] = []
  const add = (code: ValidationIssue['code'], path: string, message: string) => issues.push({ code, path, message })
  const nonempty = (v: string) => typeof v === 'string' && v.trim().length > 0
  const version = (v: string) => /^\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?$/i.test(v)
  const m = pack.manifest
  if (m.schemaVersion !== 1 || !version(m.version))
    add('version', 'manifest', 'Unsupported schema or invalid semantic version')
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
  const domains = ['names', 'cultures', 'religions', 'governments', 'resources', 'presets'] as const
  const definitions: ContentDefinition[] = domains.flatMap(key => [...pack[key]])
  const ids = new Set<string>()
  for (const [i, d] of definitions.entries()) {
    if (!/^[a-z0-9-]+:[a-z0-9-]+\/[a-z0-9-]+$/.test(d.id))
      add('required', `definitions[${i}].id`, 'Expected namespace:domain/name')
    if (ids.has(d.id))
      add('duplicate', `definitions[${i}].id`, 'Duplicate content ID')
    ids.add(d.id)
    if (!nonempty(d.displayNameKey) || d.tags.some(t => !nonempty(t)))
      add('required', `definitions[${i}]`, 'Invalid name key or tag')
  }
  const resolved = dependencies.filter(p => m.dependencies.some(d => d.id === p.manifest.id && d.version === p.manifest.version))
  for (const dep of resolved) {
    for (const key of domains) {
      for (const d of dep[key]) {
        if (ids.has(d.id))
          add('duplicate', 'dependencies', `Conflicting content ID ${d.id}`)
        ids.add(d.id)
      }
    }
  }
  const names = new Set([...pack.names, ...resolved.flatMap(p => [...p.names])].map(d => d.id))
  for (const [i, c] of pack.cultures.entries()) {
    if (!names.has(c.namePoolId))
      add('reference', `cultures[${i}].namePoolId`, 'Missing name pool')
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
  pack.governments.forEach((g, i) => {
    numeric(g.weight, `governments[${i}].weight`)
    if (!['centralized', 'distributed', 'federated'].includes(g.governance) || !['hereditary', 'elective', 'appointed', 'mixed'].includes(g.succession))
      add('range', `governments[${i}]`, 'Invalid government')
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
    for (const key of [m.nameKey, ...definitions.map(d => d.displayNameKey)]) {
      if (!nonempty(texts[key] ?? ''))
        add('required', `translations.${locale}.${key}`, 'Missing localized text')
    }
  }
  return { valid: issues.length === 0, issues }
}
