import type { ContentPack } from '@another-earth/world-data'
import { loadBuiltinGenerationCatalog } from '@another-earth/world-data'

/** Builtin packs selected for newly generated worlds: core, earthlike, and geography-zh. */
export function loadBuiltinContentPacks(): readonly ContentPack[] {
  return loadBuiltinGenerationCatalog().packs
}
