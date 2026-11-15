import type { ContentPack } from '../index'
import { describe, expect, it } from 'vitest'
import { validateContentPack } from '../index'

function pack(): ContentPack {
  return {
    manifest: { id: 'test:core', version: '1.0.0', schemaVersion: 1, nameKey: 'pack', contentHash: 'test-hash', dependencies: [] },
    names: [{ id: 'test:names/basic', displayNameKey: 'names', tags: [], entries: [{ value: 'Ada', weight: 1 }] }],
    cultures: [{ id: 'test:culture/basic', displayNameKey: 'culture', tags: [], traits: [], namePoolId: 'test:names/basic' }],
    religions: [],
    governments: [],
    resources: [],
    presets: [],
    translations: { en: { pack: 'Test', names: 'Names', culture: 'Culture' } },
  }
}

describe('content pack validation', () => {
  it('accepts a minimal localized pack', () => expect(validateContentPack(pack()).valid).toBe(true))
  it('rejects duplicate IDs', () => {
    const p = pack()
    expect(validateContentPack({ ...p, names: [...p.names, ...p.names] }).issues.some(e => e.code === 'duplicate')).toBe(true)
  })
  it('rejects unresolved references', () => {
    expect(validateContentPack({ ...pack(), names: [] }).issues.some(e => e.code === 'reference')).toBe(true)
  })
  it('rejects negative and nonfinite weights', () => {
    for (const weight of [-1, Number.NaN, Infinity, 0]) {
      const p = pack()
      expect(validateContentPack({ ...p, names: [{ ...p.names[0], entries: [{ value: 'Ada', weight }] }] }).valid).toBe(false)
    }
  })
  it('rejects missing translations and unsupported versions', () => {
    const p = pack()
    expect(validateContentPack({ ...p, translations: {} }).valid).toBe(false)
    expect(validateContentPack({ ...p, manifest: { ...p.manifest, version: 'invalid' } }).valid).toBe(false)
  })
  it('resolves references only through exact declared dependencies', () => {
    const base = pack()
    const extension: ContentPack = {
      ...base,
      manifest: { ...base.manifest, id: 'test:extension', dependencies: [{ id: 'test:core', version: '1.0.0' }] },
      names: [],
      cultures: [{ ...base.cultures[0], id: 'test:culture/extension' }],
    }
    expect(validateContentPack(extension, [base]).valid).toBe(true)
    expect(validateContentPack(extension).valid).toBe(false)
  })
})
