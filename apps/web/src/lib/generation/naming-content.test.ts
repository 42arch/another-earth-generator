import type { ContentPackV1, NamingStyle } from '@another-earth/world-data'
import { generateName } from '@another-earth/world-core'
import { calculateContentHash, calculateNamingStyleSignature, createContentCatalog, createNamingStylePack, decodeNamingStyleJson, encodeNamingStyleJson, loadBuiltinNamingStyles } from '@another-earth/world-data'
import { describe, expect, it } from 'vitest'
import { builtinContentPacks, builtinGeographicNamingProfile, builtinPipelineContent, findPolityTrait, translateContentKey } from './builtin-content'

function roundTrip(style: NamingStyle): NamingStyle {
  const result = decodeNamingStyleJson(encodeNamingStyleJson(style))
  if (!result.valid)
    throw new Error(result.issues[0].message)
  return result.value
}

function cultures(names: readonly ContentPackV1[]): ContentPackV1 {
  const pack: ContentPackV1 = {
    manifest: { id: 'example-cultures', version: '1.0.0', schemaVersion: 1, nameKey: 'pack', contentHash: '', dependencies: names.map(pack => ({ id: pack.manifest.id, version: pack.manifest.version })) },
    names: [],
    namingStyles: [],
    peoples: [],
    polities: [],
    cultures: names.map((pack, index) => ({ id: `example:culture/culture-${index}` as const, displayNameKey: `culture.${index}`, tags: [], traits: [], namingStyleId: pack.namingStyles[0].id })),
    religions: [],
    resources: [],
    presets: [],
    translations: { en: { pack: 'Cultures', ...Object.fromEntries(names.map((_pack, index) => [`culture.${index}`, `Culture ${index}`])) } },
  }
  return { ...pack, manifest: { ...pack.manifest, contentHash: calculateContentHash(pack) } }
}

describe('naming content public API integration', () => {
  it('injects the neutral polity trait catalog and resolves bilingual names and descriptions', () => {
    const definition = findPolityTrait('centralized')!
    expect(translateContentKey(definition.displayNameKey, 'zh-CN')).toBe('中央集权')
    expect(translateContentKey(definition.displayNameKey, 'en')).toBe('Centralized')
    expect(translateContentKey(definition.descriptionKey, 'zh-CN')).not.toBe(definition.descriptionKey)
    const content = builtinPipelineContent.content['civilization-content']
    expect(content.polityTraits).toHaveLength(16)
    expect(content.polities.find(p => p.politicalForm === 'theocracy')?.requiredTraits).toEqual(['theocratic'])
  })

  it('generates both kinds of geographic names from the current style', () => {
    const style = builtinGeographicNamingProfile
    for (const kind of ['continent', 'ocean'] as const) {
      expect(style.pools[kind]).toHaveLength(48)
      const name = generateName({ worldSeed: 'fixed', entityId: `${kind}:1`, rule: kind, style, styleSignature: calculateNamingStyleSignature(style) })
      expect(style.pools[kind].map(entry => entry.value)).toContain(name)
    }
  })

  it('exposes self-contained western profiles by generated language', () => {
    const profiles = loadBuiltinNamingStyles()
    expect(profiles.map(profile => [profile.style, profile.language])).toEqual([['western', 'zh-CN'], ['western', 'en']])
    expect(profiles.find(profile => profile.language === 'zh-CN')?.id).toBe('builtin:naming-style/western-zh-cn')
    expect(profiles.find(profile => profile.language === 'en')?.id).toBe('builtin:naming-style/western-en')
  })

  it('uses one frozen profile and signature with only current content packs', () => {
    expect(builtinContentPacks.map(pack => pack.manifest.id).sort()).toEqual([
      'builtin-cultures-zh-cn',
      'builtin-peoples-zh-cn',
      'builtin-polities-zh-cn',
      'builtin-polity-traits',
      'builtin-religions-zh-cn',
      'builtin:naming-style/western-zh-cn',
      'core',
      'earthlike',
    ].sort())
    expect(Object.isFrozen(builtinGeographicNamingProfile)).toBe(true)
    expect(Object.isFrozen(builtinGeographicNamingProfile.pools.continent)).toBe(true)
    expect(builtinPipelineContent.content['geographic-naming-style']).toBe(builtinGeographicNamingProfile)
    expect(builtinPipelineContent.contentSignatures['geographic-naming-style']).toBe(calculateNamingStyleSignature(builtinGeographicNamingProfile))
  })

  it('imports styles, resolves cultural bindings and generates names after export and reimport', () => {
    const styles = loadBuiltinNamingStyles().map(roundTrip)
    const packs = styles.map(createNamingStylePack)
    const culturePack = cultures(packs)
    const catalog = createContentCatalog([...packs, culturePack])
    const storedCultures = catalog.get(culturePack.manifest.id) as ContentPackV1
    const availableStyles = catalog.packs.flatMap(pack => 'namingStyles' in pack ? [...pack.namingStyles] : [])
    const names = storedCultures.cultures.map((culture, index) => {
      const style = availableStyles.find(style => style.id === culture.namingStyleId)!
      const input = { worldSeed: 1024, entityId: `person:${index}`, rule: 'person', style, styleSignature: calculateNamingStyleSignature(style) }
      const name = generateName(input)
      const reimported = roundTrip(style)
      expect(generateName({ ...input, style: reimported, styleSignature: calculateNamingStyleSignature(reimported) })).toBe(name)
      expect(generateName({ ...input, rule: 'settlement' }).length).toBeGreaterThan(0)
      expect(generateName({ ...input, rule: 'continent' }).length).toBeGreaterThan(0)
      return name
    })
    expect(names[0]).toMatch(/^[一-鿿]+·[一-鿿]+$/u)
    expect(names[0]).not.toContain(' ')
    expect(names[1]).toMatch(/^[A-Za-z]+ [A-Za-z]+$/)
    expect(createContentCatalog([...packs, culturePack].reverse()).contentSignature).toBe(catalog.contentSignature)
  })

  it('keeps unused styles out of the selected style generation identity', () => {
    const [selected, unused] = loadBuiltinNamingStyles()
    const signature = calculateNamingStyleSignature(selected)
    const input = { style: selected, styleSignature: signature, worldSeed: 'fixed', entityId: 'person:1', rule: 'person' }
    const before = generateName(input)
    const catalog = createContentCatalog([createNamingStylePack(selected), createNamingStylePack({ ...unused, version: '2.0.0' })])
    const pack = catalog.get(selected.id) as ContentPackV1
    const resolved = pack.namingStyles[0]
    expect(generateName({ ...input, style: resolved, styleSignature: calculateNamingStyleSignature(resolved) })).toBe(before)
    expect(calculateNamingStyleSignature(resolved)).toBe(signature)
  })
})
