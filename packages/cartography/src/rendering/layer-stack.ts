import type { MapLayerSlot } from '#styles/spec'

/**
 * Camera-facing separation on the unit sphere, and the matching 2D z offset.
 * Smaller values sit underneath. Overlays stay outside thematic fills.
 */
export const LAYER_STACK = Object.freeze({
  baseFillOffset: 0.0004,
  thematicRasterOffset: 0.00075,
  thematicFillOffset: 0.0012,
  symbolOffset: 0.0018,
  hydroFillOffset: 0.0023,
  lineOffset: 0.0031,
  circleOffset: 0.0039,
  contentRenderOrder: 20,
})

/** Base layers always paint before thematic and overlay layers. */
export function layerRenderOrder(slot: MapLayerSlot, orderIndex: number): number {
  return slot === 'base' ? orderIndex : LAYER_STACK.contentRenderOrder + orderIndex
}
