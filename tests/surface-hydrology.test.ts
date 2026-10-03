import { describe, expect, it } from 'vitest'
import { HYDROLOGY_RADIUS_M, HYDROLOGY_YEAR_SECONDS } from '@/core/hydrology/hydrology-units'
import { SurfaceHydrologyGenerator } from '@/core/hydrology/surface-hydrology-generator'
import { FibonacciSphereBuilder } from '@/core/mesh/fibonacci-sphere-builder'
import SphericalMesh from '@/core/mesh/mesh'

const mesh = new SphericalMesh(new FibonacciSphereBuilder().build(1024, 73, 0.3))
const elevation = Float32Array.from(mesh.regionLatitude, latitude => latitude < -0.5 ? -1 : 0.1 + latitude + 0.5)
const oceanMask = Uint8Array.from(elevation, height => height < 0 ? 1 : 0)
const runoff = Float32Array.from(mesh.regionLatitude, latitude => 100 + 900 * Math.max(0, Math.cos(latitude)))
const generator = new SurfaceHydrologyGenerator()

describe('spherical runoff accumulation', () => {
  it('routes every land cell in a complete acyclic topological order without carving terrain', () => {
    const before = Float32Array.from(elevation)
    const result = generator.routeRunoff(mesh, elevation, oceanMask, runoff)
    expect(elevation).toEqual(before)
    expect(result.topologicalOrder.length).toBe(oceanMask.reduce((sum, ocean) => sum + (ocean ? 0 : 1), 0))
    expect(new Set(result.topologicalOrder).size).toBe(result.topologicalOrder.length)
    const position = new Int32Array(mesh.numRegions).fill(-1)
    result.topologicalOrder.forEach((region, index) => position[region] = index)
    for (const region of result.topologicalOrder) {
      const target = result.downstream[region]
      if (target >= 0 && !oceanMask[target])
        expect(position[target]).toBeGreaterThan(position[region])
    }
  })

  it('balances physical runoff production against ocean outlets and closed sinks', () => {
    const result = generator.routeRunoff(mesh, elevation, oceanMask, runoff)
    let production = 0
    let terminalDischarge = 0
    for (const region of result.topologicalOrder) {
      production += runoff[region] / 1000 * mesh.regionArea[region] * HYDROLOGY_RADIUS_M ** 2 / HYDROLOGY_YEAR_SECONDS
      const target = result.downstream[region]
      if (target < 0 || oceanMask[target])
        terminalDischarge += result.discharge[region]
    }
    expect(Math.abs(terminalDischarge / production - 1)).toBeLessThan(1e-5)
  })

  it('doubles discharge when runoff doubles while retaining the drainage topology', () => {
    const low = generator.routeRunoff(mesh, elevation, oceanMask, runoff)
    const high = generator.routeRunoff(mesh, elevation, oceanMask, Float32Array.from(runoff, value => 2 * value))
    expect(high.downstream).toEqual(low.downstream)
    for (const region of low.topologicalOrder)
      expect(high.discharge[region]).toBeCloseTo(2 * low.discharge[region], 4)
  })

  it('produces no rivers when the effective runoff is zero', () => {
    const result = generator.generate(mesh, elevation, oceanMask, new Float32Array(mesh.numRegions))
    expect(result.discharge.every(value => value === 0)).toBe(true)
    expect(result.riverMask.every(value => value === 0)).toBe(true)
  })
})
