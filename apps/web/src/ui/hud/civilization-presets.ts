import type { CivilizationParameters } from '@another-earth/world-core'

/**
 * UI scenarios apply effective numbers; preset IDs never enter world facts or cache keys.
 * `enabled`, `populationScale` and `culturalDiversity` stay independent of social background
 * presets so switching scenarios does not overwrite user-chosen population or cultural settings.
 */
export const CIVILIZATION_PRESETS = [
  {
    id: 'agrarian',
    parameters: {
      enabled: true,
      populationScale: 1,
      settlementDensity: 0.45,
      urbanConcentration: 0.1,
      polityCount: 60,
      politySizeVariation: 0.35,
      culturalDiversity: 1,
      capabilities: { agriculturalProductivity: 0.25, industrialCapability: 0, landTransportCapability: 0.25, seafaringCapability: 0.05, administrativeCapacity: 0.2 },
    },
  },
  {
    id: 'mercantile-city-states',
    parameters: {
      enabled: true,
      populationScale: 1,
      settlementDensity: 1.15,
      urbanConcentration: 0.55,
      polityCount: 108,
      politySizeVariation: 0.25,
      culturalDiversity: 1,
      capabilities: { agriculturalProductivity: 0.55, industrialCapability: 0.1, landTransportCapability: 0.5, seafaringCapability: 0.7, administrativeCapacity: 0.4 },
    },
  },
  {
    id: 'regional-kingdoms',
    parameters: {
      enabled: true,
      populationScale: 1,
      settlementDensity: 0.8,
      urbanConcentration: 0.35,
      polityCount: 36,
      politySizeVariation: 0.65,
      culturalDiversity: 1,
      capabilities: { agriculturalProductivity: 0.7, industrialCapability: 0.2, landTransportCapability: 0.65, seafaringCapability: 0.45, administrativeCapacity: 0.45 },
    },
  },
  {
    id: 'industrial-mercantile',
    parameters: {
      enabled: true,
      populationScale: 1,
      settlementDensity: 1,
      urbanConcentration: 0.65,
      polityCount: 60,
      politySizeVariation: 0.5,
      culturalDiversity: 1,
      capabilities: { agriculturalProductivity: 1, industrialCapability: 1, landTransportCapability: 1, seafaringCapability: 1, administrativeCapacity: 0.75 },
    },
  },
] as const satisfies readonly { id: string, parameters: CivilizationParameters }[]

export type CivilizationPresetId = typeof CIVILIZATION_PRESETS[number]['id']

const PRESET_SOCIETY_KEYS = ['settlementDensity', 'urbanConcentration', 'polityCount', 'politySizeVariation'] as const

type PreservedPresetAxes = Pick<CivilizationParameters, 'enabled' | 'populationScale' | 'culturalDiversity'>

/** Enabled, population scale and cultural diversity are independent axes, not part of preset identity. */
export function matchCivilizationPreset(parameters: CivilizationParameters): CivilizationPresetId | 'custom' {
  return CIVILIZATION_PRESETS.find(({ parameters: preset }) =>
    PRESET_SOCIETY_KEYS
      .every(key => Math.abs(preset[key] - parameters[key]) < 1e-9)
      && (Object.keys(preset.capabilities) as (keyof CivilizationParameters['capabilities'])[])
        .every(key => Math.abs(preset.capabilities[key] - parameters.capabilities[key]) < 1e-9))?.id ?? 'custom'
}

export function applyCivilizationPreset(
  id: CivilizationPresetId,
  preserved: boolean | PreservedPresetAxes,
): CivilizationParameters {
  const preset = CIVILIZATION_PRESETS.find(preset => preset.id === id)
  if (!preset)
    throw new Error(`Unknown civilization preset: ${id}`)
  if (typeof preserved === 'boolean')
    return { ...preset.parameters, enabled: preserved, capabilities: { ...preset.parameters.capabilities } }
  return {
    ...preset.parameters,
    enabled: preserved.enabled,
    populationScale: preserved.populationScale,
    culturalDiversity: preserved.culturalDiversity,
    capabilities: { ...preset.parameters.capabilities },
  }
}
