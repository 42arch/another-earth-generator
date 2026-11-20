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

/**
 * Globe lines that trace a territory or shoreline share the thematic fill shell.
 * A radial lift shows up as a gap at the limb; depth bias keeps the stroke in front.
 */
export function globeLinePlacement(sourceId: string, orderIndex: number): {
  readonly surfaceOffset: number
  readonly polygonOffsetFactor: number
  readonly polygonOffsetUnits: number
} {
  if (sourceId === 'polity-borders' || sourceId === 'coastlines') {
    return {
      surfaceOffset: LAYER_STACK.thematicFillOffset,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
    }
  }
  return {
    surfaceOffset: LAYER_STACK.lineOffset + orderIndex * 0.00002,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 0,
  }
}
