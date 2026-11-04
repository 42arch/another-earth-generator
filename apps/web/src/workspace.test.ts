import { packageId as cartographyId } from '@another-earth/cartography'
import { packageId as worldCoreId } from '@another-earth/world-core'
import { packageId as worldDataId } from '@another-earth/world-data'
import { describe, expect, it } from 'vitest'

describe('workspace public exports', () => {
  it('resolves all package entry points', () => {
    expect([worldDataId, worldCoreId, cartographyId]).toEqual([
      '@another-earth/world-data',
      '@another-earth/world-core',
      '@another-earth/cartography',
    ])
  })
})
