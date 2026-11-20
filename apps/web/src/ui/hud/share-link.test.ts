import { describe, expect, it } from 'vitest'
import { applyShareHash, createShareHash, SHARE_DEFAULT_PARAMETERS } from './share-link'

describe('share-link v10', () => {
  it('round-trips civilization parameters alongside natural parameters', async () => {
    const custom = {
      ...SHARE_DEFAULT_PARAMETERS,
      seed: '2048',
      civilizationEnabled: false,
      populationScale: 1.75,
      settlementDensity: 2.25,
      polityCohesion: 0.85,
    }
    const hash = await createShareHash(custom)
    expect(hash.startsWith('#w=10.')).toBe(true)

    const restored = await applyShareHash(hash)
    expect(restored).toEqual(custom)
  })

  it('rejects legacy v9 hashes and out-of-range civilization parameters', async () => {
    expect(await applyShareHash('#w=9.AAAA')).toBeNull()

    const invalid = {
      ...SHARE_DEFAULT_PARAMETERS,
      populationScale: 10,
    }
    const hash = await createShareHash(invalid)
    expect(await applyShareHash(hash)).toBeNull()
  })
})
