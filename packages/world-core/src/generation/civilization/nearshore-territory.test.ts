import { describe, expect, it } from 'vitest'
import { claimMaritimeTerritory, claimNearshoreTerritory } from './nearshore-territory'

function fixture(options: {
  positionsKm: readonly number[]
  seaRegions: readonly number[]
  claims: readonly number[]
  edges?: readonly (readonly [number, number])[]
  movementCost?: readonly number[]
}) {
  const n = options.positionsKm.length
  const adjacency: number[][] = Array.from({ length: n }, () => [])
  const edges = options.edges ?? Array.from({ length: n - 1 }, (_, r) => [r, r + 1] as const)
  for (const [a, b] of edges) {
    adjacency[a]!.push(b)
    adjacency[b]!.push(a)
  }
  const neighborOffsets = new Uint32Array(n + 1)
  for (let r = 0; r < n; r++)
    neighborOffsets[r + 1] = neighborOffsets[r]! + adjacency[r]!.length
  const mesh = {
    regionCount: n,
    centers: Float64Array.from(options.positionsKm.flatMap((km) => {
      const angle = km / 1000
      return [Math.sin(angle), 0, Math.cos(angle)]
    })),
    physicalRadiusKm: 1000,
    neighborOffsets,
    neighbors: Uint32Array.from(adjacency.flat()),
  }
  const landMask = new Uint8Array(n).fill(1)
  for (const r of options.seaRegions)
    landMask[r] = 0
  const movementCost = options.movementCost ? Float32Array.from(options.movementCost) : undefined

  const assertInvariants = (ownership: Int32Array) => {
    for (let r = 0; r < n; r++) {
      if (landMask[r] === 0)
        expect(ownership[r]).toBe(-1)
      if (options.claims[r]! >= 0)
        expect(ownership[r]).toBe(options.claims[r])
    }
  }

  const run = () => {
    const ownership = Int32Array.from(options.claims)
    claimNearshoreTerritory(mesh, landMask, ownership)
    assertInvariants(ownership)
    return Array.from(ownership)
  }

  run.maritime = (maritimeOptions: Omit<Parameters<typeof claimMaritimeTerritory>[3], 'movementCost'>) => {
    const ownership = Int32Array.from(options.claims)
    claimMaritimeTerritory(mesh, landMask, ownership, { ...maritimeOptions, movementCost })
    assertInvariants(ownership)
    return Array.from(ownership)
  }

  return run
}

describe('nearshore territory', () => {
  it('claims the whole connected island even beyond the crossing limit inland', () => {
    const run = fixture({
      positionsKm: [0, 80, 160, 260, 460],
      seaRegions: [1],
      claims: [0, -1, -1, -1, -1],
    })
    // Center-to-center distance to the first landing is 160 km, but only
    // 40 + 40 = 80 km is water. The remaining 300 km of land has no cap.
    expect(run()).toEqual([0, -1, 0, 0, 0])
    expect(run()).toEqual(run())
  })

  it('partitions the entire island between competing landings by total distance', () => {
    const run = fixture({
      positionsKm: [0, 40, 80, 120, 180, 220, 260],
      seaRegions: [1, 5],
      claims: [0, -1, -1, -1, -1, -1, 1],
    })
    expect(run()).toEqual([0, -1, 0, 0, 1, -1, 1])
    expect(run()).toEqual(run())
  })

  it('keeps equal-distance competition deterministic without leaving a gray gap', () => {
    const run = fixture({
      positionsKm: [0, 40, 80, 130, 180, 220, 260],
      seaRegions: [1, 5],
      claims: [0, -1, -1, -1, -1, -1, 1],
    })
    const result = run()
    expect([0, 1]).toContain(result[3])
    expect(result[2]).toBe(0)
    expect(result[4]).toBe(1)
    expect(run()).toEqual(result)
  })

  it('leaves a distant island unclaimed across multiple sea cells', () => {
    const run = fixture({
      positionsKm: [0, 80, 160, 240, 300],
      seaRegions: [1, 2],
      claims: [0, -1, -1, -1, -1],
    })
    // Water distance is 40 + 80 + 40 = 160 km, above the ~112 km limit.
    expect(run()).toEqual([0, -1, -1, -1, -1])
  })

  it('counts sea-to-sea edges in full for an eligible multi-cell crossing', () => {
    const run = fixture({
      positionsKm: [0, 40, 80, 120, 320],
      seaRegions: [1, 2],
      claims: [0, -1, -1, -1, -1],
    })
    expect(run()).toEqual([0, -1, -1, 0, 0])
  })

  it('does not restart sea reach from an acquired island or tunnel through it', () => {
    const run = fixture({
      positionsKm: [0, 40, 80, 180, 220, 260],
      seaRegions: [1, 4],
      claims: [0, -1, -1, -1, -1, -1],
    })
    expect(run()).toEqual([0, -1, 0, 0, -1, -1])
  })

  it('preserves existing claims and disconnected land', () => {
    const run = fixture({
      positionsKm: [0, 50, 100, 200, 300, 350],
      seaRegions: [1],
      claims: [0, -1, -1, -1, 1, -1],
      edges: [[0, 1], [1, 2], [2, 3], [3, 4]],
    })
    expect(run()).toEqual([0, -1, 0, 0, 1, -1])
  })

  it('leaves land unclaimed when no original territory can launch a crossing', () => {
    const run = fixture({
      positionsKm: [0, 40, 80],
      seaRegions: [1],
      claims: [-1, -1, -1],
    })
    expect(run()).toEqual([-1, -1, -1])
  })
})

describe('maritime territory projection', () => {
  it('makes no sea claims when the maritime budget is zero', () => {
    const run = fixture({
      positionsKm: [0, 40, 80],
      seaRegions: [1],
      claims: [0, -1, -1],
    })
    expect(run.maritime({ maxWaterBudgetKm: 0 })).toEqual([0, -1, -1])
  })

  it('supports budgeted island-chain hopping without unbounded relay', () => {
    const run = fixture({
      // Coast 0 -> sea 1 (40 km water) -> island 2-3 (40 km inland) -> sea 4 (40 km water) -> island 5 -> sea 6 (40 km water) -> island 7
      positionsKm: [0, 40, 80, 120, 160, 200, 240, 280],
      seaRegions: [1, 4, 6],
      claims: [0, -1, -1, -1, -1, -1, -1, -1],
    })
    // Hop to island 5 costs: 40 (sea1) + 40 (inland 2->3) + 30 (hop) + 40 (sea4) = 150 km.
    // Hop to island 7 would add 30 + 40 = 220 km, above the 180 km budget.
    const result = run.maritime({ maxWaterBudgetKm: 180, islandHopPenaltyKm: 30 })
    expect(result).toEqual([0, -1, 0, 0, -1, 0, -1, -1])
    expect(run.maritime({ maxWaterBudgetKm: 180, islandHopPenaltyKm: 30 })).toEqual(result)
  })

  it('prioritizes owned ports over non-port coasts without letting distant ports override close coasts', () => {
    // Island at 500 km; polity 0 non-port coast at 300 km (200 km sea), polity 1 port at 760 km (260 km sea).
    const run = fixture({
      positionsKm: [300, 400, 500, 630, 760],
      seaRegions: [1, 3],
      claims: [0, -1, -1, -1, 1],
    })
    const portMask = new Uint8Array([0, 0, 0, 0, 1])
    // With 150 km non-port penalty: polity 0 = 150 + 100 = 250 vs polity 1 = 0 + 130 = 130 -> port wins.
    expect(run.maritime({
      maxWaterBudgetKm: 500,
      prioritySourceMask: portMask,
      nonPriorityPenaltyKm: 150,
    })).toEqual([0, -1, 1, -1, 1])

    // If polity 1 port is much farther (600 km water vs 100 km water + 150 km penalty), nearby coast still wins.
    const farPort = fixture({
      positionsKm: [300, 400, 500, 800, 1100],
      seaRegions: [1, 3],
      claims: [0, -1, -1, -1, 1],
    })
    expect(farPort.maritime({
      maxWaterBudgetKm: 800,
      prioritySourceMask: portMask,
      nonPriorityPenaltyKm: 150,
    })).toEqual([0, -1, 0, -1, 1])
  })

  it('respects sea movement cost and claims the entire reached island regardless of inland length', () => {
    const run = fixture({
      positionsKm: [0, 100, 200, 300, 600, 1000],
      seaRegions: [1, 2],
      claims: [0, -1, -1, -1, -1, -1],
      movementCost: [1, 0.55, 1.35, 1, 1, 1],
    })
    // Water cost: 50 * 0.55 (0->1) + 100 * 0.95 (1->2) + 50 * 1.35 (2->3) = 27.5 + 95 + 67.5 = 190 km.
    expect(run.maritime({ maxWaterBudgetKm: 180 })).toEqual([0, -1, -1, -1, -1, -1])
    expect(run.maritime({ maxWaterBudgetKm: 200 })).toEqual([0, -1, -1, 0, 0, 0])
  })

  it('modulates open-ocean competition by per-polity sea cost factors', () => {
    // Island at 2 sits equidistant between polity 0 (at 0) and polity 1 (at 4).
    const run = fixture({
      positionsKm: [0, 100, 200, 300, 400],
      seaRegions: [1, 3],
      claims: [0, -1, -1, -1, 1],
    })
    // Polity 1 has maritime/mercantile advantage (0.68x sea cost) vs polity 0's nomadic disadvantage (1.6x).
    expect(run.maritime({
      maxWaterBudgetKm: 500,
      politySeaCostFactors: [1.6, 0.68],
    })).toEqual([0, -1, 1, -1, 1])

    // When budget is tight, only the mercantile polity can cross the open sea to claim the island.
    const singleRange = fixture({
      positionsKm: [0, 150, 300, 450, 600],
      seaRegions: [1, 3],
      claims: [0, -1, -1, -1, 1],
    })
    expect(singleRange.maritime({
      maxWaterBudgetKm: 140,
      politySeaCostFactors: [1.6, 0.68],
    })).toEqual([0, -1, 1, -1, 1])
  })
})
