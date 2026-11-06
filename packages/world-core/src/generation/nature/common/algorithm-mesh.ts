import type { RandomSource } from '#math/random'
import type { SphericalMesh } from '#mesh/spherical-mesh'

/** Internal migration adapter. Areas are steradians and edge lengths radians, preserving legacy tuning. */
export interface AlgorithmMesh {
  readonly numRegions: number
  readonly physicalRadiusKm: number
  readonly voronoi: { readonly edgeRegions: Uint32Array }
  /** Latitude in radians, matching the legacy climate/erosion convention. */
  readonly regionLatitude: Float32Array
  distanceBetweenRegions: (a: number, b: number) => number
  readonly regionPosition: Float64Array
  readonly regionArea: Float64Array
  readonly neighborOffsets: Uint32Array
  readonly neighbors: Uint32Array
  readonly neighborDistances: Float64Array
  forEachNeighborOfRegion: (region: number) => Iterable<number>
}

export type AlgorithmMeshInput = Pick<SphericalMesh, 'meshId' | 'regionCount' | 'physicalRadiusKm' | 'centers' | 'areaKm2' | 'neighborOffsets' | 'neighbors' | 'neighborEdges' | 'edgeAngularDistances' | 'edgeRegions'>

/** Select before cloning, so render-only buffers never enter algorithm copies. */
export function selectAlgorithmMeshInput(mesh: Readonly<SphericalMesh>): AlgorithmMeshInput {
  const { meshId, regionCount, physicalRadiusKm, centers, areaKm2, neighborOffsets, neighbors, neighborEdges, edgeAngularDistances, edgeRegions } = mesh
  return { meshId, regionCount, physicalRadiusKm, centers, areaKm2, neighborOffsets, neighbors, neighborEdges, edgeAngularDistances, edgeRegions }
}

export function algorithmMesh(mesh: AlgorithmMeshInput): AlgorithmMesh {
  const regionArea = Float64Array.from(mesh.areaKm2, area => area / mesh.physicalRadiusKm ** 2)
  const neighborDistances = Float64Array.from(mesh.neighborEdges, edge => mesh.edgeAngularDistances[edge])
  return {
    numRegions: mesh.regionCount,
    physicalRadiusKm: mesh.physicalRadiusKm,
    voronoi: { edgeRegions: mesh.edgeRegions },
    regionLatitude: Float32Array.from({ length: mesh.regionCount }, (_, r) => Math.asin(Math.max(-1, Math.min(1, mesh.centers[3 * r + 1])))),
    distanceBetweenRegions(a, b) {
      const dot = mesh.centers[3 * a] * mesh.centers[3 * b] + mesh.centers[3 * a + 1] * mesh.centers[3 * b + 1] + mesh.centers[3 * a + 2] * mesh.centers[3 * b + 2]
      return Math.acos(Math.max(-1, Math.min(1, dot)))
    },
    regionPosition: mesh.centers,
    regionArea,
    neighborOffsets: mesh.neighborOffsets,
    neighbors: mesh.neighbors,
    neighborDistances,
    * forEachNeighborOfRegion(region) {
      for (let i = mesh.neighborOffsets[region]; i < mesh.neighborOffsets[region + 1]; i++)
        yield mesh.neighbors[i]
    },
  }
}

export function randomFunction(source: RandomSource): () => number {
  return () => source.nextFloat()
}
