import type { GeologyArtifact } from '../geology/types'
import { createSphericalMesh } from '#mesh/spherical-mesh'
import { describe, expect, it } from 'vitest'
import { generateGeographicRegions, validateGeographicRegions } from './geographic-regions'

const mesh = createSphericalMesh({ subdivisionLevel: 1, irregularity: 0, physicalRadiusKm: 6371 })
const farthest = (start: number) => {
  let result = -1
  let distance = -Infinity
  for (let region = 0; region < mesh.regionCount; region++) {
    const dot = mesh.centers[3 * start] * mesh.centers[3 * region]
      + mesh.centers[3 * start + 1] * mesh.centers[3 * region + 1]
      + mesh.centers[3 * start + 2] * mesh.centers[3 * region + 2]
    if (dot < distance || result < 0) {
      distance = dot
      result = region
    }
  }
  return result
}

function geology(sources: number): Pick<GeologyArtifact, 'meshId' | 'continents' | 'nearestContinentIndex'> {
  return {
    meshId: mesh.meshId,
    continents: Array.from({ length: sources }, (_, index) => ({ id: `candidate:${index}`, referenceSeedRegion: index })),
    nearestContinentIndex: Int32Array.from({ length: mesh.regionCount }, (_, index) => sources ? index === 0 ? 0 : 1 % sources : -1),
  }
}

describe('final geographic regions', () => {
  it('splits two broad basins across a land-controlled clearance saddle', () => {
    const links: [number, number, number][] = [[0, 1, 1], [0, 100, 1], [0, 101, 1], [101, 50, 4]]
    for (let region = 1; region < 100; region++) links.push([region, region + 1, 1])
    const adjacency: { next: number, edge: number }[][] = Array.from({ length: 102 }, () => [])
    links.forEach(([a, b], edge) => {
      adjacency[a].push({ next: b, edge })
      adjacency[b].push({ next: a, edge })
    })
    const offsets = new Uint32Array(103)
    const neighbors: number[] = []
    const neighborEdges: number[] = []
    for (let region = 0; region < 102; region++) {
      for (const item of adjacency[region]) {
        neighbors.push(item.next)
        neighborEdges.push(item.edge)
      }
      offsets[region + 1] = neighbors.length
    }
    const basinMesh = {
      meshId: 'two-basins', regionCount: 102, physicalRadiusKm: 100,
      areaKm2: new Float64Array(102).fill(1), neighborOffsets: offsets,
      neighbors: Uint32Array.from(neighbors), neighborEdges: Uint32Array.from(neighborEdges),
      edgeAngularDistances: Float64Array.from(links, link => link[2] / 100),
    }
    const land = new Uint8Array(102)
    land[0] = 1
    land[101] = 1
    const source = { meshId: basinMesh.meshId, continents: [{ id: 'continent:one', referenceSeedRegion: 0 }], nearestContinentIndex: new Int32Array(102) }
    const first = generateGeographicRegions(basinMesh, land, source)
    expect(first.oceans).toHaveLength(2)
    expect(first.seas).toHaveLength(0)
    expect(first.oceanIndex[25]).not.toBe(first.oceanIndex[75])
    expect(first.oceanIndex[50]).toBeGreaterThanOrEqual(0)
    expect(generateGeographicRegions(basinMesh, land, source)).toEqual(first)
    validateGeographicRegions(first, basinMesh.meshId, 102, land)
  })

  it('keeps an open coast in the ocean and identifies a sea behind a narrow entrance', () => {
    const links: [number, number][] = [[0, 1], [0, 31], [30, 31], [31, 32], [32, 33]]
    for (let region = 1; region < 30; region++) links.push([region, region + 1])
    const adjacency: { next: number, edge: number }[][] = Array.from({ length: 34 }, () => [])
    links.forEach(([a, b], edge) => {
      adjacency[a].push({ next: b, edge })
      adjacency[b].push({ next: a, edge })
    })
    const offsets = new Uint32Array(35)
    const neighbors: number[] = []
    const neighborEdges: number[] = []
    for (let region = 0; region < 34; region++) {
      for (const item of adjacency[region]) {
        neighbors.push(item.next)
        neighborEdges.push(item.edge)
      }
      offsets[region + 1] = neighbors.length
    }
    const narrowMesh = {
      meshId: 'neck-fixture', regionCount: 34, physicalRadiusKm: 100,
      areaKm2: new Float64Array(34).fill(1), neighborOffsets: offsets,
      neighbors: Uint32Array.from(neighbors), neighborEdges: Uint32Array.from(neighborEdges),
      edgeAngularDistances: new Float64Array(links.length).fill(0.01),
    }
    const land = new Uint8Array(34)
    land[0] = 1
    const source = { meshId: narrowMesh.meshId, continents: [{ id: 'continent:one', referenceSeedRegion: 0 }], nearestContinentIndex: new Int32Array(34) }
    const regions = generateGeographicRegions(narrowMesh, land, source)
    expect(regions.oceans).toHaveLength(1)
    expect(regions.seas).toHaveLength(1)
    expect(regions.oceanIndex[1]).toBe(0)
    expect(regions.seaIndex[33]).toBe(0)
    expect(regions.oceanIndex[33]).toBe(-1)
    validateGeographicRegions(regions, narrowMesh.meshId, 34, land)
  })

  it('classifies a water world as one ocean and a land world as one continent', () => {
    const water = generateGeographicRegions(mesh, new Uint8Array(mesh.regionCount), geology(0))
    expect(water.continents).toHaveLength(0)
    expect(water.oceans).toHaveLength(1)
    expect(water.seas).toHaveLength(0)
    expect(water.oceanIndex.every(value => value === 0)).toBe(true)
    validateGeographicRegions(water, mesh.meshId, mesh.regionCount, new Uint8Array(mesh.regionCount))

    const land = new Uint8Array(mesh.regionCount).fill(1)
    const continents = generateGeographicRegions(mesh, land, geology(2))
    expect(continents.continents).toHaveLength(1)
    expect(continents.oceans).toHaveLength(0)
    expect(continents.seas).toHaveLength(0)
    expect(continents.continentIndex.every(value => value === 0)).toBe(true)
    validateGeographicRegions(continents, mesh.meshId, mesh.regionCount, land)
  })

  it('uses final land, partitions open water deterministically, and keeps enclosed water separate', () => {
    const opposite = farthest(0)
    const land = new Uint8Array(mesh.regionCount)
    land[0] = 1
    land[opposite] = 1
    const source = geology(2)
    source.nearestContinentIndex[opposite] = 1
    const first = generateGeographicRegions(mesh, land, source)
    const second = generateGeographicRegions(mesh, land, source)
    expect(first).toEqual(second)
    expect(first.continents).toHaveLength(2)
    expect(first.oceans.length).toBeGreaterThan(0)
    expect(first.continentIndex[0]).not.toBe(first.continentIndex[opposite])
    for (let region = 0; region < mesh.regionCount; region++) {
      expect(first.continentIndex[region] >= 0).toBe(Boolean(land[region]))
      expect((first.oceanIndex[region] >= 0) !== (first.seaIndex[region] >= 0)).toBe(!land[region])
    }
    validateGeographicRegions(first, mesh.meshId, mesh.regionCount, land)

    const enclosed = new Uint8Array(mesh.regionCount).fill(1)
    enclosed[0] = 0
    enclosed[opposite] = 0
    const water = generateGeographicRegions(mesh, enclosed, source)
    expect(water.oceans).toHaveLength(0)
    expect(water.seas).toHaveLength(2)
    expect([water.seaIndex[0], water.seaIndex[opposite]].sort()).toEqual([0, 1])
    validateGeographicRegions(water, mesh.meshId, mesh.regionCount, enclosed)
    const broken = { ...water, continentIndex: water.continentIndex.slice() }
    broken.continentIndex[0] = 0
    expect(() => validateGeographicRegions(broken, mesh.meshId, mesh.regionCount, enclosed)).toThrow()
  })
})
