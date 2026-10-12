import { Group, Scene } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { SceneLayerManager } from '@/core/rendering/scene-layer-manager'

describe('SceneLayerManager', () => {
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

  it('disposes layer properly when explicitly replaced or disposed', () => {
    const scene = new Scene()
    const manager = new SceneLayerManager(scene, () => true)
    const disposeFn1 = vi.fn()
    const group1 = new Group()

    manager.ensure('rivers', () => ({ group: group1, dispose: disposeFn1 }))
    expect(scene.children).toContain(group1)

    // replace should dispose old layer and mount new one
    const disposeFn2 = vi.fn()
    const group2 = new Group()
    manager.replace('rivers', () => ({ group: group2, dispose: disposeFn2 }))

    expect(disposeFn1).toHaveBeenCalledTimes(1)
    expect(scene.children).not.toContain(group1)
    expect(scene.children).toContain(group2)

    // dispose should clean up
    manager.dispose('rivers')
    expect(disposeFn2).toHaveBeenCalledTimes(1)
    expect(scene.children).not.toContain(group2)
    expect(manager.has('rivers')).toBe(false)
  })
})
