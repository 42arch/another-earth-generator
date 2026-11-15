import type { MapStyleDocument, MapStyleLayer, StyleTokenValue } from '../spec'
import { linearRgbToHex } from '../compiler'

export type BuiltinMapStylePresetId
  = | 'satellite'
    | 'standard-atlas'
    | 'physical-relief'
    | 'minimal-light'
    | 'minimal-dark'
    | 'historical-parchment'

export const KOPPEN_CLASS_LABELS_ZH: readonly string[] = Object.freeze([
  '海洋',
  '热带雨林 (Af)',
  '热带季风 (Am)',
  '热带冬干稀树草原 (Aw)',
  '热带夏干稀树草原 (As)',
  '热沙漠 (BWh)',
  '冷沙漠 (BWk)',
  '热半干旱草原 (BSh)',
  '冷半干旱草原 (BSk)',
  '炎夏地中海 (Csa)',
  '暖夏地中海 (Csb)',
  '凉夏地中海 (Csc)',
  '冬干炎夏温带 (Cwa)',
  '冬干暖夏温带 (Cwb)',
  '冬干凉夏温带 (Cwc)',
  '湿润炎夏温带 (Cfa)',
  '温带海洋性 (Cfb)',
  '凉夏海洋性 (Cfc)',
  '夏干炎夏大陆性 (Dsa)',
  '夏干暖夏大陆性 (Dsb)',
  '夏干亚寒带 (Dsc)',
  '夏干严寒亚寒带 (Dsd)',
  '冬干炎夏大陆性 (Dwa)',
  '冬干暖夏大陆性 (Dwb)',
  '冬干亚寒带 (Dwc)',
  '冬干严寒亚寒带 (Dwd)',
  '湿润炎夏大陆性 (Dfa)',
  '湿润暖夏大陆性 (Dfb)',
  '湿润亚寒带 (Dfc)',
  '湿润严寒亚寒带 (Dfd)',
  '苔原 (ET)',
  '冰原 (EF)',
])

const KOPPEN_LINEAR_RGB: readonly (readonly [number, number, number])[] = [
  [0.05, 0.18, 0.34],
  [0.04, 0.48, 0.28],
  [0.11, 0.63, 0.32],
  [0.64, 0.78, 0.19],
  [0.75, 0.85, 0.39],
  [0.94, 0.39, 0.17],
  [0.77, 0.33, 0.28],
  [0.96, 0.69, 0.26],
  [0.86, 0.63, 0.40],
  [0.95, 0.77, 0.33],
  [0.93, 0.87, 0.48],
  [0.82, 0.85, 0.62],
  [0.29, 0.65, 0.38],
  [0.44, 0.72, 0.48],
  [0.61, 0.80, 0.61],
  [0.18, 0.67, 0.53],
  [0.36, 0.75, 0.65],
  [0.57, 0.81, 0.73],
  [0.70, 0.50, 0.68],
  [0.63, 0.59, 0.76],
  [0.55, 0.66, 0.80],
  [0.44, 0.59, 0.75],
  [0.44, 0.43, 0.72],
  [0.40, 0.51, 0.78],
  [0.34, 0.58, 0.80],
  [0.27, 0.52, 0.72],
  [0.36, 0.38, 0.69],
  [0.31, 0.45, 0.73],
  [0.25, 0.53, 0.74],
  [0.20, 0.45, 0.65],
  [0.67, 0.76, 0.82],
  [0.90, 0.94, 0.96],
]

export const KOPPEN_PALETTE_HEX: readonly string[] = Object.freeze(
  KOPPEN_LINEAR_RGB.map(c => linearRgbToHex(c)),
)

export const BIOME_CLASS_LABELS_ZH: readonly string[] = Object.freeze([
  '海洋',
  '热带雨林',
  '热带季雨林',
  '稀树草原',
  '热荒漠',
  '温带荒漠',
  '温带草原',
  '地中海灌丛',
  '温带草甸草原',
  '温带落叶阔叶林',
  '温带雨林',
  '泰加针叶林',
  '极地苔原',
  '高山苔原',
  '永久冰盖',
])

const BIOME_LINEAR_RGB: readonly (readonly [number, number, number])[] = [
  [0.035, 0.12, 0.28],
  [0.05, 0.42, 0.18],
  [0.12, 0.58, 0.22],
  [0.68, 0.66, 0.22],
  [0.83, 0.48, 0.22],
  [0.65, 0.48, 0.42],
  [0.72, 0.68, 0.4],
  [0.68, 0.58, 0.28],
  [0.48, 0.62, 0.32],
  [0.18, 0.48, 0.28],
  [0.16, 0.6, 0.48],
  [0.2, 0.42, 0.5],
  [0.56, 0.68, 0.72],
  [0.73, 0.82, 0.78],
  [0.9, 0.94, 0.96],
]

export const BIOME_PALETTE_HEX: readonly string[] = Object.freeze(
  BIOME_LINEAR_RGB.map(c => linearRgbToHex(c)),
)

export const LAND_COVER_LABELS_ZH: readonly string[] = Object.freeze([
  '海洋',
  '冰雪覆盖',
  '森林',
  '稀树草原',
  '荒漠裸地',
  '草地',
  '灌丛',
  '苔原',
])

const LAND_COVER_LINEAR_RGB: readonly (readonly [number, number, number])[] = [
  [0.035, 0.12, 0.28],
  [0.9, 0.94, 0.96],
  [0.142, 0.5, 0.332],
  [0.68, 0.66, 0.22],
  [0.74, 0.48, 0.32],
  [0.6, 0.65, 0.36],
  [0.68, 0.58, 0.28],
  [0.645, 0.75, 0.75],
]

export const LAND_COVER_PALETTE_HEX: readonly string[] = Object.freeze(
  LAND_COVER_LINEAR_RGB.map(c => linearRgbToHex(c)),
)

function buildGoldenAnglePalette(count: number): readonly string[] {
  const result: string[] = []
  for (let i = 0; i < count; i++) {
    const hue = (i * 0.618033988749895) % 1
    const channel = (offset: number) => {
      const k = (offset + hue * 12) % 12
      return 0.63 - 0.38 * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    }
    result.push(linearRgbToHex([channel(0), channel(8), channel(4)]))
  }
  return Object.freeze(result)
}

export const CATEGORICAL_GROUP_PALETTE_HEX: readonly string[] = buildGoldenAnglePalette(64)

const SHARED_THEMATIC_TOKENS: Readonly<Record<string, StyleTokenValue>> = Object.freeze({
  koppenPalette: KOPPEN_PALETTE_HEX,
  biomePalette: BIOME_PALETTE_HEX,
  landCoverPalette: LAND_COVER_PALETTE_HEX,
  groupPalette: CATEGORICAL_GROUP_PALETTE_HEX,
  labelFontFamily: '"PingFang SC", "Noto Sans SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  labelFontWeight: '600',
})

function buildSharedThematicLayers(): readonly MapStyleLayer[] {
  return [
    {
      id: 'thematic-koppen',
      type: 'fill',
      source: 'koppen-areas',
      slot: 'thematic',
      thematicId: 'koppen',
      interactive: true,
      legend: {
        title: 'Köppen 气候带',
        fieldName: 'koppenClass',
        labels: KOPPEN_CLASS_LABELS_ZH,
      },
      paint: {
        'fill-color': ['palette', ['get', 'koppenClass'], ['token', 'koppenPalette'], '#10253f'],
        'fill-opacity': 1,
      },
    },
    {
      id: 'thematic-biomes',
      type: 'fill',
      source: 'biome-areas',
      slot: 'thematic',
      thematicId: 'biomes',
      interactive: true,
      legend: {
        title: '潜在生物群系',
        fieldName: 'biomeIndex',
        labels: BIOME_CLASS_LABELS_ZH,
      },
      paint: {
        'fill-color': ['palette', ['get', 'biomeIndex'], ['token', 'biomePalette'], '#0e1d36'],
        'fill-opacity': 1,
      },
    },
    {
      id: 'thematic-land-cover',
      type: 'fill',
      source: 'land-cover-areas',
      slot: 'thematic',
      thematicId: 'land-cover',
      interactive: true,
      legend: {
        title: '自然地表覆盖',
        fieldName: 'landCoverIndex',
        labels: LAND_COVER_LABELS_ZH,
      },
      paint: {
        'fill-color': ['palette', ['get', 'landCoverIndex'], ['token', 'landCoverPalette'], '#0e1d36'],
        'fill-opacity': 1,
      },
    },
    {
      id: 'thematic-temperature',
      type: 'raster',
      source: 'climate-monthly',
      slot: 'thematic',
      thematicId: 'temperature',
      legend: {
        title: '月平均气温',
        unit: '°C',
        fieldName: 'temperatureC',
      },
      paint: {
        'raster-color': [
          'interpolate',
          ['linear'],
          ['get', 'temperatureC'],
          -30,
          '#2b5cb8',
          -10,
          '#5ea4d8',
          5,
          '#e3eedd',
          20,
          '#f2b659',
          35,
          '#d94325',
        ],
        'raster-opacity': 1,
      },
    },
    {
      id: 'thematic-annual-temperature',
      type: 'raster',
      source: 'world-surface',
      slot: 'thematic',
      thematicId: 'annual-temperature',
      legend: {
        title: '年平均气温',
        unit: '°C',
        fieldName: 'annualTemperatureC',
      },
      paint: {
        'raster-color': [
          'interpolate',
          ['linear'],
          ['get', 'annualTemperatureC'],
          -30,
          '#2b5cb8',
          -10,
          '#5ea4d8',
          5,
          '#e3eedd',
          20,
          '#f2b659',
          35,
          '#d94325',
        ],
        'raster-opacity': 1,
      },
    },
    {
      id: 'thematic-precipitation',
      type: 'raster',
      source: 'climate-monthly',
      slot: 'thematic',
      thematicId: 'precipitation',
      legend: {
        title: '月降水量',
        unit: 'mm/月',
        fieldName: 'precipitationMm',
      },
      paint: {
        'raster-color': [
          'interpolate',
          ['linear'],
          ['get', 'precipitationMm'],
          0,
          '#d7b57d',
          40,
          '#8dc38b',
          120,
          '#3c93a6',
          250,
          '#1f5b9c',
          450,
          '#112e6e',
        ],
        'raster-opacity': 1,
      },
    },
    {
      id: 'thematic-annual-precipitation',
      type: 'raster',
      source: 'world-surface',
      slot: 'thematic',
      thematicId: 'annual-precipitation',
      legend: {
        title: '年总降水量',
        unit: 'mm/年',
        fieldName: 'annualPrecipitationMm',
      },
      paint: {
        'raster-color': [
          'interpolate',
          ['linear'],
          ['get', 'annualPrecipitationMm'],
          0,
          '#d7b57d',
          250,
          '#8dc38b',
          800,
          '#3c93a6',
          1600,
          '#1f5b9c',
          3000,
          '#112e6e',
        ],
        'raster-opacity': 1,
      },
    },
    {
      id: 'thematic-elevation',
      type: 'raster',
      source: 'world-surface',
      slot: 'thematic',
      thematicId: 'elevation',
      legend: {
        title: '高程',
        unit: 'km',
        fieldName: 'elevationKm',
      },
      paint: {
        'raster-color': [
          'case',
          ['==', ['get', 'landMask'], 0],
          [
            'interpolate',
            ['linear'],
            ['get', 'elevationKm'],
            -10,
            '#061a33',
            -4,
            '#174d81',
            0,
            '#367eae',
          ],
          [
            'interpolate',
            ['linear'],
            ['get', 'elevationKm'],
            0,
            '#075537',
            1,
            '#27853c',
            2.5,
            '#9bc75a',
            3.5,
            '#efd18c',
            5,
            '#ba4033',
            6.5,
            '#a72f2f',
          ],
        ],
        'raster-opacity': 1,
      },
    },
    {
      id: 'thematic-plates',
      type: 'fill',
      source: 'plate-areas',
      slot: 'thematic',
      thematicId: 'plates',
      interactive: true,
      legend: {
        title: '构造板块',
        fieldName: 'groupIndex',
      },
      paint: {
        'fill-color': ['palette', ['get', 'groupIndex'], ['token', 'groupPalette'], '#334155'],
        'fill-opacity': 1,
      },
    },
    {
      id: 'thematic-continents',
      type: 'fill',
      source: 'continent-areas',
      slot: 'thematic',
      thematicId: 'continents',
      interactive: true,
      legend: {
        title: '陆海分区',
        fieldName: 'continentIndex',
      },
      paint: {
        'fill-color': [
          'case',
          ['>=', ['get', 'continentIndex'], 0],
          ['palette', ['get', 'continentIndex'], ['token', 'groupPalette'], '#2d5a42'],
          ['>=', ['get', 'oceanIndex'], 0],
          ['palette', ['get', 'oceanIndex'], ['#12385b', '#184b73', '#1f5e89', '#164366', '#256b96'], '#12385b'],
          ['palette', ['get', 'seaIndex'], ['#28667a', '#31798e', '#3a8ba0', '#2b7085'], '#1d4e66'],
        ],
        'fill-opacity': 1,
      },
    },
    {
      id: 'thematic-runoff',
      type: 'raster',
      source: 'world-surface',
      slot: 'thematic',
      thematicId: 'runoff',
      legend: {
        title: '年径流深',
        unit: 'mm/年',
        fieldName: 'annualRunoffMm',
      },
      paint: {
        'raster-color': [
          'case',
          ['==', ['get', 'landMask'], 0],
          '#0d2238',
          [
            'interpolate',
            ['linear'],
            ['get', 'annualRunoffMm'],
            0,
            '#d97854',
            100,
            '#97b87a',
            400,
            '#3a9ab0',
            1200,
            '#1d5d99',
            2400,
            '#0d3170',
          ],
        ],
        'raster-opacity': 1,
      },
    },
    {
      id: 'thematic-snow',
      type: 'raster',
      source: 'climate-monthly',
      slot: 'thematic',
      thematicId: 'snow',
      legend: {
        title: '月度积雪水当量',
        unit: 'mm',
        fieldName: 'snowWaterEquivalentMm',
      },
      paint: {
        'raster-color': [
          'case',
          ['==', ['get', 'landMask'], 0],
          '#0d2238',
          [
            'interpolate',
            ['linear'],
            ['get', 'snowWaterEquivalentMm'],
            0,
            '#2e3f52',
            15,
            '#5b7d9c',
            80,
            '#8fb6d6',
            250,
            '#c9e2f5',
            600,
            '#f4f9fc',
          ],
        ],
        'raster-opacity': 1,
      },
    },
    {
      id: 'thematic-basins',
      type: 'raster',
      source: 'world-surface',
      slot: 'thematic',
      thematicId: 'basins',
      legend: {
        title: '水文流域',
        fieldName: 'basinIndex',
        noDataLabel: '海洋或非流域',
        noDataColor: '#0e243b',
      },
      paint: {
        'raster-color': ['palette', ['get', 'basinIndex'], ['token', 'groupPalette'], '#0e243b'],
        'raster-opacity': 1,
      },
    },
    {
      id: 'thematic-wind-speed',
      type: 'raster',
      source: 'climate-monthly',
      slot: 'thematic',
      thematicId: 'wind-speed',
      legend: {
        title: '10m 月均风速',
        unit: 'm/s',
        fieldName: 'windSpeedMps',
        noDataLabel: '无环流数据',
        noDataColor: '#374151',
      },
      paint: {
        'raster-color': [
          'case',
          ['!', ['has', 'windSpeedMps']],
          '#374151',
          [
            'step',
            ['get', 'windSpeedMps'],
            '#16324f',
            1,
            '#18537a',
            2,
            '#1b7885',
            4,
            '#3b9e6e',
            6,
            '#9ebd46',
            8,
            '#f28f27',
          ],
        ],
        'raster-opacity': 1,
      },
    },
    {
      id: 'thematic-ocean-speed',
      type: 'raster',
      source: 'climate-monthly',
      slot: 'thematic',
      thematicId: 'ocean-speed',
      legend: {
        title: '表层洋流速度',
        unit: 'm/s',
        fieldName: 'oceanSpeedMps',
        noDataLabel: '陆地或缺测海域',
        noDataColor: '#475569',
      },
      paint: {
        'raster-color': [
          'case',
          ['!=', ['get', 'landMask'], 0],
          '#8b9968',
          ['!', ['has', 'oceanSpeedMps']],
          '#475569',
          [
            'step',
            ['get', 'oceanSpeedMps'],
            '#16324f',
            0.02,
            '#18537a',
            0.05,
            '#1b7885',
            0.1,
            '#3b9e6e',
            0.15,
            '#9ebd46',
            0.2,
            '#f28f27',
          ],
        ],
        'raster-opacity': 1,
      },
    },
  ]
}

function buildSharedOverlayLayers(): readonly MapStyleLayer[] {
  return [
    {
      id: 'overlay-coastlines',
      type: 'line',
      source: 'coastlines',
      slot: 'overlay',
      overlayId: 'coastlines',
      layout: {
        'visibility': 'visible',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': ['token', 'coastline'],
        'line-opacity': 0.88,
        'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1.0, 6, 1.6, 12, 2.2],
      },
    },
    {
      id: 'overlay-river-centerlines',
      type: 'line',
      source: 'river-centerlines',
      slot: 'overlay',
      overlayId: 'rivers',
      interactive: true,
      filter: ['>=', ['get', 'strahlerOrder'], 2],
      layout: {
        'visibility': 'visible',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': ['token', 'waterBody'],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.36, 4, 0.22, 8, 0.08],
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0,
          ['step', ['get', 'strahlerOrder'], 0.2, 3, 0.35, 5, 0.55],
          8,
          ['step', ['get', 'strahlerOrder'], 0.3, 3, 0.5, 5, 0.8],
        ],
      },
    },
    {
      id: 'overlay-river-polygons',
      type: 'fill',
      source: 'river-polygons',
      slot: 'overlay',
      overlayId: 'rivers',
      interactive: true,
      filter: ['>=', ['get', 'strahlerOrder'], 2],
      layout: {
        visibility: 'visible',
      },
      paint: {
        'fill-color': ['token', 'waterBody'],
        'fill-opacity': 1,
      },
    },
    {
      id: 'overlay-lake-polygons',
      type: 'fill',
      source: 'lake-polygons',
      slot: 'overlay',
      overlayId: 'lakes',
      interactive: true,
      layout: {
        visibility: 'visible',
      },
      paint: {
        'fill-color': ['token', 'waterBody'],
        'fill-opacity': 1,
      },
    },
    {
      id: 'overlay-plate-boundaries',
      type: 'line',
      source: 'plate-boundaries',
      slot: 'overlay',
      overlayId: 'plate-boundaries',
      layout: {
        'visibility': 'visible',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': ['token', 'plateBoundary'],
        'line-opacity': 0.85,
        'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1.2, 6, 1.8, 12, 2.4],
        'line-dasharray': [4, 2.5],
      },
    },
    {
      id: 'overlay-graticule',
      type: 'line',
      source: 'graticule',
      slot: 'overlay',
      overlayId: 'graticule',
      layout: {
        visibility: 'visible',
      },
      paint: {
        'line-color': ['token', 'graticule'],
        'line-opacity': [
          'match',
          ['get', 'kind'],
          ['equator', 'prime-meridian', 'antimeridian'],
          0.52,
          0.28,
        ],
        'line-width': [
          'match',
          ['get', 'kind'],
          ['equator', 'prime-meridian', 'antimeridian'],
          1.35,
          0.85,
        ],
        'line-dasharray': [
          'match',
          ['get', 'kind'],
          'equator',
          [1, 0],
          [3, 3],
        ],
      },
    },
    {
      id: 'overlay-wind-arrows',
      type: 'line',
      source: 'circulation-vectors',
      slot: 'overlay',
      overlayId: 'wind-arrows',
      filter: ['==', ['get', 'kind'], 'wind'],
      layout: {
        'visibility': 'visible',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': ['token', 'windArrow'],
        'line-opacity': 0.85,
        'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1.1, 8, 1.6],
      },
    },
    {
      id: 'overlay-ocean-arrows',
      type: 'line',
      source: 'circulation-vectors',
      slot: 'overlay',
      overlayId: 'ocean-arrows',
      filter: ['==', ['get', 'kind'], 'ocean'],
      layout: {
        'visibility': 'visible',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': [
          'interpolate',
          ['linear'],
          ['get', 'warmth'],
          -1,
          '#2166ac',
          0,
          '#f7f7f7',
          1,
          '#b2182b',
        ],
        'line-opacity': 0.9,
        'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1.2, 8, 1.75],
      },
    },
    {
      id: 'overlay-geographic-labels',
      type: 'symbol',
      source: 'geographic-labels',
      slot: 'overlay',
      overlayId: 'geographic-labels',
      layout: {
        'visibility': 'visible',
        'text-field': ['get', 'displayName'],
        'text-font': ['token', 'labelFontFamily'],
        'text-weight': ['token', 'labelFontWeight'],
        'symbol-placement': [
          'case',
          ['==', ['get', 'curved'], true],
          'spine',
          'point',
        ],
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0,
          ['match', ['get', 'kind'], 'continent', 15, 13],
          6,
          ['match', ['get', 'kind'], 'continent', 22, 18],
        ],
      },
      paint: {
        'text-color': [
          'match',
          ['get', 'kind'],
          'continent',
          ['token', 'continentLabel'],
          ['token', 'oceanLabel'],
        ],
        'text-halo-color': ['token', 'labelHalo'],
        'text-halo-width': 1.8,
        'text-opacity': 0.96,
      },
    },
    {
      id: 'overlay-cell-wireframe',
      type: 'line',
      source: 'cell-wireframe',
      slot: 'overlay',
      overlayId: 'cell-wireframe',
      layout: {
        visibility: 'visible',
      },
      paint: {
        'line-color': ['token', 'graticule'],
        'line-opacity': 0.25,
        'line-width': 0.75,
      },
    },
  ]
}

const SATELLITE_GLOBE_EFFECTS = Object.freeze({ atmosphere: true, dayNight: true })
const ATLAS_GLOBE_EFFECTS = Object.freeze({ atmosphere: false, dayNight: false })

const SATELLITE_DEFAULT_LAYERS = ['world-surface', 'rivers', 'lakes', 'labels'] as const
const STANDARD_ATLAS_DEFAULT_LAYERS = ['world-surface', 'rivers', 'lakes', 'coastlines', 'labels'] as const
const PHYSICAL_RELIEF_DEFAULT_LAYERS = ['world-surface', 'rivers', 'lakes'] as const
const MINIMAL_DEFAULT_LAYERS = ['world-surface'] as const
const PARCHMENT_DEFAULT_LAYERS = ['world-surface', 'coastlines', 'labels'] as const

function composePresetLayers(
  baseLayers: readonly MapStyleLayer[],
): readonly MapStyleLayer[] {
  return [
    ...baseLayers,
    ...buildSharedThematicLayers(),
    ...buildSharedOverlayLayers(),
  ]
}

export const SATELLITE_STYLE_PRESET: MapStyleDocument = Object.freeze({
  version: 1,
  id: 'satellite',
  name: '仿真卫星',
  description: '地表微纹理、浅海过渡、雪线裸岩混合与高程晕渲的仿真卫星底图',
  defaultEnabledLayerIds: SATELLITE_DEFAULT_LAYERS,
  defaultGlobeEffects: SATELLITE_GLOBE_EFFECTS,
  tokens: {
    ...SHARED_THEMATIC_TOKENS,
    background: '#071b34',
    oceanDeep: '#091f3a',
    oceanShallow: '#1b6478',
    landBase: '#4c6b3c',
    coastline: '#203c52',
    waterBody: '#6c9fb5',
    plateBoundary: '#f59e0b',
    graticule: '#94a3b8',
    windArrow: '#a9fff1',
    continentLabel: '#f8fafc',
    oceanLabel: '#bae6fd',
    labelHalo: '#0f172a',
  },
  layers: composePresetLayers([
    {
      id: 'base-satellite-surface',
      type: 'raster',
      source: 'world-surface',
      slot: 'base',
      legend: {
        title: '仿真卫星地表',
        fieldName: 'elevationKm',
        unit: 'km',
      },
      layout: {
        'visibility': 'visible',
        'raster-mode': 'satellite',
      },
      paint: {
        'raster-color': [
          'case',
          ['==', ['get', 'landMask'], 0],
          [
            'interpolate',
            ['linear'],
            ['get', 'elevationKm'],
            -8,
            '#071b34',
            -1,
            '#103d63',
            0,
            '#1f6d7d',
          ],
          [
            'interpolate',
            ['linear'],
            ['get', 'elevationKm'],
            0,
            '#3d6234',
            1.5,
            '#6c7c43',
            3.2,
            '#8c7c62',
            5.2,
            '#e6edf2',
          ],
        ],
        'raster-opacity': 1,
        'raster-hillshade': 1,
      },
    },
  ]),
})

export const STANDARD_ATLAS_STYLE_PRESET: MapStyleDocument = Object.freeze({
  version: 1,
  id: 'standard-atlas',
  name: '标准地图集',
  description: '柔和陆地分级色、清新浅蓝海洋、海岸细描边与河湖一体水系',
  defaultEnabledLayerIds: STANDARD_ATLAS_DEFAULT_LAYERS,
  defaultGlobeEffects: ATLAS_GLOBE_EFFECTS,
  tokens: {
    ...SHARED_THEMATIC_TOKENS,
    background: '#5ca8d1',
    oceanDeep: '#76bce0',
    oceanShallow: '#9ad3ee',
    landLow: '#d9ebd0',
    landMid: '#e8e2be',
    landHigh: '#d8c5a5',
    coastline: '#3b7594',
    waterBody: '#4b92b8',
    plateBoundary: '#e11d48',
    graticule: '#64748b',
    windArrow: '#0f766e',
    continentLabel: '#1e293b',
    oceanLabel: '#1d4ed8',
    labelHalo: '#f8fafc',
  },
  layers: composePresetLayers([
    {
      id: 'base-atlas-surface',
      type: 'raster',
      source: 'world-surface',
      slot: 'base',
      legend: {
        title: '标准地图高程',
        fieldName: 'elevationKm',
        unit: 'km',
      },
      paint: {
        'raster-color': [
          'case',
          ['==', ['get', 'landMask'], 0],
          [
            'interpolate',
            ['linear'],
            ['get', 'elevationKm'],
            -8,
            '#5ca8d1',
            -1.5,
            '#7ec0e3',
            0,
            '#a2d8f2',
          ],
          [
            'interpolate',
            ['linear'],
            ['get', 'elevationKm'],
            0,
            '#d4e9c9',
            1.2,
            '#e5e4be',
            2.8,
            '#dfcba6',
            5.0,
            '#cab39b',
          ],
        ],
        'raster-opacity': 1,
        'raster-hillshade': 0.35,
      },
    },
    {
      id: 'base-atlas-land-polygons',
      type: 'fill',
      source: 'land-areas',
      slot: 'base',
      paint: {
        'fill-color': ['token', 'landLow'],
        'fill-opacity': 0.22,
      },
    },
  ]),
})

export const PHYSICAL_RELIEF_STYLE_PRESET: MapStyleDocument = Object.freeze({
  version: 1,
  id: 'physical-relief',
  name: '自然地理地形图',
  description: '清晰海深与陆高阶梯色带、增强法线晕渲与流域水系突出',
  defaultEnabledLayerIds: PHYSICAL_RELIEF_DEFAULT_LAYERS,
  defaultGlobeEffects: ATLAS_GLOBE_EFFECTS,
  tokens: {
    ...SHARED_THEMATIC_TOKENS,
    background: '#061a33',
    coastline: '#1b4965',
    waterBody: '#2b7bba',
    plateBoundary: '#dc2626',
    graticule: '#475569',
    windArrow: '#0284c7',
    continentLabel: '#0f172a',
    oceanLabel: '#0c4a6e',
    labelHalo: '#f1f5f9',
  },
  layers: composePresetLayers([
    {
      id: 'base-physical-relief',
      type: 'raster',
      source: 'world-surface',
      slot: 'base',
      legend: {
        title: '自然地理分层设色',
        fieldName: 'elevationKm',
        unit: 'km',
      },
      paint: {
        'raster-color': [
          'case',
          ['==', ['get', 'landMask'], 0],
          [
            'interpolate',
            ['linear'],
            ['get', 'elevationKm'],
            -10,
            '#061a33',
            -4,
            '#174d81',
            -0.5,
            '#367eae',
            0,
            '#5aa4cf',
          ],
          [
            'interpolate',
            ['linear'],
            ['get', 'elevationKm'],
            0,
            '#1a6b44',
            0.8,
            '#46964c',
            2.0,
            '#a6c963',
            3.2,
            '#efd18c',
            4.8,
            '#c45943',
            6.5,
            '#f2ece9',
          ],
        ],
        'raster-opacity': 1,
        'raster-hillshade': 0.85,
      },
    },
  ]),
})

export const MINIMAL_LIGHT_STYLE_PRESET: MapStyleDocument = Object.freeze({
  version: 1,
  id: 'minimal-light',
  name: '极简明亮底图',
  description: '低饱和暖白陆地与淡灰蓝海洋，专为高对比度叠加科学专题而设计',
  defaultEnabledLayerIds: MINIMAL_DEFAULT_LAYERS,
  defaultGlobeEffects: ATLAS_GLOBE_EFFECTS,
  tokens: {
    ...SHARED_THEMATIC_TOKENS,
    background: '#dce6ef',
    ocean: '#dce6ef',
    land: '#f7f6f2',
    coastline: '#94a3b8',
    waterBody: '#6ba3c7',
    plateBoundary: '#64748b',
    graticule: '#94a3b8',
    windArrow: '#0e7490',
    continentLabel: '#334155',
    oceanLabel: '#475569',
    labelHalo: '#ffffff',
  },
  layers: composePresetLayers([
    {
      id: 'base-minimal-light-surface',
      type: 'raster',
      source: 'world-surface',
      slot: 'base',
      legend: {
        title: '极简明亮海陆底图',
        fieldName: 'landMask',
        labels: ['海洋', '陆地'],
      },
      paint: {
        'raster-color': [
          'match',
          ['get', 'landMask'],
          0,
          ['token', 'ocean'],
          1,
          ['token', 'land'],
          ['token', 'ocean'],
        ],
        'raster-opacity': 1,
        'raster-hillshade': 0.15,
      },
    },
    {
      id: 'base-minimal-light-land',
      type: 'fill',
      source: 'land-areas',
      slot: 'base',
      paint: {
        'fill-color': ['token', 'land'],
        'fill-opacity': 1,
      },
    },
  ]),
})

export const MINIMAL_DARK_STYLE_PRESET: MapStyleDocument = Object.freeze({
  version: 1,
  id: 'minimal-dark',
  name: '极简暗色底图',
  description: '深岩灰陆地与深海蓝底色，契合暗色 HUD 工作台及风场/洋流高亮展示',
  defaultEnabledLayerIds: MINIMAL_DEFAULT_LAYERS,
  defaultGlobeEffects: ATLAS_GLOBE_EFFECTS,
  tokens: {
    ...SHARED_THEMATIC_TOKENS,
    background: '#0f172a',
    ocean: '#0f172a',
    land: '#1e293b',
    coastline: '#475569',
    waterBody: '#38bdf8',
    plateBoundary: '#94a3b8',
    graticule: '#334155',
    windArrow: '#5eead4',
    continentLabel: '#e2e8f0',
    oceanLabel: '#93c5fd',
    labelHalo: '#090d16',
  },
  layers: composePresetLayers([
    {
      id: 'base-minimal-dark-surface',
      type: 'raster',
      source: 'world-surface',
      slot: 'base',
      legend: {
        title: '极简暗色海陆底图',
        fieldName: 'landMask',
        labels: ['海洋', '陆地'],
      },
      paint: {
        'raster-color': [
          'match',
          ['get', 'landMask'],
          0,
          ['token', 'ocean'],
          1,
          ['token', 'land'],
          ['token', 'ocean'],
        ],
        'raster-opacity': 1,
        'raster-hillshade': 0.2,
      },
    },
    {
      id: 'base-minimal-dark-land',
      type: 'fill',
      source: 'land-areas',
      slot: 'base',
      paint: {
        'fill-color': ['token', 'land'],
        'fill-opacity': 1,
      },
    },
  ]),
})

export const HISTORICAL_PARCHMENT_STYLE_PRESET: MapStyleDocument = Object.freeze({
  version: 1,
  id: 'historical-parchment',
  name: '古典羊皮纸风格',
  description: '暖羊皮纸色调、墨棕海岸线与古典字色',
  defaultEnabledLayerIds: PARCHMENT_DEFAULT_LAYERS,
  defaultGlobeEffects: ATLAS_GLOBE_EFFECTS,
  tokens: {
    ...SHARED_THEMATIC_TOKENS,
    background: '#c8bc9e',
    oceanDeep: '#c8bc9e',
    oceanShallow: '#d8ceb4',
    landLow: '#e8dec3',
    landHigh: '#cbb894',
    coastline: '#5c4328',
    waterBody: '#6e7f78',
    plateBoundary: '#7c2d12',
    graticule: '#857153',
    windArrow: '#5c4328',
    continentLabel: '#3b2816',
    oceanLabel: '#594833',
    labelHalo: '#efe6cf',
    labelFontFamily: '"LXGW WenKai", "Kaiti SC", "STKaiti", "Songti SC", "Noto Serif SC", serif',
    labelFontWeight: '600',
  },
  layers: composePresetLayers([
    {
      id: 'base-parchment-surface',
      type: 'raster',
      source: 'world-surface',
      slot: 'base',
      legend: {
        title: '古典羊皮纸高程',
        fieldName: 'elevationKm',
        unit: 'km',
      },
      paint: {
        'raster-color': [
          'case',
          ['==', ['get', 'landMask'], 0],
          [
            'interpolate',
            ['linear'],
            ['get', 'elevationKm'],
            -8,
            '#bfb191',
            0,
            '#d8ceb4',
          ],
          [
            'interpolate',
            ['linear'],
            ['get', 'elevationKm'],
            0,
            '#e8dec3',
            2.5,
            '#d8c8a5',
            5.5,
            '#bfa682',
          ],
        ],
        'raster-opacity': 1,
        'raster-hillshade': 0.45,
      },
    },
    {
      id: 'base-parchment-land',
      type: 'fill',
      source: 'land-areas',
      slot: 'base',
      paint: {
        'fill-color': ['token', 'landLow'],
        'fill-opacity': 0.35,
      },
    },
  ]),
})

export const BUILTIN_MAP_STYLE_PRESETS: Readonly<Record<BuiltinMapStylePresetId, MapStyleDocument>> = Object.freeze({
  'satellite': SATELLITE_STYLE_PRESET,
  'standard-atlas': STANDARD_ATLAS_STYLE_PRESET,
  'physical-relief': PHYSICAL_RELIEF_STYLE_PRESET,
  'minimal-light': MINIMAL_LIGHT_STYLE_PRESET,
  'minimal-dark': MINIMAL_DARK_STYLE_PRESET,
  'historical-parchment': HISTORICAL_PARCHMENT_STYLE_PRESET,
})

export const BUILTIN_MAP_STYLE_PRESET_LIST: readonly MapStyleDocument[] = Object.freeze([
  SATELLITE_STYLE_PRESET,
  STANDARD_ATLAS_STYLE_PRESET,
  PHYSICAL_RELIEF_STYLE_PRESET,
  MINIMAL_LIGHT_STYLE_PRESET,
  MINIMAL_DARK_STYLE_PRESET,
  HISTORICAL_PARCHMENT_STYLE_PRESET,
])

export function getBuiltinMapStylePreset(styleId: string): MapStyleDocument {
  return (BUILTIN_MAP_STYLE_PRESETS as Readonly<Record<string, MapStyleDocument>>)[styleId]
    ?? SATELLITE_STYLE_PRESET
}
