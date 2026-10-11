import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Points,
  PointsMaterial,
} from 'three'

export class Stars {
  public readonly group = new Group()

  constructor() {
    const geometry = new BufferGeometry()
    const vertices = []

    // 生成 3000 颗随机星星
    for (let i = 0; i < 3000; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      // 将星星放置在距离星球中心 1000 到 1500 的球壳内，避免与相机(maxDistance 500)穿模
      const r = 1000 + Math.random() * 500

      vertices.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
      )
    }

    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))

    const material = new PointsMaterial({
      color: 0xFFFFFF,
      size: 2.0,
      transparent: true,
      opacity: 0.8,
    })

    const points = new Points(geometry, material)
    this.group.add(points)
  }

  public dispose(): void {
    this.group.removeFromParent()
    for (const child of this.group.children) {
      if (child instanceof Points) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose())
        }
        else {
          child.material.dispose()
        }
      }
    }
  }
}
