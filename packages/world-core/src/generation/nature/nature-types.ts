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
  /** Present on newly generated worlds. Older Schema 3 archives remain unnamed and unclassified. */
  readonly regions?: {
    /** Present when continent and ocean names were generated. */
    readonly nameContentSignature?: string
    readonly continentIndex: DenseField<Int32Array>
    readonly oceanIndex: DenseField<Int32Array>
    /** Added in geographic-regions-v2; absent in older classified archives. */
    readonly seaIndex?: DenseField<Int32Array>
    readonly continents: readonly { readonly id: string, readonly areaKm2: number, readonly name?: string }[]
    readonly oceans: readonly { readonly id: string, readonly areaKm2: number, readonly name?: string, readonly definingContinentIds?: readonly string[] }[]
    readonly seas?: readonly { readonly id: string, readonly areaKm2: number }[]
  }
}
export interface ClimateState {
  readonly monthsPerYear: 12
  /** Month-major: index = month * regionCount + region, month 0..11. */
  readonly layout: 'month-major'
  /** Monthly means, °C >= absolute zero, length 12N. */
  readonly temperatureC: DenseField<Float32Array>
  /** Monthly totals, mm/month >= 0, length 12N. */
  readonly precipitationMm: DenseField<Float32Array>
  readonly annualMeanTemperatureC: DenseField<Float32Array>
  readonly annualPrecipitationMm: DenseField<Float32Array>
  readonly koppenClass: DenseField<Uint8Array>
}
export interface HydrologyState {
  readonly monthlySnowWaterEquivalentMm: DenseField<Float32Array>
  readonly monthlySnowfallMm: DenseField<Float32Array>
  readonly monthlySnowmeltMm: DenseField<Float32Array>
  /** Region receiver, -1 for an outlet. Length N; no cycles. */
  readonly downstreamRegion: DenseField<Int32Array>
  /** Annual runoff depth mm/year >= 0, length N. */
  readonly annualRunoffMm: DenseField<Float32Array>
  readonly annualRunoffVolumeM3: DenseField<Float64Array>
  readonly accumulatedAnnualFlowM3s: DenseField<Float64Array>
  readonly contributingAreaKm2: DenseField<Float64Array>
  /** -1 for ocean, otherwise an index into basins. */
  readonly basinIndex: DenseField<Int32Array>
  readonly basins: readonly { readonly id: string, readonly outletRegion: number, readonly endorheic: boolean, readonly areaKm2: number, readonly annualRunoffM3: number }[]
  /** -1 outside a river segment. */
  readonly riverIndex: DenseField<Int32Array>
  readonly rivers: readonly { readonly id: string, readonly sourceRegion: number, readonly mouthRegion: number, readonly downstreamRiver: number, readonly annualMeanDischargeM3s: number, readonly strahlerOrder: number, readonly endorheic: boolean, readonly regions: Uint32Array }[]
  /** -1 outside a static lake. */
  readonly lakeIndex: DenseField<Int32Array>
  readonly lakes: readonly { readonly id: string, readonly basinId: string, readonly endorheic: boolean, readonly areaKm2: number, readonly waterLevelKm: number, readonly spillRegion: number | null, readonly downstreamRegion: number | null, readonly regions: Uint32Array }[]
}
export interface EcologyState {
  /** Snapshot-local classification dictionaries. No missing values. */
  readonly potentialBiomeIds: readonly string[]
  readonly landCoverIds: readonly string[]
  readonly potentialBiomeIndex: DenseField<Uint16Array>
  readonly landCoverIndex: DenseField<Uint16Array>
  readonly aridityIndex: DenseField<Float32Array>
  readonly growingSeasonMonths: DenseField<Uint8Array>
}
export interface NatureState {
  readonly geology: GeologyState
  readonly geography: GeographyState
  readonly climate: ClimateState
  readonly hydrology: HydrologyState
  readonly ecology: EcologyState
}
