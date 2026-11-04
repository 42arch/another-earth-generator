import type { ContentPack } from './schemas/content'
import { calculateContentHash, createContentCatalog } from './catalog'

function withHash(pack: Omit<ContentPack, 'manifest'> & { manifest: Omit<ContentPack['manifest'], 'contentHash'> }): ContentPack {
  return { ...pack, manifest: { ...pack.manifest, contentHash: calculateContentHash(pack) } }
}

const core = withHash({
  manifest: { id: 'core', version: '1.0.0', schemaVersion: 1, nameKey: 'core.pack', dependencies: [] },
  names: [{ id: 'core:names/basic', displayNameKey: 'core.names', tags: [], entries: [{ value: 'Aru', weight: 1 }, { value: 'Ena', weight: 1 }] }],
  cultures: [{ id: 'core:culture/basic', displayNameKey: 'core.culture', tags: [], namePoolId: 'core:names/basic', traits: [] }],
  religions: [{ id: 'core:religion/local', displayNameKey: 'core.religion', tags: [], organization: 'decentralized', traits: [], tolerance: 0.5, spreadBias: 0.5, weight: 1 }],
  governments: [{ id: 'core:government/council', displayNameKey: 'core.government', tags: [], governance: 'distributed', succession: 'elective', weight: 1 }],
  resources: [{ id: 'core:resource/timber', displayNameKey: 'core.resource', tags: [], category: 'biological', geologyTags: [] }],
  presets: [],
  translations: { en: { 'core.pack': 'Core', 'core.names': 'Basic names', 'core.culture': 'Basic culture', 'core.religion': 'Local tradition', 'core.government': 'Council', 'core.resource': 'Timber' }, zh: { 'core.pack': '核心', 'core.names': '基础名称', 'core.culture': '基础文化', 'core.religion': '地方信仰', 'core.government': '议会', 'core.resource': '木材' } },
})

const earthlike = withHash({
  manifest: { id: 'earthlike', version: '1.0.0', schemaVersion: 1, nameKey: 'earthlike.pack', dependencies: [{ id: 'core', version: '1.0.0' }] },
  names: [],
  cultures: [],
  religions: [],
  governments: [],
  resources: [],
  presets: [{ id: 'earthlike:preset/temperate', displayNameKey: 'earthlike.temperate', tags: ['earthlike'], physicalRadiusKm: 6371, rotationPeriodHours: 24, orbitalPeriodDays: 365.25, axialTiltDegrees: 23.44, seaLevelDatumKm: 0 }],
  translations: { en: { 'earthlike.pack': 'Earthlike', 'earthlike.temperate': 'Temperate world' }, zh: { 'earthlike.pack': '类地球', 'earthlike.temperate': '温带世界' } },
})

export function loadBuiltinCatalog() {
  return createContentCatalog([core, earthlike])
}
