import type { MAP_STYLE_SOURCES } from '@/core/data-source/source-registry'
import type { MapStyleDocument, MapStyleLayer, MapStyleView, StyleEvaluationContext, StyleValue } from '@/core/rendering/styles/style-spec'
import { getImportedGeoJsonSource, notifyMapDataSourceChanges } from '@/core/data-source/data-sources'
import { geoJsonGeometryKind } from '@/core/data-source/geojson'
import { hasGeoJsonSource } from '@/core/data-source/geojson-source-runtime'
import { getMapStyleSource } from '@/core/data-source/source-registry'
import { MAP_STYLE_PRESETS } from '@/core/rendering/styles/presets'
import { MAP_STYLE_RENDERERS } from '@/core/rendering/styles/renderer-registry'
import { civilizationGroupColor } from '@/core/simulation/civilization/group-color'

export interface ResolvedStyleLayer {
  layer: MapStyleLayer
  layout: Record<string, unknown>
  paint: Record<string, unknown>
  visible: boolean
}

function interpolate(from: unknown, to: unknown, amount: number): unknown {
  if (typeof from === 'number' && typeof to === 'number')
    return from + (to - from) * amount
  if (typeof from === 'string' && typeof to === 'string' && /^#[\da-f]{6}$/i.test(from) && /^#[\da-f]{6}$/i.test(to)) {
    const a = Number.parseInt(from.slice(1), 16)
    const b = Number.parseInt(to.slice(1), 16)
    const channel = (shift: number) => Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * amount)
    return `#${channel(16).toString(16).padStart(2, '0')}${channel(8).toString(16).padStart(2, '0')}${channel(0).toString(16).padStart(2, '0')}`
  }
  return amount < 0.5 ? from : to
}

export function evaluateStyleValue(value: StyleValue, context: StyleEvaluationContext): unknown {
  if (!Array.isArray(value))
    return value

  const [operator, ...args] = value
  const evaluate = (item: StyleValue | undefined) => item === undefined ? undefined : evaluateStyleValue(item, context)
  switch (operator) {
    case 'literal':
      return args[0]
    case 'token':
      return context.tokens[String(evaluate(args[0]) ?? '')]
    case 'zoom':
      return context.zoom
    case 'get':
      return context.properties?.[String(evaluate(args[0]) ?? '')]
    case 'group-color': {
      const [red, green, blue] = civilizationGroupColor(Number(evaluate(args[0]) ?? 0))
      return `#${[red, green, blue].map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}`
    }
    case 'coalesce':
      for (const arg of args) {
        const result = evaluate(arg)
        if (result !== null && result !== undefined)
          return result
      }
      return null
    case 'case': {
      for (let index = 0; index + 1 < args.length - 1; index += 2) {
        if (evaluate(args[index]))
          return evaluate(args[index + 1])
      }
      return evaluate(args.at(-1))
    }
    case 'match': {
      const input = evaluate(args[0])
      for (let index = 1; index + 1 < args.length - 1; index += 2) {
        const label = evaluate(args[index])
        if (Array.isArray(label) ? label.includes(input) : label === input)
          return evaluate(args[index + 1])
      }
      return evaluate(args.at(-1))
    }
    case 'step': {
      const input = Number(evaluate(args[0]))
      let output = evaluate(args[1])
      for (let index = 2; index + 1 < args.length; index += 2) {
        if (input < Number(evaluate(args[index])))
          break
        output = evaluate(args[index + 1])
      }
      return output
    }
    case 'interpolate': {
      const input = Number(evaluate(args[1]))
      if (args.length < 6)
        return evaluate(args.at(-1))
      for (let index = 2; index + 3 < args.length; index += 2) {
        const lower = Number(evaluate(args[index]))
        const upper = Number(evaluate(args[index + 2]))
        const lowerValue = evaluate(args[index + 1])
        const upperValue = evaluate(args[index + 3])
        if (input <= lower)
          return lowerValue
        if (input <= upper)
          return interpolate(lowerValue, upperValue, (input - lower) / Math.max(Number.EPSILON, upper - lower))
      }
      return evaluate(args.at(-1))
    }
    case 'all':
      return args.every(arg => Boolean(evaluate(arg)))
    case 'any':
      return args.some(arg => Boolean(evaluate(arg)))
    case '!':
      return !evaluate(args[0])
    case '==':
      return evaluate(args[0]) === evaluate(args[1])
    case '!=':
      return evaluate(args[0]) !== evaluate(args[1])
    case '>':
      return Number(evaluate(args[0])) > Number(evaluate(args[1]))
    case '>=':
      return Number(evaluate(args[0])) >= Number(evaluate(args[1]))
    case '<':
      return Number(evaluate(args[0])) < Number(evaluate(args[1]))
    case '<=':
      return Number(evaluate(args[0])) <= Number(evaluate(args[1]))
    case '+':
      return args.reduce<number>((total, arg) => total + Number(evaluate(arg)), 0)
    case '-':
      return Number(evaluate(args[0])) - Number(evaluate(args[1]))
    case '*':
      return args.reduce<number>((total, arg) => total * Number(evaluate(arg)), 1)
    case '/':
      return Number(evaluate(args[0])) / Number(evaluate(args[1]))
    case 'min':
      return Math.min(...args.map(arg => Number(evaluate(arg))))
    case 'max':
      return Math.max(...args.map(arg => Number(evaluate(arg))))
    default:
      return null
  }
}

function evaluateRecord(
  record: Record<string, StyleValue>,
  context: StyleEvaluationContext,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, evaluateStyleValue(value, context)]))
}

const resolvedCache = new WeakMap<MapStyleDocument, Map<string, (context: StyleEvaluationContext) => ResolvedStyleLayer>>()

function compileLayer(style: MapStyleDocument, layer: MapStyleLayer): (context: StyleEvaluationContext) => ResolvedStyleLayer {
  let cache = resolvedCache.get(style)
  if (!cache) {
    cache = new Map()
    resolvedCache.set(style, cache)
  }
  const existing = cache.get(layer.id)
  if (existing)
    return existing

  const compiled = (context: StyleEvaluationContext): ResolvedStyleLayer => {
    const layout = evaluateRecord(layer.layout, context)
    const paint = evaluateRecord(layer.paint, context)
    const minZoom = layer.minZoom ?? 0
    const maxZoom = layer.maxZoom ?? 24
    const visible = layout.visibility !== 'none' && context.zoom >= minZoom && context.zoom < maxZoom
    return { layer, layout, paint, visible }
  }
  cache.set(layer.id, compiled)
  return compiled
}

export function getMapStyleDocument(styleId: string | undefined): MapStyleDocument {
  return MAP_STYLE_PRESETS[styleId ?? ''] ?? MAP_STYLE_PRESETS.standard
}

export function getMapStyleLayer(styleId: string | undefined, layerId: string): MapStyleLayer | undefined {
  return getMapStyleDocument(styleId).layers.find(layer => layer.id === layerId)
}

export function getRasterStyleLayer(styleId: string | undefined, baseMap: string): MapStyleLayer | undefined {
  const layers = getMapStyleDocument(styleId).layers
  for (let index = layers.length - 1; index >= 0; index--) {
    if (layers[index].renderer === 'raster' && layers[index].baseMaps?.includes(baseMap))
      return layers[index]
  }
  return undefined
}

export function usesVectorCartographicBaseMap(styleId: string | undefined, baseMap: string): boolean {
  return baseMap === 'cartographic'
    && !getRasterStyleLayer(styleId, baseMap)
    && getMapStyleDocument(styleId).layers.some(layer => layer.renderer === 'fill'
      && layer.source === 'land-areas' && layer.baseMaps?.includes(baseMap))
}

/** Point layers are discovered from the style document, independent of feature-specific scene classes. */
export function getPointStyleLayerEntries(
  styleId: string | undefined,
  view: MapStyleView,
  overlays: Record<string, boolean>,
): Array<{ layer: MapStyleLayer, order: number }> {
  const entries: Array<{ layer: MapStyleLayer, order: number }> = []
  getMapStyleDocument(styleId).layers.forEach((layer, order) => {
    const source = getMapStyleSource(layer.source, getMapStyleDocument(styleId).sources)
    if (layer.renderer !== 'circle' || source?.kind !== 'geojson' || source.geometry !== 'point'
      || !hasGeoJsonSource(layer.source)) {
      return
    }
    if (layer.views && !layer.views.includes(view))
      return
    if (source.overlay && !overlays[source.overlay])
      return
    entries.push({ layer, order })
  })
  return entries
}

export function havePointStyleOverlayChanges(
  styleId: string | undefined,
  previous: Record<string, boolean>,
  next: Record<string, boolean>,
): boolean {
  return getMapStyleDocument(styleId).layers.some((layer) => {
    if (layer.renderer !== 'circle')
      return false
    const overlay = getMapStyleSource(layer.source, getMapStyleDocument(styleId).sources)?.overlay
    return overlay !== undefined && previous[overlay] !== next[overlay]
  })
}

export function resolveMapStyleLayer(
  styleId: string | undefined,
  layerId: string,
  zoom = 0,
  properties?: Record<string, unknown>,
): ResolvedStyleLayer | undefined {
  const style = getMapStyleDocument(styleId)
  const layer = style.layers.find(item => item.id === layerId)
  if (!layer)
    return undefined
  return compileLayer(style, layer)({ zoom, tokens: style.tokens, properties })
}

export function getMapStylePaint(
  styleId: string | undefined,
  layerId: string,
  property: string,
  zoom = 0,
  properties?: Record<string, unknown>,
): unknown {
  return resolveMapStyleLayer(styleId, layerId, zoom, properties)?.paint[property]
}

export function getMapStyleLayout(
  styleId: string | undefined,
  layerId: string,
  property: string,
  zoom = 0,
  properties?: Record<string, unknown>,
): unknown {
  return resolveMapStyleLayer(styleId, layerId, zoom, properties)?.layout[property]
}

export function isMapStyleLayerVisible(styleId: string | undefined, layerId: string, zoom: number, view?: MapStyleView): boolean {
  const resolved = resolveMapStyleLayer(styleId, layerId, zoom)
  return Boolean(resolved?.visible && (!view || !resolved.layer.views || resolved.layer.views.includes(view)))
}

/** Evaluate a layer's feature filter in the context supplied by its source adapter. */
export function matchesMapStyleLayerFilter(
  styleId: string | undefined,
  layerId: string,
  zoom: number,
  properties: Record<string, unknown>,
): boolean {
  const style = getMapStyleDocument(styleId)
  const layer = style.layers.find(item => item.id === layerId)
  return !layer?.filter || Boolean(evaluateStyleValue(layer.filter, {
    zoom,
    tokens: style.tokens,
    properties,
  }))
}

/** Convert the app's 2D camera scale (1 = full map) to a Mapbox-like zoom. */
export function getMapStyleZoom(cameraZoom: number): number {
  return Math.max(0, Math.min(24, Math.log2(Math.max(cameraZoom, Number.EPSILON))))
}

/** Convert globe camera distance to a zoom where distance = 3.2 planet radii is zoom 0. */
export function getGlobeStyleZoom(distance: number, planetRadius: number): number {
  const referenceDistance = Math.max(planetRadius * 3.2, Number.EPSILON)
  return Math.max(0, Math.min(24, Math.log2(referenceDistance / Math.max(distance, Number.EPSILON))))
}

const EXPRESSION_OPERATORS = new Set([
  'literal',
  'token',
  'zoom',
  'get',
  'group-color',
  'coalesce',
  'case',
  'match',
  'step',
  'interpolate',
  'all',
  'any',
  '!',
  '==',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  '+',
  '-',
  '*',
  '/',
  'min',
  'max',
])

function validateStyleValue(
  value: StyleValue,
  path: string,
  style: MapStyleDocument,
  source: typeof MAP_STYLE_SOURCES[string] | undefined,
  errors: string[],
): void {
  if (!Array.isArray(value))
    return
  const [operator, ...args] = value
  if (typeof operator !== 'string' || !EXPRESSION_OPERATORS.has(operator)) {
    errors.push(`${path} uses an unsupported expression operator`)
    return
  }
  if (operator === 'token') {
    const key = String(args[0] ?? '')
    if (!(key in style.tokens))
      errors.push(`${path} references unknown token "${key}"`)
    return
  }
  if (operator === 'get') {
    const key = String(args[0] ?? '')
    if (source && !source.properties.includes(key))
      errors.push(`${path} reads unknown property "${key}" from source "${source.id}"`)
    return
  }
  if (operator === 'literal')
    return
  const expressionArgs = operator === 'interpolate' ? args.slice(1) : args
  expressionArgs.forEach((argument, index) => {
    validateStyleValue(argument, `${path}[${index + 1}]`, style, source, errors)
  })
}

export function validateMapStyleDocument(style: MapStyleDocument): string[] {
  const errors: string[] = []
  if (style.version !== 1)
    errors.push(`Unsupported style version: ${style.version}`)
  for (const [id, source] of Object.entries(style.sources ?? {})) {
    if (source.id !== id)
      errors.push(`Source key "${id}" must match its id`)
    if (source.kind !== 'raster' && source.kind !== 'geojson')
      errors.push(`Source "${id}" has an unsupported kind`)
  }
  const seen = new Set<string>()
  for (const layer of style.layers) {
    if (seen.has(layer.id))
      errors.push(`Duplicate layer id: ${layer.id}`)
    seen.add(layer.id)
    const source = getMapStyleSource(layer.source, style.sources)
    const renderer = MAP_STYLE_RENDERERS[layer.renderer]
    if (!source)
      errors.push(`Layer "${layer.id}" references unknown source "${layer.source}"`)
    if (!renderer)
      errors.push(`Layer "${layer.id}" references unknown renderer "${layer.renderer}"`)
    if (source && renderer && !renderer.sourceKinds.includes(source.kind))
      errors.push(`Renderer "${renderer.id}" cannot render source kind "${source.kind}"`)
    if (source?.kind === 'geojson' && !source.geometry)
      errors.push(`GeoJSON source "${source.id}" requires a geometry kind`)
    if (source?.geometry && renderer?.geometries && !renderer.geometries.includes(source.geometry))
      errors.push(`Renderer "${renderer.id}" cannot render ${source.geometry} geometry`)
    if (source?.kind === 'geojson' && !hasGeoJsonSource(layer.source))
      errors.push(`Layer "${layer.id}" has no registered GeoJSON data for source "${layer.source}"`)
    const imported = getImportedGeoJsonSource(layer.source)
    if (source?.geometry && imported?.data.features.some(feature => geoJsonGeometryKind(feature.geometry) !== source.geometry))
      errors.push(`Layer "${layer.id}" source "${source.id}" contains incompatible geometries`)
    if (layer.views && (layer.views.length === 0 || layer.views.some(view => view !== 'map' && view !== 'globe') || new Set(layer.views).size !== layer.views.length))
      errors.push(`Layer "${layer.id}" has invalid views`)
    if (layer.baseMaps && (layer.baseMaps.length === 0 || new Set(layer.baseMaps).size !== layer.baseMaps.length))
      errors.push(`Layer "${layer.id}" has invalid baseMaps`)
    if (layer.minZoom !== undefined && (!Number.isFinite(layer.minZoom) || layer.minZoom < 0))
      errors.push(`Layer "${layer.id}" has an invalid minZoom`)
    if (layer.maxZoom !== undefined && (!Number.isFinite(layer.maxZoom) || layer.maxZoom < (layer.minZoom ?? 0)))
      errors.push(`Layer "${layer.id}" has an invalid maxZoom`)
    if (!renderer)
      continue
    for (const key of Object.keys(layer.layout)) {
      if (!renderer.layoutProperties.includes(key))
        errors.push(`Layer "${layer.id}" renderer "${renderer.id}" does not support layout property "${key}"`)
    }
    for (const key of Object.keys(layer.paint)) {
      if (!renderer.paintProperties.includes(key))
        errors.push(`Layer "${layer.id}" renderer "${renderer.id}" does not support paint property "${key}"`)
    }
    for (const [key, value] of Object.entries(layer.layout))
      validateStyleValue(value, `Layer "${layer.id}" layout.${key}`, style, source, errors)
    for (const [key, value] of Object.entries(layer.paint))
      validateStyleValue(value, `Layer "${layer.id}" paint.${key}`, style, source, errors)
    if (layer.filter)
      validateStyleValue(layer.filter, `Layer "${layer.id}" filter`, style, source, errors)
  }
  return errors
}

/** Register a complete custom style after its source and renderer references are checked. */
export function registerMapStyleDocument(style: MapStyleDocument): void {
  if (style.id === 'light' || style.id === 'standard' || style.id === 'dark')
    throw new Error(`Built-in map style "${style.id}" cannot be replaced`)
  const errors = validateMapStyleDocument(style)
  if (errors.length > 0)
    throw new Error(`Invalid map style "${style.id}": ${errors.join('; ')}`)
  MAP_STYLE_PRESETS[style.id] = structuredClone(style)
  notifyMapDataSourceChanges('*')
}
