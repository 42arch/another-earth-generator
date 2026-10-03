import type SphericalMesh from '@/core/mesh/mesh'

interface DrainageGeometry {
  offsets: Uint32Array
  neighbors: Uint32Array
  /** Angular distance for each directed neighbor entry, retained at Float64 precision. */
  distance: Float64Array
}

const geometryCache = new WeakMap<SphericalMesh, DrainageGeometry>()

/** Mesh topology is fixed throughout terrain evolution; elevations and drainage directions are not cached. */
export function drainageGeometry(mesh: SphericalMesh): DrainageGeometry {
  const cached = geometryCache.get(mesh)
  if (cached)
    return cached
  let offsets = mesh.neighborOffsets
  let neighbors = mesh.neighbors
  // Also support small graph fixtures and mesh adapters implementing neighbor iteration only.
  if (!offsets || !neighbors) {
    offsets = new Uint32Array(mesh.numRegions + 1)
    const entries: number[] = []
    for (let region = 0; region < mesh.numRegions; region++) {
      for (const neighbor of mesh.forEachNeighborOfRegion(region))
        entries.push(neighbor)
      offsets[region + 1] = entries.length
    }
    neighbors = Uint32Array.from(entries)
  }
  const distance = new Float64Array(neighbors.length)
  for (let region = 0; region < mesh.numRegions; region++) {
    for (let entry = offsets[region]; entry < offsets[region + 1]; entry++)
      distance[entry] = mesh.distanceBetweenRegions(region, neighbors[entry])
  }
  const geometry = { offsets, neighbors, distance }
  geometryCache.set(mesh, geometry)
  return geometry
}
