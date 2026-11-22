import { describe, expect, it } from 'vitest'
import { applyShareHash, createShareHash, SHARE_DEFAULT_PARAMETERS } from './share-link'

describe('share-link v15', () => {
  it('round-trips civilization parameters alongside natural parameters', async () => {
    const custom = {
      ...SHARE_DEFAULT_PARAMETERS,
      seed: '2048',
      civilizationEnabled: false,
      populationScale: 1.75,
      settlementDensity: 2.25,
      administrativeCapacity: 0.85,
      urbanConcentration: 0.75,
      polityCount: 60,
      politySizeVariation: 0.8,
      culturalDiversity: 0.5,
      agriculturalProductivity: 1.6,
      industrialCapability: 0.35,
      landTransportCapability: 1.75,
      seafaringCapability: 0,
    }
    const hash = await createShareHash(custom)
    expect(hash.startsWith('#w=15.')).toBe(true)

    const restored = await applyShareHash(hash)
    expect(restored).toEqual(custom)
  })

  it.each([1, 60, 200])('restores exact country count %i', async (polityCount) => {
    const custom = { ...SHARE_DEFAULT_PARAMETERS, polityCount }
    expect(await applyShareHash(await createShareHash(custom))).toEqual(custom)
  })

  it('rejects legacy v9–v14 hashes and out-of-range civilization parameters', async () => {
    expect(await applyShareHash('#w=9.AAAA')).toBeNull()
    expect(await applyShareHash('#w=10.AAAA')).toBeNull()
    expect(await applyShareHash('#w=11.AAAA')).toBeNull()
    expect(await applyShareHash('#w=12.AAAA')).toBeNull()
    expect(await applyShareHash('#w=13.AAAA')).toBeNull()
    expect(await applyShareHash('#w=14.AAAA')).toBeNull()

    const invalid = {
      ...SHARE_DEFAULT_PARAMETERS,
      populationScale: 10,
    }
    const hash = await createShareHash(invalid)
    expect(await applyShareHash(hash)).toBeNull()
  })

  it('rejects out-of-range capabilities and restores defaults', async () => {
    const invalid = { ...SHARE_DEFAULT_PARAMETERS, landTransportCapability: 0 }
    expect(await applyShareHash(await createShareHash(invalid))).toBeNull()
    expect(await applyShareHash(await createShareHash({ ...SHARE_DEFAULT_PARAMETERS }))).toEqual(SHARE_DEFAULT_PARAMETERS)
  })

  it.each([
    { urbanConcentration: 1.1 },
    { polityCount: 0 },
    { polityCount: 1.5 },
    { polityCount: 201 },
    { politySizeVariation: 1.1 },
    { culturalDiversity: 3 },
    { administrativeCapacity: -1 },
  ])('rejects invalid society values %j', async (values) => {
    expect(await applyShareHash(await createShareHash({ ...SHARE_DEFAULT_PARAMETERS, ...values }))).toBeNull()
  })
})
