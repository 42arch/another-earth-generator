import type { ContentPackV1 } from '../schemas/content'
import { describe, expect, it } from 'vitest'
import politiesChinese from '../../data/society/polities-zh-cn.json'
import { calculateContentHash, createContentCatalog, createSocietyPack, loadBuiltinCatalog, parseSocietyPack, validateContentPack } from '../index'

describe('polity trait content', () => {
  it('shares one frozen bilingual trait catalog between both polity languages', () => {
    const catalog = loadBuiltinCatalog()
    const traits = catalog.get('builtin-polity-traits')!
    expect(traits.polityTraits).toHaveLength(16)
    expect(Object.isFrozen(traits.polityTraits)).toBe(true)
    for (const dimension of ['power', 'governance', 'economy'])
      expect(traits.polityTraits!.filter(trait => trait.dimension === dimension)).toHaveLength(5)
    for (const trait of traits.polityTraits!) {
      for (const locale of ['zh-CN', 'en']) {
        expect(traits.translations[locale]![trait.displayNameKey]).toBeTruthy()
        expect(traits.translations[locale]![trait.descriptionKey]).toBeTruthy()
      }
    }
    const chinese = catalog.get('builtin-polities-zh-cn')!
    const english = catalog.get('builtin-polities-en')!
    expect(chinese.polities.map(p => [p.politicalForm, p.weight, p.allowedSizeClasses, p.requiredTraits, p.traitAffinities]))
      .toEqual(english.polities.map(p => [p.politicalForm, p.weight, p.allowedSizeClasses, p.requiredTraits, p.traitAffinities]))
    for (const form of ['free-territory', 'chiefdom', 'commune', 'city-state'])
      expect(chinese.polities.find(p => p.politicalForm === form)!.requiredTraits).toContain('small-area')
    expect(chinese.polities.filter(p => p.allowedSizeClasses)).toHaveLength(0)
    const smallArea = traits.polityTraits!.find(trait => trait.id === 'small-area')!
    expect(smallArea.dimension).toBe('territory')
    expect(smallArea.sizeClasses).toEqual(['city-state'])
    expect(chinese.polities.find(p => p.politicalForm === 'theocracy')!.requiredTraits).toEqual(['theocratic'])
    const parsed = parseSocietyPack(politiesChinese)
    if (!parsed.valid)
      throw new Error('Expected valid polity author document')
    expect(() => createSocietyPack(parsed.value)).toThrow('manifest.dependencies')
    expect(createSocietyPack(parsed.value, [traits])).toEqual(chinese)
  })

  it('gives common forms stronger priors and keeps crowns compatible with civic institutions', () => {
    const polities = loadBuiltinCatalog().get('builtin-polities-en')!.polities
    const byForm = new Map(polities.map(polity => [polity.politicalForm, polity]))
    const kingdom = byForm.get('kingdom')!
    const dynastic = byForm.get('dynastic-monarchy')!
    expect(kingdom.weight).toBeGreaterThan(byForm.get('military-junta')!.weight)
    expect(byForm.get('republic')!.weight).toBeGreaterThan(byForm.get('protectorate')!.weight)
    expect(kingdom.requiredTraits).not.toContain('dynastic-aristocratic')
    expect(dynastic.traitAffinities?.filter(rule => rule.traits.includes('democratic') && rule.weight < 1)).toHaveLength(0)
    for (const form of ['kingdom', 'dynastic-monarchy', 'empire', 'principality', 'emirate', 'sultanate', 'khanate'] as const) {
      const polity = byForm.get(form)!
      expect(polity.traitAffinities?.some(rule => rule.traits.includes('dynastic-aristocratic') && rule.weight > 1)).toBe(true)
    }
  })

  it('rejects unresolved references, contradictory dimensions and invalid matching conditions', () => {
    const catalog = loadBuiltinCatalog()
    const traits = catalog.get('builtin-polity-traits')!
    const pack = catalog.get('builtin-polities-en')!
    const candidate = pack.polities[0]!
    const invalid = (change: Partial<typeof candidate>) => validateContentPack({ ...pack, polities: [{ ...candidate, ...change }] }, [traits])
    expect(invalid({ requiredTraits: ['unknown-trait'] }).issues.some(i => i.code === 'reference')).toBe(true)
    expect(invalid({ requiredTraits: ['centralized', 'decentralized'] }).issues.some(i => i.code === 'range')).toBe(true)
    expect(invalid({ requiredTraits: ['centralized', 'centralized'] }).issues.some(i => i.code === 'duplicate')).toBe(true)
    expect(invalid({ traitAffinities: [{ traits: ['centralized'], excludedTraits: ['centralized'], weight: 2 }] }).valid).toBe(false)
    expect(invalid({ traitAffinities: [{ traits: [], weight: 2 }] }).valid).toBe(false)
    expect(invalid({ traitAffinities: [{ traits: ['centralized'], weight: Number.NaN }] }).valid).toBe(false)
    expect(invalid({ traitAffinities: [{ traits: ['centralized'], weight: 0 }] }).valid).toBe(false)
    expect(invalid({ traitAffinities: [{ traits: ['centralized'], sizeClasses: [], weight: 2 }] }).valid).toBe(false)
    expect(parseSocietyPack({ ...politiesChinese, polities: [{ ...politiesChinese.polities[0], traitAffinities: 'invalid' }] }).valid).toBe(false)
  })

  it.each([[], ['unknown'], ['city-state', 'city-state'], null, 'city-state'].map(value => [value]))('rejects invalid territory size constraints %j', (allowedSizeClasses) => {
    const catalog = loadBuiltinCatalog()
    const pack = catalog.get('builtin-polities-en')!
    const invalid = { ...pack, polities: [{ ...pack.polities[0]!, allowedSizeClasses }] } as unknown as ContentPackV1
    expect(validateContentPack(invalid, [catalog.get('builtin-polity-traits')!]).issues).toContainEqual(expect.objectContaining({ path: 'polities[0].allowedSizeClasses' }))
    expect(parseSocietyPack({ ...politiesChinese, polities: [{ ...politiesChinese.polities[0], allowedSizeClasses }] }).valid).toBe(false)
  })

  it.each([undefined, [], ['unknown'], ['city-state', 'city-state'], null].map(value => [value]))('rejects missing or invalid territory trait conditions %j', (sizeClasses) => {
    const pack = loadBuiltinCatalog().get('builtin-polity-traits')!
    const smallArea = pack.polityTraits!.find(trait => trait.id === 'small-area')!
    const invalid = { ...pack, polityTraits: [{ ...smallArea, sizeClasses }] } as unknown as ContentPackV1
    expect(validateContentPack(invalid).issues).toContainEqual(expect.objectContaining({ path: 'polityTraits[0].sizeClasses', code: 'range' }))
  })

  it('validates trait definitions and includes definitions and matching rules in content hashes', () => {
    const catalog = loadBuiltinCatalog()
    const pack = catalog.get('builtin-polity-traits')!
    const first = pack.polityTraits![0]!
    const changed = { ...pack, polityTraits: [{ ...first, dimension: 'economy' as const }, ...pack.polityTraits!.slice(1)] }
    expect(calculateContentHash(changed)).not.toBe(pack.manifest.contentHash)
    const changedConditions = { ...pack, polityTraits: [{ ...first, sizeClasses: ['regional' as const] }, ...pack.polityTraits!.slice(1)] }
    expect(calculateContentHash(changedConditions)).not.toBe(pack.manifest.contentHash)
    expect(validateContentPack(changed).issues).toContainEqual(expect.objectContaining({ path: 'polityTraits[0].sizeClasses', code: 'range' }))
    const duplicate = { ...pack, polityTraits: [...pack.polityTraits!, first] }
    expect(validateContentPack(duplicate).issues.some(i => i.code === 'duplicate')).toBe(true)
    const badDimension = { ...pack, polityTraits: [{ ...first, dimension: 'unknown' }] } as unknown as ContentPackV1
    expect(validateContentPack(badDimension).valid).toBe(false)
    const missingText = { ...pack, translations: { en: { 'polity-traits.pack': 'Traits' } } }
    expect(validateContentPack(missingText).valid).toBe(false)
    const collision = { ...pack, manifest: { ...pack.manifest, id: 'other-traits' } }
    expect(() => createContentCatalog([pack, collision])).toThrow('Duplicate polity trait ID')
    const polities = catalog.get('builtin-polities-en')!
    const changedRules = { ...polities, polities: [{ ...polities.polities[0]!, traitAffinities: [] }, ...polities.polities.slice(1)] }
    expect(calculateContentHash(changedRules)).not.toBe(polities.manifest.contentHash)
    const changedSizes = { ...polities, polities: [{ ...polities.polities[0]!, allowedSizeClasses: ['city-state' as const] }, ...polities.polities.slice(1)] }
    expect(calculateContentHash(changedSizes)).not.toBe(polities.manifest.contentHash)
  })
})
