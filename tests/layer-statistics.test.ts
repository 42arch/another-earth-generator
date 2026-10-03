import type { WorldSimulationState } from '@/core/simulation/state'
import { describe, expect, it } from 'vitest'
import { buildLayerStatistics } from '@/core/world/layer-statistics'

describe('active-layer cell statistics', () => {
  it('counts Köppen classes over all output cells, including ocean', () => {
    const data = {
      geography: { elevation: new Float32Array(5) },
      climate: { koppen: { climateClass: Uint8Array.from([0, 1, 1, 5, 31]) } },
    } as unknown as WorldSimulationState
    const result = buildLayerStatistics(data, 'koppen', 0)
    expect(result?.totalCells).toBe(5)
    expect(result?.rows.filter(item => item.count > 0).map(item => [item.label.split(' · ')[0], item.count, item.percentage])).toEqual([
      ['Af', 2, 40],
      ['Ocean', 1, 20],
      ['BWh', 1, 20],
      ['EF', 1, 20],
    ])
    expect(result?.rows).toHaveLength(32)
  })

  it('uses the selected month and explicit temperature intervals', () => {
    const data = {
      geography: { elevation: new Float32Array(4) },
      climate: {
        displayMonth: {
          month: 6,
          temperatureC: Float32Array.from([-25, -5, 15, 32]),
          precipitationMm: Float32Array.from([0, 20, 100, 500]),
        },
      },
    } as unknown as WorldSimulationState
    const result = buildLayerStatistics(data, 'temperature', 6)
    expect(result?.title).toContain('7 月')
    expect(result?.rows.reduce((sum, item) => sum + item.count, 0)).toBe(4)
    expect(result?.rows.filter(item => item.count > 0).every(item => item.percentage === 25)).toBe(true)
    const precipitation = buildLayerStatistics(data, 'precipitation', 6)
    expect(precipitation?.rows.filter(item => item.count > 0).map(item => item.label)).toEqual([
      '0 mm',
      '> 0 至 < 25 mm',
      '100 至 < 250 mm',
      '≥ 500 mm',
    ])
    expect(buildLayerStatistics(data, 'temperature', 0)).toBeNull()
  })
})
