import { describe, expect, it, vi } from 'vitest'
import { LayerCache } from '@/core/rendering/shared/layer-cache'
import { isLayerAffected } from '@/core/rendering/shared/layer-dependencies'
import { DEFAULT_GLOBE_GEN_PARAMS } from '@/core/spherical/config'
import { lakeThermalState } from '@/core/spherical/hydrology/lake-thermal-state'
import { LAKE_ICE_STATE } from '@/core/spherical/hydrology/hydrology-data'
import SphericalMesh from '@/core/spherical/spherical-mesh'
import { GenerationRuntime } from '@/core/world/generation-runtime'
import { mergeGenerationStages, planGeneration } from '@/core/world/generation-plan'
import { snapshotMesh } from '@/core/world/generation-protocol'

const params = { ...DEFAULT_GLOBE_GEN_PARAMS, seed: 91, subdivision: 2 }

describe('incremental generation', () => {
  it('merges changes independently of parameter edit order', () => {
    expect(mergeGenerationStages('religions', 'hydrology')).toBe('hydrology')
    expect(mergeGenerationStages('hydrology', 'religions')).toBe('hydrology')
    expect(planGeneration(params, { ...params, equatorTemperature: 29, religionCount: 8 })).toBe('hydrology')
    expect(planGeneration(params, { ...params, autoRotate: true, showRivers: false })).toBeNull()
  })

  it.each([
    { mountainStrength: 0.7 },
    { infiltration: 0.3 },
    { riverBasinThreshold: 0.003 },
    { settlementDensity: 0.7 },
    { shippingCurrentInfluence: 0.4 },
    { tradeActivity: 0.5 },
    { culturalBlending: 0.7 },
    { politicalCohesion: 0.7 },
    { religiousProselytism: 0.8 },
  ])('matches a full generation after changing %o', (change) => {
    const runtime = new GenerationRuntime()
    runtime.run(params, 'world')
    const next = { ...params, ...change }
    const incremental = runtime.run(next, null)
    const full = new GenerationRuntime().run(next, 'world')
    expect(incremental.data).toEqual(full.data)
    expect(incremental.mesh.triangles).toEqual(full.mesh.triangles)
  })

  it('rehydrates a transferred mesh without regenerating its topology', () => {
    const original = new GenerationRuntime().run(params, 'world').mesh
    const snapshot = structuredClone(snapshotMesh(original))
    const restored = new SphericalMesh(snapshot, snapshot.voronoi)
    expect(restored.regionArea).toBe(snapshot.voronoi.cellArea)
    const neighbor = restored.neighbors[restored.neighborOffsets[0]]
    expect(restored.voronoi.getSharedBoundaryCorners(0, neighbor))
      .toEqual(original.voronoi.getSharedBoundaryCorners(0, neighbor))
    expect(restored.distanceBetweenRegions(0, neighbor)).toBe(original.distanceBetweenRegions(0, neighbor))
  })
})

describe('cached overlays', () => {
  it('invalidates lake-sensitive contours without rebuilding terrain-independent layers', () => {
    expect(isLayerAffected('contours', 'hydrology')).toBe(true)
    expect(isLayerAffected('rivers', 'hydrology')).toBe(true)
    expect(isLayerAffected('plates', 'hydrology')).toBe(false)
    expect(isLayerAffected('graticule', 'world')).toBe(false)
    expect(isLayerAffected('roads', 'religions')).toBe(false)
  })

  it('lazily builds layers, reuses hidden geometry and isolates revisions', () => {
    const cache = new LayerCache<{ visible: boolean }>()
    const river = { visible: true }
    const buildRiver = vi.fn(() => [river])
    const buildRoad = vi.fn(() => [{ visible: true }])
    cache.sync('river', false, 1, buildRiver)
    expect(buildRiver).not.toHaveBeenCalled()
    cache.sync('river', true, 1, buildRiver)
    cache.sync('road', true, 1, buildRoad)
    cache.sync('river', false, 1, buildRiver)
    expect(river.visible).toBe(false)
    cache.sync('river', true, 1, buildRiver)
    expect(river.visible).toBe(true)
    expect(buildRiver).toHaveBeenCalledTimes(1)
    cache.sync('road', true, 2, buildRoad)
    expect(buildRiver).toHaveBeenCalledTimes(1)
    expect(buildRoad).toHaveBeenCalledTimes(2)
    cache.clear()
    cache.sync('river', true, 2, buildRiver)
    expect(buildRiver).toHaveBeenCalledTimes(2)
  })
})

describe('lake freezing', () => {
  it.each([
    [[10, 15, 20, 15], LAKE_ICE_STATE.OpenWater, 1],
    [[-15, 5, 20, 5], LAKE_ICE_STATE.SeasonallyFrozen, 0.75],
    [[-20, -10, -1, -10], LAKE_ICE_STATE.Subglacial, 0],
    [[-10, -2, 0, -2], LAKE_ICE_STATE.Subglacial, 0],
  ])('classifies the complete temperature cycle %o', (temperatures, iceState, fraction) => {
    expect(lakeThermalState(temperatures as number[])).toEqual({ iceState, openWaterFraction: fraction })
  })
})
