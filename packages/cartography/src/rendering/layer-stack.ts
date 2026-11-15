import type { MapLayerSlot } from '#styles/spec'

/**
 * Camera-facing separation on the unit sphere, and the matching 2D z offset.
 * Smaller values sit underneath. Overlays stay outside thematic fills.
 */
export const LAYER_STACK = Object.freeze({
  baseFillOffset: 0.0002,
  thematicRasterOffset: 0.00035,
  thematicFillOffset: 0.00055,
  symbolOffset: 0.0009,
  hydroFillOffset: 0.0014,
  lineOffset: 0.0022,
  circleOffset: 0.0032,
  contentRenderOrder: 20,
})

/** Base layers always paint before thematic and overlay layers. */
export function layerRenderOrder(slot: MapLayerSlot, orderIndex: number): number {
  return slot === 'base' ? orderIndex : LAYER_STACK.contentRenderOrder + orderIndex
}
