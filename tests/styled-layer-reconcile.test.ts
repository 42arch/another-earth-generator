import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { Scene, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { FibonacciSphereBuilder } from '@/core/mesh/fibonacci-sphere-builder'
import SphericalMesh from '@/core/mesh/mesh'
import { getMapProjection } from '@/core/projections/d3-map-projection'
import { GlobeLayerSet } from '@/core/rendering/globe/layer-set'
import { MapLayerSet } from '@/core/rendering/map/layer-set'

function createTestConfig(overrides: Partial<WorldConfig['appearance']> = {}): WorldConfig {
  return {
    seed: 12345,
    core: { planetRadius: 100, subdivisions: 4 },
    geology: {} as any,
    climate: { axialTiltDeg: 23.5 } as any,
    hydrology: {} as any,
    biomes: {} as any,
    civilization: {} as any,
    appearance: {
      baseMap: 'cartographic',
      surfaceField: 'default',
      mapStyle: 'standard',
      elevationDisplacement: true,
      autoRotate: false,
      climateMonth: 0,
      thematicFills: {},
      overlays: {
        'routes': false,
        'cities': false,
        'sacred-sites': false,
        'atmosphere': false,
        'clouds': false,
        'graticule': false,
        'rivers': true,
        'wireframe': false,
        'day-night': false,
        'nation-labels': false,
        'religion-labels': false,
        'ethnicity-labels': false,
        'language-labels': false,
      },
      ...overrides,
    },
  } as unknown as WorldConfig
}

function createMockData(mesh: SphericalMesh): WorldSimulationState {
  const n = mesh.numRegions
  return {
    geography: {
      elevation: new Float32Array(n),
      landMask: new Uint8Array(n),
    },
    climate: {
      displayVector: {
        kind: 'wind',
        month: 0,
        east: new Float32Array(n).fill(0.5),
        north: new Float32Array(n).fill(0.2),
      },
    },
  } as unknown as WorldSimulationState
}

describe('layer appearance reconciliation and lifecycle', () => {
  const mesh = new SphericalMesh(new FibonacciSphereBuilder().build(42, 32))
  const data = createMockData(mesh)
  const projection = getMapProjection('mercator')

  it('does not trigger river-ribbon rebuild when toggling unrelated overlays like clouds or wireframe', () => {
    const scene = new Scene()
    const configA = createTestConfig({ overlays: { rivers: true, clouds: false, wireframe: false } as any })
    const configB = createTestConfig({ overlays: { rivers: true, clouds: true, wireframe: true } as any })

    let currentConfig = configA
    const layerSet = new GlobeLayerSet(scene, () => ({
      mesh,
      data,
      params: currentConfig,
      sunlight: new Vector3(1, 1, 1),
    }))

    const styledLayers = (layerSet as any).styledLayers
    const rebuildSpy = vi.spyOn(styledLayers, 'rebuild')

    // 触发 updateOverlayVisibility
    layerSet.updateOverlayVisibility()
    // 之前在这行会强制调用 rebuild('river-ribbon')，优化后绝不应被调用
    expect(rebuildSpy).not.toHaveBeenCalledWith('river-ribbon', expect.anything())

    // 触发 reconcileAppearance
    currentConfig = configB
    layerSet.reconcileAppearance(configA, configB)
    // 依然不应该调用 river-ribbon 重建
    expect(rebuildSpy).not.toHaveBeenCalledWith('river-ribbon', expect.anything())
  })

  it('accurately reconciles river-ribbon without force recreation when rivers overlay toggles', () => {
    const scene = new Scene()
    const configRiversOn = createTestConfig({ overlays: { rivers: true } as any })
    const configRiversOff = createTestConfig({ overlays: { rivers: false } as any })

    const layerSet = new GlobeLayerSet(scene, () => ({
      mesh,
      data,
      params: configRiversOff,
      sunlight: new Vector3(1, 1, 1),
    }))

    const styledLayers = (layerSet as any).styledLayers
    const rebuildSpy = vi.spyOn(styledLayers, 'rebuild')

    layerSet.reconcileAppearance(configRiversOn, configRiversOff)
    // 应当调用 rebuild('river-ribbon', false) 进行隐藏，而不强行 dispose 几何体
    expect(rebuildSpy).toHaveBeenCalledWith('river-ribbon', false)
  })

  it('automatically triggers vectors rebuild in reconcileAppearance on climateMonth change', () => {
    const scene = new Scene()
    const configMonth0 = createTestConfig({ surfaceField: 'wind', climateMonth: 0 })
    const configMonth1 = createTestConfig({ surfaceField: 'wind', climateMonth: 1 })

    const globeSet = new GlobeLayerSet(scene, () => ({
      mesh,
      data,
      params: configMonth1,
      sunlight: new Vector3(1, 1, 1),
    }))

    const rebuildSpy = vi.spyOn(globeSet, 'rebuild')
    globeSet.reconcileAppearance(configMonth0, configMonth1)
    expect(rebuildSpy).toHaveBeenCalledWith('vectors')

    const mapSet = new MapLayerSet(scene, () => ({
      mesh,
      data,
      params: configMonth1,
      projection,
      centralMeridian: 0,
      viewportWidth: 800,
      viewportHeight: 600,
    }))
    const mapRebuildSpy = vi.spyOn(mapSet, 'rebuild')
    mapSet.reconcileAppearance(configMonth0, configMonth1)
    expect(mapRebuildSpy).toHaveBeenCalledWith('vectors')
  })
})
