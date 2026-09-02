export interface SphericalRiverData {
  drainageElevation: Float32Array
  downstreamRegion: Int32Array
  flowAccumulation: Float32Array
  /** Season-major accumulated flow for January, April, July and October. */
  seasonalFlowAccumulation: Float32Array
  riverMask: Uint8Array
  /** Annual river cells whose driest-season flow is below 25% of peak flow. */
  seasonalRiverMask: Uint8Array
  /** Relative seasonal flow range, from perennial (0) to intermittent (1). */
  riverSeasonality: Float32Array
  sourceRegions: Uint32Array
  segmentSource: Uint32Array
  segmentTarget: Uint32Array
  totalRunoff: number
  seasonalTotalRunoff: Float32Array
  thresholdFlow: number
}

export const LAKE_ICE_STATE = {
  OpenWater: 0,
  SeasonallyFrozen: 1,
  Subglacial: 2,
} as const

export type LakeIceStateCode
  = (typeof LAKE_ICE_STATE)[keyof typeof LAKE_ICE_STATE]

export interface SphericalLakeData {
  lakeMask: Uint8Array
  regionLakeId: Int32Array
  surfaceElevation: Float32Array
  bottomElevation: Float32Array
  area: Float32Array
  volume: Float32Array
  outletRegion: Int32Array
  outletTarget: Int32Array
  inflow: Float32Array
  /** Season-major inflow for January, April, July and October. */
  seasonalInflow: Float32Array
  evaporation: Float32Array
  /** Season-major open-water evaporation. */
  seasonalEvaporation: Float32Array
  fillRatio: Float32Array
  /** Season-major water-balance fill ratio. */
  seasonalFillRatio: Float32Array
  salinity: Float32Array
  isEndorheic: Uint8Array
  isSeasonal: Uint8Array
  iceState: Uint8Array
}
