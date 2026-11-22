import type { CivilizationCapabilities, CivilizationParameters, CivilizationParametersInput } from './civilization-types'
import { InvalidStageInputError } from '#generation/pipeline/errors'
import { DEFAULT_CIVILIZATION_CAPABILITIES, DEFAULT_CIVILIZATION_PARAMETERS } from './civilization-types'

export const CIVILIZATION_CAPABILITY_RANGES = Object.freeze({
  agriculturalProductivity: [0.25, 2],
  industrialCapability: [0, 2],
  landTransportCapability: [0.25, 2],
  seafaringCapability: [0, 2],
  administrativeCapacity: [0, 1],
} as const)

export const CIVILIZATION_SOCIETY_RANGES = Object.freeze({
  urbanConcentration: [0, 1],
  polityCount: [1, 200],
  politySizeVariation: [0, 1],
  culturalDiversity: [0.5, 2],
} as const)

export function validateCivilizationCapabilities(value: CivilizationCapabilities, stageId = 'civilization'): void {
  if (!value || typeof value !== 'object')
    throw new InvalidStageInputError(stageId, 'Civilization capabilities must be an object')
  for (const key of Object.keys(CIVILIZATION_CAPABILITY_RANGES) as (keyof CivilizationCapabilities)[]) {
    const [min, max] = CIVILIZATION_CAPABILITY_RANGES[key]
    if (!Number.isFinite(value[key]) || value[key] < min || value[key] > max)
      throw new InvalidStageInputError(stageId, `Invalid civilization capability: ${key}`)
  }
}

/** Missing values use defaults; explicit invalid values are never coerced. */
export function resolveCivilizationCapabilities(input: Partial<CivilizationCapabilities> = {}): CivilizationCapabilities {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new InvalidStageInputError('civilization', 'Civilization capabilities must be an object')
  const resolved = { ...DEFAULT_CIVILIZATION_CAPABILITIES }
  for (const key of Object.keys(CIVILIZATION_CAPABILITY_RANGES) as (keyof CivilizationCapabilities)[]) {
    if (input[key] !== undefined)
      resolved[key] = input[key]!
  }
  validateCivilizationCapabilities(resolved)
  return resolved
}

export function validateCivilizationParameters(params: CivilizationParameters, stageId = 'civilization'): void {
  if (!params || typeof params !== 'object' || typeof params.enabled !== 'boolean'
    || !Number.isFinite(params.populationScale) || params.populationScale < 0.1 || params.populationScale > 4
    || !Number.isFinite(params.settlementDensity) || params.settlementDensity < 0.25 || params.settlementDensity > 4
    || 'polityCohesion' in params || 'polityDensity' in params) {
    throw new InvalidStageInputError(stageId, 'Invalid civilization parameters')
  }
  for (const key of Object.keys(CIVILIZATION_SOCIETY_RANGES) as (keyof typeof CIVILIZATION_SOCIETY_RANGES)[]) {
    const [min, max] = CIVILIZATION_SOCIETY_RANGES[key]
    if (!Number.isFinite(params[key]) || params[key] < min || params[key] > max)
      throw new InvalidStageInputError(stageId, `Invalid civilization parameter: ${key}`)
  }
  if (!Number.isInteger(params.polityCount))
    throw new InvalidStageInputError(stageId, 'Polity count must be an integer from 1 to 200')
  validateCivilizationCapabilities(params.capabilities, stageId)
}

/** Returns a complete detached configuration suitable for hashing and saving. */
export function resolveCivilizationParameters(input: CivilizationParametersInput = {}): CivilizationParameters {
  if (!input || typeof input !== 'object' || Array.isArray(input) || 'polityCohesion' in input || 'polityDensity' in input)
    throw new InvalidStageInputError('civilization', 'Invalid civilization parameters; polityDensity and polityCohesion are no longer supported')
  const resolved: CivilizationParameters = {
    enabled: input.enabled === undefined ? DEFAULT_CIVILIZATION_PARAMETERS.enabled : input.enabled,
    populationScale: input.populationScale === undefined ? DEFAULT_CIVILIZATION_PARAMETERS.populationScale : input.populationScale,
    settlementDensity: input.settlementDensity === undefined ? DEFAULT_CIVILIZATION_PARAMETERS.settlementDensity : input.settlementDensity,
    urbanConcentration: input.urbanConcentration === undefined ? DEFAULT_CIVILIZATION_PARAMETERS.urbanConcentration : input.urbanConcentration,
    polityCount: input.polityCount === undefined ? DEFAULT_CIVILIZATION_PARAMETERS.polityCount : input.polityCount,
    politySizeVariation: input.politySizeVariation === undefined ? DEFAULT_CIVILIZATION_PARAMETERS.politySizeVariation : input.politySizeVariation,
    culturalDiversity: input.culturalDiversity === undefined ? DEFAULT_CIVILIZATION_PARAMETERS.culturalDiversity : input.culturalDiversity,
    capabilities: resolveCivilizationCapabilities(input.capabilities),
  }
  validateCivilizationParameters(resolved)
  return resolved
}
