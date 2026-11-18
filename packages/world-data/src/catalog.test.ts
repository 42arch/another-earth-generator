import { describe, expect, it } from 'vitest'
import { calculateContentHash, createContentCatalog, loadBuiltinCatalog, loadBuiltinGenerationCatalog, validateContentPack } from './index'

describe('builtin content catalog', () => {
  it('loads core, earthlike and geographic names deterministically with resolved references', () => {
    const first = loadBuiltinCatalog()
    const second = loadBuiltinCatalog()
    expect(first.contentSignature).toBe(second.contentSignature)
    expect(first.packs.map(pack => pack.manifest.id)).toEqual([
      'builtin-cultures-en', 'builtin-cultures-zh-cn', 'builtin-peoples-en', 'builtin-peoples-zh-cn', 'builtin-states-en', 'builtin-states-zh-cn',
      'builtin:naming-style/western-en', 'builtin:naming-style/western-zh-cn', 'core', 'earthlike',
    ].sort((a, b) => a.localeCompare(b)))
    expect(loadBuiltinGenerationCatalog().packs.map(pack => pack.manifest.id)).toEqual(['builtin:naming-style/western-zh-cn', 'core', 'earthlike'])
    const profile = first.get('builtin:naming-style/western-zh-cn')
    expect(profile && 'namingStyles' in profile ? profile.namingStyles[0] : undefined).toMatchObject({ style: 'western', language: 'zh-CN' })
    expect(profile && 'namingStyles' in profile ? profile.namingStyles[0].pools.continent.every(entry => /^[\u3400-\u9FFF]+$/u.test(entry.value)) : false).toBe(true)
    expect(first.get('geography')).toBeUndefined()
    expect(first.get('geography-zh')).toBeUndefined()
    expect(first.packs.every(pack => validateContentPack(pack, first.packs.filter(other => other !== pack)).valid)).toBe(true)
    expect(first.get('earthlike')?.presets[0].physicalRadiusKm).toBe(6371)
    expect(Object.isFrozen(first.get('core')?.names[0].entries)).toBe(true)
    expect(createContentCatalog([...first.packs].reverse()).contentSignature).toBe(first.contentSignature)
  })
  it('provides independent language-specific society candidates without selecting them for natural generation', () => {
    const catalog = loadBuiltinCatalog()
    const ids = ['builtin-peoples-en', 'builtin-peoples-zh-cn', 'builtin-cultures-en', 'builtin-cultures-zh-cn', 'builtin-states-en', 'builtin-states-zh-cn']
    for (const id of ids) {
      const pack = catalog.get(id)!
      const [locale] = Object.keys(pack.translations)
      expect(Object.keys(pack.translations)).toHaveLength(1)
      expect(locale && id.endsWith(locale.toLowerCase())).toBe(true)
      const definitions = [...pack.cultures, ...('peoples' in pack ? pack.peoples : []), ...('states' in pack ? pack.states : [])]
      expect(pack.translations[locale!]?.[pack.manifest.nameKey]).toBeTruthy()
      expect(definitions.every(definition => definition.id.endsWith(`-${locale!.toLowerCase()}`) && !!definition.description && !!pack.translations[locale!]?.[definition.displayNameKey])).toBe(true)
    }
    const peoples = catalog.get('builtin-peoples-en')!
    expect('peoples' in peoples ? peoples.peoples.map(people => people.id) : []).toEqual([
      'builtin:people/avilan-en', 'builtin:people/novari-en', 'builtin:people/taren-en', 'builtin:people/lomiri-en',
    ])
    expect('peoples' in peoples && Object.isFrozen(peoples.peoples)).toBe(true)
    expect(catalog.get('builtin-cultures-zh-cn')?.cultures).toHaveLength(4)
    const englishStates = catalog.get('builtin-states-en')!
    const chineseStates = catalog.get('builtin-states-zh-cn')!
    expect('states' in englishStates ? englishStates.states : []).toHaveLength(20)
    const englishStateIds = 'states' in englishStates ? englishStates.states.map(state => state.id.replace('-en', '')) : []
    const chineseStateIds = 'states' in chineseStates ? chineseStates.states.map(state => state.id.replace('-zh-cn', '')) : []
    expect(englishStateIds).toEqual(chineseStateIds)
    for (const id of ids)
      expect(loadBuiltinGenerationCatalog().get(id)).toBeUndefined()
  })

  it('includes people candidates in current v1 hashes without modifying the original pack', () => {
    const pack = loadBuiltinCatalog().get('builtin-peoples-en')!
    if (!('peoples' in pack))
      throw new Error('Expected the peoples pack')
    const changed = { ...pack, peoples: [{ ...pack.peoples[0], tags: ['revised'], description: 'A revised description.' }, ...pack.peoples.slice(1)] }
    expect(calculateContentHash(changed)).not.toBe(pack.manifest.contentHash)
    expect(() => createContentCatalog([changed])).toThrow('Content hash mismatch')
    const signed = { ...changed, manifest: { ...changed.manifest, contentHash: calculateContentHash(changed) } }
    expect(createContentCatalog([signed]).contentSignature).not.toBe(createContentCatalog([pack]).contentSignature)
    const collision = { ...pack, manifest: { ...pack.manifest, id: 'another-peoples' } }
    expect(() => createContentCatalog([pack, collision])).toThrow('Duplicate content ID')
  })

  it('includes state archetypes in the current v1 hash', () => {
    const pack = loadBuiltinCatalog().get('builtin-states-en')!
    if (!('states' in pack))
      throw new Error('Expected the states pack')
    const changed = { ...pack, states: [{ ...pack.states[0], headOfStateTitle: 'High Speaker' }, ...pack.states.slice(1)] }
    expect(calculateContentHash(changed)).not.toBe(pack.manifest.contentHash)
  })

  it('rejects changed content with a stale hash and duplicate packs', () => {
    const catalog = loadBuiltinCatalog()
    const core = catalog.get('core')!
    const changed = { ...core, names: [{ ...core.names[0], entries: [{ ...core.names[0].entries[0], value: 'Changed' }] }] }
    expect(() => createContentCatalog([changed])).toThrow('Content hash mismatch')
    expect(() => createContentCatalog([core, core])).toThrow('Duplicate content pack')
  })
})
