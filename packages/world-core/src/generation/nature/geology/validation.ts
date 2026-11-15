import type { GeologyArtifact } from './types'

/** Validate decoded typed artifact data before displaying or caching. Not an arbitrary JSON parser. */
export function validateGeologyArtifact(value: GeologyArtifact, meshId = value.meshId, regionCount = value.plateIndex.length): void {
  if (!value.meshId || value.meshId !== meshId || !value.referenceMeshId || !Number.isInteger(value.referenceRegionCount) || value.referenceRegionCount < 1 || !value.algorithmVersion || !value.plates.length || value.plateAngularVelocity.length !== value.plates.length * 3)
    throw new TypeError('Invalid geology identity or plate table')
  const fields = {
    geographicReference: Uint32Array,
    geologicalReference: Uint32Array,
    plateIndex: Uint32Array,
    subdivisionIndex: Uint32Array,
    candidateLandMask: Uint8Array,
    continentIndex: Int32Array,
    nearestContinentIndex: Int32Array,
    crustType: Uint8Array,
    densityGcm3: Float32Array,
    thicknessKm: Float32Array,
    baseElevationCoordinate: Float32Array,
  }
  for (const [key, constructor] of Object.entries(fields)) {
    const array = value[key as keyof typeof fields]
    if (!(array instanceof constructor) || array.length !== regionCount)
      throw new TypeError(`Invalid geology field ${key}`)
  }
  if (!(value.plateAngularVelocity instanceof Float32Array) || !value.plateAngularVelocity.every(Number.isFinite) || new Set(value.plates.map(p => p.id)).size !== value.plates.length || value.plates.some(p => !p.id || (p.kind !== 'primary' && p.kind !== 'micro')) || new Set(value.continents.map(c => c.id)).size !== value.continents.length || value.continents.some(c => !c.id || !Number.isInteger(c.referenceSeedRegion) || c.referenceSeedRegion < 0 || c.referenceSeedRegion >= value.referenceRegionCount))
    throw new TypeError('Invalid geology entity data')
  const validContinent = (index: number) => index >= 0 && index < value.continents.length
  for (let r = 0; r < regionCount; r++) {
    if (value.geographicReference[r] >= value.referenceRegionCount || value.geologicalReference[r] >= value.referenceRegionCount || value.plateIndex[r] >= value.plates.length || value.subdivisionIndex[r] >= 100 || value.candidateLandMask[r] > 1 || value.crustType[r] !== value.candidateLandMask[r] || (value.candidateLandMask[r] ? !validContinent(value.continentIndex[r]) : value.continentIndex[r] !== -1) || (value.continents.length ? !validContinent(value.nearestContinentIndex[r]) : value.nearestContinentIndex[r] !== -1) || !(value.densityGcm3[r] > 0) || !Number.isFinite(value.densityGcm3[r]) || !(value.thicknessKm[r] > 0) || !Number.isFinite(value.thicknessKm[r]) || !Number.isFinite(value.baseElevationCoordinate[r]))
      throw new TypeError(`Invalid geology region ${r}`)
  }
  for (const key of ['targetCandidateLandCoverage', 'referenceCandidateLandCoverage', 'outputCandidateLandCoverage'] as const) {
    if (!Number.isFinite(value.statistics[key]) || value.statistics[key] < 0 || value.statistics[key] > 1 + 1e-9)
      throw new TypeError(`Invalid geology statistic ${key}`)
  }
  if (!Number.isFinite(value.statistics.candidateLandAreaKm2) || value.statistics.candidateLandAreaKm2 < 0)
    throw new TypeError('Invalid candidate land area')
}
