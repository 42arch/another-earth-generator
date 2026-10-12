export type LayerDataType = 'raster' | 'vector-line' | 'vector-point' | 'vector-area'
export type LayerCategory = 'physics' | 'climate' | 'ecology' | 'civilization' | 'environment' | 'system'

/**
 * Defines the properties and metadata of a renderable layer in the globe.
 */
export interface LayerDefinition {
  id: string
  name: string
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
  // === Base Maps ===
  'cartographic': { id: 'cartographic', name: '制图底图', dataType: 'raster', category: 'physics', isBaseMap: true, canOverlay: false },
  'satellite': { id: 'satellite', name: '卫星影像', dataType: 'raster', category: 'physics', isBaseMap: true, canOverlay: false },
  'heightmap': { id: 'heightmap', name: '高度图', dataType: 'raster', category: 'physics', isBaseMap: true, canOverlay: false },
  'dem': { id: 'dem', name: 'DEM图', dataType: 'raster', category: 'physics', isBaseMap: true, canOverlay: false },

  // Geography / Topology
  'geometric-flow': { id: 'geometric-flow', name: '几何汇流', dataType: 'raster', category: 'physics', isBaseMap: true, canOverlay: false },

  // Climate
  'temperature': { id: 'temperature', name: '月均气温', dataType: 'raster', category: 'climate', isBaseMap: true, canOverlay: false },
  'precipitation': { id: 'precipitation', name: '月降水量', dataType: 'raster', category: 'climate', isBaseMap: true, canOverlay: false },
  'wind': { id: 'wind', name: '盛行风', dataType: 'raster', category: 'climate', isBaseMap: true, canOverlay: false },
  'ocean-current': { id: 'ocean-current', name: '洋流', dataType: 'raster', category: 'climate', isBaseMap: true, canOverlay: false },

  // Ecology
  'population': { id: 'population', name: '人口密度', dataType: 'raster', category: 'civilization', isBaseMap: true, canOverlay: false },
  'market-access': { id: 'market-access', name: '市场可达性', dataType: 'raster', category: 'civilization', isBaseMap: true, canOverlay: false },
  'ethnicity': { id: 'ethnicity', name: '民族分布', dataType: 'vector-area', category: 'civilization', isBaseMap: true, canOverlay: false },
  'languages': { id: 'languages', name: '语言分布', dataType: 'vector-area', category: 'civilization', isBaseMap: true, canOverlay: false },
  'polities': { id: 'polities', name: '国家归属', dataType: 'vector-area', category: 'civilization', isBaseMap: true, canOverlay: false },
  'religions': { id: 'religions', name: '宗教与信仰', dataType: 'vector-area', category: 'civilization', isBaseMap: true, canOverlay: false },

  // civilization overlays
  'nation-borders': { id: 'nation-borders', name: '国界线', dataType: 'vector-line', category: 'civilization', isBaseMap: false, canOverlay: true },
  'nation-labels': { id: 'nation-labels', name: '国家标签', dataType: 'vector-point', category: 'civilization', isBaseMap: false, canOverlay: true },
  'religion-labels': { id: 'religion-labels', name: '宗教标签', dataType: 'vector-point', category: 'civilization', isBaseMap: false, canOverlay: true },
  'ethnicity-labels': { id: 'ethnicity-labels', name: '民族标签', dataType: 'vector-point', category: 'civilization', isBaseMap: false, canOverlay: true },
  'language-labels': { id: 'language-labels', name: '语言标签', dataType: 'vector-point', category: 'civilization', isBaseMap: false, canOverlay: true },
  'cities': { id: 'cities', name: '聚落', dataType: 'vector-point', category: 'civilization', isBaseMap: false, canOverlay: true },
  'routes': { id: 'routes', name: '道路与航线', dataType: 'vector-line', category: 'civilization', isBaseMap: false, canOverlay: true },
  'sacred-sites': { id: 'sacred-sites', name: '圣地', dataType: 'vector-point', category: 'civilization', isBaseMap: false, canOverlay: true },

  // === Environment & System ===
  'clouds': { id: 'clouds', name: '云层', dataType: 'raster', category: 'environment', isBaseMap: false, canOverlay: true },
  'atmosphere': { id: 'atmosphere', name: '大气圈', dataType: 'raster', category: 'environment', isBaseMap: false, canOverlay: true },
  'day-night': { id: 'day-night', name: '昼夜光照', dataType: 'raster', category: 'environment', isBaseMap: false, canOverlay: true },
  'graticule': { id: 'graticule', name: '经纬网格', dataType: 'vector-line', category: 'system', isBaseMap: false, canOverlay: true },
  'wireframe': { id: 'wireframe', name: '三角线框', dataType: 'vector-line', category: 'system', isBaseMap: false, canOverlay: true },
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
