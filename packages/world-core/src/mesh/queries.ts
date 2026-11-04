import type { Vector3Like } from '../math/spherical'
import type { SphericalMesh } from './spherical-mesh'
/** Read facade; outputs belong to callers. Does not expose mesh buffers or mutate topology. */
export class MeshQueries {
  readonly meshId: string
  readonly regionCount: number
  #mesh: SphericalMesh
  constructor(mesh: SphericalMesh) {
    this.#mesh = mesh
    this.meshId = mesh.meshId
    this.regionCount = mesh.regionCount
  }

  #check(region: number): void {
    if (!Number.isInteger(region) || region < 0 || region >= this.regionCount)
      throw new RangeError('Invalid region index')
  }

  getRegionCenter(region: number, out: Vector3Like): Vector3Like {
    this.#check(region)
    out.x = this.#mesh.centers[3 * region]
    out.y = this.#mesh.centers[3 * region + 1]
    out.z = this.#mesh.centers[3 * region + 2]
    return out
  }

  getRegionAreaKm2(region: number): number {
    this.#check(region)
    return this.#mesh.areaKm2[region]
  }

  getNeighborCount(region: number): number {
    this.#check(region)
    return this.#mesh.neighborOffsets[region + 1] - this.#mesh.neighborOffsets[region]
  }

  forEachRegion(callback: (region: number) => void): void {
    for (let r = 0; r < this.regionCount; r++)
      callback(r)
  }

  forEachNeighbor(region: number, callback: (neighbor: number, edge: number, distanceKm: number) => void): void {
    this.#check(region)
    const m = this.#mesh
    for (let i = m.neighborOffsets[region]; i < m.neighborOffsets[region + 1]; i++) {
      const edge = m.neighborEdges[i]
      callback(m.neighbors[i], edge, m.edgeAngularDistances[edge] * m.physicalRadiusKm)
    }
  }

  areAdjacent(a: number, b: number): boolean {
    return this.getNeighborDistanceKm(a, b) !== null
  }

  /** null for nonadjacent regions; center-to-center physical distance, not boundary length. */
  getNeighborDistanceKm(a: number, b: number): number | null {
    this.#check(a)
    this.#check(b)
    const m = this.#mesh
    for (let i = m.neighborOffsets[a]; i < m.neighborOffsets[a + 1]; i++) {
      if (m.neighbors[i] === b)
        return m.edgeAngularDistances[m.neighborEdges[i]] * m.physicalRadiusKm
    }
    return null
  }

  forEachBoundaryCorner(region: number, callback: (corner: number, x: number, y: number, z: number) => void): void {
    this.#check(region)
    const m = this.#mesh
    for (let i = m.neighborOffsets[region]; i < m.neighborOffsets[region + 1]; i++) {
      const id = m.boundaryCorners[i]
      callback(id, m.dualVertices[3 * id], m.dualVertices[3 * id + 1], m.dualVertices[3 * id + 2])
    }
  }
}
