import { deflateSync } from 'fflate'
import { expect, it } from 'vitest'
import { applyShareHash, createShareHash } from '@/core/sharing/share-link'
import {
  cloneWorldConfig,
  DEFAULT_WORLD_CONFIG,
  REFERENCE_PLATE_SUBDIVISION_COUNT,
} from '@/core/simulation/config'

it('round-trips tectonic controls and reads legacy subdivision counts', () => {
  const config = cloneWorldConfig(DEFAULT_WORLD_CONFIG)
  config.geology.primaryPlateCount = 12
  config.geology.microPlateCount = 4
  config.geology.plateSizeVariety = 0.6
  const restored = cloneWorldConfig(DEFAULT_WORLD_CONFIG)
  const currentHash = createShareHash(config)
  expect(currentHash.startsWith('#w=6.')).toBe(true)
  expect(applyShareHash(restored, currentHash)).toBe(true)
  expect(restored.geology).toEqual(config.geology)

  for (const version of [2, 3, 4, 5]) {
    const changes = version === 2 ? [[3, 64]] : version === 3 ? [[3, 64], [16, 12]] : []
    const payload = deflateSync(new TextEncoder().encode(JSON.stringify([changes])))
    const hash = `#w=${version}.${btoa(String.fromCharCode(...payload)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`
    const migrated = cloneWorldConfig(DEFAULT_WORLD_CONFIG)
    expect(applyShareHash(migrated, hash)).toBe(true)
    expect('plateCount' in migrated.geology).toBe(false)
    expect(migrated.geology.primaryPlateCount).toBe(version === 3 ? 12 : DEFAULT_WORLD_CONFIG.geology.primaryPlateCount)
    expect(migrated.geology.microPlateCount).toBe(version < 5 ? 6 : 14)
    expect(migrated.geology.continentCount).toBe(6)
  }
  const explicitContinentPayload = deflateSync(new TextEncoder().encode(JSON.stringify([[[3, 8]]])))
  const explicitContinentHash = `#w=5.${btoa(String.fromCharCode(...explicitContinentPayload)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`
  const explicitContinents = cloneWorldConfig(DEFAULT_WORLD_CONFIG)
  expect(applyShareHash(explicitContinents, explicitContinentHash)).toBe(true)
  expect(explicitContinents.geology.continentCount).toBe(8)

  expect(DEFAULT_WORLD_CONFIG.geology.microPlateCount).toBe(14)
  expect(DEFAULT_WORLD_CONFIG.geology.continentCount).toBe(7)
  expect(REFERENCE_PLATE_SUBDIVISION_COUNT).toBe(100)
})
