export interface PlanetParameters {
  readonly physicalRadiusKm: number
  readonly rotationPeriodHours: number
  /** Earth days, each exactly 24 hours. */
  readonly orbitalPeriodDays: number
  /** [0, 180], prograde/retrograde encoded by tilt. */
  readonly axialTiltDegrees: number
  /** Sea-level reference relative to the planet's radial datum; elevations are relative to this. */
  readonly seaLevelDatumKm: number
}
