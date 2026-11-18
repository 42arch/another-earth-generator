export const packageId = '@another-earth/cartography' as const

export { buildGeographicLabelAnchors } from './geographic-labels'
export type { GeographicLabelAnchor } from './geographic-labels'

export {
  intersectUnitSphereScreenPoint,
  isPointerClickGesture,
  MapPicker,
  MAX_CLICK_DRAG_PX,
  screenPointToAtlasWorldCoordinates,
} from './picking/map-picker'
export type {
  MapFeatureHit,
  MapPickResult,
  PickableMapLayer,
} from './picking/map-picker'

export {
  buildProjectionSilhouettePoints,
  BUILTIN_MAP_PROJECTIONS,
  computeAtlasStyleZoom,
  computeAtlasVisibleWorldHeight,
  EQUAL_EARTH_PROJECTION,
  EQUIRECTANGULAR_PROJECTION,
  getMapProjection,
  MERCATOR_MAX_LATITUDE_DEGREES,
  MERCATOR_PROJECTION,
  projectLonLatRing,
} from './projections/map-projections'
export type {
  MapProjection,
  MapProjectionId,
} from './projections/map-projections'
export {
  clipPolygonAtAntimeridian,
  clipPolylineAtAntimeridian,
  clipRingToGeographicBox,
  computeAntimeridianCrossingLatitudeDeg,
} from './projections/seam-clipper'
export type {
  ClippedPolygonPart,
  ClippedPolylineSegment,
} from './projections/seam-clipper'
export {
  buildTangentBasis,
  cartesianToLonLatDeg,
  crossVec3,
  DEG_TO_RAD,
  dotVec3,
  lonLatDegToCartesian,
  normalizeVec3,
  RAD_TO_DEG,
  signedPlanarUnwrappedRingArea,
  signedSphericalRingArea,
  slerpVec3,
  sphericalAngleRad,
  unwrapLongitudeDegNear,
  wrapLongitudeDeg,
} from './projections/spherical-math'
export type { LonLatTuple, Vec3Tuple } from './projections/spherical-math'

export { AtlasView } from './rendering/atlas-view'
export type { AtlasLayerFilterState } from './rendering/atlas-view'
export {
  computeGlobeStyleZoom,
  computeSunDirectionForMonth,
  DEFAULT_PLANET_SPIN_DEGREES_PER_SECOND,
  GlobeView,
  planetSpinStepRadians,
} from './rendering/globe-view'
export type {
  GlobeEffectsConfig,
  GlobeLayerFilterState,
} from './rendering/globe-view'
export { GpuResourceTracker } from './rendering/gpu-resource-tracker'
export type { GpuResourceCounts } from './rendering/gpu-resource-tracker'
export {
  CircleLayer,
  createCircleLayerFromRegistry,
} from './rendering/layers/circle-layer'
export type {
  CircleLayerOptions,
  CircleSymbolShape,
} from './rendering/layers/circle-layer'
export {
  containsSphericalPointInPatches,
  createFillLayerFromRegistry,
  FillLayer,
  MAX_ATLAS_TRIANGLE_EDGE_DEG,
  MAX_SPHERICAL_TRIANGLE_EDGE_RAD,
  pointInRing2D,
  triangulateAtlasPolygon,
  triangulateSphericalPolygon,
} from './rendering/layers/fill-layer'
export type {
  FillLayerOptions,
  GeoJsonPolygonCoordinates,
  GeoJsonRingCoordinates,
  ProjectedGnomonicPatch,
  SphericalTriangulationResult,
} from './rendering/layers/fill-layer'
export {
  buildPolylineRibbonAttributes,
  computeScreenMiterOffset,
  createLineLayerFromRegistry,
  LINE_MITER_LIMIT,
  LineLayer,
  MAX_LINE_SEGMENT_ARC_RAD,
} from './rendering/layers/line-layer'
export type {
  GeoJsonLineCoordinates,
  LineLayerOptions,
  PolylineRibbonData,
} from './rendering/layers/line-layer'
export {
  acquireAtlasCellGeometry,
  acquireGlobeCellGeometry,
  acquireSmoothedDualCorners,
  getCachedAtlasGeometryCount,
  getCachedGlobeGeometryCount,
  RASTER_TEX_WIDTH,
  RasterLayer,
} from './rendering/layers/raster-layer'
export type { RasterLayerOptions } from './rendering/layers/raster-layer'
export { SelectionLayer } from './rendering/layers/selection-layer'
export type { SelectionState } from './rendering/layers/selection-layer'
export {
  clearRegisteredMapFontFaces,
  COLLISION_CELL_SIZE_PX,
  CollisionGrid,
  computeGlyphSdf,
  createSymbolLayerFromRegistry,
  DEFAULT_SYMBOL_FONT_FAMILY,
  DEFAULT_SYMBOL_FONT_WEIGHT,
  getRegisteredMapFontFaces,
  GLOBE_SYMBOL_BACKFACE_DOT_THRESHOLD,
  loadMapFontFaces,
  normalizeFontFaceSource,
  registerCustomMapFont,
  SymbolLayer,
} from './rendering/layers/symbol-layer'
export type {
  LoadMapFontFacesOptions,
  ScreenCollisionBox,
  SymbolFeaturePlacementState,
  SymbolLayerOptions,
} from './rendering/layers/symbol-layer'
export {
  applyCellHillshadeRgba8,
  parseCssColorToRgba8,
  writeSatelliteCellColorsRgba8,
} from './rendering/satellite-shader'
export type { SatelliteSurfaceOptions } from './rendering/satellite-shader'
export { WorldViewport } from './rendering/viewport'
export type { WorldViewportOptions } from './rendering/viewport'

export {
  createCartographySession,
  DEFAULT_CARTOGRAPHY_VIEW_STATE,
} from './session'
export type {
  CartographySession,
  CartographySessionOptions,
  CartographyViewState,
  PreparedWorldMap,
} from './session'

export {
  buildBiomeAreasSource,
  buildContinentAreasSource,
  buildKoppenAreasSource,
  buildLandAreasSource,
  buildLandCoverAreasSource,
  buildPlateAreasSource,
  formatContinentDisplayName,
  formatOceanDisplayName,
} from './sources/adapters/area-sources'
export {
  buildLakePolygonsSource,
  buildRiverCenterlinesSource,
  buildRiverPolygonsSource,
} from './sources/adapters/hydro-sources'
export { buildGeographicLabelsSource } from './sources/adapters/label-sources'
export {
  buildCellWireframeSource,
  buildCirculationVectorsSource,
  buildCoastlinesSource,
  buildGraticuleSource,
  buildPlateBoundariesSource,
} from './sources/adapters/line-sources'
export {
  buildClimateMonthlyRasterSource,
  buildWorldSurfaceRasterSource,
} from './sources/adapters/surface-raster'
export { MapSourceRegistry } from './sources/registry'
export type { CustomMapSourceAdapter, MapSourceRequestOptions } from './sources/registry'
export { buildHydrographyRivers } from './sources/topology/hydrography-buffer'
export type { DerivedRiverFeature } from './sources/topology/hydrography-buffer'
export {
  assemblePolygonsWithHoles,
  extractCornerPositions,
  ringPointsToClosedLonLat,
  traceClassificationRings,
} from './sources/topology/ring-tracer'
export type {
  TracedClassificationTopology,
  TracedCornerRing,
  TracedGroupTopology,
} from './sources/topology/ring-tracer'
export {
  buildSmoothedSharedBoundaryRings,
  catmullRomSmoothClosedRing,
  catmullRomSmoothOpenPath,
  chaikinSmoothSphericalRing,
  evaluateSphericalCatmullRom,
  evaluateSphericalCatmullRomWithTangent,
  offsetSphericalPoint,
  smoothBoundaryCornerPositions,
} from './sources/topology/spherical-smooth'
export {
  computeTerritorySpine,
  sampleSpineGlyphAnchors,
  selectInteriorAnchorRegion,
  SPINE_ELONGATION_THRESHOLD,
} from './sources/topology/territory-spine'
export type {
  SampledSpineGlyphAnchor,
  SampleSpineGlyphOptions,
  TerritoryInput,
} from './sources/topology/territory-spine'
export { BUILTIN_MAP_SOURCE_SCHEMAS } from './sources/types'
export type {
  BuiltinMapSourceId,
  GeoJsonFeature,
  GeoJsonFeatureCollection,
  GeoJsonFeaturePropertyValue,
  GeoJsonGeometry,
  GeoJsonGeometryKind,
  GeoJsonLineStringGeometry,
  GeoJsonMultiLineStringGeometry,
  GeoJsonMultiPolygonGeometry,
  GeoJsonPointGeometry,
  GeoJsonPolygonGeometry,
  GeoJsonSource,
  MapSourceSchema,
  RasterCellSource,
  RasterFieldDescriptor,
  ResolvedMapSource,
  SourceUnavailable,
  TerritorySpineMetadata,
} from './sources/types'

export {
  compileStyleExpression,
  linearRgbToHex,
  linearToSrgbByte,
  parseHexColorToLinearRgb,
  srgbToLinearChannel,
  StyleCompiler,
} from './styles/compiler'
export type {
  CompiledMapStyle,
  CompiledMapStyleLayer,
  CompiledStyleExpression,
  LinearRgbTuple,
  StyleEvaluationInput,
} from './styles/compiler'
export {
  BIOME_CLASS_LABELS_ZH,
  BIOME_PALETTE_HEX,
  BUILTIN_MAP_STYLE_PRESET_LIST,
  BUILTIN_MAP_STYLE_PRESETS,
  CATEGORICAL_GROUP_PALETTE_HEX,
  getBuiltinMapStylePreset,
  HISTORICAL_PARCHMENT_STYLE_PRESET,
  KOPPEN_CLASS_LABELS_ZH,
  KOPPEN_PALETTE_HEX,
  LAND_COVER_LABELS_ZH,
  LAND_COVER_PALETTE_HEX,
  MINIMAL_DARK_STYLE_PRESET,
  MINIMAL_LIGHT_STYLE_PRESET,
  PHYSICAL_RELIEF_STYLE_PRESET,
  SATELLITE_STYLE_PRESET,
  STANDARD_ATLAS_STYLE_PRESET,
} from './styles/presets'
export type { BuiltinMapStylePresetId } from './styles/presets'
export { readStyleBackgroundColor, StyleValidationError } from './styles/spec'
export type {
  CategoricalLegendDescriptor,
  ContinuousLegendDescriptor,
  ExpressionDependencyLevel,
  LegendCategoryItem,
  LegendDescriptor,
  LegendGradientStop,
  MapFontFaceDescriptor,
  MapLayerSlot,
  MapLayerType,
  MapStyleDocument,
  MapStyleLayer,
  MapStyleLayerLegendHint,
  MapViewportMode,
  StyleExpression,
  StylePrimitive,
  StyleTokenValue,
  StyleValue,
} from './styles/spec'

export type { WorldViewState } from './view-state'
