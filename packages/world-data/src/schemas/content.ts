import type { NamingStyle } from './naming-style'

export type ContentId = `${string}:${string}/${string}`
export interface ContentDefinition {
  readonly id: ContentId
  readonly displayNameKey: string
  readonly tags: readonly string[]
}
export interface ContentPackManifest<SchemaVersion extends 1 | 2 = 1 | 2> {
  readonly id: string
  readonly version: string
  readonly schemaVersion: SchemaVersion
  readonly nameKey: string
  readonly contentHash: string
  readonly dependencies: readonly { readonly id: string, readonly version: string }[]
}
export interface NamePool extends ContentDefinition {
  readonly entries: readonly { readonly value: string, readonly weight: number }[]
}
export interface CultureArchetypeV1 extends ContentDefinition {
  readonly namePoolId: ContentId
  readonly traits: readonly string[]
}
export interface CultureArchetypeV2 extends ContentDefinition {
  readonly namingStyleId: ContentId
  readonly traits: readonly string[]
}
export type CultureArchetype = CultureArchetypeV1 | CultureArchetypeV2
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
  readonly manifest: ContentPackManifest<1>
  readonly cultures: readonly CultureArchetypeV1[]
}
export interface ContentPackV2 extends ContentPackBase {
  readonly manifest: ContentPackManifest<2>
  readonly cultures: readonly CultureArchetypeV2[]
  readonly namingStyles: readonly NamingStyle[]
}
export type ContentPack = ContentPackV1 | ContentPackV2
export type ContentPackHashInput
  = (Omit<ContentPackV1, 'manifest'> & { readonly manifest: Omit<ContentPackManifest<1>, 'contentHash'> & { readonly contentHash?: string } })
    | (Omit<ContentPackV2, 'manifest'> & { readonly manifest: Omit<ContentPackManifest<2>, 'contentHash'> & { readonly contentHash?: string } })

export interface ValidationIssue {
  readonly code: 'required' | 'version' | 'range' | 'length' | 'reference' | 'duplicate' | 'topology' | 'population' | 'dtype'
  readonly path: string
  readonly message: string
}
export interface ValidationResult {
  readonly valid: boolean
  readonly issues: readonly ValidationIssue[]
}
