import type { DenseField } from '#world/fields'

export interface GeologyState {
  readonly plates: readonly { readonly id: string }[]
  /** Snapshot-local lookup into plates, length N. Plate IDs are stable. */
  readonly plateIndex: DenseField<Uint32Array>
  /** 0 oceanic, 1 continental, length N. */
  readonly crustType: DenseField<Uint8Array>
}
export interface GeographyState {
  /** km relative to sea level, length N, no missing values. */
  readonly elevationKm: DenseField<Float32Array>
  /** 0 ocean, 1 land (elevation > 0), length N. */
  readonly landMask: DenseField<Uint8Array>
}
export interface ClimateState {
  readonly monthsPerYear: 12
  /** Month-major: index = month * regionCount + region, month 0..11. */
  readonly layout: 'month-major'
  /** Monthly means, °C >= absolute zero, length 12N. */
  readonly temperatureC: DenseField<Float32Array>
  /** Monthly totals, mm/month >= 0, length 12N. */
  readonly precipitationMm: DenseField<Float32Array>
}
export interface HydrologyState {
  /** Region receiver, -1 for an outlet. Length N; no cycles. */
  readonly downstreamRegion: DenseField<Int32Array>
  /** Annual runoff depth mm/year >= 0, length N. */
  readonly annualRunoffMm: DenseField<Float32Array>
}
export interface EcologyState {
  /** Snapshot-local classification dictionaries. No missing values. */
  readonly potentialBiomeIds: readonly string[]
  readonly landCoverIds: readonly string[]
  readonly potentialBiomeIndex: DenseField<Uint16Array>
  readonly landCoverIndex: DenseField<Uint16Array>
}
export interface NatureState {
  readonly geology: GeologyState
  readonly geography: GeographyState
  readonly climate: ClimateState
  readonly hydrology: HydrologyState
  readonly ecology: EcologyState
}
