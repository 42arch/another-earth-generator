import type { MakiId } from '@/core/rendering/shared/maki'
import type { Settlement } from '@/core/society/society-data'
import { Maki, MAKI_CODEPOINTS } from '@/core/rendering/shared/maki'

export { Maki, type MakiId }

/**
 * 获取 Maki 图标字形的单字符 Unicode
 */
export function getMakiGlyph(icon: Maki): string {
  const codepoint = MAKI_CODEPOINTS[icon]
  return codepoint ? String.fromCharCode(Number(codepoint)) : '●'
}

export interface SettlementIconInfo {
  icon: Maki
  char: string
  color: number
  sizeMultiplier: number
}

/**
 * 依据聚落等级、首都身份及生成成因智能匹配最契合的官方 Mapbox Maki 矢量图标
 */
export function getSettlementMakiIcon(
  settlement: Settlement,
  isCapital: boolean,
): SettlementIconInfo {
  // 1. 首都拥有最高优先级的国家星标
  if (isCapital) {
    return {
      icon: Maki.Star,
      char: getMakiGlyph(Maki.Star),
      color: 0xFDE047, // 璀璨亮金
      sizeMultiplier: 1.4,
    }
  }

  // 2. 根据成因特征匹配专业地理功能图标
  const reasons = settlement.reasons || []
  const reasonsStr = reasons.join(' ').toLowerCase()

  if (reasonsStr.includes('port') || reasonsStr.includes('coast') || reasonsStr.includes('strait')) {
    return {
      icon: Maki.Harbor,
      char: getMakiGlyph(Maki.Harbor),
      color: 0x38BDF8, // 蔚蓝海运港口
      sizeMultiplier: 1.15,
    }
  }

  if (reasonsStr.includes('pass') || reasonsStr.includes('choke') || reasonsStr.includes('garrison')) {
    return {
      icon: Maki.Castle,
      char: getMakiGlyph(Maki.Castle),
      color: 0xFB923C, // 坚固要塞橙
      sizeMultiplier: 1.15,
    }
  }

  // 3. 按行政/人口层级匹配
  switch (settlement.rank) {
    case 'metropolis':
      return {
        icon: Maki.Monument,
        char: getMakiGlyph(Maki.Monument),
        color: 0xF87171, // 枢纽都会珊瑚红
        sizeMultiplier: 1.25,
      }
    case 'city':
      return {
        icon: Maki.City,
        char: getMakiGlyph(Maki.City),
        color: 0xFBBF24, // 城市琥珀金
        sizeMultiplier: 1.1,
      }
    case 'town':
      return {
        icon: Maki.Building,
        char: getMakiGlyph(Maki.Building),
        color: 0x94A3B8, // 市镇石青板岩灰
        sizeMultiplier: 0.95,
      }
    case 'village':
    default:
      return {
        icon: Maki.Campsite,
        char: getMakiGlyph(Maki.Campsite),
        color: 0x86EFAC, // 村落青翠绿
        sizeMultiplier: 0.85,
      }
  }
}
