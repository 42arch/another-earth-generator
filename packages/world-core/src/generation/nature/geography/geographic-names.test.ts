import type { GeographicRegionsArtifact } from './geographic-regions'
import { describe, expect, it } from 'vitest'
import { testNamingStyle } from '#content/test-content'
import { nameGeographicRegions } from './geographic-names'

const style = {
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

describe('geographic names', () => {
  it('uses stable IDs and style identity, resolves duplicates and leaves seas unnamed', () => {
    const first = nameGeographicRegions(regions, 'seed', style, 'style:v1')
    const reordered = nameGeographicRegions({ ...regions, continents: [...regions.continents].reverse() }, 'seed', style, 'style:v1')
    expect(first).toEqual(nameGeographicRegions(regions, 'seed', style, 'style:v1'))
    expect(first.continents.map(item => item.name).sort()).toEqual(['苍岚', '苍岚·二'])
    expect(Object.fromEntries(first.continents.map(item => [item.id, item.name]))).toEqual(Object.fromEntries(reordered.continents.map(item => [item.id, item.name])))
    expect(first.nameStyleId).toBe(style.id)
    expect(first.nameStyleSignature).toBe('style:v1')
    expect(first.seas).toEqual(regions.seas)
    expect(first.continentIndex).toEqual(regions.continentIndex)
    expect(regions.continents.every(item => item.name === undefined)).toBe(true)
  })

  it.each(['continent', 'ocean'] as const)('rejects missing %s rule even when regions are empty', (missing) => {
    const rules = { ...style.rules }
    delete (rules as Partial<typeof rules>)[missing]
    expect(() => nameGeographicRegions({ ...regions, continents: [], oceans: [] }, 'seed', { ...style, rules }, 'style:v1')).toThrow(/rule.*missing/i)
  })
})
