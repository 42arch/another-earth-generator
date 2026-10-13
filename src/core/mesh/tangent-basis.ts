import { Matrix4, Vector3 } from 'three'

export interface TangentBasis {
  matrix: Matrix4
  right: Vector3
  up: Vector3
  normal: Vector3
}

/**
 * 构造球面局部切平面的正交旋转基底：
 * X = right (向东正向阅读方向，或沿 forward 走向在切平面的投影)
 * Y = up (向北上方，或法向正交向上)
 * Z = normal (球心外向法线)
 */
export function computeTangentBasis(normal: Vector3, forward?: Vector3): TangentBasis {
  const northRef = new Vector3(0, 1, 0)
  let right: Vector3
  let up: Vector3

  if (forward && forward.lengthSq() > 1e-4) {
    right = forward.clone().sub(normal.clone().multiplyScalar(forward.dot(normal))).normalize()
    up = new Vector3().crossVectors(normal, right).normalize()
    right.crossVectors(up, normal).normalize()
  }
  else {
    up = northRef.clone().sub(normal.clone().multiplyScalar(normal.dot(northRef)))
    if (up.lengthSq() < 1e-6) {
      const poleFallback = new Vector3(0, 0, -Math.sign(normal.y || 1))
      up = poleFallback.sub(normal.clone().multiplyScalar(normal.dot(poleFallback)))
    }
    up.normalize()
    right = new Vector3().crossVectors(up, normal).normalize()
    up.crossVectors(normal, right).normalize()
  }

  const matrix = new Matrix4().makeBasis(right, up, normal)
  return { matrix, right, up, normal }
}
