import type { Matrix4, Vector3 } from 'three'
import type { GeoJsonFeatureCollection } from '@/core/data-source/geojson'
import type SphericalMesh from '@/core/mesh/mesh'
import type { SettlementTier } from '@/core/rendering/shared/settlement-label-data'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { computeWorldLabels } from '@/core/rendering/shared/label-data'
import { computeSettlementLabels } from '@/core/rendering/shared/settlement-label-data'
import { getCartographicStyle } from '@/core/rendering/styles/cartographic-styles'

export interface SymbolGlyph {
  char: string
  region: number
  lon: number
  lat: number
  normal: Vector3
  matrix3D: Matrix4
  angle2D: number
}

export interface SymbolFeature {
  id: string | number
  name: string
  properties: Record<string, unknown>
  glyphs: SymbolGlyph[]
  curved: boolean
  offsetUpRatio?: number
  priority: number
  tier?: SettlementTier
  mapMaxCameraZoom?: number
  fontSize2D: number
  fontSize3D: number
  color: number
  haloColor: number
  icon?: {
    char: string
    color: number
    size2D: number
    size3D: number
    right3D: Vector3
  }
}

export interface SymbolSourceContext {
  mesh: SphericalMesh
  data: WorldSimulationState
  params: WorldConfig
}

export interface SymbolSourceResult {
  data: GeoJsonFeatureCollection
  layout: Map<string | number, SymbolFeature>
}

export type SymbolSourceAdapter = (context: SymbolSourceContext) => SymbolSourceResult

function toSource(features: SymbolFeature[]): SymbolSourceResult {
  return {
    data: {
      type: 'FeatureCollection',
      features: features.filter(feature => feature.glyphs.length > 0).map((feature) => {
        const anchor = feature.glyphs[Math.floor(feature.glyphs.length / 2)]
        return {
          type: 'Feature' as const,
          id: feature.id,
          geometry: { type: 'Point' as const, coordinates: [anchor.lon * 180 / Math.PI, anchor.lat * 180 / Math.PI] as [number, number] },
          properties: { ...feature.properties },
        }
      }),
    },
    layout: new Map(features.map(feature => [feature.id, feature])),
  }
}

const worldLabelCache = new WeakMap<WorldConfig, ReturnType<typeof computeWorldLabels>>()
function worldLabels({ mesh, data, params }: SymbolSourceContext) {
  let labels = worldLabelCache.get(params)
  if (!labels) {
    labels = computeWorldLabels(mesh, data, params)
    worldLabelCache.set(params, labels)
  }
  return labels
}

const SYMBOL_FEATURE_ADAPTERS: Record<string, (context: SymbolSourceContext) => SymbolFeature[]> = {
  'polity-labels': context => worldLabels(context)
    .filter(item => item.type === 'polity')
    .map(item => ({
      id: item.id,
      name: item.name,
      properties: { name: item.name, type: item.type, population: item.population ?? 0 },
      glyphs: item.glyphs,
      curved: item.isCurved,
      offsetUpRatio: item.offsetUpRatio,
      priority: item.population ?? 1000,
      mapMaxCameraZoom: 6.5,
      fontSize2D: item.fontSize * 0.026,
      fontSize3D: item.fontSize,
      color: item.color,
      haloColor: item.outlineColor,
    })),
  'civilization-labels': context => worldLabels(context)
    .filter(item => item.type !== 'polity')
    .map(item => ({
      id: item.id,
      name: item.name,
      properties: { name: item.name, type: item.type, population: item.population ?? 0 },
      glyphs: item.glyphs,
      curved: item.isCurved,
      offsetUpRatio: item.offsetUpRatio,
      priority: item.population ?? 1000,
      mapMaxCameraZoom: 6.5,
      fontSize2D: item.fontSize * 0.026,
      fontSize3D: item.fontSize,
      color: item.color,
      haloColor: item.outlineColor,
    })),
  'settlement-labels': ({ mesh, data, params }) => computeSettlementLabels(mesh, data, params)
    .map((item) => {
      const population = item.isSacredSite ? 0 : data.civilization?.settlements[item.id]?.population ?? 0
      const priority = item.isCapital
        ? 1000000 + population
        : item.isSacredSite
          ? 400000
          : item.tier === 'high'
            ? 500000 + population
            : item.tier === 'mid' ? 100000 + population : population
      return {
        id: item.id,
        name: item.name,
        properties: {
          name: item.name,
          rank: item.rank,
          population,
          isCapital: item.isCapital,
          isSacredSite: Boolean(item.isSacredSite),
        },
        glyphs: [{
          char: item.name,
          region: item.region,
          lon: item.lon,
          lat: item.lat,
          normal: item.normal,
          matrix3D: item.matrix3D,
          angle2D: 0,
        }],
        curved: false,
        priority,
        tier: item.tier,
        fontSize2D: item.fontSize2D,
        fontSize3D: item.fontSize3D,
        color: item.nameColor,
        haloColor: getCartographicStyle(params.appearance.mapStyle).settlementHalo,
        icon: {
          char: item.iconChar,
          color: item.iconColor,
          size2D: item.iconSize2D,
          size3D: item.iconSize3D,
          right3D: item.right3D,
        },
      }
    }),
}

export const SYMBOL_SOURCE_ADAPTERS: Record<string, SymbolSourceAdapter> = Object.fromEntries(
  Object.entries(SYMBOL_FEATURE_ADAPTERS).map(([id, adapter]) => [id, (context: SymbolSourceContext) => toSource(adapter(context))]),
)
