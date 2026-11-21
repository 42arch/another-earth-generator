import type { CivilizationContentBundle, ContentId, ContentPackView, ContentPort, EcologyClassView, EcologyVocabulary, NamePoolView, NamingStyleView, ResourceDefinitionView } from './content-port'
import { civilizationContentSignature, ecologyVocabularySignature, resourceDefinitionsSignature } from './content-port'

function hash(value: string): string {
  let h = 0x811C9DC5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `fnv1a32:${(h >>> 0).toString(16).padStart(8, '0')}`
}

/** Test double. Production callers pass the world-data implementations. */
export const testContentPort: ContentPort = {
  calculateContentHash: pack => hash(JSON.stringify([pack.manifest.id, pack.manifest.version])),
  calculateContentSignature: packs => hash(JSON.stringify([...packs].map(pack => [pack.manifest.id, pack.manifest.version, pack.manifest.contentHash]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))),
  calculateNamingStyleSignature: style => hash(JSON.stringify(style)),
  validateContentPack: () => ({ valid: true, issues: [] }),
}

const entries = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => ({ value: `${prefix}${index + 1}`, weight: 1 }))

export const testNamingStyle: NamingStyleView = {
  format: 'another-earth/naming-style',
  schemaVersion: 2,
  id: 'test:naming-style/western-zh-cn',
  style: 'western',
  language: 'zh-CN',
  version: '1.0.0',
  displayName: { en: 'Test geography' },
  pools: {
    continent: entries('苍岚', 8),
    ocean: entries('沧溟', 8),
    settlement: entries('新港', 256),
    people: entries('山民', 64),
    culture: entries('星辉文脉', 64),
    religion: entries('晨曦圣宗', 64),
    polity: entries('海风合众', 64),
  },
  rules: {
    continent: [{ weight: 1, parts: [{ pool: 'continent' }] }],
    ocean: [{ weight: 1, parts: [{ pool: 'ocean' }] }],
    settlement: [{ weight: 1, parts: [{ pool: 'settlement' }] }],
    people: [{ weight: 1, parts: [{ pool: 'people' }] }],
    culture: [{ weight: 1, parts: [{ pool: 'culture' }] }],
    religion: [{ weight: 1, parts: [{ pool: 'religion' }] }],
    polity: [{ weight: 1, parts: [{ pool: 'polity' }] }],
  },
}

export const testResources: readonly ResourceDefinitionView[] = [
  { id: 'test:resource/grain', displayNameKey: 'resource.grain', tags: ['agriculture'], category: 'biological', geologyTags: ['alluvial', 'grassland'] },
  { id: 'test:resource/iron', displayNameKey: 'resource.iron', tags: ['metallurgy'], category: 'mineral', geologyTags: ['orogen', 'continental-shield'] },
]

export const testContentPack: ContentPackView = {
  manifest: { id: 'test:core', version: '1.0.0', contentHash: hash(JSON.stringify(['test:core', '1.0.0'])), dependencies: [] },
  names: [
    { id: 'test:names/continent' },
    { id: 'test:names/ocean' },
  ],
  namingStyles: [testNamingStyle],
  peoples: [{ id: 'test:people/basic', displayNameKey: 'people.basic', tags: ['generalist'] }],
  cultures: [{ id: 'test:culture/basic', displayNameKey: 'culture.basic', tags: ['river'], namingStyleId: testNamingStyle.id as ContentId, traits: ['agrarian'] }],
  religions: [{ id: 'test:religion/basic', displayNameKey: 'religion.basic', tags: ['local'], organization: 'decentralized', traits: ['nature-veneration'], tolerance: 0.7, spreadBias: 0.4, weight: 1 }],
  polities: [{ id: 'test:polity/basic', displayNameKey: 'polity.basic', tags: [], politicalForm: 'republic', governmentOrganization: 'presidential', headOfStateTitle: '总统', headOfGovernmentTitle: '总理', legislatureTitle: '议会', succession: 'elective', weight: 1 }],
  resources: testResources,
  presets: [],
  translations: {
    'zh-CN': {
      'people.basic': '基础族群',
      'culture.basic': '基础文化',
      'religion.basic': '地方山川信仰',
      'polity.basic': '共和国',
      'resource.grain': '良田谷物',
      'resource.iron': '铁矿',
    },
  },
}

export const testNamePools: { readonly continent: NamePoolView, readonly ocean: NamePoolView } = {
  continent: { id: 'test:names/continent', entries: entries('苍岚', 8) },
  ocean: { id: 'test:names/ocean', entries: entries('沧溟', 8) },
}

const biome = (code: string): EcologyClassView => ({ id: `test:biome/${code}`, code, nameZh: code })
const cover = (code: string): EcologyClassView => ({ id: `test:land-cover/${code}`, code, nameZh: code })

/** Covers every code the classifier can emit. IDs are fixtures, not the published vocabulary. */
export const testEcologyVocabulary: EcologyVocabulary = {
  biomes: ['Ocean', 'TropicalRainforest', 'TropicalSeasonalForest', 'Savanna', 'HotDesert', 'ColdDesert', 'Steppe', 'MediterraneanShrubland', 'TemperateGrassland', 'TemperateSeasonalForest', 'TemperateRainforest', 'BorealForest', 'Tundra', 'IceSheet', 'AlpineTundra'].map(biome),
  landCover: ['Ocean', 'SnowIce', 'Forest', 'Savanna', 'Desert', 'Grassland', 'Shrubland', 'Tundra'].map(cover),
}

export function extractCivilizationContent(packs: readonly ContentPackView[]): CivilizationContentBundle {
  const translations: Record<string, Record<string, string>> = {}
  for (const pack of packs) {
    if (!pack.translations)
      continue
    for (const [locale, texts] of Object.entries(pack.translations)) {
      translations[locale] ??= {}
      Object.assign(translations[locale], texts)
    }
  }
  return {
    peoples: packs.flatMap(pack => pack.peoples),
    cultures: packs.flatMap(pack => pack.cultures),
    religions: packs.flatMap(pack => pack.religions),
    polities: packs.flatMap(pack => pack.polities),
    namingStyles: packs.flatMap(pack => pack.namingStyles ?? []),
    translations,
  }
}

/** Generation and validation use the same style from the selected packs. */
export function testPipelineContent(packs: readonly ContentPackView[] = [testContentPack]) {
  const style = packs.flatMap(pack => pack.namingStyles ?? []).find(item => item.id === testNamingStyle.id) ?? testNamingStyle
  const resources = packs.flatMap(pack => pack.resources)
  const civilizationContent = extractCivilizationContent(packs)
  return {
    content: {
      'geographic-naming-style': style,
      'ecology-classes': testEcologyVocabulary,
      'resource-definitions': resources,
      'civilization-content': civilizationContent,
    },
    contentSignatures: {
      'geographic-naming-style': testContentPort.calculateNamingStyleSignature(style),
      'ecology-classes': ecologyVocabularySignature(testEcologyVocabulary),
      'resource-definitions': resourceDefinitionsSignature(resources),
      'civilization-content': civilizationContentSignature(civilizationContent),
    },
  }
}
