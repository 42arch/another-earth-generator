export const REGION_FEATURE = {
  Ocean: 0,
  Island: 1,
  Lake: 2,
} as const

export type RegionFeatureCode = typeof REGION_FEATURE[keyof typeof REGION_FEATURE]
