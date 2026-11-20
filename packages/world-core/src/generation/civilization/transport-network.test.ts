import { describe, expect, it } from 'vitest'
import { REFERENCE_TRAVEL_KM_PER_DAY } from './population-settlements'
import { generateTransportNetwork, validateTransportNetworkArtifact } from './transport-network'

type TransportInput = Parameters<typeof generateTransportNetwork>

function createFixture(options: {
  angles: readonly number[]
  edges: readonly (readonly [number, number])[]
  settlementRegions: readonly number[]
  movementCosts: readonly number[]
  seaRegions?: readonly number[]
}): TransportInput {
  const n = options.angles.length
  const meshId = 'transport-search-regression'
  const adjacency: number[][] = Array.from({ length: n }, () => [])
  for (const [a, b] of options.edges) {
    adjacency[a]!.push(b)
    adjacency[b]!.push(a)
  }
  const neighborOffsets = new Uint32Array(n + 1)
  for (let r = 0; r < n; r++)
    neighborOffsets[r + 1] = neighborOffsets[r]! + adjacency[r]!.length
  const landMask = new Uint8Array(n).fill(1)
  for (const r of options.seaRegions ?? [])
    landMask[r] = 0
  const population = new Float64Array(n)
  const settlementSites = options.settlementRegions.map((regionId) => {
    population[regionId] = 1000
    return {
      id: `settlement:${regionId}`,
      regionId,
      tier: 'town' as const,
      isPort: options.seaRegions !== undefined,
      population: 500,
      foundedAtYear: -100,
      score: 1,
    }
  })
  return [
    {
      meshId,
      regionCount: n,
      // Equatorial centers give explicit angular distances; radius = 1000 km,
      // area = 1 km² must not change the reference travel speed.
      centers: Float64Array.from(options.angles.flatMap(angle => [Math.sin(angle), 0, Math.cos(angle)])),
      areaKm2: new Float64Array(n).fill(1),
      neighborOffsets,
      neighbors: Uint32Array.from(adjacency.flat()),
      physicalRadiusKm: 1000,
    },
    { meshId, landMask },
    { meshId, riverIndex: new Int32Array(n).fill(-1), downstreamRegion: new Int32Array(n).fill(-1) },
    { meshId, lakeIndex: new Int32Array(n).fill(-1) },
    { meshId, movementCost: Float32Array.from(options.movementCosts) },
    { meshId, enabled: true, population, settlementSites },
  ]
}

describe('transport network bounded searches', () => {
  it('counts five distinct land targets despite an improved target being queued twice', () => {
    const input = createFixture({
      angles: [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.2, 0.07],
      edges: [[0, 1], [0, 2], [1, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7]],
      settlementRegions: [0, 2, 3, 4, 5, 6, 7, 8],
      movementCosts: [20, 1, 1, 1, 1, 1, 1, 1, 1],
    })
    const result = generateTransportNetwork(...input)
    // 0→2 is queued by a direct expensive edge, then improved via 1.
    // Its stale entry precedes all other targets; it must not use a quota slot.
    // Inspect routes emitted by the first source so reverse searches cannot
    // conceal an early stop by adding the missing connection afterwards.
    const outgoing = result.routes.filter(route => route.fromNodeId === 'node:0')
    expect(outgoing.map(route => route.toNodeId)).toEqual(['node:2', 'node:3', 'node:4', 'node:5', 'node:6'])
    expect(outgoing.every(route => route.mode === 'road')).toBe(true)
    expect(Array.from(outgoing[0]!.regions)).toEqual([0, 1, 2])
    expect(outgoing[0]!.cost).toBeCloseTo((10 * 10.5 + 10) / REFERENCE_TRAVEL_KM_PER_DAY, 5)
    // Region 7 is beyond the search bound; region 8 has no connecting edges.
    expect(result.routes.some(route => route.fromNodeId === 'node:7' || route.toNodeId === 'node:7')).toBe(false)
    expect(result.accessibility[8]).toBe(1) // An isolated settlement remains its own accessibility source.
    expect(() => validateTransportNetworkArtifact(result)).not.toThrow()
    expect(generateTransportNetwork(...input)).toEqual(result)
  })

  it('counts four distinct sea targets despite an improved port being queued twice', () => {
    const input = createFixture({
      angles: [0, 0.001, 0.03, 0.04, 0.15, 0.25, 0.35],
      edges: [[0, 1], [0, 2], [1, 3], [2, 3], [2, 4], [2, 5], [2, 6]],
      settlementRegions: [0, 3, 4, 5, 6],
      movementCosts: [1, 20, 1, 1, 1, 1, 1],
      seaRegions: [1, 2],
    })
    const result = generateTransportNetwork(...input)
    // Sea cell 1 is reached first and queues port 3; sea cell 2 later
    // improves that port before either entry is popped. Both entries are
    // cheaper than the next port, so an unguarded search counts port 3 twice.
    const outgoing = result.routes.filter(route => route.fromNodeId === 'node:0' && route.mode === 'sea')
    expect(outgoing.map(route => route.toNodeId)).toEqual(['node:3', 'node:4', 'node:5', 'node:6'])
    expect(Array.from(outgoing[0]!.regions)).toEqual([0, 2, 3])
    expect(outgoing[0]!.cost).toBeCloseTo((30 + 10 * 0.7) / (REFERENCE_TRAVEL_KM_PER_DAY * 1.65), 5)
    expect(() => validateTransportNetworkArtifact(result)).not.toThrow()
    expect(generateTransportNetwork(...input)).toEqual(result)
  })
})
