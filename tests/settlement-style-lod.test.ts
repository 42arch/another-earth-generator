import { describe, expect, it } from 'vitest'
import {
  DARK_STYLE,
  evaluateStyleValue,
  getGlobeStyleZoom,
  getMapStyleLayer,
  getMapStylePaint,
  getMapStyleZoom,
  LIGHT_STYLE,
  matchesMapStyleLayerFilter,
  SATELLITE_STYLE,
  SETTLEMENT_ICON_IMAGE,
  SETTLEMENT_ICON_SIZE,
  SETTLEMENT_LOD_FILTER,
  SETTLEMENT_TEXT_SIZE,
  STANDARD_STYLE,
} from '@/core/styles'

describe('settlement LOD filtering and style declarations', () => {
  it('applies hierarchical zoom LOD rules correctly', () => {
    const capitalProps = { isCapital: true, rank: 'city', tier: 'high' }
    const metropolisProps = { isCapital: false, rank: 'metropolis', tier: 'high' }
    const cityProps = { isCapital: false, rank: 'city', tier: 'mid' }
    const sacredSiteProps = { isCapital: false, isSacredSite: true, tier: 'mid' }
    const townProps = { isCapital: false, rank: 'town', tier: 'low' }
    const villageProps = { isCapital: false, rank: 'village', tier: 'low' }

    // Zoom 0 (global overview): capitals and metropolises are visible
    expect(evaluateStyleValue(SETTLEMENT_LOD_FILTER, { zoom: 0, tokens: {}, properties: capitalProps })).toBe(true)
    expect(evaluateStyleValue(SETTLEMENT_LOD_FILTER, { zoom: 0, tokens: {}, properties: metropolisProps })).toBe(true)
    expect(evaluateStyleValue(SETTLEMENT_LOD_FILTER, { zoom: 0, tokens: {}, properties: cityProps })).toBe(false)
    expect(evaluateStyleValue(SETTLEMENT_LOD_FILTER, { zoom: 0, tokens: {}, properties: sacredSiteProps })).toBe(false)
    expect(evaluateStyleValue(SETTLEMENT_LOD_FILTER, { zoom: 0, tokens: {}, properties: townProps })).toBe(false)

    // Zoom 1.2 (continental / regional scale): cities and sacred sites appear
    expect(evaluateStyleValue(SETTLEMENT_LOD_FILTER, { zoom: 1.2, tokens: {}, properties: capitalProps })).toBe(true)
    expect(evaluateStyleValue(SETTLEMENT_LOD_FILTER, { zoom: 1.2, tokens: {}, properties: cityProps })).toBe(true)
    expect(evaluateStyleValue(SETTLEMENT_LOD_FILTER, { zoom: 1.2, tokens: {}, properties: sacredSiteProps })).toBe(true)
    expect(evaluateStyleValue(SETTLEMENT_LOD_FILTER, { zoom: 1.2, tokens: {}, properties: townProps })).toBe(false)
    expect(evaluateStyleValue(SETTLEMENT_LOD_FILTER, { zoom: 1.2, tokens: {}, properties: villageProps })).toBe(false)

    // Zoom 2.5 (local close-up): towns and villages appear
    expect(evaluateStyleValue(SETTLEMENT_LOD_FILTER, { zoom: 2.5, tokens: {}, properties: capitalProps })).toBe(true)
    expect(evaluateStyleValue(SETTLEMENT_LOD_FILTER, { zoom: 2.5, tokens: {}, properties: cityProps })).toBe(true)
    expect(evaluateStyleValue(SETTLEMENT_LOD_FILTER, { zoom: 2.5, tokens: {}, properties: townProps })).toBe(true)
    expect(evaluateStyleValue(SETTLEMENT_LOD_FILTER, { zoom: 2.5, tokens: {}, properties: villageProps })).toBe(true)
  })

  it('declares SETTLEMENT_LOD_FILTER and icon-color in all preset styles', () => {
    const styles = [STANDARD_STYLE, LIGHT_STYLE, DARK_STYLE, SATELLITE_STYLE]

    for (const style of styles) {
      const layer = getMapStyleLayer(style.id, 'settlement-labels')
      expect(layer).toBeDefined()
      expect(layer?.filter).toBe(SETTLEMENT_LOD_FILTER)

      // Test layer filter matching through style runtime API
      expect(matchesMapStyleLayerFilter(style.id, 'settlement-labels', 0, { isCapital: true })).toBe(true)
      expect(matchesMapStyleLayerFilter(style.id, 'settlement-labels', 0, { rank: 'town' })).toBe(false)
      expect(matchesMapStyleLayerFilter(style.id, 'settlement-labels', 2.2, { rank: 'town' })).toBe(true)

      // Verify custom colors for sacred sites and capitals
      const sacredColor = getMapStylePaint(style.id, 'settlement-labels', 'text-color', 1, { isSacredSite: true })
      const normalColor = getMapStylePaint(style.id, 'settlement-labels', 'text-color', 1, { isSacredSite: false })
      expect(sacredColor).toBe(style.tokens.sacredSite)
      expect(normalColor).toBe(style.tokens.settlementLabel)

      const capitalIconColor = getMapStylePaint(style.id, 'settlement-labels', 'icon-color', 1, { isCapital: true })
      expect(capitalIconColor).toBeDefined()
      expect(typeof capitalIconColor).toBe('string')

      // Verify layout declarations for icon-image, text-size, icon-size, and text-offset
      expect(layer?.layout['icon-image']).toBeDefined()
      expect(layer?.layout['text-size']).toBeDefined()
      expect(layer?.layout['icon-size']).toBeDefined()
      expect(layer?.layout['text-offset']).toEqual([0.65, 0])
    }
  })

  it('matches semantic icon images and resolves typography sizes purely from style expressions', () => {
    // 1. Icon-image matching expression
    expect(evaluateStyleValue(SETTLEMENT_ICON_IMAGE, { zoom: 0, tokens: {}, properties: { featureKind: 'capital' } })).toBe('star')
    expect(evaluateStyleValue(SETTLEMENT_ICON_IMAGE, { zoom: 0, tokens: {}, properties: { featureKind: 'port' } })).toBe('harbor')
    expect(evaluateStyleValue(SETTLEMENT_ICON_IMAGE, { zoom: 0, tokens: {}, properties: { featureKind: 'garrison' } })).toBe('castle')
    expect(evaluateStyleValue(SETTLEMENT_ICON_IMAGE, { zoom: 0, tokens: {}, properties: { featureKind: 'sacred-site' } })).toBe('place-of-worship')
    expect(evaluateStyleValue(SETTLEMENT_ICON_IMAGE, { zoom: 0, tokens: {}, properties: { featureKind: 'metropolis' } })).toBe('monument')
    expect(evaluateStyleValue(SETTLEMENT_ICON_IMAGE, { zoom: 0, tokens: {}, properties: { featureKind: 'city' } })).toBe('city')
    expect(evaluateStyleValue(SETTLEMENT_ICON_IMAGE, { zoom: 0, tokens: {}, properties: { featureKind: 'town' } })).toBe('building')
    expect(evaluateStyleValue(SETTLEMENT_ICON_IMAGE, { zoom: 0, tokens: {}, properties: { featureKind: 'village' } })).toBe('campsite')

    // 2. Text size expressions: capitals & metropolises get larger sizes
    const capitalSize = evaluateStyleValue(SETTLEMENT_TEXT_SIZE, { zoom: 0, tokens: {}, properties: { isCapital: true } })
    const villageSize = evaluateStyleValue(SETTLEMENT_TEXT_SIZE, { zoom: 0, tokens: {}, properties: { isCapital: false, rank: 'village', tier: 'low' } })
    expect(Number(capitalSize)).toBeGreaterThan(Number(villageSize))

    // 3. Icon size expressions: capitals get larger icon sizes
    const capitalIconSize = evaluateStyleValue(SETTLEMENT_ICON_SIZE, { zoom: 0, tokens: {}, properties: { isCapital: true } })
    const villageIconSize = evaluateStyleValue(SETTLEMENT_ICON_SIZE, { zoom: 0, tokens: {}, properties: { isCapital: false, rank: 'village', tier: 'low' } })
    expect(Number(capitalIconSize)).toBeGreaterThan(Number(villageIconSize))
  })

  it('aligns globe visual altitude zoom scale with map zoom scale', () => {
    const planetRadius = 100

    // Distant globe (overview at 3.2 radii) corresponds to zoom 0
    expect(getGlobeStyleZoom(320, planetRadius)).toBeCloseTo(0, 1)

    // Mid-range globe (around 2 radii) corresponds to zoom around 1.0~1.4
    const midZoom = getGlobeStyleZoom(190, planetRadius)
    expect(midZoom).toBeGreaterThan(1.0)
    expect(midZoom).toBeLessThan(1.8)

    // Close-up near planet surface (125) reaches zoom > 3.0
    const closeZoom = getGlobeStyleZoom(125, planetRadius)
    expect(closeZoom).toBeGreaterThan(3.0)

    // 2D map zoom behavior check: camera zoom 1 -> style zoom 0, camera zoom 8 -> style zoom 3
    expect(getMapStyleZoom(1)).toBe(0)
    expect(getMapStyleZoom(8)).toBe(3)
  })
})
