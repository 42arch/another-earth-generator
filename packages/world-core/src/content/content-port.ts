/** `namespace:domain/name`. Pack validation, not world-core, checks the pattern. */
export type ContentId = `${string}:${string}/${string}`

/** Structural view of a content pack. world-data owns the real packs; world-core only reads these fields. */
export interface ContentPackView {
  readonly manifest: {
    readonly id: string
    readonly version: string
    readonly contentHash: string
    readonly dependencies: readonly { readonly id: string, readonly version: string }[]
  }
  readonly names: readonly { readonly id: string }[]
  readonly cultures: readonly { readonly id: string }[]
  readonly religions: readonly { readonly id: string }[]
  readonly governments: readonly { readonly id: string }[]
  readonly resources: readonly { readonly id: string }[]
  readonly presets: readonly { readonly id: string }[]
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
  validateContentPack: (pack: ContentPackView, resolved: readonly ContentPackView[]) => ContentValidationResult
}

export interface NamePoolView {
  readonly id: string
  readonly entries: readonly { readonly value: string, readonly weight: number }[]
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

/** Stable identity of the id/code pairs actually used to index an ecology artifact. */
export function ecologyVocabularySignature(vocabulary: EcologyVocabulary): string {
  const rows = [
    ...vocabulary.biomes.map(item => ['biome', item.id, item.code]),
    ...vocabulary.landCover.map(item => ['land-cover', item.id, item.code]),
  ]
  let hash = 0x811C9DC5
  const text = JSON.stringify(rows)
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `ecology-classes:${(hash >>> 0).toString(16).padStart(8, '0')}`
}
