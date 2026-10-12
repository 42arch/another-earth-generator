import { MAP_STYLE_PRESETS } from '@/core/rendering/styles/presets'

export type CartographicStyleId = 'light' | 'standard' | 'dark' | 'satellite' | string

export interface CartographicStyle {
  id: string
  name: string
  description: string
  swatch: string
  ocean: number
  landLow: number
  landHigh: number
  polityBorder: number
  river: number
  road: number
  seaRoute: number
  label: number
  labelHalo: number
  settlementLabel: number
  settlementHalo: number
}

function colorToken(tokens: Record<string, string | number>, key: string): number {
  const value = tokens[key]
  if (typeof value === 'number')
    return value
  return Number.parseInt(value.replace('#', ''), 16)
}

/** Compatibility palette derived from the declarative style documents. */
export const CARTOGRAPHIC_STYLES = Object.fromEntries(
  Object.entries(MAP_STYLE_PRESETS).map(([id, preset]) => [id, {
    id: id as CartographicStyleId,
    name: preset.name,
    description: preset.description,
    swatch: String(preset.tokens.swatch),
    ocean: colorToken(preset.tokens, 'ocean'),
    landLow: colorToken(preset.tokens, 'landLow'),
    landHigh: colorToken(preset.tokens, 'landHigh'),
    polityBorder: colorToken(preset.tokens, 'polityBorder'),
    river: colorToken(preset.tokens, 'river'),
    road: colorToken(preset.tokens, 'road'),
    seaRoute: colorToken(preset.tokens, 'seaRoute'),
    label: colorToken(preset.tokens, 'label'),
    labelHalo: colorToken(preset.tokens, 'labelHalo'),
    settlementLabel: colorToken(preset.tokens, 'settlementLabel'),
    settlementHalo: colorToken(preset.tokens, 'settlementHalo'),
  } satisfies CartographicStyle]),
) as Record<CartographicStyleId, CartographicStyle>

export function getCartographicStyle(id: string | undefined): CartographicStyle {
  const builtin = CARTOGRAPHIC_STYLES[id as CartographicStyleId]
  if (builtin)
    return builtin
  const preset = MAP_STYLE_PRESETS[id ?? '']
  if (!preset)
    return CARTOGRAPHIC_STYLES.standard
  const fallback = CARTOGRAPHIC_STYLES.standard
  const token = (key: keyof CartographicStyle): number => {
    const value = preset.tokens[key]
    return value === undefined ? fallback[key] as number : colorToken(preset.tokens, key)
  }
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    swatch: String(preset.tokens.swatch ?? fallback.swatch),
    ocean: token('ocean'),
    landLow: token('landLow'),
    landHigh: token('landHigh'),
    polityBorder: token('polityBorder'),
    river: token('river'),
    road: token('road'),
    seaRoute: token('seaRoute'),
    label: token('label'),
    labelHalo: token('labelHalo'),
    settlementLabel: token('settlementLabel'),
    settlementHalo: token('settlementHalo'),
  }
}
