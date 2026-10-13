import type { MapStyleRenderer } from './style-spec'
import type { GeoJsonGeometryKind, MapStyleSourceKind } from '@/core/data-source'

export interface MapStyleRendererDefinition {
  id: string
  sourceKinds: readonly MapStyleSourceKind[]
  geometries?: readonly GeoJsonGeometryKind[]
  layoutProperties: readonly string[]
  paintProperties: readonly string[]
}

/** Style renderer capabilities; keep this registry aligned with MapStyleRenderer. */
export const MAP_STYLE_RENDERERS: Record<MapStyleRenderer, MapStyleRendererDefinition> = {
  'raster': {
    id: 'raster',
    sourceKinds: ['raster'],
    layoutProperties: ['visibility'],
    paintProperties: ['raster-color', 'raster-opacity'],
  },
  'fill': {
    id: 'fill',
    sourceKinds: ['geojson'],
    geometries: ['polygon'],
    layoutProperties: ['visibility'],
    paintProperties: ['fill-color', 'fill-opacity'],
  },
  'line': {
    id: 'line',
    sourceKinds: ['geojson'],
    geometries: ['line', 'polygon'],
    layoutProperties: ['visibility', 'line-cap', 'line-join'],
    paintProperties: ['line-color', 'line-opacity', 'line-width', 'line-dasharray'],
  },
  'river-ribbon': {
    id: 'river-ribbon',
    sourceKinds: ['geojson'],
    geometries: ['line'],
    layoutProperties: ['visibility'],
    paintProperties: ['line-color', 'line-opacity', 'line-width'],
  },
  'circle': {
    id: 'circle',
    sourceKinds: ['geojson'],
    geometries: ['point'],
    layoutProperties: ['visibility'],
    paintProperties: ['circle-color', 'circle-opacity', 'circle-radius', 'circle-stroke-color', 'circle-stroke-width'],
  },
  'symbol': {
    id: 'symbol',
    sourceKinds: ['geojson'],
    geometries: ['point', 'line', 'polygon'],
    layoutProperties: ['visibility', 'text-field', 'text-size', 'icon-image', 'symbol-placement', 'text-allow-overlap'],
    paintProperties: ['text-color', 'text-halo-color', 'text-halo-width', 'text-opacity'],
  },
}
