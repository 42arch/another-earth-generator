import type { SphericalCrustData } from './crust-types'

export type { SphericalCrustData } from './crust-types'
export { CRUST_TYPE } from './crust-types'
export const PLATE_BOUNDARY = {
  None: 0,
  Convergent: 1,
  Divergent: 2,
  Transform: 3,
} as const

export const SUBDUCTION_ROLE = {
  None: 0,
  Overriding: 1,
  Subducting: 2,
} as const

export interface SphericalBoundaryData {
  /** Boundary classification for every Voronoi edge. */
  edgeBoundaryType: Uint8Array
  /** Signed separation speed: negative converges, positive diverges. */
  edgeNormalVelocity: Float32Array
  /** Absolute relative velocity parallel to the boundary. */
  edgeShearVelocity: Float32Array
  /** Dominant normal or shear velocity magnitude. */
  edgeStress: Float32Array
  /** Strongest incident boundary type for each region. */
  regionBoundaryType: Uint8Array
  /** Strongest incident edge stress for each region. */
  regionStress: Float32Array
  /** Compression, extension and shear components before normalization. */
  regionCompression: Float32Array
  regionExtension: Float32Array
  regionShear: Float32Array
  /** Tangential direction toward the opposite side of the strongest boundary. */
  regionStressDirection: Float32Array
  /** Plate ids on the two sides of a convergent subduction boundary. */
  edgeSubductingPlate: Int16Array
  edgeOverridingPlate: Int16Array
  /** Strongest convergent-boundary role for each region. */
  regionSubductionRole: Uint8Array
  /** Blended subduction polarity: 0 is overriding, 1 is subducting. */
  regionSubductionFactor: Float32Array
}

export interface SphericalTectonicData extends SphericalBoundaryData, SphericalCrustData {
  regionPlate: Int16Array
  /** Broad tectonic unit that owns boundary topology and propagation barriers. */
  regionPrimaryPlate: Int16Array
  plateSeeds: Uint32Array
  /** Signed Euler angular velocity vectors, stored as xyz triples. */
  plateAngularVelocity: Float32Array
}
