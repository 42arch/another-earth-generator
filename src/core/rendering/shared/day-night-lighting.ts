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
  const amount = Math.max(0, Math.min(1, (cosine + 0.12) / 0.24))
  const twilight = amount * amount * (3 - 2 * amount)
  return 0.045 + twilight * 0.955
}
