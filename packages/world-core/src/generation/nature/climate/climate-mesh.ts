import type { SphericalMesh } from '#mesh/spherical-mesh'

/** Read-only geometry adapter for the feat-society climate solvers. */
export interface ClimateMesh {
  readonly numRegions: number
  readonly regionPosition: Float32Array
  readonly regionLatitude: Float32Array
  readonly regionLongitude: Float32Array
  readonly regionArea: Float64Array
  readonly neighborOffsets: Uint32Array
  readonly neighbors: Uint32Array
  readonly neighborDx: Float32Array
  readonly neighborDy: Float32Array
  readonly neighborDz: Float32Array
  readonly physicalRadiusKm: number
}

export function climateMesh(mesh: SphericalMesh): ClimateMesh {
  const n = mesh.regionCount
  const regionPosition = Float32Array.from(mesh.centers)
  const regionLatitude = new Float32Array(n)
  const regionLongitude = new Float32Array(n)
  const neighborDx = new Float32Array(mesh.neighbors.length)
  const neighborDy = new Float32Array(mesh.neighbors.length)
  const neighborDz = new Float32Array(mesh.neighbors.length)
  for (let r = 0; r < n; r++) {
    regionLatitude[r] = Math.asin(Math.max(-1, Math.min(1, mesh.centers[3 * r + 1])))
    regionLongitude[r] = Math.atan2(mesh.centers[3 * r], mesh.centers[3 * r + 2])
    for (let edge = mesh.neighborOffsets[r]; edge < mesh.neighborOffsets[r + 1]; edge++) {
      const other = mesh.neighbors[edge]
      neighborDx[edge] = regionPosition[3 * r] - regionPosition[3 * other]
      neighborDy[edge] = regionPosition[3 * r + 1] - regionPosition[3 * other + 1]
      neighborDz[edge] = regionPosition[3 * r + 2] - regionPosition[3 * other + 2]
    }
  }
  return { numRegions: n, regionPosition, regionLatitude, regionLongitude, regionArea: mesh.areaKm2, neighborOffsets: mesh.neighborOffsets, neighbors: mesh.neighbors, neighborDx, neighborDy, neighborDz, physicalRadiusKm: mesh.physicalRadiusKm }
}
