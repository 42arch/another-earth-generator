import { smoothstep } from '@/core/math/math'

/** Returns a subdued but visible night brightness with a soft twilight transition. */
export function getSurfaceDaylight(
  x: number,
  y: number,
  z: number,
  sunX: number,
  sunY: number,
  sunZ: number,
): number {
  const positionLength = Math.hypot(x, y, z)
  const sunLength = Math.hypot(sunX, sunY, sunZ)
  if (positionLength <= Number.EPSILON || sunLength <= Number.EPSILON)
    return 0.045

  const cosine = (x * sunX + y * sunY + z * sunZ) / (positionLength * sunLength)
  const twilight = smoothstep(-0.12, 0.12, cosine)
  return 0.045 + twilight * 0.955
}
