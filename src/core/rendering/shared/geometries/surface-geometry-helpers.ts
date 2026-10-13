import type { BufferAttribute, BufferGeometry } from 'three'

/**
 * 地理填充三角形（经纬度度数表示，用于 GeoJSON 多边形三角剖分）
 */
export interface GeographicFillTriangle {
  vertices: readonly [readonly [number, number], readonly [number, number], readonly [number, number]]
  color: readonly [number, number, number]
  featureIndex: number
}

/**
 * 统一更新基于面元（Face）关联区域的高程/着色 BufferGeometry 顶点颜色
 */
export function updateSurfaceVertexColors(geometry: BufferGeometry, colors: Float32Array): void {
  const faceRegions = geometry.userData.faceRegions as Uint32Array | undefined
  const colorAttribute = geometry.getAttribute('color') as BufferAttribute | undefined
  if (!faceRegions || !colorAttribute)
    return

  for (let face = 0; face < faceRegions.length; face++) {
    const source = faceRegions[face] * 3
    const target = face * 9
    for (let vertex = 0; vertex < 3; vertex++) {
      const offset = target + vertex * 3
      colorAttribute.array[offset] = colors[source]
      colorAttribute.array[offset + 1] = colors[source + 1]
      colorAttribute.array[offset + 2] = colors[source + 2]
    }
  }
  colorAttribute.needsUpdate = true
}
