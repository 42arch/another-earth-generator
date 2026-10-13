/**
 * 地理要素派生适配器 (Adapters)
 */
export {
  createAreaGeoJsonSource,
  createLandGeoJsonSource,
} from './adapters/area-adapter'
export type { AreaSourceId } from './adapters/area-adapter'

export { GEOJSON_LINE_SOURCE_ADAPTERS } from './adapters/line-adapter'
export type { GeoJsonLineSourceAdapter, GeoJsonLineSourceContext } from './adapters/line-adapter'

export { POINT_SOURCE_ADAPTERS } from './adapters/point-adapter'
export type { PointSourceAdapter } from './adapters/point-adapter'

export { createRiverGeoJsonSource } from './adapters/river-adapter'
export { SYMBOL_SOURCE_ADAPTERS } from './adapters/symbol-adapter'

export type {
  SymbolFeature,
  SymbolGlyph,
  SymbolSourceAdapter,
  SymbolSourceContext,
  SymbolSourceResult,
} from './adapters/symbol-adapter'

/**
 * GeoJSON 规范与要素模型
 */
export { geoJsonGeometryKind, validateGeoJson } from './geojson'
export type {
  GeoJsonFeature,
  GeoJsonFeatureCollection,
  GeoJsonFeatureHit,
  GeoJsonGeometry,
  GeoJsonGeometryKind,
  GeoJsonPosition,
} from './geojson'

/**
 * 运行时数据源管理与缓存
 */
export {
  createWorldRasterSource,
  exportGeoJsonSource,
  exportRasterCellSource,
  getImportedGeoJsonSource,
  importGeoJsonSource,
  importRasterCellSource,
  notifyMapDataSourceChanges,
  rasterGridId,
  removeGeoJsonSource,
  removeRasterCellSource,
  resolveRasterCellSource,
  subscribeMapDataSourceChanges,
  updateGeoJsonFeature,
} from './runtime/data-source-manager'
export type {
  GeoJsonDataSource,
  MapDataSource,
  RasterCellField,
  RasterCellSource,
  SerializedRasterCellSource,
} from './runtime/data-source-manager'

export {
  computeGeoJsonSourceCacheKey,
  exportGeneratedGeoJsonSource,
  exportGeneratedGeoJsonSourceBundle,
  hasGeoJsonSource,
  invalidateGeneratedGeoJsonSources,
  registerGeneratedGeoJsonSource,
  resolveGeoJsonSource,
} from './runtime/geojson-cache'
export type { GeneratedGeoJsonProvider } from './runtime/geojson-cache'

/**
 * 样式数据源注册表 (Source Registry)
 */
export { getMapStyleSource, MAP_STYLE_SOURCES } from './runtime/source-registry'
export type { MapStyleSourceDefinition, MapStyleSourceKind } from './runtime/source-registry'
/**
 * 栅格与物理场提取工具
 */
export { extractOceanWarmth, extractVectorSpeed } from './utils/raster-field-extractors'

/**
 * 区域模式分类与地貌几何提取
 */
export {
  buildDisplayRegionIds,
  buildSmoothedRegionCornersForMode,
  getLandAreaGeometry,
  isGeoJsonAreaBaseMap,
  OCEAN_REGION_ID,
} from './utils/region-classification'
export type {
  AreaClassificationMode,
  LandAreaGeometry,
} from './utils/region-classification'

/**
 * 人文与地貌世界注记生成
 */
export { computeWorldLabels } from './utils/world-labels'
export type { WorldGlyphItem, WorldLabelItem } from './utils/world-labels'
