import type { ContentPackV1, ContentPackV2, NamingStyle } from '../index'
import { describe, expect, it } from 'vitest'
import { calculateContentHash, calculateNamingStyleSignature, createContentCatalog, createNamingStylePack, loadBuiltinCatalog, validateContentPack } from '../index'

function style(id: NamingStyle['id'] = 'test:naming-style/western-zh-cn', language = 'zh-CN'): NamingStyle {
  return {
    format: 'another-earth/naming-style', schemaVersion: 2, id, style: 'western', language, version: '1.0.0',
    displayName: { en: 'Example' },
    pools: { whole: [{ value: '青岚', weight: 1 }] },
    rules: { continent: [{ weight: 1, parts: [{ pool: 'whole' }] }] },
  }
}

function culturePack(dependency: ContentPackV2, namingStyleId = dependency.namingStyles[0].id): ContentPackV2 {
  const pack: ContentPackV2 = {
    manifest: { id: 'cultures', version: '1.0.0', schemaVersion: 2, nameKey: 'pack', contentHash: '', dependencies: [{ id: dependency.manifest.id, version: dependency.manifest.version }] },
    names: [], namingStyles: [],
    cultures: [{ id: 'test:culture/first', displayNameKey: 'culture', tags: [], traits: [], namingStyleId }],
    religions: [], governments: [], resources: [], presets: [],
    translations: { en: { pack: 'Cultures', culture: 'First' } },
  }
  return { ...pack, manifest: { ...pack.manifest, contentHash: calculateContentHash(pack) } }
}

describe('naming styles in content packs', () => {
  it('combines independent styles and shared cultural references without changing builtin packs', () => {
    const chinese = createNamingStylePack(style())
    const western = createNamingStylePack(style('test:naming-style/western-en', 'en'))
    const firstCulture = culturePack(chinese)
    const cultures = { ...firstCulture, cultures: [...firstCulture.cultures, { ...firstCulture.cultures[0], id: 'test:culture/second' as const }] }
    const signedCultures = { ...cultures, manifest: { ...cultures.manifest, contentHash: calculateContentHash(cultures) } }
    const inputs = [...loadBuiltinCatalog().packs, chinese, western, signedCultures]
    const catalog = createContentCatalog(inputs)
    expect(catalog.contentSignature).toBe(createContentCatalog([...inputs].reverse()).contentSignature)
    expect(catalog.get(chinese.manifest.id)).toEqual(chinese)
    const stored = catalog.get(chinese.manifest.id) as ContentPackV2
    expect(stored.namingStyles[0]).toEqual(style())
    expect(Object.isFrozen(stored.namingStyles[0].pools.whole)).toBe(true)
    expect(Object.isFrozen(chinese.namingStyles[0].pools.whole)).toBe(false)
    expect(loadBuiltinCatalog().get('core')?.manifest.schemaVersion).toBe(1)
    expect(loadBuiltinCatalog().get('geography-zh')).toBeUndefined()
  })

  it('requires an exact direct dependency and a naming-style reference', () => {
    const names = createNamingStylePack(style())
    const cultures = culturePack(names)
    expect(validateContentPack(cultures, [names]).valid).toBe(true)
    expect(validateContentPack(cultures).valid).toBe(false)
    expect(validateContentPack({ ...cultures, manifest: { ...cultures.manifest, dependencies: [] } }, [names]).valid).toBe(false)
    expect(validateContentPack({ ...cultures, manifest: { ...cultures.manifest, dependencies: [{ id: names.manifest.id, version: '2.0.0' }] } }, [names]).valid).toBe(false)
    const wrongReference = culturePack(names, 'core:names/basic')
    expect(validateContentPack(wrongReference, [names, ...loadBuiltinCatalog().packs]).issues.some(issue => issue.path.endsWith('namingStyleId'))).toBe(true)
  })

  it('rejects duplicate styles across different packs and legacy content domains', () => {
    const first = createNamingStylePack(style())
    const duplicate = { ...first, manifest: { ...first.manifest, id: 'another-pack' } }
    duplicate.manifest.contentHash = calculateContentHash(duplicate)
    expect(() => createContentCatalog([first, duplicate])).toThrow('Duplicate content ID')
    const collision = { ...first, names: [{ id: first.namingStyles[0].id, displayNameKey: first.manifest.nameKey, tags: [], entries: [{ value: 'Other', weight: 1 }] }] }
    collision.manifest = { ...collision.manifest, contentHash: calculateContentHash(collision) }
    expect(() => createContentCatalog([collision])).toThrow('Duplicate content ID')
  })

  it('includes style rules and metadata in v2 pack hashes', () => {
    const original = createNamingStylePack(style())
    const changed = { ...original, namingStyles: [{ ...style(), rules: { continent: [{ weight: 1, parts: [{ literal: 'Another' }] }] } }] }
    expect(calculateContentHash(changed)).not.toBe(original.manifest.contentHash)
    expect(() => createContentCatalog([changed])).toThrow('Content hash mismatch')
    const credited = { ...style(), author: 'An author' }
    expect(createNamingStylePack(credited).manifest.contentHash).not.toBe(original.manifest.contentHash)
    expect(calculateNamingStyleSignature(credited)).toBe(calculateNamingStyleSignature(style()))
  })

  it('validates styles even when callers construct a typed pack directly', () => {
    const pack = createNamingStylePack(style())
    const invalid = { ...pack, namingStyles: [{ ...style(), rules: { continent: [{ weight: 1, parts: [{ pool: 'missing' }] }] } }] }
    expect(validateContentPack(invalid).issues.some(issue => issue.path.startsWith('namingStyles[0].rules.continent'))).toBe(true)
  })

  it('preserves the v1 hash wire representation', () => {
    const legacy: ContentPackV1 = {
      manifest: { id: 'legacy', version: '1.0.0', schemaVersion: 1, nameKey: 'pack', contentHash: '', dependencies: [] },
      names: [], cultures: [], religions: [], governments: [], resources: [], presets: [], translations: { en: { pack: 'Legacy' } },
    }
    // Frozen pre-v2 canonical wire format; compute FNV-1a independently with bigint.
    const wire = '{"cultures":[],"governments":[],"manifest":{"dependencies":[],"id":"legacy","nameKey":"pack","schemaVersion":1,"version":"1.0.0"},"names":[],"presets":[],"religions":[],"resources":[],"translations":{"en":{"pack":"Legacy"}}}'
    let hash = 0x811C9DC5n
    for (let i = 0; i < wire.length; i++)
      hash = BigInt.asUintN(32, (hash ^ BigInt(wire.charCodeAt(i))) * 0x01000193n)
    expect(calculateContentHash(legacy)).toBe(`fnv1a32:${hash.toString(16).padStart(8, '0')}`)
  })
})
