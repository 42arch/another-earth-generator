export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function dot3(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  return ax * bx + ay * by + az * bz
}

export function sphericalTriangleArea(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): number {
  const crossX = by * cz - bz * cy
  const crossY = bz * cx - bx * cz
  const crossZ = bx * cy - by * cx
  const numerator = Math.abs(ax * crossX + ay * crossY + az * crossZ)
  const denominator = 1
    + dot3(ax, ay, az, bx, by, bz)
    + dot3(bx, by, bz, cx, cy, cz)
    + dot3(cx, cy, cz, ax, ay, az)
  return 2 * Math.atan2(numerator, denominator)
}

export function deterministicUnit(seed: number, a: number, b = 0, c = 0): number {
  let value = Math.imul(seed ^ 0x9E3779B9, 0x85EBCA6B)
  value = Math.imul(value ^ a, 0xC2B2AE35)
  value = Math.imul(value ^ b, 0x27D4EB2D)
  value = Math.imul(value ^ c, 0x165667B1)
  value ^= value >>> 16
  return (value >>> 0) / 0x100000000
}
