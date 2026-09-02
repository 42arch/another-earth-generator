export interface SphericalTectonicData {
  regionPlate: Int32Array
  plateSeeds: Int32Array
  plateArea: Float32Array
  plateCentroid: Float32Array
  /** Area-weighted continental-crust fraction for each plate. */
  plateContinentalFraction: Float32Array
  /** Euler angular velocity vectors, stored as xyz triples per plate. */
  plateAngularVelocity: Float32Array
  /** Boundary classification for each spherical Voronoi edge. */
  edgeBoundaryType: Uint8Array
  /** Connected boundary-run id for each edge, or -1 for an internal edge. */
  edgeBoundarySegment: Int32Array
  /** Coherent 0..1 geomorphic expression envelope along each boundary run. */
  edgeBoundaryActivity: Float32Array
  /** Signed relative velocity normal to each edge; negative values converge. */
  edgeNormalVelocity: Float32Array
  /** Absolute relative velocity tangent to each edge. */
  edgeShearVelocity: Float32Array
  /** Dominant normal or shear stress for each edge. */
  edgeStress: Float32Array
  /** 0: none, -1: edge region A subducts, +1: edge region B subducts. */
  edgeSubductionPolarity: Int8Array
  /** Per-region oceanic or continental crust classification. */
  regionCrustType: Uint8Array
  /** Relative crust age from newly formed (0) to old (1). */
  regionCrustAge: Float32Array
  /** Approximate crust thickness in kilometres. */
  regionCrustThicknessKm: Float32Array
  /** Strongest incident boundary classification, aggregated for region consumers. */
  regionBoundaryType: Uint8Array
  /** Strongest incident edge stress, aggregated for region consumers. */
  regionStress: Float32Array
}

export const SPHERICAL_CRUST_TYPE = {
  Unknown: 0,
  Oceanic: 1,
  Continental: 2,
} as const

export const EDGE_SUBDUCTION_POLARITY = {
  RegionAUnderB: -1,
  None: 0,
  RegionBUnderA: 1,
} as const

export const SPHERICAL_ISLAND_TYPE = {
  None: 0,
  VolcanicArc: 1,
  HotspotChain: 2,
  ContinentalFragment: 3,
  Scattered: 4,
} as const

export type SphericalIslandTypeCode
  = (typeof SPHERICAL_ISLAND_TYPE)[keyof typeof SPHERICAL_ISLAND_TYPE]
