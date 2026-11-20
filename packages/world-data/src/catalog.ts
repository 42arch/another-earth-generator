import type { ContentPack, ContentPackHashInput } from './schemas/content'
import { canonical, hash } from './content-hash'
import { validateContentPack } from './validation/validate-content-pack'

export function calculateContentHash(pack: ContentPackHashInput): string {
  const manifest = { ...pack.manifest, contentHash: undefined }
  const content = {
    manifest,
    names: pack.names,
    namingStyles: pack.namingStyles,
    cultures: pack.cultures,
    peoples: pack.peoples,
    polities: pack.polities,
    religions: pack.religions,
    resources: pack.resources,
    presets: pack.presets,
    translations: pack.translations,
  }
  return hash(canonical(content))
}

export function calculateContentSignature(packs: readonly ContentPack[]): string {
  return hash(JSON.stringify([...packs].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id)).map(pack => [pack.manifest.id, pack.manifest.version, pack.manifest.contentHash])))
}

export interface ContentCatalog {
  readonly packs: readonly ContentPack[]
  readonly contentSignature: string
  get: (id: string) => ContentPack | undefined
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

export function createContentCatalog(input: readonly ContentPack[]): ContentCatalog {
  const packs = input.map(pack => JSON.parse(JSON.stringify(pack)) as ContentPack)
  const byId = new Map<string, ContentPack>()
  for (const pack of packs) {
    if (byId.has(pack.manifest.id))
      throw new Error(`Duplicate content pack: ${pack.manifest.id}`)
    byId.set(pack.manifest.id, pack)
  }
  const contentIds = new Set<string>()
  for (const pack of packs) {
    const entries = [
      ...pack.names,
      ...pack.cultures,
      ...pack.religions,
      ...pack.resources,
      ...pack.presets,
      ...('namingStyles' in pack ? pack.namingStyles : []),
      ...('peoples' in pack ? pack.peoples : []),
      ...('polities' in pack ? pack.polities : []),
    ]
    for (const entry of entries) {
      if (contentIds.has(entry.id))
        throw new Error(`Duplicate content ID: ${entry.id}`)
      contentIds.add(entry.id)
    }
  }
  for (const pack of packs) {
    const result = validateContentPack(pack, packs.filter(other => other !== pack))
    if (!result.valid)
      throw new Error(`Invalid content pack ${pack.manifest.id}: ${result.issues[0]?.path}`)
    if (pack.manifest.contentHash !== calculateContentHash(pack))
      throw new Error(`Content hash mismatch: ${pack.manifest.id}`)
  }
  const ordered = packs.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))
  const signature = calculateContentSignature(ordered)
  ordered.forEach(deepFreeze)
  return Object.freeze({ packs: Object.freeze(ordered), contentSignature: signature, get: (id: string) => byId.get(id) })
}
