/** Independently validated T0 terrain artifact, not a complete WorldSnapshot. */
export interface TerrainSurfaceTexture {
  /** Display-only, dimensionless texture fields generated from the T0 seed. */
  readonly tectonicBand: Float32Array
  readonly detail: Float32Array
  readonly coastal: Float32Array
  readonly uniformLand: Float32Array
  readonly postDetail: Float32Array
}

export interface TerrainArtifact {
  readonly meshId: string
  readonly algorithmVersion: string
  readonly physicalRadiusKm: number
  readonly seaLevelDatumKm: number
  readonly elevationKm: Float32Array
  readonly landMask: Uint8Array
  /** Maximum adjacent-region gradient angle, in radians. */
  readonly slopeRadians: Float32Array
  /** 0 none, 1 convergence, 2 divergence, 3 transform. */
  readonly boundaryType: Uint8Array
  /** Relative model stress, not physical pressure. */
  readonly stress: Float32Array
  readonly mantleFlow: Float32Array
  readonly plateAngularVelocity: Float32Array
  /** Dimensionless shaping contributions; cannot be added to final physical km. */
  readonly volcanicCoordinate: Float32Array
  readonly ridgeCoordinate: Float32Array
  /** Legacy compatibility diagnostic; no additional regional uplift is applied. */
  readonly regionalUpliftCoordinate: Float32Array
  /** Legacy compatibility diagnostic; no additional regional relief is applied. */
  readonly regionalReliefKm: Float32Array
  /** Legacy compatibility diagnostic; uniformly 1 in the restored algorithm. */
  readonly roughnessWeight: Float32Array
  /** Water plus glacial erosion delta in internal shaping coordinates. */
  readonly erosionCoordinate: Float32Array
  /** Deposited shaping-coordinate delta. */
  readonly depositionCoordinate: Float32Array
  readonly foldBelt: Float32Array
  /** Optional render input; excluded from WorldSnapshot facts and domain queries. */
  readonly surfaceTexture?: TerrainSurfaceTexture
  readonly statistics: {
    readonly landCoverage: number
    readonly candidateLandCoverage: number
    readonly changedCoastRegions: number
    readonly landComponentCount: number
    readonly largestLandAreaKm2: number
    readonly minimumElevationKm: number
    readonly maximumElevationKm: number
    /** Region-weighted quantiles; land coverage and component areas are area-weighted. */
    readonly elevationQuantilesKm: readonly number[]
  }
}
