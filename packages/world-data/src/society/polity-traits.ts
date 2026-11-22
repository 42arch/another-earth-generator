import type { PolityTraitDefinition, ValidationIssue } from '../schemas/content'

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Shared by the author-document parser and resolved content-pack validation. */
export function validatePolityTraitReferences(
  polity: { readonly allowedSizeClasses?: unknown, readonly requiredTraits?: unknown, readonly traitAffinities?: unknown },
  path: string,
  definitions?: readonly PolityTraitDefinition[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (code: ValidationIssue['code'], field: string, message: string) => issues.push({ code, path: field, message })
  if (polity.allowedSizeClasses !== undefined) {
    const sizes = polity.allowedSizeClasses
    if (!Array.isArray(sizes) || !sizes.length || sizes.some(size => !['city-state', 'regional', 'kingdom', 'empire'].includes(size)) || new Set(sizes).size !== sizes.length)
      add('range', `${path}.allowedSizeClasses`, 'Expected nonempty unique supported size classes')
  }
  const byId = definitions ? new Map(definitions.map(d => [d.id, d])) : undefined
  const references = (value: unknown, field: string, nonempty = false): string[] => {
    if (!Array.isArray(value)) {
      add('dtype', field, 'Expected a trait ID array')
      return []
    }
    if (nonempty && !value.length)
      add('required', field, 'At least one trait is required')
    const ids: string[] = []
    for (const [i, id] of value.entries()) {
      if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))
        add('reference', `${field}[${i}]`, 'Expected a stable trait ID')
      else {
        if (ids.includes(id))
          add('duplicate', `${field}[${i}]`, 'Duplicate trait reference')
        if (byId && !byId.has(id))
          add('reference', `${field}[${i}]`, `Unresolved polity trait ${id}`)
        ids.push(id)
      }
    }
    return ids
  }
  const orthogonal = (ids: readonly string[], field: string) => {
    const dimensions = new Set<string>()
    for (const id of new Set(ids)) {
      const dimension = byId?.get(id)?.dimension
      if (dimension && dimensions.has(dimension))
        add('range', field, `Conflicting traits in dimension ${dimension}`)
      if (dimension)
        dimensions.add(dimension)
    }
  }
  const required = polity.requiredTraits === undefined ? [] : references(polity.requiredTraits, `${path}.requiredTraits`)
  orthogonal(required, `${path}.requiredTraits`)
  if (polity.traitAffinities !== undefined) {
    if (!Array.isArray(polity.traitAffinities)) {
      add('dtype', `${path}.traitAffinities`, 'Expected an affinity array')
    }
    else {
      for (const [i, affinity] of polity.traitAffinities.entries()) {
        const field = `${path}.traitAffinities[${i}]`
        if (!record(affinity)) {
          add('dtype', field, 'Expected an affinity object')
          continue
        }
        for (const key of Object.keys(affinity)) {
          if (!['traits', 'excludedTraits', 'sizeClasses', 'weight'].includes(key))
            add('range', `${field}.${key}`, 'Unknown affinity field')
        }
        const traits = references(affinity.traits, `${field}.traits`, true)
        const excluded = affinity.excludedTraits === undefined ? [] : references(affinity.excludedTraits, `${field}.excludedTraits`)
        orthogonal([...required, ...traits], `${field}.traits`)
        if (excluded.some(id => required.includes(id) || traits.includes(id)))
          add('range', `${field}.excludedTraits`, 'Required and excluded traits overlap')
        if (typeof affinity.weight !== 'number' || !Number.isFinite(affinity.weight) || affinity.weight <= 0)
          add('range', `${field}.weight`, 'Affinity weight must be finite and positive')
        if (affinity.sizeClasses !== undefined) {
          const sizes = affinity.sizeClasses
          if (!Array.isArray(sizes) || !sizes.length || sizes.some(size => !['city-state', 'regional', 'kingdom', 'empire'].includes(size)) || new Set(sizes).size !== sizes.length)
            add('range', `${field}.sizeClasses`, 'Expected unique supported size classes')
        }
      }
    }
  }
  return issues
}
