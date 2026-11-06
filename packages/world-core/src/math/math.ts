export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1)
    return value < edge0 ? 0 : 1
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

export function gaussian(distance: number, width: number): number {
  if (!Number.isFinite(distance))
    return 0
  const normalized = distance / Math.max(width, Number.EPSILON)
  return Math.exp(-0.5 * normalized * normalized)
}

