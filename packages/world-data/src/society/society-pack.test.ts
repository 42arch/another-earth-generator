import { describe, expect, it } from 'vitest'
import culturesEnglish from '../../data/society/cultures-en.json'
import culturesChinese from '../../data/society/cultures-zh-cn.json'
import peoplesEnglish from '../../data/society/peoples-en.json'
import peoplesChinese from '../../data/society/peoples-zh-cn.json'
import statesEnglish from '../../data/society/states-en.json'
import statesChinese from '../../data/society/states-zh-cn.json'
import { createSocietyPack, decodeSocietyPackJson, encodeSocietyPackJson, loadBuiltinCatalog, parseSocietyPack, societyPackDocumentFromPack } from '../index'

const samples = [peoplesEnglish, peoplesChinese, culturesEnglish, culturesChinese, statesEnglish, statesChinese] as const

function hasIssue(parse: (value: unknown) => { valid: boolean, issues: readonly { path: string }[] }, value: unknown, suffix: string): boolean {
  const result = parse(value)
  return !result.valid && result.issues.some(item => item.path.endsWith(suffix))
}

describe('society pack JSON', () => {
  it('round trips each complete language document through its catalog pack', () => {
    const catalog = loadBuiltinCatalog()
    for (const source of samples) {
      const parsed = decodeSocietyPackJson(JSON.stringify(source))
      expect(parsed.valid).toBe(true)
      if (!parsed.valid)
        throw new Error(`Invalid bundled society document: ${source.id}`)
      const dependencies = parsed.value.cultures
        ? [catalog.get(parsed.value.dependencies[0]!.id)!]
        : []
      const pack = createSocietyPack(parsed.value, dependencies)
      expect(pack).toEqual(catalog.get(source.id))
      expect('translations' in parsed.value).toBe(false)
      const definitions = [...pack.cultures, ...('peoples' in pack ? pack.peoples : []), ...('states' in pack ? pack.states : [])]
      expect(definitions.every(definition => !!definition.description)).toBe(true)
      expect(societyPackDocumentFromPack(pack, dependencies)).toEqual(parsed.value)
      const encoded = encodeSocietyPackJson(parsed.value)
      expect(encoded.endsWith('\n')).toBe(true)
      expect(decodeSocietyPackJson(encoded)).toEqual(parsed)
    }
  })

  it('adapts state author documents to the current v1 content contract', () => {
    const catalog = loadBuiltinCatalog()
    const pack = catalog.get('builtin-states-en')!
    expect(pack.manifest.schemaVersion).toBe(1)
    expect('states' in pack ? pack.states : []).toHaveLength(20)
    expect(pack.governments).toEqual([])
    expect(catalog.get('core')?.governments.map(government => government.id)).toContain('core:government/council')
  })

  it('imports independent documents with separate language-specific IDs', () => {
    const document = { ...peoplesEnglish, id: 'custom-peoples-en', peoples: [{ ...peoplesEnglish.peoples[0], id: 'custom:people/first-en' }] }
    const parsed = decodeSocietyPackJson(JSON.stringify(document))
    expect(parsed.valid).toBe(true)
    if (!parsed.valid)
      throw new Error('Expected an importable society document')
    const pack = createSocietyPack(parsed.value)
    expect(pack.manifest.id).toBe('custom-peoples-en')
    expect('peoples' in pack ? pack.peoples[0].id : undefined).toBe('custom:people/first-en')
  })

  it('detaches parsed values and preserves definition order', () => {
    const parsed = parseSocietyPack(peoplesEnglish)
    expect(parsed.valid).toBe(true)
    if (!parsed.valid || !parsed.value.peoples)
      throw new Error('Expected a peoples document')
    expect(parsed.value).not.toBe(peoplesEnglish)
    expect(parsed.value.peoples).not.toBe(peoplesEnglish.peoples)
    expect(parsed.value.peoples.map(entry => entry.id)).toEqual(peoplesEnglish.peoples.map(entry => entry.id))
  })

  it('reports paths for malformed documents and rejects mixed-language content', () => {
    expect(decodeSocietyPackJson('{')).toMatchObject({ valid: false, issues: [{ path: '$' }] })
    expect(hasIssue(parseSocietyPack, null, '$')).toBe(true)
    expect(hasIssue(parseSocietyPack, { ...peoplesEnglish, contentHash: 'not-author-data' }, 'contentHash')).toBe(true)
    expect(hasIssue(parseSocietyPack, { ...peoplesEnglish, schemaVersion: 2 }, 'schemaVersion')).toBe(true)
    expect(hasIssue(parseSocietyPack, { ...peoplesEnglish, language: 'zh-CN' }, 'id')).toBe(true)
    expect(hasIssue(parseSocietyPack, { ...peoplesEnglish, translations: {} }, 'translations')).toBe(true)
    expect(hasIssue(parseSocietyPack, { ...peoplesEnglish, peoples: 'invalid' }, 'peoples')).toBe(true)
    expect(hasIssue(parseSocietyPack, { ...peoplesEnglish, governments: [] }, 'governments')).toBe(true)
    expect(hasIssue(parseSocietyPack, { ...peoplesEnglish, peoples: [{ ...peoplesEnglish.peoples[0], tags: 'invalid' }] }, 'peoples[0].tags')).toBe(true)
    expect(hasIssue(parseSocietyPack, { ...peoplesEnglish, id: 'builtin-peoples' }, 'id')).toBe(true)
  })

  it('requires localized descriptions and validates state fields and IDs', () => {
    expect(hasIssue(parseSocietyPack, { ...peoplesEnglish, peoples: [...peoplesEnglish.peoples, peoplesEnglish.peoples[0]] }, 'peoples[4].id')).toBe(true)
    expect(hasIssue(parseSocietyPack, { ...peoplesEnglish, peoples: [{ ...peoplesEnglish.peoples[0], description: '' }, ...peoplesEnglish.peoples.slice(1)] }, 'peoples[0].description')).toBe(true)
    expect(hasIssue(parseSocietyPack, { ...statesEnglish, states: [{ ...statesEnglish.states[0], weight: -1 }] }, 'states[0].weight')).toBe(true)
    expect(hasIssue(parseSocietyPack, { ...statesEnglish, states: [{ ...statesEnglish.states[0], politicalForm: 'invalid' }] }, 'states[0].politicalForm')).toBe(true)
    expect(hasIssue(parseSocietyPack, { ...statesEnglish, states: [{ ...statesEnglish.states[0], headOfStateTitle: '' }] }, 'states[0].headOfStateTitle')).toBe(true)
    expect(hasIssue(parseSocietyPack, { ...statesEnglish, states: [{ ...statesEnglish.states[0], headOfGovernmentTitle: '' }] }, 'states[0].headOfGovernmentTitle')).toBe(true)
    expect(hasIssue(parseSocietyPack, { ...statesEnglish, states: [{ ...statesEnglish.states[0], id: 'builtin:government/republic-en' }] }, 'states[0].id')).toBe(true)
  })

  it('requires matching language-specific naming dependencies for cultures', () => {
    const catalog = loadBuiltinCatalog()
    const document = parseSocietyPack(culturesEnglish)
    if (!document.valid)
      throw new Error('Expected a valid culture document')
    const naming = catalog.get('builtin:naming-style/western-en')!
    expect(() => createSocietyPack(document.value)).toThrow('manifest.dependencies[0]')
    expect(() => createSocietyPack(document.value, [{ ...naming, manifest: { ...naming.manifest, version: '0.0.0' } }])).toThrow('manifest.dependencies[0]')
    const invalidReference = { ...culturesEnglish, cultures: [{ ...culturesEnglish.cultures[0], namingStyleId: 'test:naming-style/missing-en' }, ...culturesEnglish.cultures.slice(1)] }
    expect(hasIssue(parseSocietyPack, invalidReference, 'cultures[0].namingStyleId')).toBe(true)
    const chineseNaming = catalog.get('builtin:naming-style/western-zh-cn')!
    expect(() => createSocietyPack(document.value, [chineseNaming])).toThrow('manifest.dependencies[0]')
  })

  it('rejects packs that cannot be represented without loss or have stale hashes', () => {
    const pack = loadBuiltinCatalog().get('builtin-peoples-en')!
    expect(() => societyPackDocumentFromPack({ ...pack, names: [{ id: 'test:names/extra', displayNameKey: 'extra', tags: [], entries: [{ value: 'Extra', weight: 1 }] }] })).toThrow()
    const extra = { ...pack, extra: 'unrepresented' }
    expect(() => societyPackDocumentFromPack(extra)).toThrow('cannot be represented')
    const stale = { ...pack, manifest: { ...pack.manifest, contentHash: 'fnv1a32:00000000' } }
    expect(() => societyPackDocumentFromPack(stale)).toThrow('hash mismatch')
  })
})
