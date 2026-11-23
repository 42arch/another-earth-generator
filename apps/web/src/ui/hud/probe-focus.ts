import { formatContinentDisplayName, formatOceanDisplayName } from '@another-earth/cartography'

/** Raster and interactive fill thematics the probe can read on their own. */
export const THEMATIC_PROBE_IDS = [
  'elevation',
  'dem',
  'plates',
  'continents',
  'temperature',
  'annual-temperature',
  'precipitation',
  'annual-precipitation',
  'wind-speed',
  'annual-wind-speed',
  'ocean-speed',
  'annual-ocean-speed',
  'snow',
  'runoff',
  'basins',
  'koppen',
  'biomes',
  'land-cover',
  'agricultural-potential',
  'deposit-richness',
  'population-density',
  'polity-territory',
  'culture-dominant',
  'religion-dominant',
] as const

export type ThematicProbeId = (typeof THEMATIC_PROBE_IDS)[number]

export const OVERLAY_PROBE_IDS = [
  'rivers',
  'lakes',
  'coastlines',
  'plate-boundaries',
  'wind-arrows',
  'ocean-arrows',
  'labels',
  'graticule',
  'cell-wireframe',
  'polity-borders',
  'transport-routes',
  'settlements',
  'polity-labels',
  'settlement-labels',
] as const

export type OverlayProbeId = (typeof OVERLAY_PROBE_IDS)[number]

export type ProbeFocus
  = | { readonly kind: 'surface' }
    | { readonly kind: 'thematic', readonly id: ThematicProbeId }
    | { readonly kind: 'overlay', readonly id: OverlayProbeId }

export interface ProbeFeatureHit {
  readonly layerId: string
  readonly sourceId: string
}

const THEMATIC_PROBE_ID_SET = new Set<string>(THEMATIC_PROBE_IDS)

const LAYER_FOCUS: Readonly<Record<string, ProbeFocus>> = {
  'thematic-koppen': { kind: 'thematic', id: 'koppen' },
  'thematic-biomes': { kind: 'thematic', id: 'biomes' },
  'thematic-land-cover': { kind: 'thematic', id: 'land-cover' },
  'thematic-plates': { kind: 'thematic', id: 'plates' },
  'thematic-continents': { kind: 'thematic', id: 'continents' },
  'thematic-polity-territory': { kind: 'thematic', id: 'polity-territory' },
  'thematic-culture-dominant': { kind: 'thematic', id: 'culture-dominant' },
  'thematic-religion-dominant': { kind: 'thematic', id: 'religion-dominant' },
  'overlay-river-centerlines': { kind: 'overlay', id: 'rivers' },
  'overlay-river-polygons': { kind: 'overlay', id: 'rivers' },
  'overlay-lake-polygons': { kind: 'overlay', id: 'lakes' },
  'overlay-coastlines': { kind: 'overlay', id: 'coastlines' },
  'overlay-plate-boundaries': { kind: 'overlay', id: 'plate-boundaries' },
  'overlay-graticule': { kind: 'overlay', id: 'graticule' },
  'overlay-wind-arrows': { kind: 'overlay', id: 'wind-arrows' },
  'overlay-ocean-arrows': { kind: 'overlay', id: 'ocean-arrows' },
  'overlay-geographic-labels': { kind: 'overlay', id: 'labels' },
  'overlay-cell-wireframe': { kind: 'overlay', id: 'cell-wireframe' },
  'overlay-polity-territory-hit': { kind: 'thematic', id: 'polity-territory' },
  'overlay-polity-borders': { kind: 'overlay', id: 'polity-borders' },
  'overlay-transport-routes': { kind: 'overlay', id: 'transport-routes' },
  'overlay-settlements': { kind: 'overlay', id: 'settlements' },
  'overlay-polity-labels': { kind: 'overlay', id: 'polity-labels' },
  'overlay-settlement-labels': { kind: 'overlay', id: 'settlement-labels' },
}

const SOURCE_FOCUS: Readonly<Record<string, ProbeFocus>> = {
  'koppen-areas': { kind: 'thematic', id: 'koppen' },
  'biome-areas': { kind: 'thematic', id: 'biomes' },
  'land-cover-areas': { kind: 'thematic', id: 'land-cover' },
  'plate-areas': { kind: 'thematic', id: 'plates' },
  'continent-areas': { kind: 'thematic', id: 'continents' },
  'polity-territory': { kind: 'thematic', id: 'polity-territory' },
  'culture-dominant': { kind: 'thematic', id: 'culture-dominant' },
  'religion-dominant': { kind: 'thematic', id: 'religion-dominant' },
  'river-centerlines': { kind: 'overlay', id: 'rivers' },
  'river-polygons': { kind: 'overlay', id: 'rivers' },
  'lake-polygons': { kind: 'overlay', id: 'lakes' },
  'coastlines': { kind: 'overlay', id: 'coastlines' },
  'plate-boundaries': { kind: 'overlay', id: 'plate-boundaries' },
  'graticule': { kind: 'overlay', id: 'graticule' },
  'geographic-labels': { kind: 'overlay', id: 'labels' },
  'cell-wireframe': { kind: 'overlay', id: 'cell-wireframe' },
  'polity-borders': { kind: 'overlay', id: 'polity-borders' },
  'transport-routes': { kind: 'overlay', id: 'transport-routes' },
  'settlements': { kind: 'overlay', id: 'settlements' },
  'polity-labels': { kind: 'overlay', id: 'polity-labels' },
  'settlement-labels': { kind: 'overlay', id: 'settlement-labels' },
}

const THEMATIC_TITLES: Readonly<Record<ThematicProbeId, string>> = {
  'elevation': '高程',
  'dem': '高程灰度图',
  'plates': '构造板块',
  'continents': '陆海分区',
  'temperature': '月平均气温',
  'annual-temperature': '年平均气温',
  'precipitation': '月降水量',
  'annual-precipitation': '年降水量',
  'wind-speed': '10m 月均风速',
  'annual-wind-speed': '10m 年平均风速',
  'ocean-speed': '表层洋流速度',
  'annual-ocean-speed': '表层洋流年平均速度',
  'snow': '月度积雪水当量',
  'runoff': '年径流深',
  'basins': '水文流域',
  'koppen': 'Köppen 气候带',
  'biomes': '潜在生物群系',
  'land-cover': '自然地表覆盖',
  'agricultural-potential': '农业潜力',
  'deposit-richness': '矿产富集度',
  'population-density': '人口密度',
  'polity-territory': '国家政区',
  'culture-dominant': '主导文化',
  'religion-dominant': '主导宗教',
}

const OVERLAY_TITLES: Readonly<Record<OverlayProbeId, string>> = {
  'rivers': '河网水系',
  'lakes': '静态湖泊',
  'coastlines': '海岸线',
  'plate-boundaries': '板块边界',
  'wind-arrows': '风向箭头',
  'ocean-arrows': '洋流箭头',
  'labels': '大陆与大洋地名',
  'graticule': '经纬网',
  'cell-wireframe': '区域网格',
  'polity-borders': '国家边界线',
  'transport-routes': '交通航路网',
  'settlements': '聚落点位',
  'polity-labels': '国家名称注记',
  'settlement-labels': '聚落名称注记',
}

function isThematicProbeId(id: string): id is ThematicProbeId {
  return THEMATIC_PROBE_ID_SET.has(id)
}

/**
 * The clicked vector or fill wins. A miss falls through to the thematic currently
 * painted under the cursor, then to the base surface.
 */
export function resolveProbeFocus(input: {
  readonly featureHit?: ProbeFeatureHit | null
  readonly activeThematicId?: string | null
}): ProbeFocus {
  const hit = input.featureHit
  if (hit) {
    const fromLayer = LAYER_FOCUS[hit.layerId]
    if (fromLayer)
      return fromLayer
    const fromSource = SOURCE_FOCUS[hit.sourceId]
    if (fromSource)
      return fromSource
  }
  if (input.activeThematicId && isThematicProbeId(input.activeThematicId))
    return { kind: 'thematic', id: input.activeThematicId }
  return { kind: 'surface' }
}

export function probeFocusTitle(focus: ProbeFocus): string {
  if (focus.kind === 'surface')
    return '地表'
  if (focus.kind === 'thematic')
    return THEMATIC_TITLES[focus.id]
  return OVERLAY_TITLES[focus.id]
}

export function probeFocusBadge(focus: ProbeFocus): string {
  if (focus.kind === 'surface')
    return '地表'
  if (focus.kind === 'overlay' && (focus.id === 'graticule' || focus.id === 'cell-wireframe'))
    return '参考'
  if (focus.kind === 'overlay' && focus.id === 'labels')
    return '地名'
  const id = focus.id
  if (
    id === 'elevation' || id === 'dem' || id === 'plates' || id === 'continents' || id === 'plate-boundaries'
  ) {
    return '地质'
  }
  if (
    id === 'temperature' || id === 'annual-temperature'
    || id === 'precipitation' || id === 'annual-precipitation'
    || id === 'wind-speed' || id === 'annual-wind-speed'
    || id === 'ocean-speed' || id === 'annual-ocean-speed'
    || id === 'snow' || id === 'runoff' || id === 'basins'
    || id === 'wind-arrows' || id === 'ocean-arrows'
    || id === 'rivers' || id === 'lakes' || id === 'coastlines'
  ) {
    return '自然'
  }
  if (id === 'koppen' || id === 'biomes' || id === 'land-cover')
    return '生态'
  if (id === 'agricultural-potential' || id === 'deposit-richness')
    return '资源'
  return '文明'
}

const FEATURE_INDEX_PAIR = /^(plate-boundary|polity-border):(-?\d+):(-?\d+)/

export function describePlateBoundary(
  plates: readonly { readonly id: string }[],
  featureId: string,
): readonly [string, string] | null {
  const pair = parseFeatureIndexPair(featureId, 'plate-boundary')
  if (!pair)
    return null
  const label = (index: number) => {
    const id = plates[index]?.id
    return id ? `板块 ${index + 1} · ${id}` : `板块 ${index + 1}`
  }
  return [label(pair.a), label(pair.b)]
}

export function parseFeatureIndexPair(
  featureId: string,
  prefix: 'plate-boundary' | 'polity-border',
): { readonly a: number, readonly b: number } | null {
  const match = FEATURE_INDEX_PAIR.exec(featureId)
  if (!match || match[1] !== prefix)
    return null
  return { a: Number(match[2]), b: Number(match[3]) }
}

export function describeGraticuleFeature(featureId: string): string | null {
  const latitude = /^graticule:lat:(-?\d+(?:\.\d+)?)$/.exec(featureId)
  if (latitude) {
    const degrees = Number(latitude[1])
    if (degrees === 0)
      return '赤道'
    return degrees > 0 ? `${degrees}°N 纬线` : `${Math.abs(degrees)}°S 纬线`
  }
  const longitude = /^graticule:lon:(-?\d+(?:\.\d+)?)$/.exec(featureId)
  if (!longitude)
    return null
  const degrees = Number(longitude[1])
  if (degrees === 0)
    return '本初子午线'
  if (Math.abs(degrees) === 180)
    return '180° 经线'
  return degrees > 0 ? `${degrees}°E 经线` : `${Math.abs(degrees)}°W 经线`
}

export interface GeographicSubject {
  readonly name: string
  readonly areaKm2: number
}

export function findGeographicSubject(
  regions: {
    readonly continents: readonly { readonly id: string, readonly areaKm2: number, readonly name?: string }[]
    readonly oceans: readonly { readonly id: string, readonly areaKm2: number, readonly name?: string }[]
    readonly seas: readonly { readonly id: string, readonly areaKm2: number }[]
  } | null,
  featureId: string,
): GeographicSubject | null {
  if (!regions)
    return null
  const continentIndex = regions.continents.findIndex(item => item.id === featureId)
  if (continentIndex >= 0) {
    const continent = regions.continents[continentIndex]
    return {
      name: formatContinentDisplayName(continent?.name, continentIndex),
      areaKm2: continent?.areaKm2 ?? 0,
    }
  }
  const oceanIndex = regions.oceans.findIndex(item => item.id === featureId)
  if (oceanIndex >= 0) {
    const ocean = regions.oceans[oceanIndex]
    return {
      name: formatOceanDisplayName(ocean?.name, oceanIndex),
      areaKm2: ocean?.areaKm2 ?? 0,
    }
  }
  const seaIndex = regions.seas.findIndex(item => item.id === featureId)
  if (seaIndex >= 0) {
    return {
      name: `海 ${seaIndex + 1}`,
      areaKm2: regions.seas[seaIndex]?.areaKm2 ?? 0,
    }
  }
  return null
}
