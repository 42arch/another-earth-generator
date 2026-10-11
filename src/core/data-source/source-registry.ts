import type { GeoJsonGeometryKind } from '@/core/data-source/geojson'

export type MapStyleSourceKind = 'raster' | 'geojson'

export interface MapStyleSourceDefinition {
  id: string
  kind: MapStyleSourceKind
  properties: readonly string[]
  geometry?: GeoJsonGeometryKind
  provider?: string
  overlay?: string
}

/** Built-in data sources; style documents may register additional sources. */
export const MAP_STYLE_SOURCES: Record<string, MapStyleSourceDefinition> = {
  'world-surface': { id: 'world-surface', kind: 'raster', provider: 'world:surface', properties: ['isLand', 'elevation', 'biome', 'temperature', 'precipitation'] },
  'land-areas': { id: 'land-areas', kind: 'geojson', geometry: 'polygon', provider: 'generated:land-areas', properties: ['kind'] },
  'polity-areas': { id: 'polity-areas', kind: 'geojson', geometry: 'polygon', provider: 'generated:polity-areas', properties: ['groupId', 'name', 'population'] },
  'ethnicity-areas': { id: 'ethnicity-areas', kind: 'geojson', geometry: 'polygon', provider: 'generated:ethnicity-areas', properties: ['groupId', 'name'] },
  'language-areas': { id: 'language-areas', kind: 'geojson', geometry: 'polygon', provider: 'generated:language-areas', properties: ['groupId', 'name'] },
  'religion-areas': { id: 'religion-areas', kind: 'geojson', geometry: 'polygon', provider: 'generated:religion-areas', properties: ['groupId', 'name'] },
  'polity-boundaries': { id: 'polity-boundaries', kind: 'geojson', geometry: 'line', provider: 'generated:polity-boundaries', overlay: 'nation-borders', properties: ['ownerA', 'ownerB', 'disputed'] },
  'river-network': { id: 'river-network', kind: 'geojson', geometry: 'line', provider: 'generated:river-network', properties: ['flowAccumulation', 'order'] },
  'transport-network': { id: 'transport-network', kind: 'geojson', geometry: 'line', provider: 'generated:transport-network', overlay: 'routes', properties: ['kind', 'distanceKm', 'costKm'] },
  'settlement-points': { id: 'settlement-points', kind: 'geojson', geometry: 'point', provider: 'generated:settlement-points', overlay: 'cities', properties: ['name', 'rank', 'population', 'isCapital', 'isSacredSite', 'region', 'markerLevel'] },
  'sacred-site-points': { id: 'sacred-site-points', kind: 'geojson', geometry: 'point', provider: 'generated:sacred-site-points', overlay: 'sacred-sites', properties: ['name', 'religionId', 'settlementId', 'region', 'markerLevel'] },
  'settlement-labels': { id: 'settlement-labels', kind: 'geojson', geometry: 'point', provider: 'generated:settlement-labels', properties: ['name', 'rank', 'population', 'isCapital', 'isSacredSite'] },
  'polity-labels': { id: 'polity-labels', kind: 'geojson', geometry: 'point', provider: 'generated:polity-labels', properties: ['name', 'population', 'rank'] },
  'civilization-labels': { id: 'civilization-labels', kind: 'geojson', geometry: 'point', provider: 'generated:civilization-labels', properties: ['name', 'type', 'population'] },
}

export function getMapStyleSource(id: string, sources?: Record<string, MapStyleSourceDefinition>): MapStyleSourceDefinition | undefined {
  return sources?.[id] ?? MAP_STYLE_SOURCES[id]
}
