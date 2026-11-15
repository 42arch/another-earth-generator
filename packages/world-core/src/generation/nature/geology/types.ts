/** Core-owned M1.1A artifact. Public display copies are independent of this storage. */
export interface GeologyArtifact {
  readonly meshId: string
  readonly referenceMeshId: string
  readonly referenceRegionCount: number
  readonly algorithmVersion: string
  readonly plates: readonly { readonly id: string, readonly kind: 'primary' | 'micro' }[]
  readonly continents: readonly { readonly id: string, readonly referenceSeedRegion: number }[]
  /** Relative Euler model vectors, xyz triples; not radians per year. */
  readonly plateAngularVelocity: Float32Array
  readonly geographicReference: Uint32Array
  readonly geologicalReference: Uint32Array
  readonly plateIndex: Uint32Array
  /** Internal reference subdivision index (0..99), distinct from moving plateIndex. */
  readonly subdivisionIndex: Uint32Array
  readonly candidateLandMask: Uint8Array
  readonly continentIndex: Int32Array
  readonly nearestContinentIndex: Int32Array
  /** 0 oceanic, 1 continental. */
  readonly crustType: Uint8Array
  readonly densityGcm3: Float32Array
  readonly thicknessKm: Float32Array
  /** Dimensionless working elevation, not final physical terrain. */
  readonly baseElevationCoordinate: Float32Array
  readonly statistics: {
    readonly targetCandidateLandCoverage: number
    readonly referenceCandidateLandCoverage: number
    readonly outputCandidateLandCoverage: number
    readonly candidateLandAreaKm2: number
    readonly requestedMicroPlateCount: number
    readonly actualMicroPlateCount: number
  }
}
