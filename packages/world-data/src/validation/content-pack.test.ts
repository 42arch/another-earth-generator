import type { ContentPackV1 } from '../index'
import { describe, expect, it } from 'vitest'
import { loadBuiltinCatalog, validateContentPack } from '../index'

function pack(): ContentPackV1 {
  return {
    manifest: { id: 'test:core', version: '1.0.0', schemaVersion: 1, nameKey: 'pack', contentHash: 'test-hash', dependencies: [] },
    names: [{ id: 'test:names/basic', displayNameKey: 'names', tags: [], entries: [{ value: 'Ada', weight: 1 }] }],
    namingStyles: [],
    cultures: [],
    peoples: [],
    polities: [],
    religions: [],
    resources: [],
    presets: [],
    translations: { en: { pack: 'Test', names: 'Names' } },
  }
}

describe('content pack validation', () => {
  it('accepts a minimal localized v1 pack', () => expect(validateContentPack(pack()).valid).toBe(true))

  it('requires the complete current v1 content arrays', () => {
    const current = pack()
    expect(validateContentPack({ ...current, namingStyles: undefined as unknown as ContentPackV1['namingStyles'] }).issues).toContainEqual(expect.objectContaining({ path: 'namingStyles', code: 'required' }))
    expect(validateContentPack({ ...current, peoples: undefined as unknown as ContentPackV1['peoples'] }).issues).toContainEqual(expect.objectContaining({ path: 'peoples', code: 'required' }))
    expect(validateContentPack({ ...current, polities: undefined as unknown as ContentPackV1['polities'] }).issues).toContainEqual(expect.objectContaining({ path: 'polities', code: 'required' }))
    expect(validateContentPack({ ...current, manifest: { ...current.manifest, schemaVersion: 2 as unknown as 1 } }).issues).toContainEqual(expect.objectContaining({ path: 'manifest', code: 'version' }))
  })

  it('rejects duplicate content IDs', () => {
    const current = pack()
    expect(validateContentPack({ ...current, names: [...current.names, ...current.names] }).issues.some(issue => issue.code === 'duplicate')).toBe(true)
  })

  it('rejects an empty definition description', () => {
    const current = pack()
    expect(validateContentPack({ ...current, names: [{ ...current.names[0], description: ' ' }] }).issues).toContainEqual(expect.objectContaining({ path: 'definitions[0].description', code: 'required' }))
  })

  it('rejects negative and nonfinite weights', () => {
    for (const weight of [-1, Number.NaN, Infinity, 0]) {
      const current = pack()
      expect(validateContentPack({ ...current, names: [{ ...current.names[0], entries: [{ value: 'Ada', weight }] }] }).valid).toBe(false)
    }
  })

  it('rejects missing translations and invalid pack versions', () => {
    const current = pack()
    expect(validateContentPack({ ...current, translations: {} }).valid).toBe(false)
    expect(validateContentPack({ ...current, manifest: { ...current.manifest, version: 'invalid' } }).valid).toBe(false)
  })

  it('validates polity archetype fields as part of the current v1 contract', () => {
    const catalog = loadBuiltinCatalog()
    const polityPack = catalog.get('builtin-polities-en')!
    const dependencies = [catalog.get('builtin-polity-traits')!]
    expect(polityPack.manifest.schemaVersion).toBe(1)
    expect(validateContentPack(polityPack, dependencies).valid).toBe(true)
    expect(validateContentPack({ ...polityPack, polities: [{ ...polityPack.polities[0], governmentOrganization: 'invalid' as typeof polityPack.polities[number]['governmentOrganization'] }, ...polityPack.polities.slice(1)] }, dependencies).issues).toContainEqual(expect.objectContaining({ path: 'polities[0].governmentOrganization', code: 'range' }))
  })

  it('resolves dependencies only through exact declared versions', () => {
    const dependency = pack()
    const extension: ContentPackV1 = {
      ...dependency,
      manifest: { ...dependency.manifest, id: 'test:extension', dependencies: [{ id: dependency.manifest.id, version: dependency.manifest.version }] },
      names: [],
    }
    expect(validateContentPack(extension, [dependency]).valid).toBe(true)
    expect(validateContentPack(extension).valid).toBe(false)
    expect(validateContentPack({ ...extension, manifest: { ...extension.manifest, dependencies: [{ id: dependency.manifest.id, version: '2.0.0' }] } }, [dependency]).valid).toBe(false)
  })
})
