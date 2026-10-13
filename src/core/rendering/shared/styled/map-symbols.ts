export const MAP_SYMBOL_CODEPOINTS = {
  'star': 61697,
  'settlement-ring-dot': 61698,
  'settlement-dot': 61699,
  'settlement-capital': 61700,
  'place-of-worship': 61701,
  'mountain': 61702,
  'monument': 61703,
  'lighthouse': 61704,
  'harbor': 61705,
  'diamond': 61706,
  'city': 61707,
  'circle': 61708,
  'castle': 61709,
  'campsite': 61710,
  'building': 61711,
} as const

export type MapSymbolId = keyof typeof MAP_SYMBOL_CODEPOINTS

/**
 * 根据地图符号名称获取矢量字体中的单字符 Unicode
 */
export function getMapSymbolGlyph(icon: string): string {
  const codepoint = MAP_SYMBOL_CODEPOINTS[icon as MapSymbolId]
  return codepoint ? String.fromCharCode(codepoint) : '●'
}
