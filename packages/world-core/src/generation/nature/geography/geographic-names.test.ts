import type { NamePool } from '@another-earth/world-data'
import type { GeographicRegionsArtifact } from './geographic-regions'
import { describe, expect, it } from 'vitest'
import { nameGeographicRegions } from './geographic-names'

const pool = (id: 'continent' | 'ocean'): NamePool => ({ id: `test:names/${id}`, displayNameKey: id, tags: [], entries: [{ value: '苍岚', weight: 1 }] })
const regions: GeographicRegionsArtifact = {
  meshId: 'mesh:test', algorithmVersion: 'geographic-regions-v3',
  continentIndex: new Int32Array([0, 1, -1, -1]), oceanIndex: new Int32Array([-1, -1, 0, -1]), seaIndex: new Int32Array([-1, -1, -1, 0]),
  continents: [{ id: 'continent:b', areaKm2: 1 }, { id: 'continent:a', areaKm2: 1 }],
  oceans: [{ id: 'ocean:a', areaKm2: 1 }], seas: [{ id: 'sea:a', areaKm2: 1 }],
}

describe('geographic names', () => {
  it('uses stable IDs and content identity, resolves duplicates and leaves seas unnamed', () => {
    const pools = { continent: pool('continent'), ocean: pool('ocean') }
    const first = nameGeographicRegions(regions, 'seed', pools, 'content:v1')
    const reordered = nameGeographicRegions({ ...regions, continents: [...regions.continents].reverse() }, 'seed', pools, 'content:v1')
    expect(first).toEqual(nameGeographicRegions(regions, 'seed', pools, 'content:v1'))
    expect(new Set(first.continents.map(item => item.name)).size).toBe(2)
    expect(first.continents.map(item => item.name).sort()).toEqual(['苍岚', '苍岚·二'])
    expect(Object.fromEntries(first.continents.map(item => [item.id, item.name]))).toEqual(Object.fromEntries(reordered.continents.map(item => [item.id, item.name])))
    expect(first.nameContentSignature).toBe('content:v1')
    expect(first.seas).toEqual(regions.seas)
    expect(first.continentIndex).toEqual(regions.continentIndex)
    expect(regions.continents.every(item => item.name === undefined)).toBe(true)
  })
})
