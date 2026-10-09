import {
  CloudRain,
  Component, // As a generic fallback icon type
  Layers,
  Map,
  Mountain,
  Satellite,
  Thermometer,
  Waves,
  Wind,
  Workflow,
} from '@lucide/svelte'

export type LayerDataType = 'raster' | 'vector-line' | 'vector-point' | 'vector-area'
export type LayerCategory = 'physics' | 'climate' | 'ecology' | 'human' | 'environment' | 'system'

/**
 * Defines the properties and metadata of a renderable layer in the globe.
 */
export interface LayerDefinition {
  id: string
  name: string
  icon: typeof Component
  dataType: LayerDataType
  category: LayerCategory

  isBaseMap: boolean
  canOverlay: boolean

  // Optional descriptions or UI hints
  description?: string
}

/**
 * The global registry of all available layers.
 * Replaces the hardcoded GlobeDisplayMode and showXXXBoundaries booleans.
 */
export const LAYER_REGISTRY: Record<string, LayerDefinition> = {
  // === Base Maps (Raster/Grid) ===
  'satellite': { id: 'satellite', name: '卫星影像', icon: Satellite, dataType: 'raster', category: 'physics', isBaseMap: true, canOverlay: false },
  'heightmap': { id: 'heightmap', name: '高度图', icon: Mountain, dataType: 'raster', category: 'physics', isBaseMap: true, canOverlay: false },
  'dem': { id: 'dem', name: 'DEM图', icon: Mountain, dataType: 'raster', category: 'physics', isBaseMap: true, canOverlay: false },
  'plates': { id: 'plates', name: '板块构造', icon: Workflow, dataType: 'raster', category: 'physics', isBaseMap: true, canOverlay: false },
  'plates-smoothed': { id: 'plates-smoothed', name: '平滑板块', icon: Workflow, dataType: 'vector-area', category: 'physics', isBaseMap: true, canOverlay: false },
  'continents': { id: 'continents', name: '大陆区划', icon: Map, dataType: 'raster', category: 'physics', isBaseMap: true, canOverlay: false },
  'continents-smoothed': { id: 'continents-smoothed', name: '平滑大陆', icon: Map, dataType: 'vector-area', category: 'physics', isBaseMap: true, canOverlay: false },

  // Geography / Topology
  'geometric-flow': { id: 'geometric-flow', name: '几何汇流', icon: Workflow, dataType: 'raster', category: 'physics', isBaseMap: true, canOverlay: false },

  // Climate
  'temperature': { id: 'temperature', name: '月均气温', icon: Thermometer, dataType: 'raster', category: 'climate', isBaseMap: true, canOverlay: false },
  'precipitation': { id: 'precipitation', name: '月降水量', icon: CloudRain, dataType: 'raster', category: 'climate', isBaseMap: true, canOverlay: false },
  'wind': { id: 'wind', name: '盛行风', icon: Wind, dataType: 'raster', category: 'climate', isBaseMap: true, canOverlay: false },
  'ocean-current': { id: 'ocean-current', name: '洋流', icon: Waves, dataType: 'raster', category: 'climate', isBaseMap: true, canOverlay: false },

  // Ecology
  'koppen': { id: 'koppen', name: '气候分类', icon: Layers, dataType: 'raster', category: 'ecology', isBaseMap: true, canOverlay: false },
  'koppen-smoothed': { id: 'koppen-smoothed', name: '平滑气候区', icon: Layers, dataType: 'vector-area', category: 'ecology', isBaseMap: true, canOverlay: false },
  'biome': { id: 'biome', name: '生物群系', icon: Layers, dataType: 'raster', category: 'ecology', isBaseMap: true, canOverlay: false },
  'biome-smoothed': { id: 'biome-smoothed', name: '平滑群系', icon: Layers, dataType: 'vector-area', category: 'ecology', isBaseMap: true, canOverlay: false },

  // === Future Human Layers (Examples) ===
  // 'nation-borders': { id: 'nation-borders', name: '国界线', icon: Map, dataType: 'vector-line', category: 'human', isBaseMap: false, canOverlay: true },
  // 'cities': { id: 'cities', name: '主要城市', icon: Component, dataType: 'vector-point', category: 'human', isBaseMap: false, canOverlay: true },

  // === Environment & System ===
  'clouds': { id: 'clouds', name: '云层', icon: CloudRain, dataType: 'raster', category: 'environment', isBaseMap: false, canOverlay: true },
  'atmosphere': { id: 'atmosphere', name: '大气圈', icon: Component, dataType: 'raster', category: 'environment', isBaseMap: false, canOverlay: true },
  'day-night': { id: 'day-night', name: '昼夜光照', icon: Component, dataType: 'raster', category: 'environment', isBaseMap: false, canOverlay: true },
  'graticule': { id: 'graticule', name: '经纬网格', icon: Component, dataType: 'vector-line', category: 'system', isBaseMap: false, canOverlay: true },
  'wireframe': { id: 'wireframe', name: '三角线框', icon: Component, dataType: 'vector-line', category: 'system', isBaseMap: false, canOverlay: true },
}

/**
 * Helper functions for UI and logic to fetch specific categories of layers.
 */
export function getBaseMaps(): LayerDefinition[] {
  return Object.values(LAYER_REGISTRY).filter(layer => layer.isBaseMap)
}

export function getOverlays(): LayerDefinition[] {
  return Object.values(LAYER_REGISTRY).filter(layer => layer.canOverlay)
}
