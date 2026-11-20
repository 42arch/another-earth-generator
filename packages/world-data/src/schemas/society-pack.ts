import type { ContentId, ContentPackManifest, CultureArchetype, PeopleArchetype, PolityArchetype, ReligionArchetype, ValidationIssue } from './content'

interface SocietyDefinitionBase {
  readonly id: ContentId
  readonly displayName: string
  readonly description: string
  readonly tags: readonly string[]
}

export type SocietyPeopleDefinition = SocietyDefinitionBase & Omit<PeopleArchetype, 'id' | 'displayNameKey' | 'description' | 'tags'>
export type SocietyCultureDefinition = SocietyDefinitionBase & Omit<CultureArchetype, 'id' | 'displayNameKey' | 'description' | 'tags'>
export type SocietyPolityDefinition = SocietyDefinitionBase & Omit<PolityArchetype, 'id' | 'displayNameKey' | 'description' | 'tags'>
export type SocietyReligionDefinition = SocietyDefinitionBase & Omit<ReligionArchetype, 'id' | 'displayNameKey' | 'description' | 'tags'>

interface SocietyPackBase {
  readonly format: 'another-earth/society-pack'
  /** Authoring format version, independent of the resulting content-pack version. */
  readonly schemaVersion: 1
  readonly id: string
  readonly version: string
  readonly language: string
  readonly displayName: string
  readonly dependencies: ContentPackManifest['dependencies']
}

export type SocietyPackDocument
  = (SocietyPackBase & { readonly peoples: readonly SocietyPeopleDefinition[], readonly cultures?: never, readonly polities?: never, readonly religions?: never })
    | (SocietyPackBase & { readonly cultures: readonly SocietyCultureDefinition[], readonly peoples?: never, readonly polities?: never, readonly religions?: never })
    | (SocietyPackBase & { readonly polities: readonly SocietyPolityDefinition[], readonly peoples?: never, readonly cultures?: never, readonly religions?: never })
    | (SocietyPackBase & { readonly religions: readonly SocietyReligionDefinition[], readonly peoples?: never, readonly cultures?: never, readonly polities?: never })

export type SocietyPackParseResult
  = { readonly valid: true, readonly value: SocietyPackDocument, readonly issues: readonly [] }
    | { readonly valid: false, readonly issues: readonly ValidationIssue[] }
