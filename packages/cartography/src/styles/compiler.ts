import type { GeoJsonGeometryKind, MapSourceSchema } from '#sources/types'
import type {
  CategoricalLegendDescriptor,
  ContinuousLegendDescriptor,
  ExpressionDependencyLevel,
  LegendCategoryItem,
  LegendDescriptor,
  LegendGradientStop,
  MapFontFaceDescriptor,
  MapLayerType,
  MapStyleDocument,
  MapStyleLayer,
  MapViewportMode,
  StyleTokenValue,
  StyleValue,
} from './spec'
import { BUILTIN_MAP_SOURCE_SCHEMAS } from '#sources/types'
import { StyleValidationError } from './spec'

export type LinearRgbTuple = readonly [r: number, g: number, b: number]

export interface StyleEvaluationInput {
  readonly zoom?: number
  readonly properties?: Readonly<Record<string, unknown>>
  /** Optional hook returning true when a property is marked noData/unavailable for the current cell/feature. */
  readonly isNoData?: (propertyName: string) => boolean
}

export interface CompiledStyleExpression<T = unknown> {
  readonly raw: StyleValue
  readonly dependency: ExpressionDependencyLevel
  readonly constantValue?: T
  readonly referencedProperties: readonly string[]
  evaluate: (input?: StyleEvaluationInput) => T
}

export interface CompiledMapStyleLayer {
  readonly raw: MapStyleLayer
  readonly id: string
  readonly type: MapLayerType
  readonly source: string
  readonly slot: MapStyleLayer['slot']
  readonly thematicId?: string
  readonly overlayId?: string
  readonly views: readonly MapViewportMode[]
  readonly minzoom: number
  readonly maxzoom: number
  readonly interactive: boolean
  readonly filter?: CompiledStyleExpression<boolean>
  readonly layout: Readonly<Record<string, CompiledStyleExpression>>
  readonly paint: Readonly<Record<string, CompiledStyleExpression>>
  readonly legend: LegendDescriptor | null
}

export interface CompiledMapStyle {
  readonly raw: MapStyleDocument
  readonly id: string
  readonly name: string
  readonly fonts: readonly MapFontFaceDescriptor[]
  readonly layers: readonly CompiledMapStyleLayer[]
  readonly layersById: ReadonlyMap<string, CompiledMapStyleLayer>
  getActiveLayers: (options: {
    readonly viewMode: MapViewportMode
    readonly zoom: number
    readonly activeThematicId: string | null
    readonly enabledOverlayIds: readonly string[]
  }) => readonly CompiledMapStyleLayer[]
  getActiveLegend: (activeThematicId: string | null) => LegendDescriptor | null
}

const VALID_LAYER_TYPES = new Set<MapLayerType>(['raster', 'fill', 'line', 'circle', 'symbol'])
const VALID_SLOTS = new Set(['base', 'thematic', 'overlay'])
const VALID_VIEWS = new Set<MapViewportMode>(['globe', 'atlas'])

const SUPPORTED_OPERATORS = new Set([
  'literal',
  'get',
  'has',
  'token',
  'zoom',
  'coalesce',
  '==',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  '!',
  'all',
  'any',
  'case',
  'match',
  'palette',
  'step',
  'interpolate',
])

const LAYER_EXPECTED_SOURCE_KIND: Readonly<Record<MapLayerType, {
  readonly kind: 'raster' | 'geojson'
  readonly geometryKind?: GeoJsonGeometryKind
}>> = {
  raster: { kind: 'raster' },
  fill: { kind: 'geojson', geometryKind: 'polygon' },
  line: { kind: 'geojson', geometryKind: 'line' },
  circle: { kind: 'geojson', geometryKind: 'point' },
  symbol: { kind: 'geojson', geometryKind: 'point' },
}

export function srgbToLinearChannel(srgbByte: number): number {
  const c = Math.max(0, Math.min(255, srgbByte)) / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function linearToSrgbByte(linear: number): number {
  const c = Math.max(0, Math.min(1, linear))
  const srgb = c <= 0.0031308 ? c * 12.92 : 1.055 * (c ** (1 / 2.4)) - 0.055
  return Math.max(0, Math.min(255, Math.round(srgb * 255)))
}

export function parseHexColorToLinearRgb(hex: string): LinearRgbTuple | null {
  if (typeof hex !== 'string')
    return null
  const trimmed = hex.trim()
  if (/^#[\da-f]{6}$/i.test(trimmed)) {
    const val = Number.parseInt(trimmed.slice(1), 16)
    return [
      srgbToLinearChannel((val >> 16) & 0xFF),
      srgbToLinearChannel((val >> 8) & 0xFF),
      srgbToLinearChannel(val & 0xFF),
    ]
  }
  if (/^#[\da-f]{3}$/i.test(trimmed)) {
    const r = Number.parseInt(trimmed[1] + trimmed[1], 16)
    const g = Number.parseInt(trimmed[2] + trimmed[2], 16)
    const b = Number.parseInt(trimmed[3] + trimmed[3], 16)
    return [
      srgbToLinearChannel(r),
      srgbToLinearChannel(g),
      srgbToLinearChannel(b),
    ]
  }
  return null
}

export function linearRgbToHex(rgb: LinearRgbTuple): string {
  const r = linearToSrgbByte(rgb[0]).toString(16).padStart(2, '0')
  const g = linearToSrgbByte(rgb[1]).toString(16).padStart(2, '0')
  const b = linearToSrgbByte(rgb[2]).toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}

function interpolateValues(from: unknown, to: unknown, t: number): unknown {
  const clamped = Math.max(0, Math.min(1, t))
  if (typeof from === 'number' && typeof to === 'number')
    return from + (to - from) * clamped
  if (typeof from === 'string' && typeof to === 'string') {
    const rgbA = parseHexColorToLinearRgb(from)
    const rgbB = parseHexColorToLinearRgb(to)
    if (rgbA && rgbB) {
      return linearRgbToHex([
        rgbA[0] + (rgbB[0] - rgbA[0]) * clamped,
        rgbA[1] + (rgbB[1] - rgbA[1]) * clamped,
        rgbA[2] + (rgbB[2] - rgbA[2]) * clamped,
      ])
    }
  }
  return clamped < 0.5 ? from : to
}

function mergeDependencies(deps: readonly ExpressionDependencyLevel[]): ExpressionDependencyLevel {
  let hasZoom = false
  let hasFeature = false
  for (const d of deps) {
    if (d === 'zoom' || d === 'zoom-feature')
      hasZoom = true
    if (d === 'feature' || d === 'zoom-feature')
      hasFeature = true
  }
  if (hasZoom && hasFeature)
    return 'zoom-feature'
  if (hasFeature)
    return 'feature'
  if (hasZoom)
    return 'zoom'
  return 'constant'
}

function assertNoFunctions(value: unknown, path: string): void {
  if (typeof value === 'function')
    throw new StyleValidationError(path, 'Style JSON must not contain JavaScript functions')
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++)
      assertNoFunctions(value[i], `${path}[${i}]`)
  }
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value))
      assertNoFunctions(v, `${path}.${k}`)
  }
}

export function compileStyleExpression<T = unknown>(
  raw: StyleValue,
  tokens: Readonly<Record<string, StyleTokenValue>>,
  path: string,
): CompiledStyleExpression<T> {
  assertNoFunctions(raw, path)
  const referencedProps = new Set<string>()

  const compileNode = (node: StyleValue, nodePath: string): {
    dependency: ExpressionDependencyLevel
    fn: (input: StyleEvaluationInput) => unknown
  } => {
    if (node === null || typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
      return {
        dependency: 'constant',
        fn: () => node,
      }
    }

    if (!Array.isArray(node))
      throw new StyleValidationError(nodePath, `Unsupported style value type "${typeof node}"`)

    if (node.length === 0)
      throw new StyleValidationError(nodePath, 'Empty style expression array is not allowed')

    const first = node[0]
    // Numeric array literal (e.g. dasharray `[3, 2]` or offset `[0, 0.5]`)
    if (typeof first === 'number') {
      if (!node.every(item => typeof item === 'number' && Number.isFinite(item)))
        throw new StyleValidationError(nodePath, 'Numeric array literal must contain only finite numbers')
      const frozen = Object.freeze([...node])
      return {
        dependency: 'constant',
        fn: () => frozen,
      }
    }

    if (typeof first !== 'string')
      throw new StyleValidationError(nodePath, 'Expression operator must be a string')

    const operator = first
    const args = node.slice(1)
    if (!SUPPORTED_OPERATORS.has(operator))
      throw new StyleValidationError(nodePath, `Unsupported expression operator "${operator}"`)

    switch (operator) {
      case 'literal': {
        if (args.length !== 1)
          throw new StyleValidationError(nodePath, '"literal" requires exactly 1 argument')
        const val = args[0]
        return {
          dependency: 'constant',
          fn: () => val,
        }
      }

      case 'token': {
        if (args.length !== 1 || typeof args[0] !== 'string')
          throw new StyleValidationError(nodePath, '"token" requires a string token name')
        const tokenName = args[0]
        if (!(tokenName in tokens))
          throw new StyleValidationError(nodePath, `Unknown style token "${tokenName}"`)
        const resolvedToken = tokens[tokenName]
        return {
          dependency: 'constant',
          fn: () => resolvedToken,
        }
      }

      case 'zoom': {
        if (args.length !== 0)
          throw new StyleValidationError(nodePath, '"zoom" takes no arguments')
        return {
          dependency: 'zoom',
          fn: input => input.zoom ?? 0,
        }
      }

      case 'get': {
        if (args.length !== 1 || typeof args[0] !== 'string' || !args[0])
          throw new StyleValidationError(nodePath, '"get" requires a non-empty property name string')
        const propName = args[0]
        referencedProps.add(propName)
        return {
          dependency: 'feature',
          fn: (input) => {
            if (input.isNoData?.(propName))
              return null
            return input.properties?.[propName] ?? null
          },
        }
      }

      case 'has': {
        if (args.length !== 1 || typeof args[0] !== 'string' || !args[0])
          throw new StyleValidationError(nodePath, '"has" requires a non-empty property name string')
        const propName = args[0]
        referencedProps.add(propName)
        return {
          dependency: 'feature',
          fn: (input) => {
            if (input.isNoData?.(propName))
              return false
            const v = input.properties?.[propName]
            return v !== undefined && v !== null
          },
        }
      }

      case 'coalesce': {
        if (args.length < 1)
          throw new StyleValidationError(nodePath, '"coalesce" requires at least 1 operand')
        const compiledArgs = args.map((arg, idx) => compileNode(arg, `${nodePath}[${idx + 1}]`))
        return {
          dependency: mergeDependencies(compiledArgs.map(a => a.dependency)),
          fn: (input) => {
            for (const c of compiledArgs) {
              const v = c.fn(input)
              if (v !== null && v !== undefined)
                return v
            }
            return null
          },
        }
      }

      case '!': {
        if (args.length !== 1)
          throw new StyleValidationError(nodePath, '"!" requires exactly 1 operand')
        const sub = compileNode(args[0], `${nodePath}[1]`)
        return {
          dependency: sub.dependency,
          fn: input => !sub.fn(input),
        }
      }

      case 'all': {
        if (args.length < 1)
          throw new StyleValidationError(nodePath, '"all" requires at least 1 operand')
        const compiledArgs = args.map((arg, idx) => compileNode(arg, `${nodePath}[${idx + 1}]`))
        return {
          dependency: mergeDependencies(compiledArgs.map(a => a.dependency)),
          fn: input => compiledArgs.every(c => Boolean(c.fn(input))),
        }
      }

      case 'any': {
        if (args.length < 1)
          throw new StyleValidationError(nodePath, '"any" requires at least 1 operand')
        const compiledArgs = args.map((arg, idx) => compileNode(arg, `${nodePath}[${idx + 1}]`))
        return {
          dependency: mergeDependencies(compiledArgs.map(a => a.dependency)),
          fn: input => compiledArgs.some(c => Boolean(c.fn(input))),
        }
      }

      case '==':
      case '!=':
      case '>':
      case '>=':
      case '<':
      case '<=': {
        if (args.length !== 2)
          throw new StyleValidationError(nodePath, `"${operator}" requires exactly 2 operands`)
        const left = compileNode(args[0], `${nodePath}[1]`)
        const right = compileNode(args[1], `${nodePath}[2]`)
        const dep = mergeDependencies([left.dependency, right.dependency])
        switch (operator) {
          case '==':
            return { dependency: dep, fn: input => left.fn(input) === right.fn(input) }
          case '!=':
            return { dependency: dep, fn: input => left.fn(input) !== right.fn(input) }
          case '>':
            return { dependency: dep, fn: input => Number(left.fn(input)) > Number(right.fn(input)) }
          case '>=':
            return { dependency: dep, fn: input => Number(left.fn(input)) >= Number(right.fn(input)) }
          case '<':
            return { dependency: dep, fn: input => Number(left.fn(input)) < Number(right.fn(input)) }
          case '<=':
            return { dependency: dep, fn: input => Number(left.fn(input)) <= Number(right.fn(input)) }
        }
        break
      }

      case 'case': {
        if (args.length < 3 || args.length % 2 === 0)
          throw new StyleValidationError(nodePath, '"case" requires (condition, output)+ and a fallback value')
        const compiledArgs = args.map((arg, idx) => compileNode(arg, `${nodePath}[${idx + 1}]`))
        return {
          dependency: mergeDependencies(compiledArgs.map(a => a.dependency)),
          fn: (input) => {
            for (let i = 0; i + 1 < compiledArgs.length - 1; i += 2) {
              if (compiledArgs[i].fn(input))
                return compiledArgs[i + 1].fn(input)
            }
            return compiledArgs.at(-1)!.fn(input)
          },
        }
      }

      case 'match': {
        if (args.length < 4 || args.length % 2 !== 0)
          throw new StyleValidationError(nodePath, '"match" requires input, (label, output)+, and fallback')
        const inputExpr = compileNode(args[0], `${nodePath}[1]`)
        const branches: {
          labels: readonly (string | number | boolean)[]
          output: ReturnType<typeof compileNode>
        }[] = []
        for (let i = 1; i + 1 < args.length - 1; i += 2) {
          const rawLabel = args[i]
          const labelPath = `${nodePath}[${i + 1}]`
          let labels: (string | number | boolean)[]
          if (Array.isArray(rawLabel)) {
            if (rawLabel.length === 0 || !rawLabel.every(item => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'))
              throw new StyleValidationError(labelPath, '"match" label array must contain non-empty primitive values')
            labels = rawLabel as (string | number | boolean)[]
          }
          else if (typeof rawLabel === 'string' || typeof rawLabel === 'number' || typeof rawLabel === 'boolean') {
            labels = [rawLabel]
          }
          else {
            throw new StyleValidationError(labelPath, '"match" label must be a primitive or array of primitives')
          }
          branches.push({
            labels,
            output: compileNode(args[i + 1], `${nodePath}[${i + 2}]`),
          })
        }
        const fallback = compileNode(args.at(-1)!, `${nodePath}[${args.length}]`)
        const dep = mergeDependencies([
          inputExpr.dependency,
          ...branches.map(b => b.output.dependency),
          fallback.dependency,
        ])
        return {
          dependency: dep,
          fn: (input) => {
            const val = inputExpr.fn(input)
            for (const branch of branches) {
              if (branch.labels.includes(val as string | number | boolean))
                return branch.output.fn(input)
            }
            return fallback.fn(input)
          },
        }
      }

      case 'palette': {
        // ['palette', indexExpr, colorsExprOrLiteral, optionalNoDataColorExpr]
        if (args.length < 2 || args.length > 3)
          throw new StyleValidationError(nodePath, '"palette" requires (indexExpr, paletteColors, noDataFallback?)')
        const indexExpr = compileNode(args[0], `${nodePath}[1]`)
        const rawColorsArg = args[1]
        let paletteNode: ReturnType<typeof compileNode>
        if (Array.isArray(rawColorsArg) && rawColorsArg.length > 0 && rawColorsArg.every(item => typeof item === 'string') && !SUPPORTED_OPERATORS.has(rawColorsArg[0] as string)) {
          const frozenColors = Object.freeze([...rawColorsArg])
          paletteNode = { dependency: 'constant', fn: () => frozenColors }
        }
        else {
          paletteNode = compileNode(rawColorsArg, `${nodePath}[2]`)
        }
        const noDataExpr = args[2] !== undefined
          ? compileNode(args[2], `${nodePath}[3]`)
          : { dependency: 'constant' as const, fn: () => '#4b5563' }

        const dep = mergeDependencies([indexExpr.dependency, paletteNode.dependency, noDataExpr.dependency])
        return {
          dependency: dep,
          fn: (input) => {
            const rawIdx = indexExpr.fn(input)
            if (rawIdx === null || rawIdx === undefined || typeof rawIdx !== 'number' || !Number.isFinite(rawIdx) || rawIdx < 0)
              return noDataExpr.fn(input)
            const colors = paletteNode.fn(input)
            if (!Array.isArray(colors) || colors.length === 0)
              return noDataExpr.fn(input)
            const idx = Math.floor(rawIdx) % colors.length
            return colors[idx]
          },
        }
      }

      case 'step': {
        // ['step', inputExpr, baseOutput, stop1, out1, stop2, out2, ...]
        if (args.length < 4 || args.length % 2 !== 0)
          throw new StyleValidationError(nodePath, '"step" requires (input, baseOutput, (stopNumber, output)+)')
        const inputExpr = compileNode(args[0], `${nodePath}[1]`)
        const baseOutput = compileNode(args[1], `${nodePath}[2]`)
        const stops: { threshold: number, output: ReturnType<typeof compileNode> }[] = []
        let prevStop = -Infinity
        for (let i = 2; i + 1 < args.length; i += 2) {
          const stopVal = args[i]
          if (typeof stopVal !== 'number' || !Number.isFinite(stopVal))
            throw new StyleValidationError(`${nodePath}[${i + 1}]`, '"step" stop threshold must be a finite number')
          if (stopVal <= prevStop)
            throw new StyleValidationError(`${nodePath}[${i + 1}]`, '"step" stop thresholds must be strictly ascending')
          prevStop = stopVal
          stops.push({
            threshold: stopVal,
            output: compileNode(args[i + 1], `${nodePath}[${i + 2}]`),
          })
        }
        const dep = mergeDependencies([
          inputExpr.dependency,
          baseOutput.dependency,
          ...stops.map(s => s.output.dependency),
        ])
        return {
          dependency: dep,
          fn: (input) => {
            const val = Number(inputExpr.fn(input))
            if (!Number.isFinite(val))
              return baseOutput.fn(input)
            let result = baseOutput.fn(input)
            for (const stop of stops) {
              if (val < stop.threshold)
                break
              result = stop.output.fn(input)
            }
            return result
          },
        }
      }

      case 'interpolate': {
        // ['interpolate', ['linear'] | ['exponential', base], inputExpr, stop1, out1, stop2, out2, ...]
        if (args.length < 6 || args.length % 2 !== 0)
          throw new StyleValidationError(nodePath, '"interpolate" requires (curve, input, stop1, out1, stop2, out2, ...)')
        const curveSpec = args[0]
        if (!Array.isArray(curveSpec) || (curveSpec[0] !== 'linear' && curveSpec[0] !== 'exponential'))
          throw new StyleValidationError(`${nodePath}[1]`, '"interpolate" curve must be ["linear"] or ["exponential", base]')
        let expBase = 1
        if (curveSpec[0] === 'exponential') {
          if (curveSpec.length !== 2 || typeof curveSpec[1] !== 'number' || !Number.isFinite(curveSpec[1]) || curveSpec[1] <= 0)
            throw new StyleValidationError(`${nodePath}[1]`, '"exponential" interpolation base must be a positive finite number')
          expBase = curveSpec[1]
        }

        const inputExpr = compileNode(args[1], `${nodePath}[2]`)
        const stops: { stop: number, output: ReturnType<typeof compileNode> }[] = []
        let prevStop = -Infinity
        for (let i = 2; i + 1 < args.length; i += 2) {
          const stopVal = args[i]
          if (typeof stopVal !== 'number' || !Number.isFinite(stopVal))
            throw new StyleValidationError(`${nodePath}[${i + 1}]`, '"interpolate" stop must be a finite number')
          if (stopVal <= prevStop)
            throw new StyleValidationError(`${nodePath}[${i + 1}]`, '"interpolate" stops must be strictly ascending')
          prevStop = stopVal
          stops.push({
            stop: stopVal,
            output: compileNode(args[i + 1], `${nodePath}[${i + 2}]`),
          })
        }

        const dep = mergeDependencies([
          inputExpr.dependency,
          ...stops.map(s => s.output.dependency),
        ])
        return {
          dependency: dep,
          fn: (input) => {
            const val = Number(inputExpr.fn(input))
            if (!Number.isFinite(val) || val <= stops[0].stop)
              return stops[0].output.fn(input)
            for (let i = 1; i < stops.length; i++) {
              const lower = stops[i - 1]
              const upper = stops[i]
              if (val <= upper.stop) {
                const span = upper.stop - lower.stop
                const progress = span > 0 ? (val - lower.stop) / span : 0
                const t = expBase === 1 || Math.abs(expBase - 1) < 1e-6
                  ? progress
                  : (expBase ** progress - 1) / (expBase - 1)
                return interpolateValues(lower.output.fn(input), upper.output.fn(input), t)
              }
            }
            return stops.at(-1)!.output.fn(input)
          },
        }
      }
    }

    throw new StyleValidationError(nodePath, `Unhandled expression operator "${operator}"`)
  }

  const root = compileNode(raw, path)
  const constantValue = root.dependency === 'constant'
    ? (root.fn({}) as T)
    : undefined

  return Object.freeze({
    raw,
    dependency: root.dependency,
    ...(root.dependency === 'constant' ? { constantValue } : {}),
    referencedProperties: Object.freeze([...referencedProps]),
    evaluate(input: StyleEvaluationInput = {}): T {
      if (root.dependency === 'constant')
        return constantValue as T
      return root.fn(input) as T
    },
  })
}

function resolveColorString(
  value: StyleValue,
  tokens: Readonly<Record<string, StyleTokenValue>>,
): string | null {
  if (typeof value === 'string')
    return value
  if (Array.isArray(value) && value[0] === 'token' && typeof value[1] === 'string') {
    const t = tokens[value[1]]
    return typeof t === 'string' ? t : null
  }
  return null
}

function extractLegendFromExpression(
  layer: MapStyleLayer,
  colorExpr: StyleValue | undefined,
  tokens: Readonly<Record<string, StyleTokenValue>>,
): LegendDescriptor | null {
  const hint = layer.legend
  const title = hint?.title ?? layer.thematicId ?? layer.id
  const unit = hint?.unit

  const walk = (expr: StyleValue | undefined): LegendDescriptor | null => {
    if (!expr || !Array.isArray(expr))
      return null
    const op = expr[0]

    if (op === 'interpolate') {
      const inputNode = expr[2]
      const fieldName = hint?.fieldName
        ?? (Array.isArray(inputNode) && inputNode[0] === 'get' && typeof inputNode[1] === 'string' ? inputNode[1] : 'value')
      const stops: LegendGradientStop[] = []
      for (let i = 3; i + 1 < expr.length; i += 2) {
        const stopVal = expr[i]
        const colorVal = resolveColorString(expr[i + 1], tokens)
        if (typeof stopVal === 'number' && colorVal) {
          stops.push({ value: stopVal, color: colorVal })
        }
      }
      if (stops.length >= 2) {
        const desc: ContinuousLegendDescriptor = {
          kind: 'continuous',
          layerId: layer.id,
          ...(layer.thematicId ? { thematicId: layer.thematicId } : {}),
          title,
          fieldName,
          ...(unit ? { unit } : {}),
          stops: Object.freeze(stops),
          ...(hint?.noDataLabel ? { noDataLabel: hint.noDataLabel } : {}),
          ...(hint?.noDataColor ? { noDataColor: hint.noDataColor } : {}),
        }
        return Object.freeze(desc)
      }
    }

    if (op === 'step') {
      const inputNode = expr[1]
      const fieldName = hint?.fieldName
        ?? (Array.isArray(inputNode) && inputNode[0] === 'get' && typeof inputNode[1] === 'string' ? inputNode[1] : 'value')
      const stops: LegendGradientStop[] = []
      const baseColor = resolveColorString(expr[2], tokens)
      if (baseColor)
        stops.push({ value: 0, color: baseColor })
      for (let i = 3; i + 1 < expr.length; i += 2) {
        const stopVal = expr[i]
        const colorVal = resolveColorString(expr[i + 1], tokens)
        if (typeof stopVal === 'number' && colorVal)
          stops.push({ value: stopVal, color: colorVal })
      }
      if (stops.length >= 2) {
        const desc: ContinuousLegendDescriptor = {
          kind: 'continuous',
          layerId: layer.id,
          ...(layer.thematicId ? { thematicId: layer.thematicId } : {}),
          title,
          fieldName,
          ...(unit ? { unit } : {}),
          stops: Object.freeze(stops),
          ...(hint?.noDataLabel ? { noDataLabel: hint.noDataLabel } : {}),
          ...(hint?.noDataColor ? { noDataColor: hint.noDataColor } : {}),
        }
        return Object.freeze(desc)
      }
    }

    if (op === 'palette') {
      const inputNode = expr[1]
      const fieldName = hint?.fieldName
        ?? (Array.isArray(inputNode) && inputNode[0] === 'get' && typeof inputNode[1] === 'string' ? inputNode[1] : undefined)
      const rawPalette = expr[2]
      let colors: readonly string[] = []
      if (Array.isArray(rawPalette)) {
        if (rawPalette[0] === 'token' && typeof rawPalette[1] === 'string') {
          const tok = tokens[rawPalette[1]]
          if (Array.isArray(tok))
            colors = tok.filter((c): c is string => typeof c === 'string')
        }
        else if (rawPalette[0] === 'literal' && Array.isArray(rawPalette[1])) {
          colors = rawPalette[1].filter((c): c is string => typeof c === 'string')
        }
        else {
          colors = rawPalette.filter((c): c is string => typeof c === 'string')
        }
      }
      const noDataColor = expr[3] !== undefined ? resolveColorString(expr[3], tokens) ?? hint?.noDataColor : hint?.noDataColor
      const labels = hint?.labels
      const itemCount = labels ? Math.min(labels.length, colors.length) : Math.min(colors.length, 16)
      const items: LegendCategoryItem[] = []
      for (let i = 0; i < itemCount; i++) {
        items.push({
          value: i,
          label: labels?.[i] ?? `${title} ${i + 1}`,
          color: colors[i],
        })
      }
      if (items.length > 0) {
        const desc: CategoricalLegendDescriptor = {
          kind: 'categorical',
          layerId: layer.id,
          ...(layer.thematicId ? { thematicId: layer.thematicId } : {}),
          title,
          ...(fieldName ? { fieldName } : {}),
          items: Object.freeze(items),
          ...(hint?.noDataLabel ? { noDataLabel: hint.noDataLabel } : {}),
          ...(noDataColor ? { noDataColor } : {}),
        }
        return Object.freeze(desc)
      }
    }

    if (op === 'match') {
      const inputNode = expr[1]
      const fieldName = hint?.fieldName
        ?? (Array.isArray(inputNode) && inputNode[0] === 'get' && typeof inputNode[1] === 'string' ? inputNode[1] : undefined)
      const items: LegendCategoryItem[] = []
      for (let i = 2; i + 1 < expr.length - 1; i += 2) {
        const rawLabel = expr[i]
        const colorVal = resolveColorString(expr[i + 1], tokens)
        if (!colorVal)
          continue
        const val = Array.isArray(rawLabel) ? String(rawLabel[0]) : (rawLabel as string | number)
        const idx = items.length
        items.push({
          value: val,
          label: hint?.labels?.[idx] ?? String(val),
          color: colorVal,
        })
      }
      if (items.length > 0) {
        const desc: CategoricalLegendDescriptor = {
          kind: 'categorical',
          layerId: layer.id,
          ...(layer.thematicId ? { thematicId: layer.thematicId } : {}),
          title,
          ...(fieldName ? { fieldName } : {}),
          items: Object.freeze(items),
          ...(hint?.noDataLabel ? { noDataLabel: hint.noDataLabel } : {}),
          ...(hint?.noDataColor ? { noDataColor: hint.noDataColor } : {}),
        }
        return Object.freeze(desc)
      }
    }

    if (op === 'case') {
      // Check branches from last to first to find primary continuous/categorical ramp (e.g., land vs ocean mask)
      for (let i = expr.length - 1; i >= 2; i--) {
        const sub = walk(expr[i])
        if (sub)
          return sub
      }
    }

    return null
  }

  const found = walk(colorExpr)
  if (found)
    return found

  if (hint && typeof colorExpr === 'string') {
    const desc: CategoricalLegendDescriptor = {
      kind: 'categorical',
      layerId: layer.id,
      ...(layer.thematicId ? { thematicId: layer.thematicId } : {}),
      title,
      items: Object.freeze([{ value: layer.id, label: title, color: colorExpr }]),
    }
    return Object.freeze(desc)
  }

  return null
}

export class StyleCompiler {
  readonly #customSchemas = new Map<string, MapSourceSchema>()

  constructor(customSchemas?: readonly MapSourceSchema[]) {
    if (customSchemas) {
      for (const s of customSchemas)
        this.#customSchemas.set(s.id, s)
    }
  }

  registerSourceSchema(schema: MapSourceSchema): void {
    this.#customSchemas.set(schema.id, schema)
  }

  getSourceSchema(sourceId: string): MapSourceSchema | undefined {
    return this.#customSchemas.get(sourceId)
      ?? (BUILTIN_MAP_SOURCE_SCHEMAS as Readonly<Record<string, MapSourceSchema>>)[sourceId]
  }

  compile(style: MapStyleDocument): CompiledMapStyle {
    if (!style || typeof style !== 'object')
      throw new StyleValidationError('style', 'Style document must be a non-null JSON object')
    assertNoFunctions(style, 'style')
    if (style.version !== 1)
      throw new StyleValidationError('style.version', `Expected style version 1, got "${String((style as { version?: unknown }).version)}"`)
    if (typeof style.id !== 'string' || !style.id.trim())
      throw new StyleValidationError('style.id', 'Style id must be a non-empty string')
    if (typeof style.name !== 'string' || !style.name.trim())
      throw new StyleValidationError('style.name', 'Style name must be a non-empty string')
    if (!style.tokens || typeof style.tokens !== 'object' || Array.isArray(style.tokens))
      throw new StyleValidationError('style.tokens', 'Style tokens must be an object map')
    if (!Array.isArray(style.layers) || style.layers.length === 0)
      throw new StyleValidationError('style.layers', 'Style layers must be a non-empty array')

    const compiledFonts: MapFontFaceDescriptor[] = []
    if (style.fonts !== undefined) {
      if (!Array.isArray(style.fonts))
        throw new StyleValidationError('style.fonts', 'Style fonts must be an array of MapFontFaceDescriptor')
      for (let i = 0; i < style.fonts.length; i++) {
        const f = style.fonts[i]
        const fontPath = `style.fonts[${i}]`
        if (!f || typeof f !== 'object')
          throw new StyleValidationError(fontPath, 'Font descriptor must be an object')
        if (typeof f.family !== 'string' || !f.family.trim())
          throw new StyleValidationError(`${fontPath}.family`, 'Font family must be a non-empty string')
        if (typeof f.source !== 'string' || !f.source.trim())
          throw new StyleValidationError(`${fontPath}.source`, 'Font source must be a non-empty URL or CSS url(...) string')
        compiledFonts.push(Object.freeze({ ...f }))
      }
    }

    const seenLayerIds = new Set<string>()
    const compiledLayers: CompiledMapStyleLayer[] = []

    for (let i = 0; i < style.layers.length; i++) {
      const layer = style.layers[i]
      const layerPath = `style.layers[${i}]`
      if (!layer || typeof layer !== 'object')
        throw new StyleValidationError(layerPath, 'Layer must be an object')
      if (typeof layer.id !== 'string' || !layer.id.trim())
        throw new StyleValidationError(`${layerPath}.id`, 'Layer id must be a non-empty string')
      if (seenLayerIds.has(layer.id))
        throw new StyleValidationError(`${layerPath}.id`, `Duplicate layer id "${layer.id}"`)
      seenLayerIds.add(layer.id)

      if (!VALID_LAYER_TYPES.has(layer.type))
        throw new StyleValidationError(`${layerPath}.type`, `Unsupported layer type "${String(layer.type)}" (expected raster | fill | line | circle | symbol)`)

      if (!VALID_SLOTS.has(layer.slot))
        throw new StyleValidationError(`${layerPath}.slot`, `Unsupported layer slot "${String(layer.slot)}" (expected base | thematic | overlay)`)

      if (layer.slot === 'thematic' && (typeof layer.thematicId !== 'string' || !layer.thematicId.trim()))
        throw new StyleValidationError(`${layerPath}.thematicId`, 'Thematic layer requires a non-empty thematicId')

      if (layer.slot === 'overlay' && (typeof layer.overlayId !== 'string' || !layer.overlayId.trim()))
        throw new StyleValidationError(`${layerPath}.overlayId`, 'Overlay layer requires a non-empty overlayId')

      const sourceSchema = this.getSourceSchema(layer.source)
      if (!sourceSchema)
        throw new StyleValidationError(`${layerPath}.source`, `Unknown map data source "${String(layer.source)}"`)

      const expected = LAYER_EXPECTED_SOURCE_KIND[layer.type]
      if (sourceSchema.kind !== expected.kind) {
        throw new StyleValidationError(
          `${layerPath}.source`,
          `Layer "${layer.id}" of type "${layer.type}" requires a "${expected.kind}" source, but "${layer.source}" is "${sourceSchema.kind}"`,
        )
      }
      if (expected.geometryKind && sourceSchema.geometryKind !== expected.geometryKind) {
        throw new StyleValidationError(
          `${layerPath}.source`,
          `Layer "${layer.id}" of type "${layer.type}" requires "${expected.geometryKind}" GeoJSON geometry, but "${layer.source}" provides "${String(sourceSchema.geometryKind)}"`,
        )
      }

      let views: readonly MapViewportMode[] = ['globe', 'atlas']
      if (layer.views !== undefined) {
        if (!Array.isArray(layer.views) || layer.views.length === 0 || !layer.views.every(v => VALID_VIEWS.has(v)))
          throw new StyleValidationError(`${layerPath}.views`, 'Layer views must be a non-empty array of "globe" | "atlas"')
        views = Object.freeze([...layer.views])
      }

      const minzoom = layer.minzoom ?? 0
      const maxzoom = layer.maxzoom ?? 12
      if (typeof minzoom !== 'number' || !Number.isFinite(minzoom) || minzoom < 0)
        throw new StyleValidationError(`${layerPath}.minzoom`, 'minzoom must be a non-negative finite number')
      if (typeof maxzoom !== 'number' || !Number.isFinite(maxzoom) || maxzoom < minzoom)
        throw new StyleValidationError(`${layerPath}.maxzoom`, 'maxzoom must be a finite number >= minzoom')

      const compiledFilter = layer.filter !== undefined
        ? compileStyleExpression<boolean>(layer.filter, style.tokens, `${layerPath}.filter`)
        : undefined

      const compiledLayout: Record<string, CompiledStyleExpression> = {}
      if (layer.layout) {
        for (const [k, v] of Object.entries(layer.layout))
          compiledLayout[k] = compileStyleExpression(v, style.tokens, `${layerPath}.layout.${k}`)
      }

      const compiledPaint: Record<string, CompiledStyleExpression> = {}
      if (layer.paint) {
        for (const [k, v] of Object.entries(layer.paint))
          compiledPaint[k] = compileStyleExpression(v, style.tokens, `${layerPath}.paint.${k}`)
      }

      const colorPropKey = layer.type === 'raster'
        ? 'raster-color'
        : layer.type === 'fill'
          ? 'fill-color'
          : layer.type === 'line'
            ? 'line-color'
            : layer.type === 'circle'
              ? 'circle-color'
              : 'text-color'
      const legend = extractLegendFromExpression(layer, layer.paint?.[colorPropKey], style.tokens)

      compiledLayers.push(Object.freeze({
        raw: layer,
        id: layer.id,
        type: layer.type,
        source: layer.source,
        slot: layer.slot,
        ...(layer.thematicId ? { thematicId: layer.thematicId } : {}),
        ...(layer.overlayId ? { overlayId: layer.overlayId } : {}),
        views,
        minzoom,
        maxzoom,
        interactive: Boolean(layer.interactive),
        ...(compiledFilter ? { filter: compiledFilter } : {}),
        layout: Object.freeze(compiledLayout),
        paint: Object.freeze(compiledPaint),
        legend,
      }))
    }

    const layersById = new Map(compiledLayers.map(l => [l.id, l]))

    return Object.freeze({
      raw: style,
      id: style.id,
      name: style.name,
      fonts: Object.freeze(compiledFonts),
      layers: Object.freeze(compiledLayers),
      layersById,
      getActiveLayers({ viewMode, zoom, activeThematicId, enabledOverlayIds }) {
        const overlaySet = new Set(enabledOverlayIds)
        const activeThematic = activeThematicId && activeThematicId !== 'none' ? activeThematicId : null
        return compiledLayers.filter((layer) => {
          if (!layer.views.includes(viewMode))
            return false
          if (zoom < layer.minzoom || zoom > layer.maxzoom)
            return false
          const vis = layer.layout.visibility?.evaluate({ zoom })
          if (vis === 'none')
            return false
          if (layer.slot === 'base')
            return true
          if (layer.slot === 'thematic')
            return activeThematic !== null && layer.thematicId === activeThematic
          if (layer.slot === 'overlay')
            return layer.overlayId !== undefined && overlaySet.has(layer.overlayId)
          return false
        })
      },
      getActiveLegend(activeThematicId: string | null): LegendDescriptor | null {
        const activeThematic = activeThematicId && activeThematicId !== 'none' ? activeThematicId : null
        if (activeThematic) {
          for (let i = compiledLayers.length - 1; i >= 0; i--) {
            const l = compiledLayers[i]
            if (l.slot === 'thematic' && l.thematicId === activeThematic && l.legend)
              return l.legend
          }
        }
        for (let i = compiledLayers.length - 1; i >= 0; i--) {
          const l = compiledLayers[i]
          if (l.slot === 'base' && l.legend)
            return l.legend
        }
        return null
      },
    })
  }
}
