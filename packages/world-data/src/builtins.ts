import type { ContentPackV1 } from './schemas/content'
import { calculateContentHash, createContentCatalog } from './catalog'
import { loadBuiltinNamingStyles } from './names/builtin-naming-styles'
import { createNamingStylePack } from './names/naming-style-pack'
import { loadBuiltinSocietyPacks } from './society/builtin-society-packs'

function withHash(pack: Omit<ContentPackV1, 'manifest'> & { manifest: Omit<ContentPackV1['manifest'], 'contentHash'> }): ContentPackV1 {
  return { ...pack, manifest: { ...pack.manifest, contentHash: calculateContentHash(pack) } }
}

const core = withHash({
  manifest: { id: 'core', version: '1.0.0', schemaVersion: 1, nameKey: 'core.pack', dependencies: [{ id: 'builtin:naming-style/western-zh-cn', version: '1.5.0' }] },
  names: [{ id: 'core:names/basic', displayNameKey: 'core.names', tags: [], entries: [{ value: 'Aru', weight: 1 }, { value: 'Ena', weight: 1 }] }],
  namingStyles: [],
  peoples: [],
  polities: [],
  cultures: [{ id: 'core:culture/basic', displayNameKey: 'core.culture', tags: [], namingStyleId: 'builtin:naming-style/western-zh-cn', traits: [] }],
  religions: [],
  resources: [
    { id: 'core:resource/timber', displayNameKey: 'core.resource.timber', description: '可用于建筑、造船与燃料的林木资源。', tags: ['forest', 'construction'], category: 'biological', geologyTags: ['forest', 'temperate', 'boreal'] },
    { id: 'core:resource/grain', displayNameKey: 'core.resource.grain', description: '支撑定居农耕与人口聚集的粮食作物带。', tags: ['agriculture', 'staple'], category: 'biological', geologyTags: ['alluvial', 'floodplain', 'grassland'] },
    { id: 'core:resource/fisheries', displayNameKey: 'core.resource.fisheries', description: '受洋流交汇与近岸浅海滋养的渔业水域。', tags: ['maritime', 'food'], category: 'biological', geologyTags: ['coastal', 'upwelling', 'estuary'] },
    { id: 'core:resource/iron', displayNameKey: 'core.resource.iron', description: '支撑农具锻造、工程与军备冶炼的铁矿脉。', tags: ['metallurgy', 'strategic'], category: 'mineral', geologyTags: ['orogen', 'continental-shield', 'sedimentary'] },
    { id: 'core:resource/copper', displayNameKey: 'core.resource.copper', description: '分布于火山弧与造山带周边的基础铜矿藏。', tags: ['metallurgy', 'trade'], category: 'mineral', geologyTags: ['volcanic-arc', 'orogen', 'subduction'] },
    { id: 'core:resource/precious-metals', displayNameKey: 'core.resource.precious', description: '集中于热液造山带与古老地块的金银贵金属矿床。', tags: ['wealth', 'coinage'], category: 'mineral', geologyTags: ['orogen', 'hotspot', 'volcanic-arc'] },
    { id: 'core:resource/coal', displayNameKey: 'core.resource.coal', description: '形成于古老沉积盆地与前陆洼地的化石燃料矿床。', tags: ['fuel', 'industrial'], category: 'energy', geologyTags: ['basin', 'sedimentary', 'foreland'] },
  ],
  presets: [],
  translations: {
    'en': {
      'core.pack': 'Core',
      'core.names': 'Basic names',
      'core.culture': 'Basic culture',
      'core.resource.timber': 'Timber',
      'core.resource.grain': 'Arable Grainlands',
      'core.resource.fisheries': 'Coastal Fisheries',
      'core.resource.iron': 'Iron Ore',
      'core.resource.copper': 'Copper Ore',
      'core.resource.precious': 'Precious Metals',
      'core.resource.coal': 'Coal Deposits',
    },
    'zh-CN': {
      'core.pack': '核心内容',
      'core.names': '基础名称',
      'core.culture': '基础文化',
      'core.resource.timber': '林木',
      'core.resource.grain': '良田谷物',
      'core.resource.fisheries': '近海渔场',
      'core.resource.iron': '铁矿',
      'core.resource.copper': '铜矿',
      'core.resource.precious': '贵金属',
      'core.resource.coal': '煤矿',
    },
  },
})

const earthlike = withHash({
  manifest: { id: 'earthlike', version: '1.0.0', schemaVersion: 1, nameKey: 'earthlike.pack', dependencies: [{ id: 'core', version: '1.0.0' }] },
  names: [],
  namingStyles: [],
  cultures: [],
  peoples: [],
  polities: [],
  religions: [],
  resources: [],
  presets: [{ id: 'earthlike:preset/temperate', displayNameKey: 'earthlike.temperate', tags: ['earthlike'], physicalRadiusKm: 6371, rotationPeriodHours: 24, orbitalPeriodDays: 365.25, axialTiltDegrees: 23.44, seaLevelDatumKm: 0 }],
  translations: { 'en': { 'earthlike.pack': 'Earthlike', 'earthlike.temperate': 'Temperate world' }, 'zh-CN': { 'earthlike.pack': '类地球', 'earthlike.temperate': '温带世界' } },
})

const builtinNamingStylePacks = loadBuiltinNamingStyles().map(createNamingStylePack)
const defaultGeographicNamingProfilePack = (() => {
  const pack = builtinNamingStylePacks.find(item => item.namingStyles[0].id === 'builtin:naming-style/western-zh-cn')
  if (!pack)
    throw new Error('Built-in Western Chinese naming profile is missing')
  return pack
})()

const builtinSocietyPacks = loadBuiltinSocietyPacks(builtinNamingStylePacks)
const defaultChineseSocietyPacks = builtinSocietyPacks.filter(pack => pack.manifest.id.endsWith('-zh-cn'))

export function loadBuiltinCatalog() {
  return createContentCatalog([core, earthlike, ...builtinNamingStylePacks, ...builtinSocietyPacks])
}

export function loadBuiltinGenerationCatalog() {
  return createContentCatalog([core, earthlike, defaultGeographicNamingProfilePack, ...defaultChineseSocietyPacks])
}
