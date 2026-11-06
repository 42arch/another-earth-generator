import type { TerrainArtifact } from './types'

export function queryTerrainRegion(terrain: TerrainArtifact, region: number) {
  if (!Number.isInteger(region) || region < 0 || region >= terrain.elevationKm.length)
    throw new RangeError('Invalid terrain region')
  return Object.freeze({ meshId: terrain.meshId, elevationKm: terrain.elevationKm[region], land: terrain.landMask[region] === 1, slopeRadians: terrain.slopeRadians[region], boundaryType: terrain.boundaryType[region], stress: terrain.stress[region], mantleFlow: terrain.mantleFlow[region], volcanicCoordinate: terrain.volcanicCoordinate[region], ridgeCoordinate: terrain.ridgeCoordinate[region], regionalUpliftCoordinate: terrain.regionalUpliftCoordinate[region], regionalReliefKm: terrain.regionalReliefKm[region], roughnessWeight: terrain.roughnessWeight[region], erosionCoordinate: terrain.erosionCoordinate[region], depositionCoordinate: terrain.depositionCoordinate[region], foldBelt: terrain.foldBelt[region] })
}
