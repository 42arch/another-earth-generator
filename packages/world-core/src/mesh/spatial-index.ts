import type { Vector3Like } from '../math/spherical'
import type { MeshTopology } from './mesh-types'
/** Instance-local balanced 3D KD-tree. Owns 8N bytes; borrows immutable mesh centers. */
export class SphericalSpatialIndex {
  readonly meshId: string
  readonly byteLength: number
  #centers: Float64Array
  #left: Int32Array
  #right: Int32Array
  #root: number
  constructor(mesh: MeshTopology) {
    const count = mesh.regionCount
    if (!Number.isSafeInteger(count) || count < 1 || count > 163842 || mesh.centers.length !== 3 * count)
      throw new RangeError('Invalid spatial index mesh')
    for (let r = 0; r < count; r++) {
      if (Math.abs(Math.hypot(mesh.centers[3 * r], mesh.centers[3 * r + 1], mesh.centers[3 * r + 2]) - 1) > 1e-10 || !Number.isFinite(mesh.centers[3 * r] + mesh.centers[3 * r + 1] + mesh.centers[3 * r + 2]))
        throw new RangeError('Centers must lie on the unit sphere')
    }
    this.meshId = mesh.meshId
    this.#centers = mesh.centers
    this.#left = new Int32Array(count).fill(-1)
    this.#right = new Int32Array(count).fill(-1)
    this.byteLength = this.#left.byteLength + this.#right.byteLength
    const ids = new Int32Array(count)
    for (let r = 0; r < count; r++)
      ids[r] = r
    const build = (start: number, end: number, depth: number): number => {
      if (start >= end)
        return -1
      const axis = depth % 3
      ids.subarray(start, end).sort((a, b) => this.#centers[3 * a + axis] - this.#centers[3 * b + axis] || a - b)
      const middle = (start + end) >>> 1
      const id = ids[middle]
      this.#left[id] = build(start, middle, depth + 1)
      this.#right[id] = build(middle + 1, end, depth + 1)
      return id
    }
    this.#root = build(0, count, 0)
  }

  /** Exact Euclidean chord nearest neighbor on unit sphere. Equal computed distances choose lower ID. */
  findNearestRegion(position: Vector3Like): number {
    const length = Math.hypot(position.x, position.y, position.z)
    if (!(length > 0) || !Number.isFinite(length))
      throw new RangeError('Expected a finite nonzero query vector')
    const x = position.x / length
    const y = position.y / length
    const z = position.z / length
    let best = -1
    let distance = Infinity
    const visit = (region: number, depth: number): void => {
      if (region < 0)
        return
      const dx = x - this.#centers[3 * region]
      const dy = y - this.#centers[3 * region + 1]
      const dz = z - this.#centers[3 * region + 2]
      const d = dx * dx + dy * dy + dz * dz
      if (d < distance || (d === distance && region < best)) {
        distance = d
        best = region
      }
      const axis = depth % 3
      const delta = axis === 0 ? dx : axis === 1 ? dy : dz
      visit(delta < 0 ? this.#left[region] : this.#right[region], depth + 1)
      if (delta * delta <= distance)
        visit(delta < 0 ? this.#right[region] : this.#left[region], depth + 1)
    }
    visit(this.#root, 0)
    return best
  }
}
