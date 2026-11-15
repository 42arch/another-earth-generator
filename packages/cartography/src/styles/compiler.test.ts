import type { MapStyleDocument } from '../index'
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_MAP_STYLE_PRESET_LIST,
  BUILTIN_MAP_STYLE_PRESETS,
  compileStyleExpression,
  StyleCompiler,
  StyleValidationError,
} from '../index'

describe('styleCompiler, expression evaluation & built-in presets (Slice 2)', () => {
  it('compiles all 6 built-in style presets without errors and extracts structured legends', () => {
    const compiler = new StyleCompiler()
    expect(BUILTIN_MAP_STYLE_PRESET_LIST).toHaveLength(6)
    expect(Object.keys(BUILTIN_MAP_STYLE_PRESETS)).toEqual([
      'satellite',
      'standard-atlas',
      'physical-relief',
      'minimal-light',
      'minimal-dark',
      'historical-parchment',
    ])

    for (const preset of BUILTIN_MAP_STYLE_PRESET_LIST) {
      expect(preset.tokens.background).toEqual(expect.stringMatching(/^#[\da-f]{6}$/i))
      expect(preset.defaultEnabledLayerIds).toContain('world-surface')
      expect(preset.defaultGlobeEffects).toEqual(
        preset.id === 'satellite'
          ? { atmosphere: true, dayNight: true }
          : { atmosphere: false, dayNight: false },
      )
      const compiled = compiler.compile(preset)
      expect(compiled.id).toBe(preset.id)
      expect(compiled.layers.length).toBeGreaterThan(10)

      // Base legend when thematic is null
      const baseLegend = compiled.getActiveLegend(null)
      expect(baseLegend).not.toBeNull()

      // Continuous thematic legend
      const tempLegend = compiled.getActiveLegend('temperature')
      expect(tempLegend?.kind).toBe('continuous')
      if (tempLegend?.kind === 'continuous') {
        expect(tempLegend.unit).toBe('°C')
        expect(tempLegend.stops.length).toBeGreaterThanOrEqual(4)
      }

      // Categorical thematic legend
      const koppenLegend = compiled.getActiveLegend('koppen')
      expect(koppenLegend?.kind).toBe('categorical')
      if (koppenLegend?.kind === 'categorical') {
        expect(koppenLegend.items).toHaveLength(32)
        expect(koppenLegend.items[1].label).toContain('Af')
      }

      // Active layer slot filtering (base + thematic + overlays)
      const activeLayers = compiled.getActiveLayers({
        viewMode: 'globe',
        zoom: 3,
        activeThematicId: 'koppen',
        enabledOverlayIds: ['rivers', 'geographic-labels'],
      })
      const activeIds = activeLayers.map(l => l.id)
      expect(activeIds).toContain('thematic-koppen')
      expect(activeIds).not.toContain('thematic-biomes')
      expect(activeIds).toContain('overlay-river-polygons')
      expect(activeIds).toContain('overlay-river-centerlines')
      expect(activeIds).toContain('overlay-geographic-labels')
      expect(activeIds).not.toContain('overlay-plate-boundaries')
    }
  })

  it('accurately classifies expression dependency levels (constant / feature / zoom / zoom-feature)', () => {
    const tokens = {
      primary: '#336699',
      palette: ['#111111', '#222222', '#333333'],
    }

    const constExpr = compileStyleExpression(['token', 'primary'], tokens, 'test.const')
    expect(constExpr.dependency).toBe('constant')
    expect(constExpr.constantValue).toBe('#336699')
    expect(constExpr.evaluate()).toBe('#336699')

    const featureExpr = compileStyleExpression(
      ['palette', ['get', 'groupIndex'], ['token', 'palette'], '#999999'],
      tokens,
      'test.feature',
    )
    expect(featureExpr.dependency).toBe('feature')
    expect(featureExpr.referencedProperties).toEqual(['groupIndex'])
    expect(featureExpr.evaluate({ properties: { groupIndex: 1 } })).toBe('#222222')
    expect(featureExpr.evaluate({ properties: { groupIndex: 4 } })).toBe('#222222') // 4 % 3 === 1
    expect(featureExpr.evaluate({ properties: { groupIndex: -1 } })).toBe('#999999') // negative -> noData
    expect(featureExpr.evaluate({
      properties: { groupIndex: 1 },
      isNoData: prop => prop === 'groupIndex',
    })).toBe('#999999')

    const zoomExpr = compileStyleExpression(
      ['interpolate', ['linear'], ['zoom'], 0, 1.0, 10, 3.0],
      tokens,
      'test.zoom',
    )
    expect(zoomExpr.dependency).toBe('zoom')
    expect(zoomExpr.evaluate({ zoom: 5 })).toBeCloseTo(2.0, 6)

    const zoomFeatureExpr = compileStyleExpression(
      [
        'interpolate',
        ['exponential', 2],
        ['zoom'],
        0,
        ['step', ['get', 'order'], 1, 2, 2, 4, 4],
        8,
        ['step', ['get', 'order'], 2, 2, 4, 4, 8],
      ],
      tokens,
      'test.zoomFeature',
    )
    expect(zoomFeatureExpr.dependency).toBe('zoom-feature')
    expect(zoomFeatureExpr.evaluate({ zoom: 0, properties: { order: 3 } })).toBeCloseTo(2, 6)
    expect(zoomFeatureExpr.evaluate({ zoom: 8, properties: { order: 3 } })).toBeCloseTo(4, 6)
  })

  it('rejects unknown operators, missing sources, and layer/source geometry mismatches with descriptive paths', () => {
    const compiler = new StyleCompiler()

    const badOperatorDoc: MapStyleDocument = {
      version: 1,
      id: 'bad-op',
      name: 'Bad Operator',
      tokens: {},
      layers: [
        {
          id: 'l1',
          type: 'fill',
          source: 'land-areas',
          slot: 'base',
          paint: {
            'fill-color': ['unknown-op', 1, 2],
          },
        },
      ],
    }
    expect(() => compiler.compile(badOperatorDoc)).toThrow(StyleValidationError)
    expect(() => compiler.compile(badOperatorDoc)).toThrow('Unsupported expression operator "unknown-op"')

    const missingSourceDoc: MapStyleDocument = {
      version: 1,
      id: 'missing-source',
      name: 'Missing Source',
      tokens: {},
      layers: [
        {
          id: 'l1',
          type: 'fill',
          source: 'non-existent-source',
          slot: 'base',
        },
      ],
    }
    expect(() => compiler.compile(missingSourceDoc)).toThrow('Unknown map data source "non-existent-source"')

    const geometryMismatchDoc: MapStyleDocument = {
      version: 1,
      id: 'geom-mismatch',
      name: 'Geometry Mismatch',
      tokens: {},
      layers: [
        {
          id: 'fill-on-line',
          type: 'fill',
          source: 'coastlines',
          slot: 'overlay',
          overlayId: 'coastlines',
        },
      ],
    }
    expect(() => compiler.compile(geometryMismatchDoc)).toThrow('requires "polygon" GeoJSON geometry, but "coastlines" provides "line"')

    const rasterOnGeoJsonDoc: MapStyleDocument = {
      version: 1,
      id: 'raster-on-geojson',
      name: 'Raster on GeoJSON',
      tokens: {},
      layers: [
        {
          id: 'raster-wrong',
          type: 'raster',
          source: 'land-areas',
          slot: 'base',
        },
      ],
    }
    expect(() => compiler.compile(rasterOnGeoJsonDoc)).toThrow('requires a "raster" source, but "land-areas" is "geojson"')
  })
})
