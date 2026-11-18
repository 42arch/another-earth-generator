import type { ContentPackV1 } from '../schemas/content'
import type { NamingStyle } from '../schemas/naming-style'
import { calculateContentHash } from '../catalog'
import { requireNamingStyle } from './naming-style'

/** One author document becomes one self-contained pack; the full style ID is also its pack ID. */
export function createNamingStylePack(input: NamingStyle): ContentPackV1 {
  const style = requireNamingStyle(input)
  const nameKey = `${style.id}.pack`
  const pack: ContentPackV1 = {
    manifest: { id: style.id, version: style.version, schemaVersion: 1, nameKey, contentHash: '', dependencies: [] },
    namingStyles: [style],
    names: [],
    cultures: [],
    peoples: [],
    states: [],
    religions: [],
    governments: [],
    resources: [],
    presets: [],
    translations: Object.fromEntries(Object.entries(style.displayName).map(([locale, label]) => [locale, { [nameKey]: label }])),
  }
  return { ...pack, manifest: { ...pack.manifest, contentHash: calculateContentHash(pack) } }
}
