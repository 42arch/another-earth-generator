import type { Group, Scene } from 'three'

export interface SceneLayer {
  readonly group: Group
  dispose: () => void
}

export type LayerHideReason = 'configuration' | 'style-visibility' | 'manual'

export class SceneLayerManager {
  private readonly layers = new Map<string, SceneLayer>()
  private readonly hiddenReasons = new Map<string, LayerHideReason>()
  private readonly scene: Scene
  private readonly canCreateLayer: () => boolean

  constructor(
    scene: Scene,
    canCreateLayer: () => boolean,
  ) {
    this.scene = scene
    this.canCreateLayer = canCreateLayer
  }

  ensure<T extends SceneLayer>(id: string, create: () => T): T | null {
    const existing = this.layers.get(id)
    if (existing)
      return existing as T

    if (!this.canCreateLayer())
      return null

    const next = create()
    this.scene.add(next.group)
    this.layers.set(id, next)
    return next
  }

  /** Ensure an enabled layer exists and is visible, or hide it by configuration. */
  syncVisibility<T extends SceneLayer>(id: string, enabled: boolean, create: () => T): void {
    if (!enabled) {
      this.setVisible(id, false, 'configuration')
      return
    }

    const layer = this.ensure(id, create)
    if (layer)
      this.setVisible(id, true)
  }

  setVisible(id: string, visible: boolean, reason: LayerHideReason = 'manual'): void {
    if (!visible) {
      this.hide(id, reason)
      return
    }
    const layer = this.layers.get(id)
    if (layer) {
      layer.group.visible = visible
      this.hiddenReasons.delete(id)
    }
  }

  /** Hidden layers retain their resources until explicitly disposed. */
  hide(id: string, reason: LayerHideReason): void {
    const layer = this.layers.get(id)
    if (!layer)
      return

    layer.group.visible = false
    this.hiddenReasons.set(id, reason)
  }

  getHiddenReason(id: string): LayerHideReason | null {
    return this.hiddenReasons.get(id) ?? null
  }

  has(id: string): boolean {
    return this.layers.has(id)
  }

  get<T extends SceneLayer>(id: string): T | null {
    return (this.layers.get(id) as T | undefined) ?? null
  }

  dispose(id: string): void {
    const layer = this.layers.get(id)
    if (!layer)
      return

    this.scene.remove(layer.group)
    layer.dispose()
    this.layers.delete(id)
    this.hiddenReasons.delete(id)
  }

  disposeMany(...ids: string[]): void {
    for (const id of ids)
      this.dispose(id)
  }

  disposeAll(): void {
    this.disposeMany(...this.layers.keys())
  }
}
