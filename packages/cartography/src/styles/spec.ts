export type StylePrimitive = string | number | boolean | null
export type StyleTokenValue = StylePrimitive | readonly StylePrimitive[]

export type StyleExpression = readonly [operator: string, ...operands: StyleValue[]]
export type StyleValue = StylePrimitive | readonly StyleValue[] | StyleExpression

export type MapLayerType = 'raster' | 'fill' | 'line' | 'circle' | 'symbol'
export type MapLayerSlot = 'base' | 'thematic' | 'overlay'
export type MapViewportMode = 'globe' | 'atlas'

export type ExpressionDependencyLevel = 'constant' | 'feature' | 'zoom' | 'zoom-feature'

export interface LegendGradientStop {
  readonly value: number
  readonly color: string
  readonly label?: string
}

export interface LegendCategoryItem {
  readonly value: string | number
  readonly label: string
  readonly color: string
}

export interface ContinuousLegendDescriptor {
  readonly kind: 'continuous'
  readonly layerId: string
  readonly thematicId?: string
  readonly title: string
  readonly fieldName: string
  readonly unit?: string
  readonly stops: readonly LegendGradientStop[]
  readonly noDataLabel?: string
  readonly noDataColor?: string
}

export interface CategoricalLegendDescriptor {
  readonly kind: 'categorical'
  readonly layerId: string
  readonly thematicId?: string
  readonly title: string
  readonly fieldName?: string
  readonly items: readonly LegendCategoryItem[]
  readonly noDataLabel?: string
  readonly noDataColor?: string
}

export type LegendDescriptor = ContinuousLegendDescriptor | CategoricalLegendDescriptor

export interface MapStyleLayerLegendHint {
  readonly title: string
  readonly unit?: string
  readonly fieldName?: string
  readonly labels?: readonly string[]
  readonly noDataLabel?: string
  readonly noDataColor?: string
}

export interface MapFontFaceDescriptor {
  /** Font family name referenced by `text-font` in symbol layers (e.g. `"LXGW WenKai"`). */
  readonly family: string
  /** Font file URL (`https://...`, `/fonts/...`, `data:...`) or CSS `url(...)` source string (`.woff2`, `.woff`, `.ttf`, `.otf`). */
  readonly source: string
  readonly weight?: string | number
  readonly style?: 'normal' | 'italic' | 'oblique'
  readonly display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional'
  readonly unicodeRange?: string
}

export interface MapStyleLayer {
  readonly id: string
  readonly type: MapLayerType
  readonly source: string
  readonly slot: MapLayerSlot
  readonly thematicId?: string
  readonly overlayId?: string
  readonly views?: readonly MapViewportMode[]
  readonly minzoom?: number
  readonly maxzoom?: number
  readonly interactive?: boolean
  readonly filter?: StyleExpression
  readonly layout?: Readonly<Record<string, StyleValue>>
  readonly paint?: Readonly<Record<string, StyleValue>>
  readonly legend?: MapStyleLayerLegendHint
}

export interface MapStyleGlobeEffectDefaults {
  readonly atmosphere: boolean
  readonly dayNight: boolean
}

export interface MapStyleDocument {
  readonly version: 1
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly fonts?: readonly MapFontFaceDescriptor[]
  readonly tokens: Readonly<Record<string, StyleTokenValue>>
  readonly layers: readonly MapStyleLayer[]
  /** Layer ids checked when this style is selected. `world-surface` is the styled planet surface. */
  readonly defaultEnabledLayerIds?: readonly string[]
  /** 3D atmosphere and day/night applied when this style is selected. Rotation stays user-controlled. */
  readonly defaultGlobeEffects?: MapStyleGlobeEffectDefaults
}

const FALLBACK_STYLE_BACKGROUND = '#0a2342'

/** Opaque underlay color for a style. Thematic holes and the far side of the globe resolve to this. */
export function readStyleBackgroundColor(tokens: Readonly<Record<string, StyleTokenValue>> | undefined): string {
  const value = tokens?.background
  if (typeof value !== 'string')
    return FALLBACK_STYLE_BACKGROUND
  const trimmed = value.trim()
  return /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(trimmed) ? trimmed : FALLBACK_STYLE_BACKGROUND
}

export class StyleValidationError extends Error {
  readonly path: string

  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'StyleValidationError'
    this.path = path
  }
}
