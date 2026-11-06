import type { GeologyArtifact } from './types'

/** Primitive-only query result; never exposes owned arrays. Also usable on independent display copies. */
export function queryGeologyRegion(geology: GeologyArtifact, region: number) {
  if (!Number.isInteger(region) || region < 0 || region >= geology.plateIndex.length)
    throw new RangeError('Invalid geology region')
  const plate = geology.plates[geology.plateIndex[region]]
  const continent = geology.continents[geology.continentIndex[region]]
  return Object.freeze({
    meshId: geology.meshId,
    referenceRegion: geology.geologicalReference[region],
    geographicReferenceRegion: geology.geographicReference[region],
    plateId: plate.id,
    plateKind: plate.kind,
    subdivisionIndex: geology.subdivisionIndex[region],
    candidateLand: geology.candidateLandMask[region] === 1,
    continentId: continent?.id ?? null,
    crustType: geology.crustType[region] === 1 ? 'continental' as const : 'oceanic' as const,
    densityGcm3: geology.densityGcm3[region],
    thicknessKm: geology.thicknessKm[region],
  })
}
