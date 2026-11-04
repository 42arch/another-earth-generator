import type { ContentPack, ContentPackManifest } from './schemas/content'
import { validateContentPack } from './validation/validate-content-pack'

function hash(value: string): string {
  let h = 0x811C9DC5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `fnv1a32:${(h >>> 0).toString(16).padStart(8, '0')}`
}

function canonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

export function calculateContentHash(pack: Omit<ContentPack, 'manifest'> & { manifest: Omit<ContentPackManifest, 'contentHash'> | ContentPackManifest }): string {
  const manifest = { ...pack.manifest, contentHash: undefined }
  return hash(canonical({ manifest, names: pack.names, cultures: pack.cultures, religions: pack.religions, governments: pack.governments, resources: pack.resources, presets: pack.presets, translations: pack.translations }))
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
    for (const domain of ['names', 'cultures', 'religions', 'governments', 'resources', 'presets'] as const) {
      for (const entry of pack[domain]) {
        if (contentIds.has(entry.id))
          throw new Error(`Duplicate content ID: ${entry.id}`)
        contentIds.add(entry.id)
      }
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
