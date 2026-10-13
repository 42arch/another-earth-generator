import type { Camera } from 'three'
import type { SceneLayer } from '@/core/rendering/scene-layer-manager'

export interface SymbolCollisionBox {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface ViewportBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** Spatial hashing grid for O(1) average-time collision detection. */
export class CollisionGrid {
  private readonly cellSize: number
  private readonly cells = new Map<number, SymbolCollisionBox[]>()
  readonly boxes: SymbolCollisionBox[] = []

  constructor(cellSize = 0.25) {
    this.cellSize = cellSize
  }

  clear(): void {
    this.cells.clear()
    this.boxes.length = 0
  }

  private cellKey(cx: number, cy: number): number {
    return ((cx & 0xFFFF) << 16) | (cy & 0xFFFF)
  }

  collides(box: SymbolCollisionBox, exclude?: SymbolCollisionBox): boolean {
    const minCX = Math.floor(box.minX / this.cellSize)
    const maxCX = Math.floor(box.maxX / this.cellSize)
    const minCY = Math.floor(box.minY / this.cellSize)
    const maxCY = Math.floor(box.maxY / this.cellSize)

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const bucket = this.cells.get(this.cellKey(cx, cy))
        if (bucket) {
          for (let i = 0; i < bucket.length; i++) {
            const other = bucket[i]
            if (other !== exclude && !(box.maxX < other.minX || box.minX > other.maxX || box.maxY < other.minY || box.minY > other.maxY))
              return true
          }
        }
      }
    }
    return false
  }

  insert(box: SymbolCollisionBox): void {
    this.boxes.push(box)
    const minCX = Math.floor(box.minX / this.cellSize)
    const maxCX = Math.floor(box.maxX / this.cellSize)
    const minCY = Math.floor(box.minY / this.cellSize)
    const maxCY = Math.floor(box.maxY / this.cellSize)

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const key = this.cellKey(cx, cy)
        let bucket = this.cells.get(key)
        if (!bucket) {
          bucket = []
          this.cells.set(key, bucket)
        }
        bucket.push(box)
      }
    }
  }
}

export interface StyledLayerUpdateContext {
  layerId: string
  styleId: string
  view: 'map' | 'globe'
  styleZoom: number
  viewZoom: number
  collisionGrid?: CollisionGrid
  viewportBounds?: ViewportBounds
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
