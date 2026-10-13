import { Group, Scene } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { SceneLayerManager } from '@/core/rendering/scene-layer-manager'

describe('sceneLayerManager', () => {
  it('lazily instantiates and reuses layers via ensure without recreation', () => {
    const scene = new Scene()
    const manager = new SceneLayerManager(scene, () => true)

    let createCount = 0
    const createLayer = () => {
      createCount++
      const group = new Group()
      return {
        group,
        dispose: vi.fn(),
      }
    }

    // 1. First ensure creates the layer and adds group to scene
    const layer1 = manager.ensure('clouds', createLayer)
    expect(layer1).toBeDefined()
    expect(createCount).toBe(1)
    expect(scene.children).toContain(layer1!.group)
    expect(manager.has('clouds')).toBe(true)

    // 2. Second ensure returns the existing instance without invoking creator
    const layer2 = manager.ensure('clouds', createLayer)
    expect(layer2).toBe(layer1)
    expect(createCount).toBe(1)
  })

  it('controls visibility without destroying geometry or calling dispose', () => {
    const scene = new Scene()
    const manager = new SceneLayerManager(scene, () => true)
    const disposeFn = vi.fn()
    const group = new Group()

    const layer = manager.ensure('graticule', () => ({
      group,
      dispose: disposeFn,
    }))
    expect(layer?.group.visible).toBe(true)

    // Toggle off
    manager.setVisible('graticule', false)
    expect(layer?.group.visible).toBe(false)
    expect(disposeFn).not.toHaveBeenCalled()
    expect(manager.has('graticule')).toBe(true)

    // Toggle on
    manager.setVisible('graticule', true)
    expect(layer?.group.visible).toBe(true)
    expect(disposeFn).not.toHaveBeenCalled()
  })

  it('disposes a layer properly', () => {
    const scene = new Scene()
    const manager = new SceneLayerManager(scene, () => true)
    const disposeFn = vi.fn()
    const group = new Group()

    manager.ensure('rivers', () => ({ group, dispose: disposeFn }))
    expect(scene.children).toContain(group)

    // dispose should clean up
    manager.dispose('rivers')
    expect(disposeFn).toHaveBeenCalledTimes(1)
    expect(scene.children).not.toContain(group)
    expect(manager.has('rivers')).toBe(false)
  })
})
