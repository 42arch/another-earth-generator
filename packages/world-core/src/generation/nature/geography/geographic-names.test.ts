import type { NamingStyleView } from '#content/content-port'
import type { GeographicRegionsArtifact } from './geographic-regions'
import { describe, expect, it } from 'vitest'
import { testNamingStyle } from '#content/test-content'
import { generateName } from '#generation/names/naming'
import { nameGeographicRegions } from './geographic-names'

const style: NamingStyleView = {
  ...testNamingStyle,
  pools: { continent: [{ value: '苍岚', weight: 1 }], ocean: [{ value: '苍岚', weight: 1 }] },
}
const regions: GeographicRegionsArtifact = {
  meshId: 'mesh:test',
  algorithmVersion: 'geographic-regions-v3',
  continentIndex: new Int32Array([0, 1, -1, -1]),
  oceanIndex: new Int32Array([-1, -1, 0, -1]),
  seaIndex: new Int32Array([-1, -1, -1, 0]),
  continents: [{ id: 'continent:b', areaKm2: 1 }, { id: 'continent:a', areaKm2: 1 }],
  oceans: [{ id: 'ocean:a', areaKm2: 1 }],
  seas: [{ id: 'sea:a', areaKm2: 1 }],
}

function entityWithName(styleForRule: NamingStyleView, rule: 'continent' | 'ocean', prefix: string, name: string): string {
  for (let index = 0; index < 80; index++) {
    const entityId = `${prefix}${index}`
    if (generateName({ style: styleForRule, styleSignature: 'style:v1', worldSeed: 'seed', entityId, rule }) === name)
      return entityId
  }
  return ''
}

describe('geographic names', () => {
  it('keeps one stable name per feature and leaves seas unnamed', () => {
    const varied: NamingStyleView = {
      ...testNamingStyle,
      pools: {
        continent: [{ value: '苍岚', weight: 1 }, { value: '玄岳', weight: 1 }],
        ocean: [{ value: '沧溟', weight: 1 }, { value: '玄岳', weight: 1 }],
      },
    }
    const first = nameGeographicRegions(regions, 'seed', varied, 'style:v1')
    const reordered = nameGeographicRegions({ ...regions, continents: [...regions.continents].reverse(), oceans: [...regions.oceans].reverse() }, 'seed', varied, 'style:v1')
    const names = [...first.continents, ...first.oceans].map(item => item.name)
    expect(first).toEqual(nameGeographicRegions(regions, 'seed', varied, 'style:v1'))
    expect(new Set(names).size).toBe(names.length)
    expect(names.every(name => name === '苍岚' || name === '玄岳' || name === '沧溟')).toBe(true)
    expect(names.join('')).not.toMatch(/[一二三四五六七八九十]/)
    expect(Object.fromEntries(first.continents.map(item => [item.id, item.name]))).toEqual(Object.fromEntries(reordered.continents.map(item => [item.id, item.name])))
    expect(Object.fromEntries(first.oceans.map(item => [item.id, item.name]))).toEqual(Object.fromEntries(reordered.oceans.map(item => [item.id, item.name])))
    expect(first.nameStyleId).toBe(varied.id)
    expect(first.nameStyleSignature).toBe('style:v1')
    expect(first.seas).toEqual(regions.seas)
    expect(first.continentIndex).toEqual(regions.continentIndex)
    expect(regions.continents.every(item => item.name === undefined)).toBe(true)
  })

  it('draws another unused candidate when the preferred name is taken', () => {
    const varied: NamingStyleView = {
      ...testNamingStyle,
      pools: {
        continent: [{ value: '甲', weight: 1 }, { value: '乙', weight: 1 }],
        ocean: [{ value: '丙', weight: 1 }],
      },
    }
    const continentA = 'continent:a'
    const preferred = generateName({ style: varied, styleSignature: 'style:v1', worldSeed: 'seed', entityId: continentA, rule: 'continent' })
    const continentB = entityWithName(varied, 'continent', 'continent:b', preferred)
    const oceanA = 'ocean:a'
    const oceanPreferred = generateName({ style: varied, styleSignature: 'style:v1', worldSeed: 'seed', entityId: oceanA, rule: 'ocean' })
    expect(continentB).not.toBe('')
    expect(oceanPreferred).toBe('丙')
    const named = nameGeographicRegions({
      ...regions,
      continents: [{ id: continentB, areaKm2: 1 }, { id: continentA, areaKm2: 1 }],
      oceans: [{ id: oceanA, areaKm2: 1 }],
    }, 'seed', varied, 'style:v1')
    expect(new Set(named.continents.map(item => item.name))).toEqual(new Set(['甲', '乙']))
    expect(named.oceans.map(item => item.name)).toEqual(['丙'])
  })

  it('does not give an ocean the same name as a continent', () => {
    const varied: NamingStyleView = {
      ...testNamingStyle,
      pools: {
        continent: [{ value: '甲', weight: 1 }, { value: '乙', weight: 1 }],
        ocean: [{ value: '甲', weight: 1 }, { value: '丙', weight: 1 }],
      },
    }
    const continentId = entityWithName(varied, 'continent', 'continent:c', '甲')
    const oceanId = entityWithName(varied, 'ocean', 'ocean:c', '甲')
    expect(continentId).not.toBe('')
    expect(oceanId).not.toBe('')
    const named = nameGeographicRegions({
      ...regions,
      continents: [{ id: continentId, areaKm2: 1 }],
      oceans: [{ id: oceanId, areaKm2: 1 }],
    }, 'seed', varied, 'style:v1')
    const names = [named.continents[0]?.name, named.oceans[0]?.name]
    expect(new Set(names).size).toBe(2)
    expect(names).toContain('甲')
    expect(names.every(name => name === '甲' || name === '乙' || name === '丙')).toBe(true)
  })

  it('fails instead of appending an ordinal when every candidate is already used', () => {
    expect(() => nameGeographicRegions(regions, 'seed', style, 'style:v1')).toThrow(/cannot assign a unique name/i)
  })

  it.each(['continent', 'ocean'] as const)('rejects missing %s rule even when regions are empty', (missing) => {
    const rules = { ...style.rules }
    delete (rules as Partial<typeof rules>)[missing]
    expect(() => nameGeographicRegions({ ...regions, continents: [], oceans: [] }, 'seed', { ...style, rules }, 'style:v1')).toThrow(/rule.*missing/i)
  })
})
