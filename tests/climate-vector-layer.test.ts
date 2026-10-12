import type { ClimateVectorDisplayData } from '@/core/simulation/climate/climate-data'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { describe, expect, it } from 'vitest'
import { FibonacciSphereBuilder } from '@/core/mesh/fibonacci-sphere-builder'
import SphericalMesh from '@/core/mesh/mesh'
import { getMapProjection } from '@/core/projections/d3-map-projection'
import { GlobeClimateVectorLayer } from '@/core/rendering/globe/layers/globe-vector-layer'
import { MapClimateVectorLayer } from '@/core/rendering/map/layers/map-vector-layer'

function createMockData(mesh: SphericalMesh, kind: 'wind' | 'ocean-current'): WorldSimulationState {
  const n = mesh.numRegions
  const east = new Float32Array(n).fill(0.5)
  const north = new Float32Array(n).fill(0.2)
  const warmth = kind === 'ocean-current' ? new Float32Array(n).map((_, i) => (i % 2 === 0 ? 0.8 : -0.8)) : undefined
  const vectors: ClimateVectorDisplayData = {
    kind,
    east,
    north,
    warmth,
  }

  return {
    geography: {
      landMask: new Uint8Array(n),
    },
    climate: {
      displayVector: vectors,
    },
  } as unknown as WorldSimulationState
}

function createConfig(surfaceField: 'wind' | 'ocean-current'): WorldConfig {
  return {
    core: { planetRadius: 100 },
    appearance: {
      baseMap: 'cartographic',
      surfaceField,
      mapStyle: 'standard',
      overlays: {},
    },
  } as unknown as WorldConfig
}

describe('climate vector layers (wind and ocean-current)', () => {
  const mesh = new SphericalMesh(new FibonacciSphereBuilder().build(42, 32))
  const projection = getMapProjection('mercator')

  it('builds and disposes MapClimateVectorLayer without throwing for wind', () => {
    const data = createMockData(mesh, 'wind')
    const params = createConfig('wind')
    const layer = new MapClimateVectorLayer(mesh, data, params, projection, 0)

    expect(layer.group.children.length).toBeGreaterThan(0)
    expect(() => layer.dispose()).not.toThrow()
    expect(layer.group.children.length).toBe(0)
  })

  it('builds and disposes MapClimateVectorLayer without throwing for ocean-current', () => {
    const data = createMockData(mesh, 'ocean-current')
    const params = createConfig('ocean-current')
    const layer = new MapClimateVectorLayer(mesh, data, params, projection, 0)

    expect(layer.group.children.length).toBeGreaterThan(0)
    expect(() => layer.dispose()).not.toThrow()
    expect(layer.group.children.length).toBe(0)
  })

  it('builds and disposes GlobeClimateVectorLayer without throwing for wind and ocean-current', () => {
    const windData = createMockData(mesh, 'wind')
    const windParams = createConfig('wind')
    const windLayer = new GlobeClimateVectorLayer(mesh, windData, windParams)
    expect(windLayer.group.children.length).toBeGreaterThan(0)
    windLayer.dispose()

    const oceanData = createMockData(mesh, 'ocean-current')
    const oceanParams = createConfig('ocean-current')
    const oceanLayer = new GlobeClimateVectorLayer(mesh, oceanData, oceanParams)
    expect(oceanLayer.group.children.length).toBeGreaterThan(0)
    oceanLayer.dispose()
  })
})
