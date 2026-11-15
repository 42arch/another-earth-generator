import type { ContentId } from './content'

export interface EcologyClassDefinition {
  readonly id: ContentId
  readonly code: string
  readonly displayNameKey: string
  readonly nameZh: string
}

/** Stable M1 natural biome vocabulary. Numeric positions are not persistent IDs. */
export const NATURAL_BIOME_DEFINITIONS = [
  { id: 'core:biome/ocean', code: 'Ocean', displayNameKey: 'ecology.biome.ocean', nameZh: '海洋' },
  { id: 'core:biome/tropical-rainforest', code: 'TropicalRainforest', displayNameKey: 'ecology.biome.tropicalRainforest', nameZh: '热带雨林' },
  { id: 'core:biome/tropical-seasonal-forest', code: 'TropicalSeasonalForest', displayNameKey: 'ecology.biome.tropicalSeasonalForest', nameZh: '热带季节林' },
  { id: 'core:biome/savanna', code: 'Savanna', displayNameKey: 'ecology.biome.savanna', nameZh: '稀树草原' },
  { id: 'core:biome/hot-desert', code: 'HotDesert', displayNameKey: 'ecology.biome.hotDesert', nameZh: '热沙漠' },
  { id: 'core:biome/cold-desert', code: 'ColdDesert', displayNameKey: 'ecology.biome.coldDesert', nameZh: '冷沙漠' },
  { id: 'core:biome/steppe', code: 'Steppe', displayNameKey: 'ecology.biome.steppe', nameZh: '半干旱草原' },
  { id: 'core:biome/mediterranean-shrubland', code: 'MediterraneanShrubland', displayNameKey: 'ecology.biome.mediterraneanShrubland', nameZh: '地中海灌丛' },
  { id: 'core:biome/temperate-grassland', code: 'TemperateGrassland', displayNameKey: 'ecology.biome.temperateGrassland', nameZh: '温带草原' },
  { id: 'core:biome/temperate-seasonal-forest', code: 'TemperateSeasonalForest', displayNameKey: 'ecology.biome.temperateSeasonalForest', nameZh: '温带季节林' },
  { id: 'core:biome/temperate-rainforest', code: 'TemperateRainforest', displayNameKey: 'ecology.biome.temperateRainforest', nameZh: '温带雨林' },
  { id: 'core:biome/boreal-forest', code: 'BorealForest', displayNameKey: 'ecology.biome.borealForest', nameZh: '针叶林' },
  { id: 'core:biome/tundra', code: 'Tundra', displayNameKey: 'ecology.biome.tundra', nameZh: '苔原' },
  { id: 'core:biome/ice-sheet', code: 'IceSheet', displayNameKey: 'ecology.biome.iceSheet', nameZh: '冰原' },
  { id: 'core:biome/alpine-tundra', code: 'AlpineTundra', displayNameKey: 'ecology.biome.alpineTundra', nameZh: '高山苔原' },
] as const satisfies readonly EcologyClassDefinition[]

/** Natural surface classes for an initial world with no civilization. */
export const NATURAL_LAND_COVER_DEFINITIONS = [
  { id: 'core:land-cover/ocean', code: 'Ocean', displayNameKey: 'ecology.landCover.ocean', nameZh: '海洋' },
  { id: 'core:land-cover/snow-ice', code: 'SnowIce', displayNameKey: 'ecology.landCover.snowIce', nameZh: '雪冰代理' },
  { id: 'core:land-cover/forest', code: 'Forest', displayNameKey: 'ecology.landCover.forest', nameZh: '森林' },
  { id: 'core:land-cover/savanna', code: 'Savanna', displayNameKey: 'ecology.landCover.savanna', nameZh: '稀树草原' },
  { id: 'core:land-cover/desert', code: 'Desert', displayNameKey: 'ecology.landCover.desert', nameZh: '荒漠' },
  { id: 'core:land-cover/grassland', code: 'Grassland', displayNameKey: 'ecology.landCover.grassland', nameZh: '草地' },
  { id: 'core:land-cover/shrubland', code: 'Shrubland', displayNameKey: 'ecology.landCover.shrubland', nameZh: '灌丛' },
  { id: 'core:land-cover/tundra', code: 'Tundra', displayNameKey: 'ecology.landCover.tundra', nameZh: '苔原' },
] as const satisfies readonly EcologyClassDefinition[]
