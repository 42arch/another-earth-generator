import type { MapStyleDocument } from '../index'
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_MAP_STYLE_PRESET_LIST,
  BUILTIN_MAP_STYLE_PRESETS,
  compileStyleExpression,
  OCEAN_SPEED_COLOR_STOPS,
  StyleCompiler,
  StyleValidationError,
  WIND_SPEED_COLOR_STOPS,
} from '../index'

describe('styleCompiler, expression evaluation & built-in presets (Slice 2)', () => {
  it('compiles all 7 built-in style presets without errors and extracts structured legends', () => {
    const compiler = new StyleCompiler()
    expect(BUILTIN_MAP_STYLE_PRESET_LIST).toHaveLength(7)
    expect(Object.keys(BUILTIN_MAP_STYLE_PRESETS)).toEqual([
      'satellite',
      'standard-atlas',
      'physical-relief',
      'minimal-light',
      'minimal-dark',
      'historical-parchment',
      'political-atlas',
    ])

    for (const preset of BUILTIN_MAP_STYLE_PRESET_LIST) {
      expect(preset.tokens.background).toEqual(expect.stringMatching(/^#[\da-f]{6}$/i))
      if (preset.id === 'political-atlas')
        expect(preset.defaultEnabledLayerIds).not.toContain('world-surface')
      else
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
      if (preset.id === 'satellite') {
        expect(baseLegend?.kind).toBe('categorical')
        const surface = compiled.layers.find(layer => layer.id === 'base-satellite-surface')
        expect(String(surface?.layout['raster-mode']?.evaluate({ zoom: 0 }))).toBe('satellite')
      }

      const demLegend = compiled.getActiveLegend('dem')
      expect(demLegend?.kind).toBe('continuous')
      if (demLegend?.kind === 'continuous') {
        expect(demLegend.fieldName).toBe('elevationKm')
        expect(demLegend.unit).toBe('km')
        expect(demLegend.stops.map(stop => stop.color)).toEqual(['#000000', '#f2f2f2'])
        expect(demLegend.stops.map(stop => stop.value)).toEqual([0, 6.5])
      }
      const demLayers = compiled.getActiveLayers({
        viewMode: 'atlas',
        zoom: 2,
        activeThematicId: 'dem',
        enabledOverlayIds: [],
      })
      expect(demLayers.map(layer => layer.id)).toContain('thematic-dem')

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

      // Civilization thematic & overlay layers compile cleanly across all presets
      const polityLegend = compiled.getActiveLegend('polity-territory')
      expect(polityLegend?.kind).toBe('categorical')
      const popLegend = compiled.getActiveLegend('population-density')
      expect(popLegend?.kind).toBe('continuous')
      if (popLegend?.kind === 'continuous') {
        expect(popLegend.unit).toBe('人/km²')
      }

      const civActive = compiled.getActiveLayers({
        viewMode: 'globe',
        zoom: 3,
        activeThematicId: 'polity-territory',
        enabledOverlayIds: ['polity-borders', 'transport-routes', 'settlements', 'polity-labels', 'settlement-labels'],
      }).map(l => l.id)
      expect(civActive).toContain('thematic-polity-territory')
      expect(civActive).toContain('overlay-polity-borders')
      expect(civActive).toContain('overlay-transport-routes')
      expect(civActive).toContain('overlay-settlements')
      expect(civActive).toContain('overlay-polity-labels')
      expect(civActive).toContain('overlay-settlement-labels')
    }
  })

  it('shares fixed physical speed scales across months, annual views and all presets', () => {
    const compiler = new StyleCompiler()
    for (const preset of BUILTIN_MAP_STYLE_PRESET_LIST) {
      const compiled = compiler.compile(preset)
      for (const [kind, stops] of [['wind', WIND_SPEED_COLOR_STOPS], ['ocean', OCEAN_SPEED_COLOR_STOPS]] as const) {
        for (const annual of [false, true]) {
          const thematicId = `${annual ? 'annual-' : ''}${kind}-speed`
          const legend = compiled.getActiveLegend(thematicId)
          expect(legend?.kind).toBe('continuous')
          if (legend?.kind !== 'continuous')
            throw new Error('Expected a continuous speed legend')
          expect(legend.unit).toBe('m/s')
          expect(legend.stops).toEqual(stops)
          const layer = compiled.layers.find(layer => layer.thematicId === thematicId)!
          const color = layer.paint['raster-color']!
          const field = legend.fieldName
          expect(color.evaluate({ properties: { landMask: 0, [field]: stops[0].value } })).toBe(stops[0].color)
          expect(color.evaluate({ properties: { landMask: 0, [field]: stops.at(-1)!.value } })).toBe(stops.at(-1)!.color)
          expect(color.evaluate({ properties: { landMask: 0, [field]: 1 }, isNoData: name => name === field })).toBe(kind === 'ocean' ? '#9aa3ad' : '#374151')
          if (kind === 'ocean')
            expect(color.evaluate({ properties: { landMask: 1, [field]: 0 } })).toBe('#f7f4ef')
        }
      }
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

  it('enables ink-styled realm borders and settlements on historical parchment', () => {
    const preset = BUILTIN_MAP_STYLE_PRESETS['historical-parchment']
    expect(preset.defaultEnabledLayerIds).toEqual([
      'world-surface',
      'coastlines',
      'labels',
      'polity-borders',
      'settlements',
      'polity-labels',
      'settlement-labels',
    ])

    const compiled = new StyleCompiler().compile(preset)
    const borders = compiled.layersById.get('overlay-polity-borders')!
    expect(borders.paint['line-color']!.evaluate({ zoom: 2, properties: { isFrontier: false } })).toBe('#3b2816')

    const symbols = compiled.layersById.get('overlay-settlements')!
    const symbolColor = (tier: string) => symbols.paint['circle-color']!.evaluate({ zoom: 4, properties: { tier } })
    expect(symbolColor('capital')).toBe('#8f3d2c')
    expect(symbolColor('city')).toBe('#3b2816')
    expect(symbolColor('town')).toBe('#3b2816')
    expect(symbols.paint['circle-stroke-color']!.evaluate({ zoom: 4, properties: { tier: 'town' } })).toBe('#24160e')

    const polityLabels = compiled.layersById.get('overlay-polity-labels')!
    expect(polityLabels.paint['text-color']!.evaluate({ zoom: 2, properties: {} })).toBe('#3b2816')
    expect(polityLabels.paint['text-halo-color']!.evaluate({ zoom: 2, properties: {} })).toBe('#efe6cf')
    expect(String(polityLabels.layout['text-font']!.evaluate({ zoom: 2, properties: {} }))).toContain('LXGW WenKai')

    const settlementLabels = compiled.layersById.get('overlay-settlement-labels')!
    expect(settlementLabels.paint['text-color']!.evaluate({ zoom: 4, properties: { tier: 'town' } })).toBe('#3b2816')
  })

  it('shrinks settlement symbols and hides minor tiers when the globe is zoomed out', () => {
    const compiler = new StyleCompiler()
    const compiled = compiler.compile(BUILTIN_MAP_STYLE_PRESETS['political-atlas'])
    const symbols = compiled.layersById.get('overlay-settlements')!
    const labels = compiled.layersById.get('overlay-settlement-labels')!
    const far = 1.2
    const near = 6

    const radiusAt = (zoom: number, tier: string) => Number(
      symbols.paint['circle-radius']!.evaluate({ zoom, properties: { tier } }),
    )
    const opacityAt = (zoom: number, tier: string) => Number(
      symbols.paint['circle-opacity']!.evaluate({ zoom, properties: { tier } }),
    )
    const strokeAt = (zoom: number, tier: string) => Number(
      symbols.paint['circle-stroke-width']!.evaluate({ zoom, properties: { tier } }),
    )
    const labelOpacityAt = (zoom: number, tier: string) => Number(
      labels.paint['text-opacity']!.evaluate({ zoom, properties: { tier } }),
    )

    expect(radiusAt(far, 'capital')).toBeLessThan(3.2)
    expect(radiusAt(far, 'capital')).toBeGreaterThan(2)
    expect(radiusAt(near, 'capital')).toBeGreaterThan(radiusAt(far, 'capital') + 1.5)
    expect(strokeAt(far, 'capital')).toBeLessThan(0.8)
    expect(strokeAt(near, 'town')).toBeGreaterThan(strokeAt(far, 'town'))

    expect(opacityAt(far, 'capital')).toBeGreaterThan(0.9)
    expect(opacityAt(far, 'city')).toBe(0)
    expect(opacityAt(far, 'town')).toBe(0)
    expect(opacityAt(2.4, 'city')).toBeGreaterThan(0.9)
    expect(opacityAt(2.4, 'town')).toBe(0)
    expect(opacityAt(near, 'town')).toBeGreaterThan(0.9)
    expect(labelOpacityAt(far, 'city')).toBe(0)
    expect(labelOpacityAt(far, 'town')).toBe(0)
    expect(labelOpacityAt(2.4, 'city')).toBeGreaterThan(0.9)
    expect(labelOpacityAt(near, 'town')).toBeGreaterThan(0.9)
    expect(labels.layout['text-offset']!.evaluate({ zoom: far, properties: { tier: 'capital' } })).toEqual([0, -0.78])
  })
})
