import type { ContentPackView, ContentPort, EcologyVocabulary } from '@another-earth/world-core'
import type { ContentPack, ContentPackV1, NamingStyle } from '@another-earth/world-data'
import { ecologyVocabularySignature } from '@another-earth/world-core'
import { calculateContentHash, calculateContentSignature, calculateNamingStyleSignature, loadBuiltinGenerationCatalog, NATURAL_BIOME_DEFINITIONS, NATURAL_LAND_COVER_DEFINITIONS, validateContentPack } from '@another-earth/world-data'

const defaultGeographicProfileId = 'builtin:naming-style/western-zh-cn'
const catalog = loadBuiltinGenerationCatalog()
const profilePack = catalog.get(defaultGeographicProfileId) as ContentPackV1 | undefined
if (!profilePack)
  throw new Error(`Built-in naming profile ${defaultGeographicProfileId} is missing`)

export const builtinGeographicNamingProfile = profilePack.namingStyles.find(profile => profile.id === defaultGeographicProfileId)!
export const builtinContentPacks: readonly ContentPackView[] = catalog.packs

export const builtinEcologyVocabulary: EcologyVocabulary = {
  biomes: NATURAL_BIOME_DEFINITIONS.map(({ id, code, nameZh }) => ({ id, code, nameZh })),
  landCover: NATURAL_LAND_COVER_DEFINITIONS.map(({ id, code, nameZh }) => ({ id, code, nameZh })),
}

export const builtinContentPort: ContentPort = {
  calculateContentHash: pack => calculateContentHash(pack as ContentPack),
  calculateContentSignature: packs => calculateContentSignature(packs as readonly ContentPack[]),
  calculateNamingStyleSignature: style => calculateNamingStyleSignature(style as NamingStyle),
  validateContentPack: (pack, resolved) => validateContentPack(pack as ContentPack, resolved as readonly ContentPack[]),
}

export const builtinPipelineContent = {
  content: {
    'geographic-naming-style': builtinGeographicNamingProfile,
    'ecology-classes': builtinEcologyVocabulary,
  },
  contentSignatures: {
    'geographic-naming-style': calculateNamingStyleSignature(builtinGeographicNamingProfile),
    'ecology-classes': ecologyVocabularySignature(builtinEcologyVocabulary),
  },
}
