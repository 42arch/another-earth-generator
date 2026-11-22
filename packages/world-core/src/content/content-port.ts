/** `namespace:domain/name`. Pack validation, not world-core, checks the pattern. */
export type ContentId = `${string}:${string}/${string}`

export interface PeopleArchetypeView {
  readonly id: string
  readonly displayNameKey: string
  readonly description?: string
  readonly tags: readonly string[]
}

export interface CultureArchetypeView {
  readonly id: string
  readonly displayNameKey: string
  readonly description?: string
  readonly tags: readonly string[]
  readonly namingStyleId: ContentId
  readonly traits: readonly string[]
}

export interface ReligionArchetypeView {
  readonly id: string
  readonly displayNameKey: string
  readonly description?: string
  readonly tags: readonly string[]
  readonly organization: 'decentralized' | 'hierarchical'
  readonly traits: readonly string[]
  readonly tolerance: number
  readonly spreadBias: number
  readonly weight: number
}

export type PolityPoliticalForm
  = 'republic' | 'empire' | 'dynastic-monarchy' | 'federation' | 'confederation'
    | 'chiefdom' | 'emirate' | 'khanate' | 'league' | 'free-territory' | 'kingdom'
    | 'principality' | 'theocracy' | 'merchant-republic' | 'city-state' | 'sultanate'
    | 'tribal-confederation' | 'military-junta' | 'protectorate' | 'commune'

export type PolityGovernmentOrganization
  = 'centralized' | 'parliamentary' | 'presidential' | 'federal-council' | 'confederal-assembly'
    | 'tribal-council' | 'theocratic-hierarchy' | 'merchant-council' | 'military-command'
    | 'rotating-delegation' | 'chartered-administration'

export type PolitySuccession = 'hereditary' | 'elective' | 'appointed' | 'rotating' | 'collective' | 'mixed'

export type PolityTraitDimension = 'power' | 'governance' | 'economy' | 'territory'
/** Stable algorithm-facing ID, independent of the language of polity candidates. */
export interface PolityTraitDefinitionView {
  readonly id: string
  readonly dimension: PolityTraitDimension
  /** Territory traits are derived after expansion from these eligible size classes. */
  readonly sizeClasses?: readonly ('city-state' | 'regional' | 'kingdom' | 'empire')[]
  readonly displayNameKey: string
  readonly descriptionKey: string
}
/** Matching entries multiply in document order; all listed traits must be present. */
export interface PolityTraitAffinityView {
  readonly traits: readonly string[]
  readonly excludedTraits?: readonly string[]
  readonly sizeClasses?: readonly ('city-state' | 'regional' | 'kingdom' | 'empire')[]
  readonly weight: number
}

export interface PolityArchetypeView {
  readonly id: string
  readonly displayNameKey: string
  readonly description?: string
  readonly tags: readonly string[]
  /** Hard territory-size eligibility; omitted means unrestricted. */
  readonly allowedSizeClasses?: readonly ('city-state' | 'regional' | 'kingdom' | 'empire')[]
  readonly requiredTraits?: readonly string[]
  readonly traitAffinities?: readonly PolityTraitAffinityView[]
  readonly politicalForm: PolityPoliticalForm
  readonly governmentOrganization: PolityGovernmentOrganization
  readonly headOfStateTitle: string
  readonly headOfGovernmentTitle: string | null
  readonly legislatureTitle: string | null
  readonly succession: PolitySuccession
  readonly weight: number
}

export interface ResourceDefinitionView {
  readonly id: string
  readonly displayNameKey: string
  readonly description?: string
  readonly tags: readonly string[]
  readonly category: 'mineral' | 'biological' | 'energy'
  readonly geologyTags: readonly string[]
}

/** Structural view of a content pack. world-data owns the real packs; world-core only reads these fields. */
export interface ContentPackView {
  readonly manifest: {
    readonly id: string
    readonly version: string
    readonly contentHash: string
    readonly dependencies: readonly { readonly id: string, readonly version: string }[]
  }
  readonly names: readonly { readonly id: string }[]
  readonly namingStyles?: readonly NamingStyleView[]
  readonly peoples: readonly PeopleArchetypeView[]
  readonly cultures: readonly CultureArchetypeView[]
  readonly religions: readonly ReligionArchetypeView[]
  readonly polityTraits?: readonly PolityTraitDefinitionView[]
  readonly polities: readonly PolityArchetypeView[]
  readonly resources: readonly ResourceDefinitionView[]
  readonly presets: readonly { readonly id: string }[]
  readonly translations?: Readonly<Record<string, Readonly<Record<string, string>>>>
}

export interface ContentValidationIssue {
  readonly code: 'required' | 'version' | 'range' | 'length' | 'reference' | 'duplicate' | 'topology' | 'population' | 'dtype'
  readonly path: string
  readonly message: string
}

export interface ContentValidationResult {
  readonly valid: boolean
  readonly issues: readonly ContentValidationIssue[]
}

/** Supplied by the caller. Hashing and pack rules stay in world-data. */
export interface ContentPort {
  calculateContentHash: (pack: ContentPackView) => string
  calculateContentSignature: (packs: readonly ContentPackView[]) => string
  calculateNamingStyleSignature: (style: NamingStyleView) => string
  validateContentPack: (pack: ContentPackView, resolved: readonly ContentPackView[]) => ContentValidationResult
}

export interface NamePoolView {
  readonly id: string
  readonly entries: readonly { readonly value: string, readonly weight: number }[]
}

export type NamingPartView = { readonly pool: string, readonly literal?: never } | { readonly literal: string, readonly pool?: never }

export interface NamingRuleView {
  readonly weight: number
  readonly parts: readonly NamingPartView[]
}

export interface NamingStyleView {
  readonly format: 'another-earth/naming-style'
  readonly schemaVersion: 2
  readonly id: string
  readonly style: string
  readonly language: string
  readonly version: string
  readonly displayName: Readonly<Record<string, string>>
  readonly author?: string
  readonly source?: string
  readonly pools: Readonly<Record<string, readonly { readonly value: string, readonly weight: number }[]>>
  readonly rules: Readonly<Record<string, readonly NamingRuleView[]>>
}

export interface EcologyClassView {
  readonly id: string
  readonly code: string
  readonly nameZh: string
}

export interface EcologyVocabulary {
  readonly biomes: readonly EcologyClassView[]
  readonly landCover: readonly EcologyClassView[]
}

export interface CivilizationContentBundle {
  readonly peoples: readonly PeopleArchetypeView[]
  readonly cultures: readonly CultureArchetypeView[]
  readonly religions: readonly ReligionArchetypeView[]
  readonly polityTraits?: readonly PolityTraitDefinitionView[]
  readonly polities: readonly PolityArchetypeView[]
  readonly namingStyles: readonly NamingStyleView[]
  readonly translations: Readonly<Record<string, Readonly<Record<string, string>>>>
}

function fnv1a32(text: string): string {
  let hash = 0x811C9DC5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Stable identity of the id/code pairs actually used to index an ecology artifact. */
export function ecologyVocabularySignature(vocabulary: EcologyVocabulary): string {
  const rows = [
    ...vocabulary.biomes.map(item => ['biome', item.id, item.code]),
    ...vocabulary.landCover.map(item => ['land-cover', item.id, item.code]),
  ]
  return `ecology-classes:${fnv1a32(JSON.stringify(rows))}`
}

/** Stable identity of natural resource definitions consumed by resource-potential stage. */
export function resourceDefinitionsSignature(resources: readonly ResourceDefinitionView[]): string {
  const rows = [...resources]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(item => [item.id, item.category, [...item.geologyTags].sort()])
  return `resource-definitions:${fnv1a32(JSON.stringify(rows))}`
}

/** Stable identity of civilization content archetypes and naming styles consumed by society stages. */
export function civilizationContentSignature(bundle: CivilizationContentBundle): string {
  const payload = {
    peoples: [...bundle.peoples].sort((a, b) => a.id.localeCompare(b.id)).map(p => [p.id, p.tags]),
    cultures: [...bundle.cultures].sort((a, b) => a.id.localeCompare(b.id)).map(c => [c.id, c.namingStyleId, c.traits]),
    religions: [...bundle.religions].sort((a, b) => a.id.localeCompare(b.id)).map(r => [r.id, r.organization, r.tolerance, r.spreadBias, r.weight, r.traits]),
    polities: [...bundle.polities].sort((a, b) => a.id.localeCompare(b.id)).map(s => [
      s.id, s.politicalForm, s.governmentOrganization, s.headOfStateTitle, s.headOfGovernmentTitle, s.legislatureTitle, s.succession, s.weight,
      s.allowedSizeClasses ? [...s.allowedSizeClasses].sort() : null,
      [...(s.requiredTraits ?? [])].sort(),
      (s.traitAffinities ?? []).map(rule => [[...rule.traits].sort(), [...(rule.excludedTraits ?? [])].sort(), rule.sizeClasses ? [...rule.sizeClasses].sort() : null, rule.weight]),
    ]),
    polityTraits: [...(bundle.polityTraits ?? [])].sort((a, b) => a.id.localeCompare(b.id)).map(t => [t.id, t.dimension, t.sizeClasses ? [...t.sizeClasses].sort() : null]),
    namingStyles: [...bundle.namingStyles].sort((a, b) => a.id.localeCompare(b.id)).map(n => [n.id, n.version, n.language, n.pools, n.rules]),
  }
  return `civilization-content:${fnv1a32(JSON.stringify(payload))}`
}
