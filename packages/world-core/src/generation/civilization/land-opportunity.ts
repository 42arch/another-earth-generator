import type { SphericalMesh } from '#mesh/spherical-mesh'
import { IndexPriorityQueue } from '#generation/nature/common/priority-queue'
import { greatCircleDistanceKm } from '#math/spherical'

/** Attenuates caller-owned potential along land paths; never crosses an ocean. */
export function spreadLandOpportunity(
  mesh: Pick<SphericalMesh, 'regionCount' | 'centers' | 'neighborOffsets' | 'neighbors' | 'physicalRadiusKm'>,
  landMask: Uint8Array,
  movementCost: Float32Array,
  potential: Float32Array,
  rangeKm: number,
  check?: () => void,
): void {
  const queue = new IndexPriorityQueue(Math.min(mesh.regionCount, 8192))
  const processed = new Uint8Array(mesh.regionCount)
  for (let r = 0; r < mesh.regionCount; r++) {
    if ((r & 4095) === 0)
      check?.()
    if (landMask[r] === 1 && potential[r]! > 0)
      queue.push(r, -potential[r]!)
  }
  const a = { x: 0, y: 0, z: 0 }
  const b = { x: 0, y: 0, z: 0 }
  let iterations = 0
  while (queue.size > 0) {
    if ((iterations++ & 4095) === 0)
      check?.()
    const u = queue.pop()
    if (processed[u])
      continue
    processed[u] = 1
    a.x = mesh.centers[3 * u]
    a.y = mesh.centers[3 * u + 1]
    a.z = mesh.centers[3 * u + 2]
    for (let e = mesh.neighborOffsets[u]; e < mesh.neighborOffsets[u + 1]; e++) {
      const v = mesh.neighbors[e]!
      if (landMask[v] !== 1 || processed[v])
        continue
      b.x = mesh.centers[3 * v]
      b.y = mesh.centers[3 * v + 1]
      b.z = mesh.centers[3 * v + 2]
      const resistance = (movementCost[u]! + movementCost[v]!) * 0.5
      const next = Math.fround(potential[u]! - greatCircleDistanceKm(a, b, mesh.physicalRadiusKm) * resistance / rangeKm)
      if (next <= potential[v]!)
        continue
      potential[v] = next
      queue.push(v, -next)
    }
  }
}
