export interface MeshTopology {
  readonly meshId: string
  readonly regionCount: number
  /** XYZ unit-sphere region centers, length 3N; not a render radius. */
  readonly centers: Float64Array
  /** km², length N, strictly positive. */
  readonly areaKm2: Float64Array
  /** Undirected CSR adjacency: offsets length N+1; no self or duplicate edges. */
  readonly neighborOffsets: Uint32Array
  readonly neighbors: Uint32Array
}
