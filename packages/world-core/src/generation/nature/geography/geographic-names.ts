import type { NamePool } from '@another-earth/world-data'
import type { GeographicRegionsArtifact } from './geographic-regions'
import { stableHash } from '#math/random'

export const GEOGRAPHIC_NAMES_VERSION = 'geographic-names-v2' as const

type NamedRegion = { readonly id: string, readonly areaKm2: number, readonly name?: string }

const chineseDigits = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const
function chineseOrdinal(value: number): string {
  if (value < 10) return chineseDigits[value]
  if (value < 100) return `${value >= 20 ? chineseDigits[Math.floor(value / 10)] : ''}十${value % 10 ? chineseDigits[value % 10] : ''}`
  return [...String(value)].map(digit => chineseDigits[Number(digit)]).join('')
}

function nameRegions(regions: readonly NamedRegion[], pool: NamePool, worldSeed: string, contentSignature: string): NamedRegion[] {
  const entries = [...pool.entries].filter(entry => entry.weight > 0).sort((a, b) => a.value < b.value ? -1 : a.value > b.value ? 1 : a.weight - b.weight)
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0)
  if (!entries.length || !Number.isFinite(total) || total <= 0)
    throw new Error(`Empty geographic name pool ${pool.id}`)
  const names = new Map<string, string>()
  const used = new Set<string>()
  for (const region of [...regions].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const hash = stableHash(JSON.stringify([GEOGRAPHIC_NAMES_VERSION, worldSeed, region.id, pool.id, contentSignature]))
    let draw = Number.parseInt(hash.slice(0, 8), 16) / 0x100000000 * total
    let base = entries[entries.length - 1].value
    for (const entry of entries) {
      draw -= entry.weight
      if (draw < 0) { base = entry.value; break }
    }
    let name = base
    for (let suffix = 2; used.has(name); suffix++) name = `${base}·${chineseOrdinal(suffix)}`
    used.add(name)
    names.set(region.id, name)
  }
  return regions.map(region => ({ ...region, name: names.get(region.id)! }))
}

/** Names are facts attached to stable geographic IDs; the classification arrays remain unchanged. */
export function nameGeographicRegions(regions: GeographicRegionsArtifact, worldSeed: string, pools: { readonly continent: NamePool, readonly ocean: NamePool }, contentSignature: string): GeographicRegionsArtifact {
  if (!worldSeed || !contentSignature)
    throw new Error('Geographic naming requires a seed and content signature')
  return {
    ...regions,
    nameContentSignature: contentSignature,
    continents: nameRegions(regions.continents, pools.continent, worldSeed, contentSignature),
    oceans: nameRegions(regions.oceans, pools.ocean, worldSeed, contentSignature),
  }
}
