import type { RandomSource } from '../math/random'
import { AleaRandom } from '../math/random'
import { jitterIcosphere } from './jitter'
import { triangulateSphericalDelaunay } from './spherical-delaunay'

export interface IcosphereOptions {
  readonly irregularity?: number
  readonly seed?: string | number
  /** Fresh stream; never reuse an already-consumed instance for reproducible geometry. */
  readonly random?: RandomSource
}
export interface IcosphereGeometry {
  readonly irregularity: number
  readonly seed: string
  readonly subdivisionLevel: number
  readonly centers: Float64Array
  /** Outward CCW region triples, length 3F. */
  readonly triangles: Uint32Array
}
export function icosphereRegionCount(subdivisionLevel: number): number {
  if (!Number.isInteger(subdivisionLevel) || subdivisionLevel < 0 || subdivisionLevel > 8)
    throw new RangeError('subdivisionLevel must be an integer in [0, 8]')
  return 10 * 4 ** subdivisionLevel + 2
}
/** Stable legacy subdivision order; optional seeded jitter uses instance-local PRNG state. */
export function generateIcosphere(subdivisionLevel: number, options: IcosphereOptions = {}): IcosphereGeometry {
  const count = icosphereRegionCount(subdivisionLevel)
  const irregularity = options.irregularity ?? 0
  if (!Number.isFinite(irregularity) || irregularity < 0 || irregularity > 1)
    throw new RangeError('irregularity must be in [0, 1]')
  if (typeof options.seed === 'number' && !Number.isSafeInteger(options.seed))
    throw new RangeError('Numeric seed must be a safe integer')
  const seed = String(options.seed ?? 0)
  if (!seed.trim())
    throw new RangeError('Seed cannot be empty')
  const phi = (1 + Math.sqrt(5)) / 2
  const centers = new Float64Array(3 * count)
  const base = [-1, phi, 0, 1, phi, 0, -1, -phi, 0, 1, -phi, 0, 0, -1, phi, 0, 1, phi, 0, -1, -phi, 0, 1, -phi, phi, 0, -1, phi, 0, 1, -phi, 0, -1, -phi, 0, 1]
  for (let i = 0; i < 36; i += 3) {
    const length = Math.hypot(base[i], base[i + 1], base[i + 2])
    centers[i] = base[i] / length
    centers[i + 1] = base[i + 1] / length
    centers[i + 2] = base[i + 2] / length
  }
  let triangles: Uint32Array = new Uint32Array([0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1])
  let vertices = 12
  for (let level = 0; level < subdivisionLevel; level++) {
    const midpoints = new Map<number, number>()
    const midpoint = (a: number, b: number): number => {
      const key = Math.min(a, b) * count + Math.max(a, b)
      const existing = midpoints.get(key)
      if (existing !== undefined)
        return existing
      const x = centers[3 * a] + centers[3 * b]
      const y = centers[3 * a + 1] + centers[3 * b + 1]
      const z = centers[3 * a + 2] + centers[3 * b + 2]
      const length = Math.hypot(x, y, z)
      const id = vertices++
      centers[3 * id] = x / length
      centers[3 * id + 1] = y / length
      centers[3 * id + 2] = z / length
      midpoints.set(key, id)
      return id
    }
    const next = new Uint32Array(4 * triangles.length)
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t]
      const b = triangles[t + 1]
      const c = triangles[t + 2]
      const ab = midpoint(a, b)
      const bc = midpoint(b, c)
      const ca = midpoint(c, a)
      const out = 4 * t
      next[out] = a
      next[out + 1] = ab
      next[out + 2] = ca
      next[out + 3] = b
      next[out + 4] = bc
      next[out + 5] = ab
      next[out + 6] = c
      next[out + 7] = ca
      next[out + 8] = bc
      next[out + 9] = ab
      next[out + 10] = bc
      next[out + 11] = ca
    }
    triangles = next
  }
  if (irregularity > 0) {
    jitterIcosphere(centers, irregularity, options.random ?? new AleaRandom(seed))
    triangles = triangulateSphericalDelaunay(centers)
  }
  return { subdivisionLevel, irregularity, seed: irregularity > 0 ? seed : '0', centers, triangles }
}
