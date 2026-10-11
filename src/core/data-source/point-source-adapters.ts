import type { GeoJsonFeatureCollection } from '@/core/data-source/geojson'
import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldSimulationState } from '@/core/simulation/state'

export type PointSourceAdapter = (mesh: SphericalMesh, data: WorldSimulationState) => GeoJsonFeatureCollection

const rankLevel = { village: 0, town: 1, city: 2, metropolis: 3 } as const

function pointForRegion(mesh: SphericalMesh, region: number): [number, number] {
  return [
    mesh.regionLongitude[region] * 180 / Math.PI,
    mesh.regionLatitude[region] * 180 / Math.PI,
  ]
}

export const POINT_SOURCE_ADAPTERS: Record<string, PointSourceAdapter> = {
  'settlement-points': (mesh, data) => {
    const civilization = data.civilization
    if (!civilization)
      return { type: 'FeatureCollection', features: [] }
    const capitals = new Set(civilization.polities?.polities
      .map(polity => polity.capitalSettlementId)
      .filter(id => id >= 0) ?? [])
    return { type: 'FeatureCollection', features: civilization.settlements.map(settlement => ({
      type: 'Feature' as const,
      id: settlement.id,
      geometry: { type: 'Point' as const, coordinates: pointForRegion(mesh, settlement.region) },
      properties: {
        name: settlement.name,
        region: settlement.region,
        markerLevel: rankLevel[settlement.rank],
        rank: settlement.rank,
        population: settlement.population,
        isCapital: capitals.has(settlement.id),
        isSacredSite: false,
      },
    })) }
  },
  'sacred-site-points': (mesh, data) => ({
    type: 'FeatureCollection',
    features: (data.civilization?.religions?.sacredSites ?? []).map(site => ({
      type: 'Feature' as const,
      id: site.id,
      geometry: { type: 'Point' as const, coordinates: pointForRegion(mesh, site.region) },
      properties: { name: site.name, region: site.region, markerLevel: 2, religionId: site.religionId, settlementId: site.settlementId },
    })),
  }),
}
