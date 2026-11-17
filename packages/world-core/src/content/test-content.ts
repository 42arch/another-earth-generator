import type { ContentPackView, ContentPort, EcologyClassView, EcologyVocabulary, NamePoolView } from './content-port'
import { ecologyVocabularySignature } from './content-port'

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
  validateContentPack: () => ({ valid: true, issues: [] }),
}

export const testContentPack: ContentPackView = {
  manifest: { id: 'test:core', version: '1.0.0', contentHash: hash(JSON.stringify(['test:core', '1.0.0'])), dependencies: [] },
  names: [
    { id: 'test:names/continent' },
    { id: 'test:names/ocean' },
  ],
  cultures: [{ id: 'test:culture/basic' }],
  religions: [{ id: 'test:religion/basic' }],
  governments: [{ id: 'test:government/basic' }],
  resources: [],
  presets: [],
}

const entries = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => ({ value: `${prefix}${index + 1}`, weight: 1 }))

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

/** Name-pool signature matches the packs so assembled snapshots pass content checks. */
export function testPipelineContent(packs: readonly ContentPackView[] = [testContentPack]) {
  return {
    content: {
      'geographic-name-pools': testNamePools,
      'ecology-classes': testEcologyVocabulary,
    },
    contentSignatures: {
      'geographic-name-pools': testContentPort.calculateContentSignature(packs),
      'ecology-classes': ecologyVocabularySignature(testEcologyVocabulary),
    },
  }
}
