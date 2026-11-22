import type { ClimateArtifact } from '#generation/nature/climate/climate'
import type { EcologyArtifact } from '#generation/nature/ecology/ecology'
import type { TerrainArtifact } from '#generation/nature/geography'
import type { HydrologyArtifact } from '#generation/nature/hydrology/hydrology'
import type { StaticLakeArtifact } from '#generation/nature/hydrology/lakes'
import type { ResourcePotentialArtifact } from '#generation/nature/resources/resource-potential'
import type { SphericalMesh } from '#mesh/spherical-mesh'
import type { CivilizationCapabilities } from './civilization-types'
import { resolveCivilizationCapabilities } from './civilization-parameters'
import { SETTLEMENT_SUPPORT_AREA_KM2 } from './civilization-scale'
import { spreadLandOpportunity } from './land-opportunity'

export const HABITABILITY_VERSION = 'habitability-v4' as const

// Static circa-1900 reference. Joint density scaling fitted on three L5 seeds,
// rounded from 21.56 / 6.69; see benchmarks/CIV-01-calibration.md. Neither term
// is a measured farm yield, urban density, or independently fitted coefficient.
const FOOD_ACCESS_RANGE_KM = Math.sqrt(SETTLEMENT_SUPPORT_AREA_KM2) * 2
const RESOURCE_ACCESS_RANGE_KM = FOOD_ACCESS_RANGE_KM
const RAINFALL_SUPPORT_MM = 600
const FOOD_DENSITY_PER_KM2 = 22
const INDUSTRIAL_DENSITY_PER_KM2 = 7

export interface HabitabilityArtifact {
  readonly meshId: string
  readonly algorithmVersion: typeof HABITABILITY_VERSION
  readonly regionCount: number
  /** 1850–1900 settlement suitability, including supplied economic opportunity. */
  readonly habitability: Float32Array
  /** Environmental limit before food, economic and access opportunities. */
  readonly environmentalSuitability: Float32Array
  /** Mineral/energy opportunity gated by food access and transport potential. */
  readonly economicOpportunity: Float32Array
  /** Discrete coast shelter, slope and freshwater proxy; not harbor bathymetry. */
  readonly portPotential: Float32Array
  readonly carryingCapacityPerKm2: Float32Array
  /** Dimensionless per-km traversal resistance (> 0). */
  readonly movementCost: Float32Array
  readonly coastalMask: Uint8Array
  readonly lakeShoreMask: Uint8Array
}

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value
}

function smoothBand(value: number, low: number, optLow: number, optHigh: number, high: number): number {
  if (value <= low || value >= high)
    return 0
  if (value >= optLow && value <= optHigh)
    return 1
  if (value < optLow)
    return (value - low) / (optLow - low)
  return (high - value) / (high - optHigh)
}

function biomeCodeOf(ecology: Pick<EcologyArtifact, 'potentialBiomeIds' | 'potentialBiomeIndex'>, region: number): string {
  const idx = ecology.potentialBiomeIndex[region]
  const id = ecology.potentialBiomeIds[idx] ?? ''
  const slash = id.lastIndexOf('/')
  return slash >= 0 ? id.slice(slash + 1) : id
}

function landCoverCodeOf(ecology: Pick<EcologyArtifact, 'landCoverIds' | 'landCoverIndex'>, region: number): string {
  const idx = ecology.landCoverIndex[region]
  const id = ecology.landCoverIds[idx] ?? ''
  const slash = id.lastIndexOf('/')
  return slash >= 0 ? id.slice(slash + 1) : id
}

export function generateHabitability(
  mesh: Pick<SphericalMesh, 'meshId' | 'regionCount' | 'centers' | 'neighborOffsets' | 'neighbors' | 'physicalRadiusKm'>,
  terrain: Pick<TerrainArtifact, 'meshId' | 'elevationKm' | 'landMask' | 'slopeRadians'>,
  climate: Pick<ClimateArtifact, 'meshId' | 'annualMeanTemperatureC' | 'annualPrecipitationMm'>,
  hydrology: Pick<HydrologyArtifact, 'meshId' | 'riverIndex' | 'accumulatedAnnualFlowM3s'>,
  lakes: Pick<StaticLakeArtifact, 'meshId' | 'lakeIndex'>,
  ecology: Pick<EcologyArtifact, 'meshId' | 'potentialBiomeIds' | 'landCoverIds' | 'potentialBiomeIndex' | 'landCoverIndex' | 'aridityIndex' | 'growingSeasonMonths'>,
  resources: Pick<ResourcePotentialArtifact, 'meshId' | 'agriculturalPotential' | 'forestryPotential' | 'fisheryPotential' | 'deposits'>,
  capabilities: Partial<Pick<CivilizationCapabilities, 'agriculturalProductivity' | 'industrialCapability' | 'landTransportCapability'>> = {},
  check?: (fraction: number) => void,
): HabitabilityArtifact {
  const { agriculturalProductivity, industrialCapability, landTransportCapability } = resolveCivilizationCapabilities(capabilities)
  const n = mesh.regionCount
  if (!n || terrain.meshId !== mesh.meshId || climate.meshId !== mesh.meshId || hydrology.meshId !== mesh.meshId || lakes.meshId !== mesh.meshId || ecology.meshId !== mesh.meshId || resources.meshId !== mesh.meshId)
    throw new Error('Habitability stage received mismatched mesh artifacts')

  const habitability = new Float32Array(n)
  const environmentalSuitability = new Float32Array(n)
  const economicOpportunity = new Float32Array(n)
  const portPotential = new Float32Array(n)
  const transportPotential = new Float32Array(n)
  const localFood = new Float32Array(n)
  const minerals = new Float32Array(n)
  const energy = new Float32Array(n)
  const carryingCapacityPerKm2 = new Float32Array(n)
  const movementCost = new Float32Array(n)
  const coastalMask = new Uint8Array(n)
  const lakeShoreMask = new Uint8Array(n)

  for (let r = 0; r < n; r++) {
    if ((r & 1023) === 0)
      check?.((r / n) * 0.5)

    const isLand = terrain.landMask[r] === 1
    const isLake = isLand && lakes.lakeIndex[r] >= 0

    let touchesSea = false
    let touchesLake = false
    let touchesLand = false
    let seaNeighbors = 0
    for (let e = mesh.neighborOffsets[r]; e < mesh.neighborOffsets[r + 1]; e++) {
      const nb = mesh.neighbors[e]
      if (terrain.landMask[nb] === 0) {
        touchesSea = true
        seaNeighbors++
      }
      else {
        touchesLand = true
      }
      if (lakes.lakeIndex[nb] >= 0)
        touchesLake = true
    }

    if (!isLand) {
      movementCost[r] = touchesLand ? 0.55 : 1.35
      continue
    }
    if (isLake) {
      movementCost[r] = 0.85
      continue
    }

    if (touchesSea)
      coastalMask[r] = 1
    if (touchesLake)
      lakeShoreMask[r] = 1

    const biome = biomeCodeOf(ecology, r)
    const cover = landCoverCodeOf(ecology, r)
    const temp = climate.annualMeanTemperatureC[r]
    const elev = Math.max(0, terrain.elevationKm[r])
    const slope = terrain.slopeRadians[r]

    const tempComfort = smoothBand(temp, -12, 8, 25, 35)
    const rainAccess = clamp01(ecology.aridityIndex[r] / 0.45) * clamp01(climate.annualPrecipitationMm[r] / RAINFALL_SUPPORT_MM)
    const riverAccess = hydrology.riverIndex[r] >= 0
      ? clamp01(Math.log10(1 + Math.max(0, hydrology.accumulatedAnnualFlowM3s[r])) / 5)
      : 0
    const freshwaterAccess = Math.max(rainAccess, riverAccess, touchesLake ? 0.85 : 0)
    const terrainScore = clamp01((1 - clamp01(slope / 0.34)) * 0.65 + (1 - clamp01(Math.max(0, elev - 0.5) / 3.5)) * 0.35)
    let environment = Math.sqrt(tempComfort * freshwaterAccess) * terrainScore
    if (biome === 'IceSheet')
      environment = 0
    else if (biome === 'AlpineTundra' || biome === 'Tundra')
      environment *= 0.25
    environmentalSuitability[r] = clamp01(environment)
    localFood[r] = environment > 0 ? clamp01(resources.agriculturalPotential[r] + resources.fisheryPotential[r] * 0.25) : 0

    const flatness = 1 - clamp01(slope / 0.22)
    const neighborCount = mesh.neighborOffsets[r + 1] - mesh.neighborOffsets[r]
    const shelter = neighborCount > 0 ? 1 - seaNeighbors / neighborCount : 0
    portPotential[r] = touchesSea ? flatness * freshwaterAccess * shelter : 0
    transportPotential[r] = flatness * 0.45 + riverAccess * 0.4 + portPotential[r]! * 0.15

    // Per-km traversal resistance: flat plains ~ 1.0, mountains/deserts/ice higher
    let cost = 1.0 + slope * 14 + Math.max(0, elev - 0.8) * 1.4
    if (cover === 'Forest')
      cost += 0.65
    else if (cover === 'Desert')
      cost += hydrology.riverIndex[r] >= 0 ? 0.8 : 2.4
    else if (cover === 'SnowIce')
      cost += 5.5
    else if (cover === 'Tundra')
      cost += 1.6
    if (hydrology.riverIndex[r] >= 0)
      cost *= 0.82
    movementCost[r] = Math.max(0.4, cost)
  }

  // Only declared, saved deposits create mining/energy opportunities. The
  // geological potential fields are not persisted and would disagree with
  // map queries reconstructed from a snapshot.
  for (const deposit of resources.deposits) {
    const r = deposit.regionId
    if (terrain.landMask[r] !== 1 || lakes.lakeIndex[r]! >= 0)
      continue
    if (deposit.category === 'mineral')
      minerals[r] = Math.max(minerals[r]!, deposit.richness)
    else if (deposit.category === 'energy')
      energy[r] = Math.max(energy[r]!, deposit.richness)
  }
  const foodAccess = localFood.slice()
  spreadLandOpportunity(mesh, terrain.landMask, movementCost, foodAccess, FOOD_ACCESS_RANGE_KM * landTransportCapability, () => check?.(0.55))
  spreadLandOpportunity(mesh, terrain.landMask, movementCost, minerals, RESOURCE_ACCESS_RANGE_KM * landTransportCapability, () => check?.(0.65))
  spreadLandOpportunity(mesh, terrain.landMask, movementCost, energy, RESOURCE_ACCESS_RANGE_KM * landTransportCapability, () => check?.(0.75))
  for (let r = 0; r < n; r++) {
    if ((r & 1023) === 0)
      check?.(0.8 + (r / n) * 0.2)
    if (terrain.landMask[r] !== 1 || lakes.lakeIndex[r]! >= 0)
      continue
    // Timber is a limited fuel substitute. Joint access to minerals and fuel
    // supports industry more strongly than an isolated mine of either type.
    const fuel = Math.max(energy[r]!, resources.forestryPotential[r]! * 0.25)
    const industry = Math.max(minerals[r]!, energy[r]! * industrialCapability) * 0.35
      + Math.sqrt(minerals[r]! * fuel) * 0.65 * industrialCapability
    const opportunity = clamp01(industry * foodAccess[r]! * transportPotential[r]!)
    economicOpportunity[r] = opportunity
    const environment = environmentalSuitability[r]!
    habitability[r] = clamp01(environment * (0.5 + foodAccess[r]! * 0.25 + opportunity * 0.15 + transportPotential[r]! * 0.1))
    if (habitability[r]! > 0.01) {
      // Productivity scales agricultural output per unit potential, not the
      // normalized natural field or the fishery contribution.
      const agriculturalFood = resources.agriculturalPotential[r]! * agriculturalProductivity
      const supportedFood = Math.max(0, localFood[r]! + agriculturalFood - resources.agriculturalPotential[r]!)
      carryingCapacityPerKm2[r] = environment * (FOOD_DENSITY_PER_KM2 * supportedFood
        + INDUSTRIAL_DENSITY_PER_KM2 * foodAccess[r]! * opportunity)
    }
  }

  check?.(1)
  return {
    meshId: mesh.meshId,
    algorithmVersion: HABITABILITY_VERSION,
    regionCount: n,
    habitability,
    environmentalSuitability,
    economicOpportunity,
    portPotential,
    carryingCapacityPerKm2,
    movementCost,
    coastalMask,
    lakeShoreMask,
  }
}

export function validateHabitabilityArtifact(output: HabitabilityArtifact): void {
  const n = output.regionCount
  if (!output.meshId || output.algorithmVersion !== HABITABILITY_VERSION || !Number.isInteger(n) || n < 1)
    throw new Error('Invalid habitability metadata')
  if (!(output.habitability instanceof Float32Array) || output.habitability.length !== n
    || !(output.environmentalSuitability instanceof Float32Array) || output.environmentalSuitability.length !== n
    || !(output.economicOpportunity instanceof Float32Array) || output.economicOpportunity.length !== n
    || !(output.portPotential instanceof Float32Array) || output.portPotential.length !== n
    || !(output.carryingCapacityPerKm2 instanceof Float32Array) || output.carryingCapacityPerKm2.length !== n
    || !(output.movementCost instanceof Float32Array) || output.movementCost.length !== n
    || !(output.coastalMask instanceof Uint8Array) || output.coastalMask.length !== n
    || !(output.lakeShoreMask instanceof Uint8Array) || output.lakeShoreMask.length !== n) {
    throw new Error('Habitability field dtype or length mismatch')
  }
  const boundedFields = [output.habitability, output.environmentalSuitability, output.economicOpportunity, output.portPotential]
  for (let i = 0; i < n; i++) {
    for (const values of boundedFields) {
      if (!Number.isFinite(values[i]) || values[i]! < 0 || values[i]! > 1)
        throw new Error(`Invalid habitability value at ${i}`)
    }
    if (output.habitability[i]! > output.environmentalSuitability[i]!)
      throw new Error(`Settlement suitability exceeds environmental limit at ${i}`)
    if (!Number.isFinite(output.carryingCapacityPerKm2[i]) || output.carryingCapacityPerKm2[i] < 0)
      throw new Error(`Invalid carrying capacity at ${i}`)
    if (!Number.isFinite(output.movementCost[i]) || output.movementCost[i] <= 0)
      throw new Error(`Invalid movement cost at ${i}`)
    if ((output.coastalMask[i] !== 0 && output.coastalMask[i] !== 1) || (output.lakeShoreMask[i] !== 0 && output.lakeShoreMask[i] !== 1))
      throw new Error(`Invalid shore mask at ${i}`)
  }
}
