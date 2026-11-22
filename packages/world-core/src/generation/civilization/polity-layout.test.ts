import { describe, expect, it } from 'vitest'
import { buildTerritoryComponents, checkPolityCountBudget, createPolityAreaTargets, growPolityTerritories, selectPolityCapitals } from './polity-layout'

function grid(width = 20, height = 10) {
  const n = width * height
  const adjacency = Array.from({ length: n }, (_, r) => {
    const x = r % width
    const y = Math.floor(r / width)
    return [x > 0 ? r - 1 : -1, x + 1 < width ? r + 1 : -1, y > 0 ? r - width : -1, y + 1 < height ? r + width : -1].filter(v => v >= 0)
  })
  const offsets = new Uint32Array(n + 1)
  adjacency.forEach((list, i) => offsets[i + 1] = offsets[i]! + list.length)
  return {
    regionCount: n, centers: Float64Array.from(Array.from({ length: n }, (_, i) => [Math.sin(i / 1000), 0, Math.cos(i / 1000)]).flat()),
    physicalRadiusKm: 1000, areaKm2: new Float64Array(n).fill(10), neighborOffsets: offsets, neighbors: Uint32Array.from(adjacency.flat()),
  }
}

function coefficientOfVariation(areas: readonly number[]) {
  const mean = areas.reduce((a, b) => a + b, 0) / areas.length
  return Math.sqrt(areas.reduce((sum, area) => sum + (area - mean) ** 2, 0) / areas.length) / mean
}

describe('polity count and territory size budgets', () => {
  it('requires enough sites for the exact count without silently shrinking the budget', () => {
    expect(() => checkPolityCountBudget(1, 8)).not.toThrow()
    expect(() => checkPolityCountBudget(60, 60)).not.toThrow()
    expect(() => checkPolityCountBudget(200, 200)).not.toThrow()
    expect(() => checkPolityCountBudget(60, 59)).toThrow('Requested 60 polities, but only 59 distinct land settlements')
    expect(() => checkPolityCountBudget(1, 0)).toThrow('feasible count: 0')
  })

  it('gives disconnected populated components first claim on the same global budget', () => {
    const mesh = grid(5, 1)
    const land = Uint8Array.from([1, 1, 0, 1, 1])
    const lakes = new Int32Array(5).fill(-1)
    const population = Float64Array.from([100, 100, 0, 20, 20])
    const components = buildTerritoryComponents(mesh, land, lakes, population, new Map())
    const sites = [{ id: 'a', regionId: 0 }, { id: 'b', regionId: 1 }, { id: 'island', regionId: 4 }]
    const two = selectPolityCapitals(sites, 2, mesh, components, () => 1)
    expect(two.map(s => s.id)).toEqual(['a', 'island'])
    const one = selectPolityCapitals(sites, 1, mesh, components, () => 1)
    expect(one.map(s => s.id)).toEqual(['a'])
    const owners = growPolityTerritories({ mesh, landMask: land, lakeIndex: lakes, capitalRegions: [0], targetAreasKm2: Float64Array.from([20]), shortcuts: new Map(), landStepCost: () => 1, shortcutCost: () => 1 })
    expect([...owners]).toEqual([0, 0, -1, -1, -1])
  })

  it('conserves physical land area and produces balanced versus unequal territories without deleting capitals', () => {
    const mesh = grid()
    const land = new Uint8Array(mesh.regionCount).fill(1)
    const lakes = new Int32Array(mesh.regionCount).fill(-1)
    lakes[0] = 0
    const components = buildTerritoryComponents(mesh, land, lakes, new Float64Array(mesh.regionCount).fill(1), new Map())
    const capitals = [21, 38, 161, 178]
    const run = (variation: number) => {
      const targets = createPolityAreaTargets(mesh, capitals, components, variation, [4, 3, 2, 1])
      const owners = growPolityTerritories({ mesh, landMask: land, lakeIndex: lakes, capitalRegions: capitals, targetAreasKm2: targets, shortcuts: new Map(), landStepCost: () => 1, shortcutCost: () => 1 })
      const areas = capitals.map(() => 0)
      for (let r = 0; r < mesh.regionCount; r++) {
        expect(owners[r]).toBeGreaterThanOrEqual(0)
        if (lakes[r]! < 0)
          areas[owners[r]!]! += mesh.areaKm2[r]!
      }
      capitals.forEach((r, p) => expect(owners[r]).toBe(p))
      expect(areas.reduce((a, b) => a + b, 0)).toBe(1990)
      expect([...targets].reduce((a, b) => a + b, 0)).toBeCloseTo(1990)
      return { owners, areas }
    }
    const balanced = run(0)
    const unequal = run(1)
    expect(coefficientOfVariation(balanced.areas)).toBeLessThan(0.1)
    expect(coefficientOfVariation(unequal.areas)).toBeGreaterThan(coefficientOfVariation(balanced.areas) + 0.3)
    expect(run(1)).toEqual(unequal)
  })

  it('uses traversal cost to select a country frontier while keeping its area budget', () => {
    const mesh = grid(3, 3)
    const land = new Uint8Array(9).fill(1)
    const lakes = new Int32Array(9).fill(-1)
    const components = buildTerritoryComponents(mesh, land, lakes, new Float64Array(9).fill(1), new Map())
    const run = (mountain: number) => growPolityTerritories({
      mesh, landMask: land, lakeIndex: lakes, capitalRegions: [0, 8], targetAreasKm2: createPolityAreaTargets(mesh, [0, 8], components, 0, [1, 0]), shortcuts: new Map(),
      landStepCost: (_p, _u, v) => v === mountain ? 100 : 1, shortcutCost: () => 1,
    })
    expect([...run(1)]).not.toEqual([...run(3)])
  })
})
