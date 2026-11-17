import type { ContentPackView, ContentPort, EcologyVocabulary, NamePoolView } from '@another-earth/world-core'
import type { ContentPack } from '@another-earth/world-data'
import { ecologyVocabularySignature } from '@another-earth/world-core'
import { calculateContentHash, calculateContentSignature, loadBuiltinGenerationCatalog, NATURAL_BIOME_DEFINITIONS, NATURAL_LAND_COVER_DEFINITIONS, validateContentPack } from '@another-earth/world-data'

const catalog = loadBuiltinGenerationCatalog()

function pool(id: string): NamePoolView {
  const source = catalog.packs.flatMap(pack => pack.names).find(item => item.id === id)
  if (!source)
    throw new Error(`Built-in name pool ${id} is missing`)
  return { id: source.id, entries: source.entries.map(entry => ({ value: entry.value, weight: entry.weight })) }
}

/** Chinese continent and ocean names selected for newly generated worlds. */
export const builtinNamePools: { readonly continent: NamePoolView, readonly ocean: NamePoolView } = {
  continent: pool('geography-zh:names/continent'),
  ocean: pool('geography-zh:names/ocean'),
}

export const builtinEcologyVocabulary: EcologyVocabulary = {
  biomes: NATURAL_BIOME_DEFINITIONS.map(({ id, code, nameZh }) => ({ id, code, nameZh })),
  landCover: NATURAL_LAND_COVER_DEFINITIONS.map(({ id, code, nameZh }) => ({ id, code, nameZh })),
}

export const builtinContentPacks: readonly ContentPackView[] = catalog.packs

export const builtinContentPort: ContentPort = {
  calculateContentHash: pack => calculateContentHash(pack as ContentPack),
  calculateContentSignature: packs => calculateContentSignature(packs as readonly ContentPack[]),
  validateContentPack: (pack, resolved) => validateContentPack(pack as ContentPack, resolved as readonly ContentPack[]),
}

export const builtinPipelineContent = {
  content: {
    'geographic-name-pools': builtinNamePools,
    'ecology-classes': builtinEcologyVocabulary,
  },
  contentSignatures: {
    'geographic-name-pools': catalog.contentSignature,
    'ecology-classes': ecologyVocabularySignature(builtinEcologyVocabulary),
  },
}
