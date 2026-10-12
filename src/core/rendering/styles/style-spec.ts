import type { MapStyleSourceDefinition } from '@/core/data-source/source-registry'

export type StyleExpression = readonly [operator: string, ...operands: StyleValue[]]
export type StyleValue = string | number | boolean | null | readonly StyleValue[] | StyleExpression
export type MapStyleView = 'map' | 'globe'
export type MapStyleRenderer = 'raster' | 'fill' | 'line' | 'river-ribbon' | 'circle' | 'symbol'

export interface MapStyleLayer {
  id: string
  source: string
  renderer: MapStyleRenderer
  /** Optional overlay toggle id (e.g. 'routes', 'cities', 'nation-borders') */
  overlay?: string
  /** Optional thematic fill category (e.g. 'plates', 'continents', 'koppen', 'biome', 'polities') */
  thematic?: string
  /** Omitted means the layer is available in both views. */
  views?: readonly MapStyleView[]
  /** Restrict generated base-map fills to selected display modes. */
  baseMaps?: readonly string[]
  minZoom?: number
  maxZoom?: number
  filter?: StyleExpression
  layout: Record<string, StyleValue>
  paint: Record<string, StyleValue>
}

export interface MapStyleDocument {
  version: 1
  id: string
  name: string
  description: string
  tokens: Record<string, string | number>
  sources?: Record<string, MapStyleSourceDefinition>
  layers: MapStyleLayer[]
}

export interface StyleEvaluationContext {
  zoom: number
  tokens: MapStyleDocument['tokens']
  properties?: Record<string, unknown>
}
