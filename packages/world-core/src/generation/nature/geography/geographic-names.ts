import type { NamingStyleView } from '#content/content-port'
import type { GeographicRegionsArtifact } from './geographic-regions'
import { generateName } from '#generation/names/naming'

export const GEOGRAPHIC_NAMES_VERSION = 'geographic-names-v3' as const

interface NamedRegion { readonly id: string, readonly areaKm2: number, readonly name?: string }

const chineseDigits = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const
function chineseOrdinal(value: number): string {
  if (value < 10)
    return chineseDigits[value]
  if (value < 100)
    return `${value >= 20 ? chineseDigits[Math.floor(value / 10)] : ''}十${value % 10 ? chineseDigits[value % 10] : ''}`
  return [...String(value)].map(digit => chineseDigits[Number(digit)]).join('')
}

function nameRegions(regions: readonly NamedRegion[], style: NamingStyleView, rule: 'continent' | 'ocean', worldSeed: string, styleSignature: string): NamedRegion[] {
  const names = new Map<string, string>()
  const used = new Set<string>()
  for (const region of [...regions].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const base = generateName({ style, rule, worldSeed, entityId: region.id, styleSignature })
    let name = base
    for (let suffix = 2; used.has(name); suffix++) name = `${base}·${chineseOrdinal(suffix)}`
    used.add(name)
    names.set(region.id, name)
  }
  return regions.map(region => ({ ...region, name: names.get(region.id)! }))
}

/** Names are facts attached to stable geographic IDs; the classification arrays remain unchanged. */
export function nameGeographicRegions(regions: GeographicRegionsArtifact, worldSeed: string, style: NamingStyleView, styleSignature: string): GeographicRegionsArtifact {
  if (!worldSeed?.trim() || !styleSignature?.trim() || !style?.id?.trim())
    throw new Error('Geographic naming requires a seed, style and style signature')
  for (const rule of ['continent', 'ocean'] as const) {
    if (!style.rules || !Object.prototype.hasOwnProperty.call(style.rules, rule) || !Array.isArray(style.rules[rule]) || style.rules[rule].length === 0)
      throw new Error(`Geographic naming rule "${rule}" is missing or empty`)
  }
  return {
    ...regions,
    nameStyleId: style.id,
    nameStyleSignature: styleSignature,
    continents: nameRegions(regions.continents, style, 'continent', worldSeed, styleSignature),
    oceans: nameRegions(regions.oceans, style, 'ocean', worldSeed, styleSignature),
  }
}
