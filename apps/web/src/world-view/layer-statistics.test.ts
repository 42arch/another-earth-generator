import type { WorldMapReader } from '@another-earth/world-core'
import { OCEAN_SPEED_COLOR_STOPS, WIND_SPEED_COLOR_STOPS } from '@another-earth/cartography'
import { describe, expect, it } from 'vitest'
import { buildLayerStatisticsFromReader } from './layer-statistics'

// Small reader fixture: exact threshold, unavailable water, land, and a strong wind.
const values = [0.054, 0.055, 0, 0, 26]
const reader = {
  capabilities: { hasCirculation: true },
  mesh: { regionCount: values.length, getRegionAreaKm2: () => 1 },
  field: (name: string) => ({ get: (r: number) => name === 'landMask' ? Number(r === 3) : name === 'oceanAvailable' ? Number(r !== 2 && r !== 3) : values[r] }),
  monthlyField: (name: string) => ({ get: (r: number) => name.endsWith('NorthMps') ? 0 : values[r] }),
} as unknown as WorldMapReader

describe('circulation legend statistics', () => {
  it('uses precise ocean scale boundaries and preserves land and missing-water buckets', () => {
    for (const activeThematicId of ['ocean-speed', 'annual-ocean-speed']) {
      const result = buildLayerStatisticsFromReader(reader, { activeThematicId })
      expect(result.gradientStops).toEqual(OCEAN_SPEED_COLOR_STOPS)
      const before = result.rows.find(row => row.key === '1')!
      const after = result.rows.find(row => row.key === '2')!
      expect(before.count).toBe(1)
      expect(after.count).toBe(1)
      expect(before.label).toContain('0.055')
      expect(after.label).toContain('0.055')
      expect(result.rows.find(row => row.key === 'no-data')?.count).toBe(1)
      expect(result.rows.find(row => row.key === 'land')?.count).toBe(1)
    }
  })

  it('retains strong-wind distinctions beyond the former 12 m/s cutoff', () => {
    const result = buildLayerStatisticsFromReader(reader, { activeThematicId: 'wind-speed' })
    expect(result.gradientStops).toEqual(WIND_SPEED_COLOR_STOPS)
    const strong = result.rows.find(row => row.key === '6')!
    expect(strong.count).toBe(1)
    expect(strong.label).toBe('25 至 < 40 m/s')
  })
})
