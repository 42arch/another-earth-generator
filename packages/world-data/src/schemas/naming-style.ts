import type { ContentId, ValidationIssue } from './content'

export interface NamingEntry {
  readonly value: string
  readonly weight: number
}

export type NamingPart = { readonly pool: string, readonly literal?: never } | { readonly literal: string, readonly pool?: never }

export interface NamingTemplate {
  readonly weight: number
  readonly parts: readonly NamingPart[]
}

/** One self-contained author document. Array order is part of its generation semantics. */
export interface NamingStyle {
  readonly format: 'another-earth/naming-style'
  readonly schemaVersion: 2
  readonly id: ContentId
  /** Name construction tradition, such as `western` or `chinese`. */
  readonly style: string
  /** BCP 47 language tag for the name values, such as `zh-CN` or `en`. */
  readonly language: string
  readonly version: string
  readonly displayName: Readonly<Record<string, string>>
  readonly author?: string
  readonly source?: string
  readonly pools: Readonly<Record<string, readonly NamingEntry[]>>
  readonly rules: Readonly<Record<string, readonly NamingTemplate[]>>
}

export type NamingStyleParseResult
  = { readonly valid: true, readonly value: NamingStyle, readonly issues: readonly [] }
    | { readonly valid: false, readonly issues: readonly ValidationIssue[] }
