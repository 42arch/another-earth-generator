import { BufferAttribute, BufferGeometry } from 'three'

export type SphericalPosition = readonly [number, number, number]

export function appendSphericalPosition(
  positions: number[],
  position: SphericalPosition,
  radius: number,
): void {
  positions.push(
    position[0] * radius,
    position[1] * radius,
    position[2] * radius,
  )
}

export function createLineGeometry(
  positions: number[],
  colors?: number[],
): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  if (colors)
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  return geometry
}
