import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { Matrix4, Vector3 } from 'three'
import { getMakiGlyph, getSettlementMakiIcon, Maki } from '@/core/rendering/shared/maki-icons'

export type SettlementTier = 'high' | 'mid' | 'low'

export interface SettlementLabelItem {
  id: number
  region: number
  name: string
  tier: SettlementTier
  rank?: 'village' | 'town' | 'city' | 'metropolis'
  isCapital: boolean
  isSacredSite?: boolean
  lon: number
  lat: number
  normal: Vector3
  matrix3D: Matrix4
  right3D: Vector3
  iconChar: string
  iconColor: number
  nameColor: number
  fontSize3D: number
  iconSize3D: number
  fontSize2D: number
  iconSize2D: number
}

/**
 * 构造切平面的正交旋转基底：
 * X = right (向东正向阅读方向), Y = up (向北上方), Z = normal (球心外向法线)
 */
function computeBasisMatrix(normal: Vector3): { matrix: Matrix4, right: Vector3, up: Vector3 } {
  const northRef = new Vector3(0, 1, 0)
  let up = northRef.clone().sub(normal.clone().multiplyScalar(normal.dot(northRef)))
  if (up.lengthSq() < 1e-6) {
    const poleFallback = new Vector3(0, 0, -Math.sign(normal.y || 1))
    up = poleFallback.sub(normal.clone().multiplyScalar(normal.dot(poleFallback)))
  }
  up.normalize()
  const right = new Vector3().crossVectors(up, normal).normalize()
  up.crossVectors(normal, right).normalize()

  const matrix = new Matrix4().makeBasis(right, up, normal)
  return { matrix, right, up }
}

/**
 * 提取全球聚落与宗教圣地的矢量图标与名称标牌数据
 */
export function computeSettlementLabels(
  mesh: SphericalMesh,
  data: WorldSimulationState,
  params: WorldConfig,
): SettlementLabelItem[] {
  if (!data.society)
    return []

  const items: SettlementLabelItem[] = []
  const showCities = Boolean(params.appearance.overlays.cities)
  const showSacredSites = Boolean(params.appearance.overlays['sacred-sites'])

  // 1. 识别全部国家首都的聚落 ID
  const capitalSettlementIds = new Set<number>()
  if (data.society.polities) {
    for (const polity of data.society.polities.polities) {
      if (polity.capitalSettlementId >= 0) {
        capitalSettlementIds.add(polity.capitalSettlementId)
      }
    }
  }

  // 2. 聚落标牌生成
  if (showCities && data.society.settlements) {
    for (const settlement of data.society.settlements) {
      const region = settlement.region
      if (region < 0 || region >= mesh.numRegions)
        continue

      const isCapital = capitalSettlementIds.has(settlement.id)
      const iconInfo = getSettlementMakiIcon(settlement, isCapital)

      // 分级判定：
      // High Tier: 国家首都 或 区域大都会 (LOD0 全球远景可见)
      // Mid Tier: 主要城市、重要港口、关隘要塞 (LOD1 洲际中景可见)
      // Low Tier: 普通城镇、村庄营寨 (LOD2 局域特写可见)
      let tier: SettlementTier = 'low'
      if (isCapital || settlement.rank === 'metropolis') {
        tier = 'high'
      }
      else if (
        settlement.rank === 'city'
        || iconInfo.icon === Maki.Harbor
        || iconInfo.icon === Maki.Castle
      ) {
        tier = 'mid'
      }

      const idx = region * 3
      const normal = new Vector3(
        mesh.regionPosition[idx],
        mesh.regionPosition[idx + 1],
        mesh.regionPosition[idx + 2],
      ).normalize()

      const { matrix, right } = computeBasisMatrix(normal)
      const lon = mesh.regionLongitude[region]
      const lat = mesh.regionLatitude[region]

      // 字号梯级与配色
      let fontSize3D = 0.95
      let iconSize3D = 1.05
      let fontSize2D = 0.038
      let iconSize2D = 0.046
      let nameColor = 0xE2E8F0

      if (tier === 'high') {
        fontSize3D = isCapital ? 1.45 : 1.30
        iconSize3D = isCapital ? 1.70 : 1.45
        fontSize2D = isCapital ? 0.058 : 0.050
        iconSize2D = isCapital ? 0.076 : 0.066
        nameColor = isCapital ? 0xFFFBEB : 0xF8FAFC
      }
      else if (tier === 'mid') {
        fontSize3D = 1.15
        iconSize3D = 1.30
        fontSize2D = 0.044
        iconSize2D = 0.058
        nameColor = 0xF1F5F9
      }

      items.push({
        id: settlement.id,
        region,
        name: settlement.name,
        tier,
        rank: settlement.rank,
        isCapital,
        lon,
        lat,
        normal,
        matrix3D: matrix,
        right3D: right,
        iconChar: iconInfo.char,
        iconColor: iconInfo.color,
        nameColor,
        fontSize3D,
        iconSize3D,
        fontSize2D,
        iconSize2D,
      })
    }
  }

  // 3. 宗教圣地标牌生成
  if (showSacredSites && data.society.religions?.sacredSites) {
    const sacredSites = data.society.religions.sacredSites
    const placeOfWorshipChar = getMakiGlyph(Maki.PlaceOfWorship)

    for (const site of sacredSites) {
      const region = site.region
      if (region < 0 || region >= mesh.numRegions)
        continue

      const idx = region * 3
      const normal = new Vector3(
        mesh.regionPosition[idx],
        mesh.regionPosition[idx + 1],
        mesh.regionPosition[idx + 2],
      ).normalize()

      const { matrix, right } = computeBasisMatrix(normal)
      const lon = mesh.regionLongitude[region]
      const lat = mesh.regionLatitude[region]

      items.push({
        id: 100000 + site.id,
        region,
        name: site.name,
        tier: 'mid', // 圣地归入中景层级
        isCapital: false,
        isSacredSite: true,
        lon,
        lat,
        normal,
        matrix3D: matrix,
        right3D: right,
        iconChar: placeOfWorshipChar,
        iconColor: 0xE9D5FF, // 圣洁淡紫
        nameColor: 0xF5F3FF,
        fontSize3D: 1.15,
        iconSize3D: 1.30,
        fontSize2D: 0.044,
        iconSize2D: 0.058,
      })
    }
  }

  return items
}
