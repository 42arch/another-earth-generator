import type { Group, Scene } from 'three'

export interface SceneLayer {
  readonly group: Group
  dispose(): void
}

export class SceneLayerManager {
  private readonly layers = new Set<SceneLayer>()
  private readonly scene: Scene
  private readonly canCreateLayer: () => boolean

  constructor(
    scene: Scene,
    canCreateLayer: () => boolean,
  ) {
    this.scene = scene
    this.canCreateLayer = canCreateLayer
  }

  replace<T extends SceneLayer>(current: T | null, create: () => T): T | null {
    this.dispose(current)
    if (!this.canCreateLayer())
      return null

    const next = create()
    this.scene.add(next.group)
    this.layers.add(next)
    return next
  }

  dispose(layer: SceneLayer | null): void {
    if (!layer)
      return

    this.scene.remove(layer.group)
    layer.dispose()
    this.layers.delete(layer)
  }

  disposeAll(): void {
    for (const layer of [...this.layers])
      this.dispose(layer)
  }
}
