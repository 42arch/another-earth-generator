import { describe, expect, it } from 'vitest'
import { createContentCatalog, loadBuiltinCatalog, loadBuiltinGenerationCatalog, validateContentPack } from './index'

describe('builtin content catalog', () => {
  it('loads core, earthlike and geographic names deterministically with resolved references', () => {
    const first = loadBuiltinCatalog()
    const second = loadBuiltinCatalog()
    expect(first.contentSignature).toBe(second.contentSignature)
    expect(first.packs.map(pack => pack.manifest.id)).toEqual(['builtin:naming-style/western-en', 'builtin:naming-style/western-zh-cn', 'core', 'earthlike'])
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
  it('rejects changed content with a stale hash and duplicate packs', () => {
    const catalog = loadBuiltinCatalog()
    const core = catalog.get('core')!
    const changed = { ...core, names: [{ ...core.names[0], entries: [{ ...core.names[0].entries[0], value: 'Changed' }] }] }
    expect(() => createContentCatalog([changed])).toThrow('Content hash mismatch')
    expect(() => createContentCatalog([core, core])).toThrow('Duplicate content pack')
  })
})
