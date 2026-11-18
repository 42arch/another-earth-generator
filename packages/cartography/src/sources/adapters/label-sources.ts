import type { WorldMapReader } from '@another-earth/world-core'
import type {
  GeoJsonFeature,
  GeoJsonPointGeometry,
  GeoJsonSource,
  SourceUnavailable,
  TerritorySpineMetadata,
} from '#sources/types'
import { computeTerritorySpine } from '#sources/topology/territory-spine'
import { BUILTIN_MAP_SOURCE_SCHEMAS } from '#sources/types'
import { formatContinentDisplayName, formatOceanDisplayName } from './area-sources'

export function buildGeographicLabelsSource(
  reader: WorldMapReader,
  cacheKey: string,
): GeoJsonSource<GeoJsonPointGeometry> | SourceUnavailable {
  const { identity, capabilities, mesh } = reader
  const { adapterVersion } = BUILTIN_MAP_SOURCE_SCHEMAS['geographic-labels']
  const geoRegions = reader.geographicRegions()
  if (!capabilities.hasGeographicRegions || !geoRegions) {
    return Object.freeze({
      unavailable: true as const,
      sourceId: 'geographic-labels',
      snapshotId: identity.snapshotId,
      adapterVersion,
      cacheKey,
      reason: 'Geographic regions are unavailable in this world snapshot',
    })
  }

  const count = mesh.regionCount
  const continentField = reader.field('continentIndex')
  const oceanField = reader.field('oceanIndex')
  const continentMembers: number[][] = Array.from({ length: geoRegions.continents.length }, () => [])
  const oceanMembers: number[][] = Array.from({ length: geoRegions.oceans.length }, () => [])

  for (let r = 0; r < count; r++) {
    const cIdx = continentField.get(r)
    if (cIdx >= 0 && cIdx < continentMembers.length)
      continentMembers[cIdx].push(r)
    const oIdx = oceanField.get(r)
    if (oIdx >= 0 && oIdx < oceanMembers.length)
      oceanMembers[oIdx].push(r)
  }

  const features: GeoJsonFeature<GeoJsonPointGeometry>[] = []
  const spines = new Map<string, TerritorySpineMetadata>()

  for (let i = 0; i < geoRegions.continents.length; i++) {
    const item = geoRegions.continents[i]
    const members = continentMembers[i]
    if (!item.name || members.length === 0)
      continue
    const displayName = formatContinentDisplayName(item.name, i)
    const spine = computeTerritorySpine(mesh, {
      featureId: item.id,
      displayName,
      kind: 'continent',
      areaKm2: item.areaKm2,
      memberRegions: members,
    })
    spines.set(item.id, spine)
    features.push({
      type: 'Feature',
      id: item.id,
      geometry: {
        type: 'Point',
        coordinates: spine.anchorCoordinates,
      },
      properties: {
        id: item.id,
        kind: 'continent',
        name: displayName,
        displayName,
        areaKm2: item.areaKm2,
        elongation: spine.elongation,
        curved: spine.isCurved,
      },
    })
  }

  for (let i = 0; i < geoRegions.oceans.length; i++) {
    const item = geoRegions.oceans[i]
    const members = oceanMembers[i]
    if (!item.name || members.length === 0)
      continue
    const displayName = formatOceanDisplayName(item.name, i)
    const spine = computeTerritorySpine(mesh, {
      featureId: item.id,
      displayName,
      kind: 'ocean',
      areaKm2: item.areaKm2,
      memberRegions: members,
    })
    spines.set(item.id, spine)
    features.push({
      type: 'Feature',
      id: item.id,
      geometry: {
        type: 'Point',
        coordinates: spine.anchorCoordinates,
      },
      properties: {
        id: item.id,
        kind: 'ocean',
        name: displayName,
        displayName,
        areaKm2: item.areaKm2,
        elongation: spine.elongation,
        curved: spine.isCurved,
      },
    })
  }

  // Sort by areaKm2 descending so collision grid prioritizes largest territories first
  features.sort((a, b) => Number(b.properties.areaKm2) - Number(a.properties.areaKm2))

  return Object.freeze({
    unavailable: false as const,
    kind: 'geojson' as const,
    sourceId: 'geographic-labels',
    snapshotId: identity.snapshotId,
    adapterVersion,
    cacheKey,
    geometryKind: 'point' as const,
    data: Object.freeze({
      type: 'FeatureCollection' as const,
      features: Object.freeze(features),
    }),
    spines,
  })
}
