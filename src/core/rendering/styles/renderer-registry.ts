import type { GeoJsonGeometryKind } from '@/core/data-source/geojson'
import type { MapStyleSourceKind } from '@/core/data-source/source-registry'

export interface MapStyleRendererDefinition {
  id: string
  sourceKinds: readonly MapStyleSourceKind[]
  geometries?: readonly GeoJsonGeometryKind[]
  layoutProperties: readonly string[]
  paintProperties: readonly string[]
}

/** Style renderer capabilities. New renderer kinds can be registered without changing style documents. */
export const MAP_STYLE_RENDERERS: Record<string, MapStyleRendererDefinition> = {
  raster: {
    id: 'raster',
    sourceKinds: ['raster'],
    layoutProperties: ['visibility'],
    paintProperties: ['raster-color', 'raster-opacity'],
  },
  fill: {
    id: 'fill',
    sourceKinds: ['geojson'],
    geometries: ['polygon'],
    layoutProperties: ['visibility', 'boundary-mode'],
    paintProperties: ['fill-color', 'fill-opacity'],
  },
  line: {
    id: 'line',
    sourceKinds: ['geojson'],
    geometries: ['line', 'polygon'],
    layoutProperties: ['visibility', 'line-cap', 'line-join'],
    paintProperties: ['line-color', 'line-opacity', 'line-width', 'line-dasharray'],
  },
  circle: {
    id: 'circle',
    sourceKinds: ['geojson'],
    geometries: ['point'],
    layoutProperties: ['visibility'],
    paintProperties: ['circle-color', 'circle-opacity', 'circle-radius', 'circle-stroke-color', 'circle-stroke-width'],
  },
  symbol: {
    id: 'symbol',
    sourceKinds: ['geojson'],
    geometries: ['point', 'line', 'polygon'],
    layoutProperties: ['visibility', 'text-field', 'text-size', 'icon-image', 'symbol-placement', 'text-allow-overlap'],
    paintProperties: ['text-color', 'text-halo-color', 'text-halo-width', 'text-opacity'],
  },
}
