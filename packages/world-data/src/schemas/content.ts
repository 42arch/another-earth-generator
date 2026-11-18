import type { NamingStyle } from './naming-style'

export type ContentId = `${string}:${string}/${string}`
export interface ContentDefinition {
  readonly id: ContentId
  readonly displayNameKey: string
  readonly description?: string
  readonly tags: readonly string[]
}
export interface ContentPackManifest {
  readonly id: string
  readonly version: string
  readonly schemaVersion: 1
  readonly nameKey: string
  readonly contentHash: string
  readonly dependencies: readonly { readonly id: string, readonly version: string }[]
}
export interface NamePool extends ContentDefinition {
  readonly entries: readonly { readonly value: string, readonly weight: number }[]
}
export interface CultureArchetype extends ContentDefinition {
  readonly namingStyleId: ContentId
  readonly traits: readonly string[]
}
/** Candidate people identity; its biological or historical meaning is decided by world generation. */
export type PeopleArchetype = ContentDefinition
export interface ReligionArchetype extends ContentDefinition {
  readonly organization: 'decentralized' | 'hierarchical'
  readonly traits: readonly string[]
  /** Dimensionless, in [0, 1]. */
  readonly tolerance: number
  readonly spreadBias: number
  readonly weight: number
}
export interface GovernmentArchetype extends ContentDefinition {
  readonly governance: 'centralized' | 'distributed' | 'federated'
  readonly succession: 'hereditary' | 'elective' | 'appointed' | 'mixed'
  readonly weight: number
}
export type StatePoliticalForm
  = 'republic' | 'empire' | 'dynastic-monarchy' | 'federation' | 'confederation'
    | 'chiefdom' | 'emirate' | 'khanate' | 'league' | 'free-territory' | 'kingdom'
    | 'principality' | 'theocracy' | 'merchant-republic' | 'city-state' | 'sultanate'
    | 'tribal-confederation' | 'military-junta' | 'protectorate' | 'commune'
export type StateGovernmentOrganization
  = 'centralized' | 'parliamentary' | 'presidential' | 'federal-council' | 'confederal-assembly'
    | 'tribal-council' | 'theocratic-hierarchy' | 'merchant-council' | 'military-command'
    | 'rotating-delegation' | 'chartered-administration'
export type StateSuccession = 'hereditary' | 'elective' | 'appointed' | 'rotating' | 'collective' | 'mixed'
/** Country-level political entity template; this is not an instantiated world polity. */
export interface StateArchetype extends ContentDefinition {
  readonly politicalForm: StatePoliticalForm
  readonly governmentOrganization: StateGovernmentOrganization
  readonly headOfStateTitle: string
  readonly headOfGovernmentTitle: string | null
  readonly legislatureTitle: string | null
  readonly succession: StateSuccession
  readonly weight: number
}
export interface ResourceDefinition extends ContentDefinition {
  readonly category: 'mineral' | 'biological' | 'energy'
  readonly geologyTags: readonly string[]
}
/** Deliberately limited to parameters whose units are already defined. */
export interface WorldPreset extends ContentDefinition {
  readonly physicalRadiusKm: number
  readonly rotationPeriodHours: number
  readonly orbitalPeriodDays: number
  readonly axialTiltDegrees: number
  readonly seaLevelDatumKm: number
}
interface ContentPackBase {
  readonly names: readonly NamePool[]
  readonly religions: readonly ReligionArchetype[]
  readonly governments: readonly GovernmentArchetype[]
  readonly resources: readonly ResourceDefinition[]
  readonly presets: readonly WorldPreset[]
  /** Locale -> translation key -> nonempty text. Every locale must cover this pack's keys. */
  readonly translations: Readonly<Record<string, Readonly<Record<string, string>>>>
}
export interface ContentPackV1 extends ContentPackBase {
  readonly manifest: ContentPackManifest
  readonly cultures: readonly CultureArchetype[]
  readonly namingStyles: readonly NamingStyle[]
  readonly peoples: readonly PeopleArchetype[]
  readonly states: readonly StateArchetype[]
}
export type ContentPack = ContentPackV1
export type ContentPackHashInput
  = Omit<ContentPackV1, 'manifest'> & { readonly manifest: Omit<ContentPackManifest, 'contentHash'> & { readonly contentHash?: string } }

export interface ValidationIssue {
  readonly code: 'required' | 'version' | 'range' | 'length' | 'reference' | 'duplicate' | 'topology' | 'population' | 'dtype'
  readonly path: string
  readonly message: string
}
export interface ValidationResult {
  readonly valid: boolean
  readonly issues: readonly ValidationIssue[]
}
