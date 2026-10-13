import type SphericalMesh from '@/core/mesh/mesh'
import type { SpineLabelGlyph } from '@/core/mesh/spine-label-layout'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { findEntityMedoidRegion, layoutSpineLabel } from '@/core/mesh/spine-label-layout'
import { getCartographicStyle, resolveEffectiveSurfaceMode } from '@/core/styles'

export type { SpineLabelGlyph as WorldGlyphItem }

export interface WorldLabelItem {
  id: string
  name: string
  type: 'polity' | 'religion' | 'ethnicity' | 'language'
  isCurved: boolean
  fontSize: number
  color: number
  outlineColor: number
  offsetUpRatio?: number
  glyphs: SpineLabelGlyph[]
  population?: number
}

/**
 * 依据当前底图模式与叠加层开关，提取所有待渲染的世界注记（政权、宗教、民族、语言）
 */
export function computeWorldLabels(
  mesh: SphericalMesh,
  data: WorldSimulationState,
  params: WorldConfig,
): WorldLabelItem[] {
  if (!data.civilization)
    return []

  const baseMap = resolveEffectiveSurfaceMode(params.appearance)
  const overlays = params.appearance.overlays
  const items: WorldLabelItem[] = []
  const cartographicStyle = getCartographicStyle(params.appearance.mapStyle)

  const isSpecializedCivilizationBaseMap = ['religions', 'ethnicity', 'languages'].includes(baseMap)
  const showPolities = (baseMap === 'polities')
    || (Boolean(overlays['nation-labels']) && !isSpecializedCivilizationBaseMap)
  const showReligions = (baseMap === 'religions') || Boolean(overlays['religion-labels'])
  const showEthnicity = (baseMap === 'ethnicity') || Boolean(overlays['ethnicity-labels'])
  const showLanguages = (baseMap === 'languages') || Boolean(overlays['language-labels'])

  // 1. 国家/政权标签
  if (showPolities && data.civilization.polities) {
    const polities = data.civilization.polities.polities
    const settlements = data.civilization.settlements
    const polityByRegion = data.civilization.polities.polityByRegion

    for (const polity of polities) {
      const capital = settlements[polity.capitalSettlementId]
      const { region: medoidRegion, memberRegions } = findEntityMedoidRegion(
        mesh,
        polityByRegion,
        polity.id,
        capital?.region ?? -1,
        data.civilization.population,
      )
      const anchorRegion = medoidRegion >= 0 ? medoidRegion : (capital?.region ?? -1)
      if (anchorRegion < 0)
        continue

      const pop = Math.max(1000, polity.population || 0)
      const sizeMultiplier = Math.max(0.85, Math.min(1.4, 0.7 + Math.log10(pop) * 0.15))
      const fontSize = 2.4 * sizeMultiplier

      const coincidesWithCapital = capital && anchorRegion === capital.region
      const offsetUpRatio = coincidesWithCapital ? 1.0 : 0

      const layout = layoutSpineLabel(
        mesh,
        polity.name,
        memberRegions,
        anchorRegion,
        data.civilization.population,
      )

      if (layout) {
        items.push({
          id: `polity-${polity.id}`,
          name: polity.name,
          type: 'polity',
          isCurved: layout.isCurved,
          fontSize,
          color: cartographicStyle.label,
          outlineColor: cartographicStyle.labelHalo,
          offsetUpRatio,
          glyphs: layout.glyphs,
          population: pop,
        })
      }
    }
  }

  // 2. 宗教与信仰标签
  if (showReligions && data.civilization.religions) {
    const religions = data.civilization.religions.religions
    const settlements = data.civilization.settlements
    const dominantAffiliation = data.civilization.religions.dominantAffiliation

    for (const religion of religions) {
      const fallbackRegion = religion.originSettlementId >= 0
        ? settlements[religion.originSettlementId]?.region ?? -1
        : -1

      const { region, totalPopulation, memberRegions } = findEntityMedoidRegion(
        mesh,
        dominantAffiliation,
        religion.id,
        fallbackRegion,
        data.civilization.population,
      )

      if (region < 0)
        continue

      const pop = Math.max(1000, totalPopulation)
      const sizeMultiplier = Math.max(0.85, Math.min(1.45, 0.7 + Math.log10(pop) * 0.15))
      const fontSize = 2.6 * sizeMultiplier

      const layout = layoutSpineLabel(
        mesh,
        religion.name,
        memberRegions,
        region,
        data.civilization.population,
      )

      if (layout) {
        items.push({
          id: `religion-${religion.id}`,
          name: religion.name,
          type: 'religion',
          isCurved: layout.isCurved,
          fontSize,
          color: 0xE9D5FF,
          outlineColor: 0x1E1035,
          glyphs: layout.glyphs,
          population: pop,
        })
      }
    }
  }

  // 3. 民族分布标签
  if (showEthnicity && data.civilization.ethnicity) {
    const groups = data.civilization.ethnicity.groups
    const dominantGroup = data.civilization.ethnicity.dominantGroup

    for (const group of groups) {
      const { region, totalPopulation, memberRegions } = findEntityMedoidRegion(
        mesh,
        dominantGroup,
        group.id,
        group.originRegion,
        data.civilization.population,
      )

      if (region < 0)
        continue

      const pop = Math.max(1000, totalPopulation)
      const sizeMultiplier = Math.max(0.85, Math.min(1.4, 0.7 + Math.log10(pop) * 0.15))
      const fontSize = 2.3 * sizeMultiplier

      const layout = layoutSpineLabel(
        mesh,
        group.name,
        memberRegions,
        region,
        data.civilization.population,
      )

      if (layout) {
        items.push({
          id: `ethnicity-${group.id}`,
          name: group.name,
          type: 'ethnicity',
          isCurved: layout.isCurved,
          fontSize,
          color: 0xA7F3D0,
          outlineColor: 0x06281D,
          glyphs: layout.glyphs,
          population: pop,
        })
      }
    }
  }

  // 4. 语言分布标签
  if (showLanguages && data.civilization.ethnicity) {
    const languages = data.civilization.ethnicity.languages
    const dominantLanguage = data.civilization.ethnicity.dominantLanguage

    for (const language of languages) {
      const { region, totalPopulation, memberRegions } = findEntityMedoidRegion(
        mesh,
        dominantLanguage,
        language.id,
        language.originRegion,
        data.civilization.population,
      )

      if (region < 0)
        continue

      const pop = Math.max(1000, totalPopulation)
      const sizeMultiplier = Math.max(0.85, Math.min(1.4, 0.7 + Math.log10(pop) * 0.15))
      const fontSize = 2.3 * sizeMultiplier

      const layout = layoutSpineLabel(
        mesh,
        language.name,
        memberRegions,
        region,
        data.civilization.population,
      )

      if (layout) {
        items.push({
          id: `language-${language.id}`,
          name: language.name,
          type: 'language',
          isCurved: layout.isCurved,
          fontSize,
          color: 0xBAE6FD,
          outlineColor: 0x082F49,
          glyphs: layout.glyphs,
          population: pop,
        })
      }
    }
  }

  return items
}
