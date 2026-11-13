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

const geography = withHash({
  manifest: { id: 'geography', version: '1.0.0', schemaVersion: 1, nameKey: 'geography.pack', dependencies: [] },
  names: [
    { id: 'geography:names/continent', displayNameKey: 'geography.continentNames', tags: ['continent'], entries: ['Avara', 'Belora', 'Cendria', 'Dorsan', 'Elvara', 'Falorin', 'Gavara', 'Helion', 'Ilyra', 'Jorath', 'Kelmora', 'Lurea', 'Norvane', 'Oradis', 'Peravia', 'Rysora', 'Selara', 'Tavaris', 'Ulmora', 'Veyra', 'Wyndor', 'Yloria', 'Zaruna'].map(value => ({ value, weight: 1 })) },
    { id: 'geography:names/ocean', displayNameKey: 'geography.oceanNames', tags: ['ocean'], entries: ['Aelith', 'Beryn', 'Caelor', 'Delvar', 'Edris', 'Falmar', 'Galen', 'Helvar', 'Iveron', 'Jorun', 'Kelmar', 'Lorien', 'Melvane', 'Nerion', 'Orveth', 'Pelion', 'Quaris', 'Rovan', 'Seryn', 'Thalor', 'Uvian', 'Velmor', 'Weryn', 'Zalen'].map(value => ({ value, weight: 1 })) },
  ],
  cultures: [], religions: [], governments: [], resources: [], presets: [],
  translations: { en: { 'geography.pack': 'Geographic names', 'geography.continentNames': 'Continent names', 'geography.oceanNames': 'Ocean names' }, zh: { 'geography.pack': '地理名称', 'geography.continentNames': '大陆名称', 'geography.oceanNames': '大洋名称' } },
})

const geographyZh = withHash({
  manifest: { id: 'geography-zh', version: '1.0.0', schemaVersion: 1, nameKey: 'geography-zh.pack', dependencies: [] },
  names: [
    { id: 'geography-zh:names/continent', displayNameKey: 'geography-zh.continentNames', tags: ['continent', 'zh'], entries: ['苍岚', '赤垠', '玄岳', '曦原', '霁川', '青霄', '岩歌', '暮汀', '星野', '霜岭', '灵岳', '瑶岚', '朔原', '栖霞', '风峦', '锦原', '明砾', '紫霄', '玉穹', '沐岚', '云峦', '晨野', '碧岭', '烁原'].map(value => ({ value, weight: 1 })) },
    { id: 'geography-zh:names/ocean', displayNameKey: 'geography-zh.oceanNames', tags: ['ocean', 'zh'], entries: ['沧溟', '澜渊', '星潮', '雾汐', '玄澜', '碧渊', '青溟', '曦涛', '苍涛', '霜潮', '云澜', '灵汐', '极渊', '晨溟', '暮浪', '银潮', '月澜', '暗汐', '晶涛', '深澜', '远溟', '流汐', '雪涛', '映渊'].map(value => ({ value, weight: 1 })) },
  ],
  cultures: [], religions: [], governments: [], resources: [], presets: [],
  translations: { en: { 'geography-zh.pack': 'Chinese geographic names', 'geography-zh.continentNames': 'Chinese continent names', 'geography-zh.oceanNames': 'Chinese ocean names' }, zh: { 'geography-zh.pack': '中文地理名称', 'geography-zh.continentNames': '大陆中文名称', 'geography-zh.oceanNames': '大洋中文名称' } },
})

export function loadBuiltinCatalog() {
  return createContentCatalog([core, earthlike, geography, geographyZh])
}

/** Packs used by newly generated natural worlds; the full catalog also retains legacy lexicons for archive resolution. */
export function loadBuiltinGenerationCatalog() {
  return createContentCatalog([core, earthlike, geographyZh])
}
