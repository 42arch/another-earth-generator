/** Display-only state; it must never participate in a generation signature. */
export interface WorldViewState {
  readonly mode: 'globe' | 'atlas'
  readonly mapStyleId: string
  readonly thematicLayerIds: readonly string[]
  readonly overlayLayerIds: readonly string[]
  /** 0 through 11, for monthly climate layers. */
  readonly climateMonth: number
  readonly selectedEntityId?: string
  readonly camera: {
    readonly targetLongitudeDegrees: number
    readonly targetLatitudeDegrees: number
    readonly zoom: number
    readonly bearingDegrees: number
    readonly pitchDegrees: number
  }
}
