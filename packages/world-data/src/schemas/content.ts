export type ContentId = `${string}:${string}/${string}`
export interface ContentDefinition {
  readonly id: ContentId
  readonly displayNameKey: string
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
  readonly namePoolId: ContentId
  readonly traits: readonly string[]
}
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
export interface ContentPack {
  readonly manifest: ContentPackManifest
  readonly names: readonly NamePool[]
  readonly cultures: readonly CultureArchetype[]
  readonly religions: readonly ReligionArchetype[]
  readonly governments: readonly GovernmentArchetype[]
  readonly resources: readonly ResourceDefinition[]
  readonly presets: readonly WorldPreset[]
  /** Locale -> translation key -> nonempty text. Every locale must cover this pack's keys. */
  readonly translations: Readonly<Record<string, Readonly<Record<string, string>>>>
}
export interface ValidationIssue {
  readonly code: 'required' | 'version' | 'range' | 'length' | 'reference' | 'duplicate' | 'topology' | 'population' | 'dtype'
  readonly path: string
  readonly message: string
}
export interface ValidationResult {
  readonly valid: boolean
  readonly issues: readonly ValidationIssue[]
}
