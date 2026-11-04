import type { RandomSource } from '../math/random'
/** Adapts legacy tangent-plane jitter, keeping the 12 original sites fixed. */
export function jitterIcosphere(centers: Float64Array, irregularity: number, random: RandomSource): void {
  const maxDisplacement = Math.sqrt(4 * Math.PI / (centers.length / 3)) * 0.75 * irregularity
  for (let i = 36; i < centers.length; i += 3) {
    const x = centers[i]
    const y = centers[i + 1]
    const z = centers[i + 2]
    const refx = Math.abs(y) < 0.9 ? 0 : 1
    const refy = Math.abs(y) < 0.9 ? 1 : 0
    const length = Math.hypot(refy * z, -refx * z, refx * y - refy * x)
    const ex = refy * z / length
    const ey = -refx * z / length
    const ez = (refx * y - refy * x) / length
    const nx = y * ez - z * ey
    const ny = z * ex - x * ez
    const nz = x * ey - y * ex
    const du = (random.nextFloat() - random.nextFloat()) * maxDisplacement
    const dv = (random.nextFloat() - random.nextFloat()) * maxDisplacement
    const a = x + du * ex + dv * nx
    const b = y + du * ey + dv * ny
    const c = z + du * ez + dv * nz
    const norm = Math.hypot(a, b, c)
    centers[i] = a / norm
    centers[i + 1] = b / norm
    centers[i + 2] = c / norm
  }
}
