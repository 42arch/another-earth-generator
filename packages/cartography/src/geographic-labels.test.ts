import type { GeographicRegionsArtifact, SphericalMesh } from '@another-earth/world-core'
import { describe, expect, it } from 'vitest'
import { buildGeographicLabelAnchors } from './geographic-labels'

const mesh = {
  meshId: 'mesh:labels', regionCount: 5,
  centers: new Float64Array([1, 0, 0, 0.8, 0.6, 0, -1, 0, 0, 0, 0, 1, 0, 0.8, 0.6]),
  areaKm2: new Float64Array([3, 1, 2, 3, 1]),
} satisfies Pick<SphericalMesh, 'meshId' | 'regionCount' | 'centers' | 'areaKm2'>

const regions = {
  meshId: mesh.meshId, algorithmVersion: 'geographic-regions-v3',
  continentIndex: new Int32Array([0, 0, 1, -1, -1]), oceanIndex: new Int32Array([-1, -1, -1, 0, 0]), seaIndex: new Int32Array(5).fill(-1),
  continents: [{ id: 'continent:a', name: '苍岚', areaKm2: 4 }, { id: 'continent:b', areaKm2: 2 }],
  oceans: [{ id: 'ocean:a', name: '沧溟', areaKm2: 4 }], seas: [],
} satisfies GeographicRegionsArtifact

describe('geographic map label anchors', () => {
  it('places only named continents and oceans on their own cells', () => {
    const anchors = buildGeographicLabelAnchors(mesh, regions)
    expect(anchors.map(anchor => [anchor.kind, anchor.name, anchor.position])).toEqual([
      ['continent', '苍岚', [1, 0, 0]],
      ['ocean', '沧溟', [0, 0, 1]],
    ])
    expect(anchors.map(anchor => anchor.areaKm2)).toEqual([4, 4])
    expect(buildGeographicLabelAnchors(mesh, regions)).toEqual(anchors)
  })

  it('rejects mismatched classification data', () => {
    expect(() => buildGeographicLabelAnchors({ ...mesh, meshId: 'other' }, regions)).toThrow('matching mesh')
    expect(() => buildGeographicLabelAnchors(mesh, { ...regions, oceanIndex: new Int32Array(3) })).toThrow('matching mesh')
  })

  it('falls back to a member cell when the spherical center cancels out', () => {
    const symmetricMesh = { ...mesh, regionCount: 2, centers: new Float64Array([1, 0, 0, -1, 0, 0]), areaKm2: new Float64Array([1, 1]) }
    const symmetricRegions = {
      ...regions,
      continentIndex: new Int32Array([0, 0]), oceanIndex: new Int32Array([-1, -1]), seaIndex: new Int32Array([-1, -1]),
      continents: [{ id: 'continent:wide', name: '广原', areaKm2: 2 }], oceans: [],
    }
    expect(buildGeographicLabelAnchors(symmetricMesh, symmetricRegions)[0].position).toEqual([1, 0, 0])
  })
})
