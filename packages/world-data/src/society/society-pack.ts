import type { ContentPack, ContentPackV1 } from '../schemas/content'
import type { SocietyPackDocument, SocietyPackParseResult } from '../schemas/society-pack'
import { calculateContentHash } from '../catalog'
import { canonical } from '../content-hash'
import { validateContentPack } from '../validation/validate-content-pack'
import { parseSocietyPack } from './parse-society-pack'

export function decodeSocietyPackJson(text: string): SocietyPackParseResult {
  return decodeJson(text, parseSocietyPack, message => ({ valid: false, issues: [{ code: 'dtype', path: '$', message }] }), 'Invalid society pack JSON')
}

function decodeJson<T>(text: string, parse: (value: unknown) => T, invalid: (message: string) => T, message: string): T {
  let value: unknown
  try {
    value = JSON.parse(text)
  }
  catch {
    return invalid(message)
  }
  return parse(value)
}

function requireDocument(value: unknown): SocietyPackDocument {
  const parsed = parseSocietyPack(value)
  if (!parsed.valid)
    throw new TypeError(`Invalid society pack at ${parsed.issues[0].path}: ${parsed.issues[0].message}`)
  return parsed.value
}

function encodeJson(value: unknown): string {
  return `${JSON.stringify(JSON.parse(canonical(value)), null, 2)}\n`
}

function displayNameKeyFor(id: string): string {
  return `society.${id.toLowerCase().replace(/[^a-z0-9]+/g, '.')}.display-name`
}

function addDisplayNameKey<T extends { readonly id: string, readonly displayName: string }>(definition: T) {
  const content = { ...definition } as Record<string, unknown>
  delete content.displayName
  content.displayNameKey = displayNameKeyFor(definition.id)
  return content as Omit<T, 'displayName'> & { readonly displayNameKey: string }
}

function contentPackBase(
  source: SocietyPackDocument,
  definitions: readonly { readonly id: string, readonly displayName: string }[],
) {
  const nameKey = displayNameKeyFor(source.id)
  const texts: Record<string, string> = { [nameKey]: source.displayName }
  for (const definition of definitions)
    texts[displayNameKeyFor(definition.id)] = definition.displayName
  const translations = { [source.language]: texts }
  return {
    manifest: { id: source.id, version: source.version, nameKey, contentHash: '', dependencies: source.dependencies },
    names: [],
    namingStyles: [],
    cultures: [],
    peoples: [],
    polities: [],
    religions: [],
    resources: [],
    presets: [],
    translations,
  }
}

export function encodeSocietyPackJson(document: SocietyPackDocument): string {
  return encodeJson(requireDocument(document))
}

/** Create one complete language-specific content pack from its author document. */
export function createSocietyPack(document: SocietyPackDocument, dependencies: readonly ContentPack[] = []): ContentPackV1 {
  const source = requireDocument(document)
  let pack: ContentPackV1
  if (source.peoples) {
    const base = contentPackBase(source, source.peoples)
    pack = { ...base, manifest: { ...base.manifest, schemaVersion: 1 }, peoples: source.peoples.map(addDisplayNameKey) }
  }
  else if (source.cultures) {
    const base = contentPackBase(source, source.cultures)
    pack = { ...base, manifest: { ...base.manifest, schemaVersion: 1 }, cultures: source.cultures.map(addDisplayNameKey) }
  }
  else if (source.polities) {
    const base = contentPackBase(source, source.polities)
    pack = { ...base, manifest: { ...base.manifest, schemaVersion: 1 }, polities: source.polities.map(addDisplayNameKey) }
  }
  else {
    const base = contentPackBase(source, source.religions)
    pack = { ...base, manifest: { ...base.manifest, schemaVersion: 1 }, religions: source.religions.map(addDisplayNameKey) }
  }
  const signed = { ...pack, manifest: { ...pack.manifest, contentHash: calculateContentHash(pack) } } as ContentPackV1
  const validation = validateContentPack(signed, dependencies)
  if (!validation.valid)
    throw new TypeError(`Invalid society pack at ${validation.issues[0].path}: ${validation.issues[0].message}`)
  return signed
}

/** Export only packs that the author format can represent without dropping definitions. */
export function societyPackDocumentFromPack(pack: ContentPack, dependencies: readonly ContentPack[] = []): SocietyPackDocument {
  const fields = ['manifest', 'names', 'namingStyles', 'cultures', 'peoples', 'polities', 'religions', 'resources', 'presets', 'translations']
  const manifestFields = ['id', 'version', 'schemaVersion', 'nameKey', 'contentHash', 'dependencies']
  if (Object.keys(pack).some(key => !fields.includes(key)) || Object.keys(pack.manifest).some(key => !manifestFields.includes(key)))
    throw new TypeError('Content pack cannot be represented as a society document')
  const entries = {
    peoples: pack.peoples,
    cultures: pack.cultures,
    polities: pack.polities,
    religions: pack.religions,
  }
  const active = (Object.keys(entries) as (keyof typeof entries)[]).filter(domain => entries[domain].length > 0)
  if (active.length !== 1 || pack.names.length || pack.namingStyles.length
    || pack.resources.length || pack.presets.length || pack.polityTraits?.length
    || pack.manifest.schemaVersion !== 1) {
    throw new TypeError('Content pack cannot be represented as a society document')
  }
  if (calculateContentHash(pack) !== pack.manifest.contentHash)
    throw new TypeError('Content pack hash mismatch')
  const validation = validateContentPack(pack, dependencies)
  if (!validation.valid)
    throw new TypeError(`Invalid society pack at ${validation.issues[0].path}: ${validation.issues[0].message}`)
  const locales = Object.keys(pack.translations)
  if (locales.length !== 1)
    throw new TypeError('Society pack must contain exactly one language')
  const language = locales[0]
  const domain = active[0]
  if (!language || !domain)
    throw new TypeError('Content pack cannot be represented without a language and definition domain')
  const texts = pack.translations[language]
  if (!texts)
    throw new TypeError('Content pack cannot be represented without language text')
  const definitions = entries[domain].map((definition) => {
    const { displayNameKey, ...rest } = definition
    const displayName = texts[displayNameKey]
    if (!displayName || !definition.description)
      throw new TypeError('Content pack cannot be represented without localized names and descriptions')
    return { ...rest, displayName }
  })
  const displayName = texts[pack.manifest.nameKey]
  if (!displayName)
    throw new TypeError('Content pack cannot be represented without a localized pack name')
  return requireDocument({
    format: 'another-earth/society-pack',
    schemaVersion: 1,
    id: pack.manifest.id,
    version: pack.manifest.version,
    language,
    displayName,
    dependencies: pack.manifest.dependencies,
    [domain]: definitions,
  })
}
