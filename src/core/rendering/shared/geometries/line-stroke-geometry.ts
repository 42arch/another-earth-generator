import { BufferAttribute, BufferGeometry } from 'three'

/** Expands independent centerline segments into screen-space ribbon triangles. */
export class LineStrokeGeometry {
  create(centerline: BufferGeometry): BufferGeometry {
    const sourcePositions = centerline.getAttribute('position') as BufferAttribute
    const sourceDistances = centerline.getAttribute('lineDistance') as BufferAttribute
    const sourceFeatures = centerline.getAttribute('featureIndex') as BufferAttribute
    const sourceBrightness = centerline.getAttribute('brightness') as BufferAttribute
    const positions: number[] = []
    const others: number[] = []
    const sides: number[] = []
    const alongs: number[] = []
    const distances: number[] = []
    const featureIndices: number[] = []
    const brightnesses: number[] = []
    const corners: readonly [number, number][] = [
      [0, -1], [0, 1], [1, -1],
      [0, 1], [1, 1], [1, -1],
    ]

    for (let vertex = 0; vertex + 1 < sourcePositions.count; vertex += 2) {
      for (const [along, side] of corners) {
        const current = vertex + along
        const other = vertex + 1 - along
        positions.push(sourcePositions.getX(current), sourcePositions.getY(current), sourcePositions.getZ(current))
        others.push(sourcePositions.getX(other), sourcePositions.getY(other), sourcePositions.getZ(other))
        sides.push(side)
        alongs.push(along)
        distances.push(sourceDistances.getX(current))
        featureIndices.push(sourceFeatures.getX(current))
        brightnesses.push(sourceBrightness.getX(current))
      }
    }

    const geometry = new BufferGeometry()
    const count = positions.length / 3
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    geometry.setAttribute('other', new BufferAttribute(new Float32Array(others), 3))
    geometry.setAttribute('side', new BufferAttribute(new Float32Array(sides), 1))
    geometry.setAttribute('along', new BufferAttribute(new Float32Array(alongs), 1))
    geometry.setAttribute('lineDistance', new BufferAttribute(new Float32Array(distances), 1))
    geometry.setAttribute('featureIndex', new BufferAttribute(new Uint32Array(featureIndices), 1))
    geometry.setAttribute('brightness', new BufferAttribute(new Float32Array(brightnesses), 1))
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(count * 3), 3))
    geometry.setAttribute('featureOpacity', new BufferAttribute(new Float32Array(count), 1))
    geometry.setAttribute('strokeWidth', new BufferAttribute(new Float32Array(count), 1))
    geometry.setAttribute('dashLength', new BufferAttribute(new Float32Array(count), 1))
    geometry.setAttribute('gapLength', new BufferAttribute(new Float32Array(count), 1))
    if (count > 0)
      geometry.computeBoundingSphere()
    return geometry
  }
}
