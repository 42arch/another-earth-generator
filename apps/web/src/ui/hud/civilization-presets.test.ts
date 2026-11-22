import { DEFAULT_CIVILIZATION_PARAMETERS, resolveCivilizationParameters } from '@another-earth/world-core'
import { describe, expect, it } from 'vitest'
import { applyCivilizationPreset, CIVILIZATION_PRESETS, matchCivilizationPreset } from './civilization-presets'

describe('civilization presets', () => {
  it('provides complete valid scenarios and keeps the industrial preset equal to defaults', () => {
    expect(new Set(CIVILIZATION_PRESETS.map(preset => preset.id)).size).toBe(4)
    for (const preset of CIVILIZATION_PRESETS) {
      expect(resolveCivilizationParameters(preset.parameters)).toEqual(preset.parameters)
      expect(matchCivilizationPreset(preset.parameters)).toBe(preset.id)
    }
    expect(applyCivilizationPreset('industrial-mercantile', true)).toEqual(DEFAULT_CIVILIZATION_PARAMETERS)
  })

  it('matches effective values, ignores independent axes and treats preset-axis edits as custom', () => {
    for (const preset of CIVILIZATION_PRESETS) {
      const values = JSON.parse(JSON.stringify(preset.parameters))
      expect(matchCivilizationPreset(values)).toBe(preset.id)
      values.populationScale = 1.75
      values.culturalDiversity = 1.5
      values.enabled = false
      expect(matchCivilizationPreset(values)).toBe(preset.id)
      values.politySizeVariation = preset.parameters.politySizeVariation + 0.05
      expect(matchCivilizationPreset(values)).toBe('custom')
      values.politySizeVariation = preset.parameters.politySizeVariation
      values.polityCount++
      expect(matchCivilizationPreset(values)).toBe('custom')
      values.polityCount--
      values.capabilities.seafaringCapability += 0.05
      expect(matchCivilizationPreset(values)).toBe('custom')
    }
  })

  it('preserves enabled, populationScale and culturalDiversity when given current parameters and returns independent copies', () => {
    const first = applyCivilizationPreset('agrarian', false)
    expect(first.enabled).toBe(false)
    expect(matchCivilizationPreset(first)).toBe('agrarian')
    Object.assign(first.capabilities, { agriculturalProductivity: 2 })
    expect(applyCivilizationPreset('agrarian', true).capabilities.agriculturalProductivity).toBe(0.25)

    const preserved = applyCivilizationPreset('regional-kingdoms', {
      enabled: true,
      populationScale: 1.6,
      culturalDiversity: 1.5,
    })
    expect(preserved.populationScale).toBe(1.6)
    expect(preserved.culturalDiversity).toBe(1.5)
    expect(preserved.capabilities.administrativeCapacity).toBe(0.45)
    expect(matchCivilizationPreset(preserved)).toBe('regional-kingdoms')
    expect(() => applyCivilizationPreset('missing' as never, true)).toThrow('Unknown civilization preset')
  })
})
