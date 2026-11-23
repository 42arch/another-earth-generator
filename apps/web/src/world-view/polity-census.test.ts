import { describe, expect, it } from 'vitest'
import { buildPolityCensus } from './polity-census'

describe('buildPolityCensus', () => {
  it('sums owned population, skips lakes in area, and ranks settlements', () => {
    const owners = [0, 0, 1, -1]
    const population = [100, 40, 25, 999]
    const area = [10, 30, 5, 80]
    const lakes = [-1, 2, -1, -1]
    const census = buildPolityCensus({
      regionCount: 4,
      polityIndexAt: region => owners[region] ?? -1,
      populationAt: region => population[region] ?? 0,
      areaKm2At: region => area[region] ?? 0,
      lakeIndexAt: region => lakes[region] ?? -1,
      polities: [{ id: 'polity:a' }, { id: 'polity:b' }],
      settlements: [
        { id: 's:capital', name: '都城', polityId: 'polity:a', tier: 'capital', population: 60, isPort: true },
        { id: 's:city', name: '港城', polityId: 'polity:a', tier: 'city', population: 40 },
        { id: 's:town', name: '镇', polityId: 'polity:a', tier: 'town', population: 10 },
        { id: 's:village', name: '村', polityId: 'polity:a', tier: 'village', population: 5 },
        { id: 's:other', name: '邻国城', polityId: 'polity:b', tier: 'city', population: 20 },
        { id: 's:free', name: '无主', polityId: null, tier: 'town', population: 50 },
      ],
    })

    expect(census.get('polity:a')).toMatchObject({
      population: 140,
      areaKm2: 10,
      densityPerKm2: 14,
      settlementCount: 4,
      capitalCount: 1,
      cityCount: 1,
      townCount: 1,
      villageCount: 1,
      portCount: 1,
    })
    expect(census.get('polity:a')?.leadingSettlements.map(item => item.name)).toEqual(['都城', '港城', '镇', '村'])
    expect(census.get('polity:b')).toMatchObject({
      population: 25,
      areaKm2: 5,
      settlementCount: 1,
      cityCount: 1,
    })
  })
})
