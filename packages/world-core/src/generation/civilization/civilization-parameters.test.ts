import type { CivilizationCapabilities, CivilizationParametersInput } from './civilization-types'
import { describe, expect, it } from 'vitest'
import { resolveCivilizationParameters, validateCivilizationParameters } from './civilization-parameters'
import { DEFAULT_CIVILIZATION_CAPABILITIES, DEFAULT_CIVILIZATION_PARAMETERS } from './civilization-types'

describe('civilization capability resolution', () => {
  it('resolves omitted and partial inputs to detached complete parameters', () => {
    expect(resolveCivilizationParameters()).toEqual(DEFAULT_CIVILIZATION_PARAMETERS)
    const input = { populationScale: 1.5, capabilities: { seafaringCapability: 0 } }
    const before = structuredClone(input)
    const resolved = resolveCivilizationParameters(input)
    expect(resolved.capabilities).toEqual({ ...DEFAULT_CIVILIZATION_CAPABILITIES, seafaringCapability: 0 })
    expect(resolved.capabilities).not.toBe(input.capabilities)
    expect(resolveCivilizationParameters().capabilities).not.toBe(DEFAULT_CIVILIZATION_CAPABILITIES)
    expect(input).toEqual(before)
    expect(resolved.polityCount).toBe(60)
    validateCivilizationParameters(resolved)
  })

  it.each([1, 60, 200])('accepts the exact integer country count %i', (polityCount) => {
    expect(resolveCivilizationParameters({ polityCount }).polityCount).toBe(polityCount)
  })

  it.each([
    ['agriculturalProductivity', 0],
    ['industrialCapability', -1],
    ['landTransportCapability', Number.NaN],
    ['seafaringCapability', Infinity],
    ['seafaringCapability', 3],
    ['industrialCapability', '1'],
    ['agriculturalProductivity', null],
    ['administrativeCapacity', -1],
    ['administrativeCapacity', 2],
  ])('rejects explicit invalid %s values without coercion', (key, value) => {
    const input = { capabilities: { [key]: value } } as unknown as CivilizationParametersInput
    expect(() => resolveCivilizationParameters(input)).toThrow()
  })

  it('rejects invalid containers, flags and incomplete saved configurations', () => {
    expect(() => resolveCivilizationParameters(null as unknown as CivilizationParametersInput)).toThrow()
    expect(() => resolveCivilizationParameters({ enabled: 0 } as unknown as CivilizationParametersInput)).toThrow()
    expect(() => resolveCivilizationParameters({ capabilities: null as unknown as CivilizationCapabilities })).toThrow()
    expect(() => validateCivilizationParameters({ ...DEFAULT_CIVILIZATION_PARAMETERS, capabilities: {} as CivilizationCapabilities })).toThrow()
  })

  it.each([
    { urbanConcentration: -1 },
    { polityDensity: 1 },
    { polityCount: 0 },
    { polityCount: 201 },
    { polityCount: 2.5 },
    { polityCount: Infinity },
    { polityCount: Number.NaN },
    { polityCount: "60" },
    { polityCount: { min: 20, max: 30 } },
    { polityCount: null },
    { politySizeVariation: -0.1 },
    { politySizeVariation: 1.1 },
    { culturalDiversity: Number.NaN },
    { polityCohesion: 0.6 },
  ])('rejects invalid or obsolete society parameters %j', (input) => {
    expect(() => resolveCivilizationParameters(input as CivilizationParametersInput)).toThrow()
  })
})
