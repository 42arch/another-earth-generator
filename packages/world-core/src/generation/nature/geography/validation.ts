import type { TerrainArtifact } from './types'

/** Validate typed stage/transfer data. Incomplete or malformed data throws before installation. */
export function validateTerrainArtifact(value: TerrainArtifact, meshId = value.meshId, regionCount = value.elevationKm.length, plateCount = value.plateAngularVelocity.length / 3): void {
  if (!value.meshId || value.meshId !== meshId || !value.algorithmVersion || !(value.physicalRadiusKm > 0) || !Number.isFinite(value.physicalRadiusKm) || !Number.isFinite(value.seaLevelDatumKm) || value.physicalRadiusKm + value.seaLevelDatumKm <= 0)
    throw new TypeError('Invalid terrain identity or planet')
  const fields = { elevationKm: Float32Array, landMask: Uint8Array, slopeRadians: Float32Array, boundaryType: Uint8Array, stress: Float32Array, mantleFlow: Float32Array, volcanicCoordinate: Float32Array, ridgeCoordinate: Float32Array, regionalUpliftCoordinate: Float32Array, regionalReliefKm: Float32Array, roughnessWeight: Float32Array, erosionCoordinate: Float32Array, depositionCoordinate: Float32Array, foldBelt: Float32Array }
  for (const [key, constructor] of Object.entries(fields)) {
    const array = value[key as keyof typeof fields]
    if (!(array instanceof constructor) || array.length !== regionCount || !array.every(Number.isFinite))
      throw new TypeError(`Invalid terrain field ${key}`)
  }
  if (!(value.plateAngularVelocity instanceof Float32Array) || value.plateAngularVelocity.length !== plateCount * 3 || !value.plateAngularVelocity.every(Number.isFinite) || !Number.isInteger(plateCount) || plateCount < 2)
    throw new TypeError('Invalid terrain plate motion')
  for (let r = 0; r < regionCount; r++) {
    if (value.landMask[r] !== (value.elevationKm[r] > 0 ? 1 : 0) || value.physicalRadiusKm + value.seaLevelDatumKm + value.elevationKm[r] <= 0 || value.slopeRadians[r] < 0 || value.slopeRadians[r] > Math.PI / 2 + 1e-7 || value.boundaryType[r] > 3 || value.stress[r] < 0 || Math.abs(value.mantleFlow[r]) > 1 + 1e-6 || value.roughnessWeight[r] < 0 || value.roughnessWeight[r] > 1 || value.regionalUpliftCoordinate[r] < 0 || value.erosionCoordinate[r] < 0 || value.depositionCoordinate[r] < 0 || value.foldBelt[r] < 0)
      throw new TypeError(`Invalid terrain region ${r}`)
  }
  const stats = value.statistics
  if (![stats.landCoverage, stats.candidateLandCoverage].every(v => Number.isFinite(v) && v >= 0 && v <= 1 + 1e-9) || ![stats.changedCoastRegions, stats.landComponentCount].every(v => Number.isInteger(v) && v >= 0 && v <= regionCount) || !Number.isFinite(stats.largestLandAreaKm2) || stats.largestLandAreaKm2 < 0 || !Number.isFinite(stats.minimumElevationKm) || !Number.isFinite(stats.maximumElevationKm) || stats.minimumElevationKm > stats.maximumElevationKm || stats.elevationQuantilesKm.length !== 5 || !stats.elevationQuantilesKm.every((v, i, values) => Number.isFinite(v) && v >= stats.minimumElevationKm && v <= stats.maximumElevationKm && (i === 0 || v >= values[i - 1])))
    throw new TypeError('Invalid terrain statistics')
}
