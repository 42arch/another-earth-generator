import type { WorldConfig } from '@/core/simulation/config'
import { resolveEffectiveSurfaceMode } from '@/core/styles'

/**
 * 判断外观参数变化是否需要触发气候/洋流矢量场的重新构建
 */
export function shouldRebuildClimateVectors(previous: WorldConfig, next: WorldConfig): boolean {
  const previousMode = resolveEffectiveSurfaceMode(previous.appearance)
  const nextMode = resolveEffectiveSurfaceMode(next.appearance)
  const monthChanged = previous.appearance.climateMonth !== next.appearance.climateMonth
  const isVectorMode = (mode: string) => mode === 'wind' || mode === 'ocean-current'

  return (previousMode !== nextMode && (isVectorMode(previousMode) || isVectorMode(nextMode)))
    || (monthChanged && isVectorMode(nextMode))
}
