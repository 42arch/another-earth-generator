import type { WorldConfig } from '@/core/simulation/config'
import { describe, expect, it } from 'vitest'
import { getActiveStyleLayers, isStyleLayerActive } from '@/core/rendering/shared/styled/layer-factory'
import { getMapStyleLayer, resolveEffectiveSurfaceMode } from '@/core/styles'

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
        'atmosphere': true,
        'clouds': true,
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
  }
}

describe('thematic layers and effective surface mode resolution', () => {
  it('correctly resolves effective surface mode with surfaceField priority and fallback', () => {
    // 1. When surfaceField is default and baseMap is dem
    expect(resolveEffectiveSurfaceMode({ surfaceField: 'default', baseMap: 'dem' })).toBe('dem')

    // 2. When surfaceField is set directly
    expect(resolveEffectiveSurfaceMode({ surfaceField: 'temperature', baseMap: 'dem' })).toBe('temperature')

    // 3. When mapStyle is satellite and surfaceField is default
    expect(resolveEffectiveSurfaceMode({ surfaceField: 'default', mapStyle: 'satellite' })).toBe('satellite')

    // 4. When nothing is specified, fallback to cartographic
    expect(resolveEffectiveSurfaceMode({})).toBe('cartographic')
  })

  it('declaratively activates thematic fill layers via layer.thematic attribute without hardcoded IDs', () => {
    const config = createTestConfig({
      thematicFills: {
        polities: true,
        ethnicity: false,
        religions: true,
      },
    })

    const politiesLayer = getMapStyleLayer('standard', 'polities-fill')!
    const ethnicityLayer = getMapStyleLayer('standard', 'ethnicity-fill')!
    const religionsLayer = getMapStyleLayer('standard', 'religions-fill')!
    const languagesLayer = getMapStyleLayer('standard', 'languages-fill')!

    expect(politiesLayer.thematic).toBe('polities')
    expect(ethnicityLayer.thematic).toBe('ethnicity')
    expect(religionsLayer.thematic).toBe('religions')
    expect(languagesLayer.thematic).toBe('languages')

    expect(isStyleLayerActive(politiesLayer, 'globe', config)).toBe(true)
    expect(isStyleLayerActive(ethnicityLayer, 'globe', config)).toBe(false)
    expect(isStyleLayerActive(religionsLayer, 'globe', config)).toBe(true)
    expect(isStyleLayerActive(languagesLayer, 'globe', config)).toBe(false)
  })

  it('activates thematic layers when surfaceField matches baseMaps or layer.thematic is enabled', () => {
    // When surfaceField is 'polities', polities-fill is active even if thematicFills.polities is false
    const configWithField = createTestConfig({
      surfaceField: 'polities',
      thematicFills: { polities: false },
    })
    const politiesLayer = getMapStyleLayer('standard', 'polities-fill')!
    expect(isStyleLayerActive(politiesLayer, 'globe', configWithField)).toBe(true)

    // And verify getActiveStyleLayers returns it
    const activeLayers = getActiveStyleLayers('standard', 'globe', configWithField)
    expect(activeLayers.some(l => l.layer.id === 'polities-fill')).toBe(true)
  })
})
