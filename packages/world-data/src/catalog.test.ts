import { describe, expect, it } from 'vitest'
import { calculateContentHash, createContentCatalog, loadBuiltinCatalog, loadBuiltinGenerationCatalog, validateContentPack } from './index'

describe('builtin content catalog', () => {
  it('loads core, earthlike and geographic names deterministically with resolved references', () => {
    const first = loadBuiltinCatalog()
    const second = loadBuiltinCatalog()
    expect(first.contentSignature).toBe(second.contentSignature)
    expect(first.packs.map(pack => pack.manifest.id)).toEqual([
      'builtin-cultures-en',
      'builtin-cultures-zh-cn',
      'builtin-peoples-en',
      'builtin-peoples-zh-cn',
      'builtin-polities-en',
      'builtin-polities-zh-cn',
      'builtin-polity-traits',
      'builtin-religions-en',
      'builtin-religions-zh-cn',
      'builtin:naming-style/western-en',
      'builtin:naming-style/western-zh-cn',
      'core',
      'earthlike',
    ].sort((a, b) => a.localeCompare(b)))
    expect(loadBuiltinGenerationCatalog().packs.map(pack => pack.manifest.id)).toEqual([
      'builtin-cultures-zh-cn',
      'builtin-peoples-zh-cn',
      'builtin-polities-zh-cn',
      'builtin-polity-traits',
      'builtin-religions-zh-cn',
      'builtin:naming-style/western-zh-cn',
      'core',
      'earthlike',
    ].sort((a, b) => a.localeCompare(b)))
    const profile = first.get('builtin:naming-style/western-zh-cn')
    expect(profile && 'namingStyles' in profile ? profile.namingStyles[0] : undefined).toMatchObject({ style: 'western', language: 'zh-CN' })
    expect(profile && 'namingStyles' in profile ? profile.namingStyles[0].pools.continent.every(entry => /^\p{Script=Han}+$/u.test(entry.value)) : false).toBe(true)
    expect(first.get('geography')).toBeUndefined()
    expect(first.get('geography-zh')).toBeUndefined()
    expect(first.packs.every(pack => validateContentPack(pack, first.packs.filter(other => other !== pack)).valid)).toBe(true)
    expect(first.get('earthlike')?.presets[0].physicalRadiusKm).toBe(6371)
    expect(Object.isFrozen(first.get('core')?.names[0].entries)).toBe(true)
    expect(createContentCatalog([...first.packs].reverse()).contentSignature).toBe(first.contentSignature)
  })

  it('provides independent language-specific society candidates and defaults generation to Chinese packs', () => {
    const catalog = loadBuiltinCatalog()
    const generationCatalog = loadBuiltinGenerationCatalog()
    const ids = [
      'builtin-peoples-en',
      'builtin-peoples-zh-cn',
      'builtin-cultures-en',
      'builtin-cultures-zh-cn',
      'builtin-polities-en',
      'builtin-polities-zh-cn',
      'builtin-religions-en',
      'builtin-religions-zh-cn',
    ]
    for (const id of ids) {
      const pack = catalog.get(id)!
      const [locale] = Object.keys(pack.translations)
      expect(Object.keys(pack.translations)).toHaveLength(1)
      expect(locale && id.endsWith(locale.toLowerCase())).toBe(true)
      const definitions = [...pack.cultures, ...pack.peoples, ...pack.polities, ...pack.religions]
      expect(pack.translations[locale!]?.[pack.manifest.nameKey]).toBeTruthy()
      expect(definitions.every(definition => definition.id.endsWith(`-${locale!.toLowerCase()}`) && !!definition.description && !!pack.translations[locale!]?.[definition.displayNameKey])).toBe(true)
    }
    const peoples = catalog.get('builtin-peoples-en')!
    expect(peoples.peoples.map(people => people.id)).toEqual([
      'builtin:people/avilan-en',
      'builtin:people/novari-en',
      'builtin:people/taren-en',
      'builtin:people/lomiri-en',
    ])
    expect(Object.isFrozen(peoples.peoples)).toBe(true)
    expect(catalog.get('builtin-cultures-zh-cn')?.cultures).toHaveLength(4)
    const englishPolities = catalog.get('builtin-polities-en')!
    const chinesePolities = catalog.get('builtin-polities-zh-cn')!
    expect(englishPolities.polities).toHaveLength(20)
    const englishPolityIds = englishPolities.polities.map(polity => polity.id.replace('-en', ''))
    const chinesePolityIds = chinesePolities.polities.map(polity => polity.id.replace('-zh-cn', ''))
    expect(englishPolityIds).toEqual(chinesePolityIds)
    const englishReligions = catalog.get('builtin-religions-en')!
    const chineseReligions = catalog.get('builtin-religions-zh-cn')!
    expect(englishReligions.religions).toHaveLength(6)
    expect(englishReligions.religions.map(r => r.id.replace('-en', ''))).toEqual(chineseReligions.religions.map(r => r.id.replace('-zh-cn', '')))
    for (const id of ids.filter(item => item.endsWith('-en')))
      expect(generationCatalog.get(id)).toBeUndefined()
    for (const id of ids.filter(item => item.endsWith('-zh-cn')))
      expect(generationCatalog.get(id)).toBeDefined()
    expect(catalog.get('core')?.resources.length).toBeGreaterThanOrEqual(7)
  })

  it('includes people candidates in current v1 hashes without modifying the original pack', () => {
    const pack = loadBuiltinCatalog().get('builtin-peoples-en')!
    const changed = { ...pack, peoples: [{ ...pack.peoples[0], tags: ['revised'], description: 'A revised description.' }, ...pack.peoples.slice(1)] }
    expect(calculateContentHash(changed)).not.toBe(pack.manifest.contentHash)
    expect(() => createContentCatalog([changed])).toThrow('Content hash mismatch')
    const signed = { ...changed, manifest: { ...changed.manifest, contentHash: calculateContentHash(changed) } }
    expect(createContentCatalog([signed]).contentSignature).not.toBe(createContentCatalog([pack]).contentSignature)
    const collision = { ...pack, manifest: { ...pack.manifest, id: 'another-peoples' } }
    expect(() => createContentCatalog([pack, collision])).toThrow('Duplicate content ID')
  })

  it('includes polity archetypes in the current v1 hash', () => {
    const pack = loadBuiltinCatalog().get('builtin-polities-en')!
    const changed = { ...pack, polities: [{ ...pack.polities[0], headOfStateTitle: 'High Speaker' }, ...pack.polities.slice(1)] }
    expect(calculateContentHash(changed)).not.toBe(pack.manifest.contentHash)
  })

  it('rejects changed content with a stale hash and duplicate packs', () => {
    const catalog = loadBuiltinCatalog()
    const core = catalog.get('core')!
    const dependencies = core.manifest.dependencies.map((dependency) => {
      const pack = catalog.get(dependency.id)
      if (!pack)
        throw new Error(`Missing dependency ${dependency.id}`)
      return pack
    })
    const changed = { ...core, names: [{ ...core.names[0], entries: [{ ...core.names[0].entries[0], value: 'Changed' }] }] }
    expect(() => createContentCatalog([...dependencies, changed])).toThrow('Content hash mismatch')
    expect(() => createContentCatalog([core, core])).toThrow('Duplicate content pack')
  })
})
