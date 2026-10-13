import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { describe, expect, it } from 'vitest'
import { computeGeoJsonSourceCacheKey } from '@/core/data-source'

describe('geoJsonSourceCacheKey', () => {
  const mockMesh = {
    numRegions: 10,
    regionPosition: new Float32Array(30),
  } as unknown as SphericalMesh

  const mockData = {
    geography: {
      elevation: new Float32Array(10),
      landMask: new Uint8Array(10),
    },
  } as unknown as WorldSimulationState

  const createParams = (overrides?: Partial<WorldConfig['appearance']>): WorldConfig => ({
    appearance: {
      mapStyle: 'standard',
      baseMap: 'cartographic',
      surfaceField: 'default',
      overlays: {
        'cities': false,
        'sacred-sites': false,
        'nation-labels': false,
        'religion-labels': false,
        'ethnicity-labels': false,
        'language-labels': false,
      },
      ...overrides,
    },
  } as unknown as WorldConfig)

  it('keeps area polygon and line sources independent of point overlays and map style', () => {
    const paramsA = createParams({
      mapStyle: 'standard',
      overlays: { 'cities': false, 'sacred-sites': false } as any,
    })
    const paramsB = createParams({
      mapStyle: 'light',
      overlays: { 'cities': true, 'sacred-sites': true } as any,
    })

    const areaKeyA = computeGeoJsonSourceCacheKey('polity-areas', mockMesh, mockData, paramsA)
    const areaKeyB = computeGeoJsonSourceCacheKey('polity-areas', mockMesh, mockData, paramsB)
    expect(areaKeyA).toBe('polity-areas')
    expect(areaKeyB).toBe('polity-areas')
    expect(areaKeyA).toBe(areaKeyB)

    const plateKeyA = computeGeoJsonSourceCacheKey('plate-areas', mockMesh, mockData, paramsA)
    const plateKeyB = computeGeoJsonSourceCacheKey('plate-areas', mockMesh, mockData, paramsB)
    expect(plateKeyA).toBe('plate-areas')
    expect(plateKeyB).toBe(plateKeyA)

    const riverKeyA = computeGeoJsonSourceCacheKey('river-network', mockMesh, mockData, paramsA)
    const riverKeyB = computeGeoJsonSourceCacheKey('river-network', mockMesh, mockData, paramsB)
    expect(riverKeyA).toBe('river-network')
    expect(riverKeyB).toBe(riverKeyA)

    const borderKeyA = computeGeoJsonSourceCacheKey('polity-boundaries', mockMesh, mockData, paramsA)
    const borderKeyB = computeGeoJsonSourceCacheKey('polity-boundaries', mockMesh, mockData, paramsB)
    expect(borderKeyA).toBe('polity-boundaries')
    expect(borderKeyB).toBe(borderKeyA)
  })

  it('differentiates settlement-labels cache key when cities or sacred-sites overlays change', () => {
    const paramsOff = createParams({ overlays: { 'cities': false, 'sacred-sites': false } as any })
    const paramsCitiesOn = createParams({ overlays: { 'cities': true, 'sacred-sites': false } as any })
    const paramsSacredOn = createParams({ overlays: { 'cities': false, 'sacred-sites': true } as any })
    const paramsStyleChanged = createParams({ mapStyle: 'dark', overlays: { 'cities': false, 'sacred-sites': false } as any })

    const keyOff = computeGeoJsonSourceCacheKey('settlement-labels', mockMesh, mockData, paramsOff)
    const keyCitiesOn = computeGeoJsonSourceCacheKey('settlement-labels', mockMesh, mockData, paramsCitiesOn)
    const keySacredOn = computeGeoJsonSourceCacheKey('settlement-labels', mockMesh, mockData, paramsSacredOn)
    const keyStyleChanged = computeGeoJsonSourceCacheKey('settlement-labels', mockMesh, mockData, paramsStyleChanged)

    expect(keyCitiesOn).not.toBe(keyOff)
    expect(keySacredOn).not.toBe(keyOff)
    expect(keyStyleChanged).not.toBe(keyOff)
  })

  it('differentiates polity-labels cache key when nation-labels overlay or surfaceField change', () => {
    const paramsOff = createParams({ overlays: { 'nation-labels': false } as any })
    const paramsOn = createParams({ overlays: { 'nation-labels': true } as any })
    const paramsMode = createParams({ surfaceField: 'polities', overlays: { 'nation-labels': false } as any })

    const keyOff = computeGeoJsonSourceCacheKey('polity-labels', mockMesh, mockData, paramsOff)
    const keyOn = computeGeoJsonSourceCacheKey('polity-labels', mockMesh, mockData, paramsOn)
    const keyMode = computeGeoJsonSourceCacheKey('polity-labels', mockMesh, mockData, paramsMode)

    expect(keyOn).not.toBe(keyOff)
    expect(keyMode).not.toBe(keyOff)
  })
})
