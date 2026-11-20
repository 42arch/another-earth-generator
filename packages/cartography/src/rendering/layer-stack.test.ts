import { describe, expect, it } from 'vitest'
import { globeLinePlacement, LAYER_STACK, layerRenderOrder } from './layer-stack'

describe('layer stack', () => {
  it('keeps the surface under thematics and overlays above both', () => {
    expect(layerRenderOrder('base', 9)).toBeLessThan(layerRenderOrder('thematic', 0))
    expect(layerRenderOrder('thematic', 14)).toBeLessThan(layerRenderOrder('overlay', 15))
    expect(LAYER_STACK.baseFillOffset).toBeLessThan(LAYER_STACK.thematicRasterOffset)
    expect(LAYER_STACK.thematicRasterOffset).toBeLessThan(LAYER_STACK.thematicFillOffset)
    expect(LAYER_STACK.thematicFillOffset).toBeLessThan(LAYER_STACK.symbolOffset)
    expect(LAYER_STACK.symbolOffset).toBeLessThan(LAYER_STACK.hydroFillOffset)
    expect(LAYER_STACK.hydroFillOffset).toBeLessThan(LAYER_STACK.lineOffset)
  })

  it('keeps territory outlines on the thematic fill shell', () => {
    for (const sourceId of ['polity-borders', 'coastlines']) {
      const placement = globeLinePlacement(sourceId, 4)
      expect(placement.surfaceOffset).toBe(LAYER_STACK.thematicFillOffset)
      expect(placement.polygonOffsetFactor).toBeLessThan(0)
    }
    expect(globeLinePlacement('rivers', 2).surfaceOffset).toBeGreaterThan(LAYER_STACK.hydroFillOffset)
  })
})
