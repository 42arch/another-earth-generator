import type { ContentPackView, ContentPort, EcologyVocabulary, ResourceDefinitionView } from '@another-earth/world-core'
import type { ContentPack, ContentPackV1, CultureArchetype, NamingStyle, PeopleArchetype, PolityArchetype, ReligionArchetype, ResourceDefinition } from '@another-earth/world-data'
import { civilizationContentSignature, ecologyVocabularySignature, resourceDefinitionsSignature } from '@another-earth/world-core'
import { calculateContentHash, calculateContentSignature, calculateNamingStyleSignature, loadBuiltinCatalog, loadBuiltinGenerationCatalog, NATURAL_BIOME_DEFINITIONS, NATURAL_LAND_COVER_DEFINITIONS, validateContentPack } from '@another-earth/world-data'

const defaultGeographicProfileId = 'builtin:naming-style/western-zh-cn'
const catalog = loadBuiltinGenerationCatalog()
const fullCatalog = loadBuiltinCatalog()
const profilePack = catalog.get(defaultGeographicProfileId) as ContentPackV1 | undefined
if (!profilePack)
  throw new Error(`Built-in naming profile ${defaultGeographicProfileId} is missing`)

export const builtinGeographicNamingProfile = profilePack.namingStyles.find(profile => profile.id === defaultGeographicProfileId)!
export const builtinContentPacks: readonly ContentPackView[] = catalog.packs

const peopleArchetypeMap = new Map<string, PeopleArchetype>()
const cultureArchetypeMap = new Map<string, CultureArchetype>()
const religionArchetypeMap = new Map<string, ReligionArchetype>()
const polityArchetypeMap = new Map<string, PolityArchetype>()
const resourceDefinitionMap = new Map<string, ResourceDefinition>()
const contentTranslationsByLocale: Record<string, Record<string, string>> = {}

for (const pack of fullCatalog.packs as readonly ContentPackV1[]) {
  for (const item of pack.peoples)
    peopleArchetypeMap.set(item.id, item)
  for (const item of pack.cultures)
    cultureArchetypeMap.set(item.id, item)
  for (const item of pack.religions)
    religionArchetypeMap.set(item.id, item)
  for (const item of pack.polities)
    polityArchetypeMap.set(item.id, item)
  for (const item of pack.resources)
    resourceDefinitionMap.set(item.id, item)
  for (const [locale, texts] of Object.entries(pack.translations)) {
    contentTranslationsByLocale[locale] ??= {}
    Object.assign(contentTranslationsByLocale[locale], texts)
  }
}

export function findPeopleArchetype(id: string): PeopleArchetype | undefined {
  return peopleArchetypeMap.get(id)
}

export function findCultureArchetype(id: string): CultureArchetype | undefined {
  return cultureArchetypeMap.get(id)
}

export function findReligionArchetype(id: string): ReligionArchetype | undefined {
  return religionArchetypeMap.get(id)
}

export function findPolityArchetype(id: string): PolityArchetype | undefined {
  return polityArchetypeMap.get(id)
}

export function findResourceDefinition(id: string): ResourceDefinition | undefined {
  return resourceDefinitionMap.get(id)
}

export function translateContentKey(key: string, locale = 'zh-CN'): string {
  return contentTranslationsByLocale[locale]?.[key]
    ?? contentTranslationsByLocale['zh-CN']?.[key]
    ?? contentTranslationsByLocale.en?.[key]
    ?? key
}

export const builtinEcologyVocabulary: EcologyVocabulary = {
  biomes: NATURAL_BIOME_DEFINITIONS.map(({ id, code, nameZh }) => ({ id, code, nameZh })),
  landCover: NATURAL_LAND_COVER_DEFINITIONS.map(({ id, code, nameZh }) => ({ id, code, nameZh })),
}

const builtinResources: readonly ResourceDefinitionView[] = catalog.packs.flatMap(pack => pack.resources)

const builtinCivilizationContent = (() => {
  const translations: Record<string, Record<string, string>> = {}
  for (const pack of catalog.packs) {
    for (const [locale, texts] of Object.entries(pack.translations)) {
      translations[locale] ??= {}
      Object.assign(translations[locale], texts)
    }
  }
  return {
    peoples: catalog.packs.flatMap(pack => pack.peoples),
    cultures: catalog.packs.flatMap(pack => pack.cultures),
    religions: catalog.packs.flatMap(pack => pack.religions),
    polities: catalog.packs.flatMap(pack => pack.polities),
    namingStyles: catalog.packs.flatMap(pack => pack.namingStyles),
    translations,
  }
})()

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
    'resource-definitions': builtinResources,
    'civilization-content': builtinCivilizationContent,
  },
  contentSignatures: {
    'geographic-naming-style': calculateNamingStyleSignature(builtinGeographicNamingProfile),
    'ecology-classes': ecologyVocabularySignature(builtinEcologyVocabulary),
    'resource-definitions': resourceDefinitionsSignature(builtinResources),
    'civilization-content': civilizationContentSignature(builtinCivilizationContent),
  },
}
