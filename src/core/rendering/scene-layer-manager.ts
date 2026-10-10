import type { Group, Scene } from 'three'

export interface SceneLayer {
  readonly group: Group
  dispose(): void
}

export class SceneLayerManager {
  private readonly layers = new Map<string, SceneLayer>()
  private readonly scene: Scene
  private readonly canCreateLayer: () => boolean

  constructor(
    scene: Scene,
    canCreateLayer: () => boolean,
  ) {
    this.scene = scene
    this.canCreateLayer = canCreateLayer
  }

  replace<T extends SceneLayer>(id: string, create: () => T): T | null {
    this.dispose(id)
    if (!this.canCreateLayer())
      return null

    const next = create()
    this.scene.add(next.group)
    this.layers.set(id, next)
    return next
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
  }

  disposeMany(...ids: string[]): void {
    for (const id of ids)
      this.dispose(id)
  }

  disposeAll(): void {
    this.disposeMany(...this.layers.keys())
  }
}
