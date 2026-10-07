import type { WorldSimulationState } from '@/core/simulation/state'
import { describe, expect, it } from 'vitest'
import { buildLayerStatistics, formatLayerStatistics } from '@/core/world/layer-statistics'

describe('active-layer cell statistics', () => {
  it('reports independently moving plate regions', () => {
    const data = {
      geography: { elevation: new Float32Array(4) },
      geology: {
        regionSuperPlate: Int16Array.from([0, 0, 1, 1]),
      },
    } as unknown as WorldSimulationState
    expect(buildLayerStatistics(data, 'plates', 0)?.rows).toHaveLength(2)
  })

  it('explains major and microplates in the plate layer and copied statistics', () => {
    const data = {
      geography: { elevation: new Float32Array(6) },
      geology: {
        regionSuperPlate: Int16Array.from([0, 0, 1, 2, 2, 3]),
      },
    } as unknown as WorldSimulationState
    const statistics = buildLayerStatistics(data, 'plates', 0, 2)!

    expect(statistics.plateCounts).toEqual({ primary: 2, micro: 2 })
    expect(statistics.rows.map(item => item.label)).toEqual([
      '主要板块 #0', '小板块 #2', '主要板块 #1', '小板块 #3',
    ])
    expect(statistics.description).toContain('独立运动')
    expect(formatLayerStatistics(statistics)).toContain('主要板块\t2\n小板块\t2')
  })

  it('counts continents using the final shoreline', () => {
    const data = {
      geography: {
        elevation: Float32Array.from([-0.2, 0.3, 0.1, -0.1]),
        landMask: Uint8Array.from([0, 1, 1, 0]),
        continentId: Int16Array.from([0, 0, -1, -1]),
        visibleContinentId: Int16Array.from([-1, 0, 0, -1]),
      },
    } as unknown as WorldSimulationState
    const statistics = buildLayerStatistics(data, 'continents', 0)!

    expect(statistics.rows.map(item => [item.label, item.count])).toEqual([
      ['海洋', 2],
      ['大陆 #0', 2],
    ])
    expect(statistics.description).toContain('最终海陆')
  })

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
