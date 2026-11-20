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

describe('resource and civilization legend statistics', () => {
  const resourceValues = [0, 0.1, 0.4, 0.8]
  const popDensities = [0, 5, 45, 180]
  const dominantPolity = [-1, 0, 0, -1]
  const dominantCulture = [-1, 0, 1, 0]
  const dominantReligion = [-1, 0, -1, 0]

  const civReader = {
    capabilities: { hasResources: true, hasCivilization: true },
    mesh: { regionCount: 4, getRegionAreaKm2: () => 100 },
    field: (name: string) => ({
      get: (r: number) => {
        if (name === 'landMask')
          return r === 0 ? 0 : 1
        if (name === 'agriculturalPotential' || name === 'depositRichness')
          return resourceValues[r]
        if (name === 'populationDensity')
          return popDensities[r]
        if (name === 'population')
          return popDensities[r] * 100
        if (name === 'dominantPolityIndex')
          return dominantPolity[r]
        if (name === 'dominantCultureIndex')
          return dominantCulture[r]
        if (name === 'dominantReligionIndex')
          return dominantReligion[r]
        return 0
      },
    }),
    resources: () => ({
      resourceIds: ['core:resource/iron'],
      deposits: [{ id: 'dep-1', resourceId: 'core:resource/iron', regionId: 3, category: 'mineral', richness: 0.8, primaryFactor: 'orogen' }],
    }),
    settlements: () => [{ id: 'set-1', name: '王都', foundedAtYear: 0, regionId: 2, polityId: 'pol-1', cultureId: 'cul-1', tier: 'capital', population: 1200 }],
    polities: () => [{ id: 'pol-1', name: '奥斯帝国', foundedAtYear: 0, archetypeId: 'pack:polity/empire', cultureId: 'cul-1', capitalSettlementId: 'set-1', sizeClass: 'empire' }],
    cultures: () => [
      { id: 'cul-1', name: '海滨文化', foundedAtYear: 0, archetypeId: 'pack:culture/coastal', peopleId: 'pep-1', namingStyleId: 'ns-1' },
      { id: 'cul-2', name: '高原文化', foundedAtYear: 0, archetypeId: 'pack:culture/highland', peopleId: 'pep-1', namingStyleId: 'ns-1' },
    ],
    religions: () => [{ id: 'rel-1', name: '晨曦教', foundedAtYear: 0, archetypeId: 'pack:religion/solar' }],
  } as unknown as WorldMapReader

  it('summarizes agricultural potential and deposit richness when resources capability is present', () => {
    const ag = buildLayerStatisticsFromReader(civReader, { activeThematicId: 'agricultural-potential' })
    expect(ag.rows.find(row => row.key === 'ocean')?.count).toBe(1)
    expect(ag.rows.find(row => row.key === '4')?.count).toBe(1)

    const dep = buildLayerStatisticsFromReader(civReader, { activeThematicId: 'deposit-richness' })
    expect(dep.description).toContain('1 处资源矿点')
    expect(dep.rows.find(row => row.key === '4')?.count).toBe(1)
  })

  it('summarizes population density, polity territory, culture, and religion layers', () => {
    const pop = buildLayerStatisticsFromReader(civReader, { activeThematicId: 'population-density' })
    expect(pop.description).toContain('聚落 1 座')
    expect(pop.rows.find(row => row.key === 'ocean')?.count).toBe(1)

    const polity = buildLayerStatisticsFromReader(civReader, { activeThematicId: 'polity-territory' })
    expect(polity.rows.find(row => row.key === '0')?.label).toBe('奥斯帝国')
    expect(polity.rows.find(row => row.key === '0')?.count).toBe(2)
    expect(polity.rows.find(row => row.key === 'unowned')?.count).toBe(1)

    const culture = buildLayerStatisticsFromReader(civReader, { activeThematicId: 'culture-dominant' })
    expect(culture.rows.find(row => row.key === '0')?.count).toBe(2)
    expect(culture.rows.find(row => row.key === '1')?.count).toBe(1)

    const religion = buildLayerStatisticsFromReader(civReader, { activeThematicId: 'religion-dominant' })
    expect(religion.rows.find(row => row.key === '0')?.label).toBe('晨曦教')
    expect(religion.rows.find(row => row.key === 'unowned')?.count).toBe(1)
  })

  it('returns empty rows with clear notice when civilization capability is disabled', () => {
    const disabledReader = {
      ...civReader,
      capabilities: { hasResources: false, hasCivilization: false },
    } as unknown as WorldMapReader

    expect(buildLayerStatisticsFromReader(disabledReader, { activeThematicId: 'agricultural-potential' }).rows).toHaveLength(0)
    expect(buildLayerStatisticsFromReader(disabledReader, { activeThematicId: 'population-density' }).rows).toHaveLength(0)
    expect(buildLayerStatisticsFromReader(disabledReader, { activeThematicId: 'polity-territory' }).rows).toHaveLength(0)
  })
})
