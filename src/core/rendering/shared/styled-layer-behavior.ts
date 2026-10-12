import type { Camera } from 'three'
import type { SceneLayer } from '@/core/rendering/scene-layer-manager'

export interface SymbolCollisionBox {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface StyledLayerUpdateContext {
  layerId: string
  styleId: string
  view: 'map' | 'globe'
  styleZoom: number
  viewZoom: number
  occupiedSymbols?: SymbolCollisionBox[]
}

/** Common behavior required by a layer created from a map style renderer. */
export interface StyledLayerBehavior extends SceneLayer {
  updateStyle: (context: StyledLayerUpdateContext) => void
  pickGeoJsonFeature: (
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    camera: Camera,
  ) => { sourceId: string, featureId: string | number } | null
}

/** Optional capability used by the viewport-sensitive 2D river ribbon. */
export interface ViewportUpdatableLayer {
  updateViewport: (width: number, height: number) => void
}

/** Optional capability for symbol layers that represent settlement regions. */
export interface SettlementPickableLayer {
  pickSettlementFeature: (
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    camera: Camera,
  ) => number | null
}

export function isViewportUpdatableLayer(
  layer: StyledLayerBehavior,
): layer is StyledLayerBehavior & ViewportUpdatableLayer {
  return 'updateViewport' in layer && typeof layer.updateViewport === 'function'
}

export function isSettlementPickableLayer(
  layer: StyledLayerBehavior,
): layer is StyledLayerBehavior & SettlementPickableLayer {
  return 'pickSettlementFeature' in layer && typeof layer.pickSettlementFeature === 'function'
}
