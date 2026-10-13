import type { Matrix4 } from 'three'
import type { GeoJsonFeatureCollection } from '@/core/data-source/geojson'
import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { Vector3 } from 'three'
import { computeWorldLabels } from '@/core/data-source/utils/world-labels'
import { computeTangentBasis } from '@/core/mesh/tangent-basis'

export type SettlementTier = 'high' | 'mid' | 'low'

export type SettlementFeatureKind
  = | 'capital'
    | 'port'
    | 'garrison'
    | 'metropolis'
    | 'city'
    | 'town'
    | 'village'

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
  fontSize2D?: number
  fontSize3D?: number
  color?: number
  haloColor?: number
  icon?: {
    right3D: Vector3
    char?: string
    color?: number
    size2D?: number
    size3D?: number
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

function computeSettlementFeatures({ mesh, data, params }: SymbolSourceContext): SymbolFeature[] {
  if (!data.civilization)
    return []

  const features: SymbolFeature[] = []
  const showCities = Boolean(params.appearance.overlays.cities)

  // 1. 识别全部国家首都的聚落 ID
  const capitalSettlementIds = new Set<number>()
  if (data.civilization.polities) {
    for (const polity of data.civilization.polities.polities) {
      if (polity.capitalSettlementId >= 0) {
        capitalSettlementIds.add(polity.capitalSettlementId)
      }
    }
  }

  // 2. 聚落地理分类与局部几何生成
  if (showCities && data.civilization.settlements) {
    for (const settlement of data.civilization.settlements) {
      const region = settlement.region
      if (region < 0 || region >= mesh.numRegions)
        continue

      const isCapital = capitalSettlementIds.has(settlement.id)

      // 空间功能分类 (由客观成因与行政级别决定)
      const reasons = settlement.reasons || []
      const reasonsStr = reasons.join(' ').toLowerCase()
      let featureKind: SettlementFeatureKind = 'village'
      if (isCapital) {
        featureKind = 'capital'
      }
      else if (reasonsStr.includes('port') || reasonsStr.includes('coast') || reasonsStr.includes('strait')) {
        featureKind = 'port'
      }
      else if (reasonsStr.includes('pass') || reasonsStr.includes('choke') || reasonsStr.includes('garrison')) {
        featureKind = 'garrison'
      }
      else if (settlement.rank === 'metropolis') {
        featureKind = 'metropolis'
      }
      else if (settlement.rank === 'city') {
        featureKind = 'city'
      }
      else if (settlement.rank === 'town') {
        featureKind = 'town'
      }

      // 层级判定 (用于底图合批与 LOD 参考)
      let tier: SettlementTier = 'low'
      if (isCapital || settlement.rank === 'metropolis') {
        tier = 'high'
      }
      else if (
        settlement.rank === 'city'
        || featureKind === 'port'
        || featureKind === 'garrison'
      ) {
        tier = 'mid'
      }

      const population = settlement.population ?? 0
      const priority = isCapital
        ? 1000000 + population
        : tier === 'high'
          ? 500000 + population
          : tier === 'mid' ? 100000 + population : population

      const idx = region * 3
      const normal = new Vector3(
        mesh.regionPosition[idx],
        mesh.regionPosition[idx + 1],
        mesh.regionPosition[idx + 2],
      ).normalize()

      const { matrix, right } = computeTangentBasis(normal)
      const lon = mesh.regionLongitude[region]
      const lat = mesh.regionLatitude[region]

      features.push({
        id: settlement.id,
        name: settlement.name,
        properties: {
          name: settlement.name,
          rank: settlement.rank,
          featureKind,
          population,
          isCapital,
          isSacredSite: false,
          tier,
        },
        glyphs: [{
          char: settlement.name,
          region,
          lon,
          lat,
          normal,
          matrix3D: matrix,
          angle2D: 0,
        }],
        curved: false,
        priority,
        tier,
        color: 0xFFFFFF,
        haloColor: 0x000000,
        icon: {
          right3D: right,
        },
      })
    }
  }

  return features
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
  'settlement-labels': computeSettlementFeatures,
}

export const SYMBOL_SOURCE_ADAPTERS: Record<string, SymbolSourceAdapter> = Object.fromEntries(
  Object.entries(SYMBOL_FEATURE_ADAPTERS).map(([id, adapter]) => [id, (context: SymbolSourceContext) => toSource(adapter(context))]),
)
