import type * as THREE from 'three'

export interface GpuResourceCounts {
  readonly geometries: number
  readonly materials: number
  readonly textures: number
}

/**
 * Deterministic tracker for Three.js GPU resources (`BufferGeometry`, `Material`, `Texture`).
 * Automatically removes resources when their `.dispose()` method fires the Three.js `dispose` event.
 */
export class GpuResourceTracker {
  private readonly geometries = new Set<THREE.BufferGeometry>()
  private readonly materials = new Set<THREE.Material>()
  private readonly textures = new Set<THREE.Texture>()

  trackGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
    if (!this.geometries.has(geometry)) {
      this.geometries.add(geometry)
      const onDispose = (): void => {
        geometry.removeEventListener('dispose', onDispose)
        this.geometries.delete(geometry)
      }
      geometry.addEventListener('dispose', onDispose)
    }
    return geometry
  }

  trackMaterial<T extends THREE.Material>(material: T): T {
    if (!this.materials.has(material)) {
      this.materials.add(material)
      const onDispose = (): void => {
        material.removeEventListener('dispose', onDispose)
        this.materials.delete(material)
      }
      material.addEventListener('dispose', onDispose)
    }
    return material
  }

  trackTexture<T extends THREE.Texture>(texture: T): T {
    if (!this.textures.has(texture)) {
      this.textures.add(texture)
      const onDispose = (): void => {
        texture.removeEventListener('dispose', onDispose)
        this.textures.delete(texture)
      }
      texture.addEventListener('dispose', onDispose)
    }
    return texture
  }

  getCounts(): GpuResourceCounts {
    return {
      geometries: this.geometries.size,
      materials: this.materials.size,
      textures: this.textures.size,
    }
  }

  disposeAll(): void {
    for (const g of [...this.geometries])
      g.dispose()
    for (const m of [...this.materials])
      m.dispose()
    for (const t of [...this.textures])
      t.dispose()
    this.geometries.clear()
    this.materials.clear()
    this.textures.clear()
  }
}
