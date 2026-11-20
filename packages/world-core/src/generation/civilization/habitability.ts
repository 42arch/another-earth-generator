import type { ClimateArtifact } from '#generation/nature/climate/climate'
import type { EcologyArtifact } from '#generation/nature/ecology/ecology'
import type { TerrainArtifact } from '#generation/nature/geography'
import type { HydrologyArtifact } from '#generation/nature/hydrology/hydrology'
import type { StaticLakeArtifact } from '#generation/nature/hydrology/lakes'
import type { ResourcePotentialArtifact } from '#generation/nature/resources/resource-potential'
import type { SphericalMesh } from '#mesh/spherical-mesh'

export const HABITABILITY_VERSION = 'habitability-v1' as const

export interface HabitabilityArtifact {
  readonly meshId: string
  readonly algorithmVersion: typeof HABITABILITY_VERSION
  readonly regionCount: number
  readonly habitability: Float32Array
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
  mesh: Pick<SphericalMesh, 'meshId' | 'regionCount' | 'neighborOffsets' | 'neighbors'>,
  terrain: Pick<TerrainArtifact, 'meshId' | 'elevationKm' | 'landMask' | 'slopeRadians'>,
  climate: Pick<ClimateArtifact, 'meshId' | 'annualMeanTemperatureC' | 'annualPrecipitationMm'>,
  hydrology: Pick<HydrologyArtifact, 'meshId' | 'riverIndex' | 'accumulatedAnnualFlowM3s'>,
  lakes: Pick<StaticLakeArtifact, 'meshId' | 'lakeIndex'>,
  ecology: Pick<EcologyArtifact, 'meshId' | 'potentialBiomeIds' | 'landCoverIds' | 'potentialBiomeIndex' | 'landCoverIndex' | 'aridityIndex' | 'growingSeasonMonths'>,
  resources: Pick<ResourcePotentialArtifact, 'meshId' | 'agriculturalPotential' | 'forestryPotential' | 'fisheryPotential'>,
  check?: (fraction: number) => void,
): HabitabilityArtifact {
  const n = mesh.regionCount
  if (!n || terrain.meshId !== mesh.meshId || climate.meshId !== mesh.meshId || hydrology.meshId !== mesh.meshId || lakes.meshId !== mesh.meshId || ecology.meshId !== mesh.meshId || resources.meshId !== mesh.meshId)
    throw new Error('Habitability stage received mismatched mesh artifacts')

  const habitability = new Float32Array(n)
  const carryingCapacityPerKm2 = new Float32Array(n)
  const movementCost = new Float32Array(n)
  const coastalMask = new Uint8Array(n)
  const lakeShoreMask = new Uint8Array(n)

  for (let r = 0; r < n; r++) {
    if ((r & 1023) === 0)
      check?.(r / n)

    const isLand = terrain.landMask[r] === 1
    const isLake = isLand && lakes.lakeIndex[r] >= 0

    let touchesSea = false
    let touchesLake = false
    let touchesLand = false
    for (let e = mesh.neighborOffsets[r]; e < mesh.neighborOffsets[r + 1]; e++) {
      const nb = mesh.neighbors[e]
      if (terrain.landMask[nb] === 0)
        touchesSea = true
      else
        touchesLand = true
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
    const waterAccess = (hydrology.riverIndex[r] >= 0 ? 0.25 : 0)
      + (touchesLake ? 0.16 : 0)
      + (touchesSea ? 0.12 : 0)
      + clamp01(Math.log10(Math.max(1, hydrology.accumulatedAnnualFlowM3s[r])) / 5) * 0.12
    const moistureScore = clamp01(smoothBand(ecology.aridityIndex[r], 0.08, 0.45, 2.0, 4.2) * 0.8 + waterAccess)
    const terrainScore = clamp01((1 - clamp01(slope / 0.34)) * 0.65 + (1 - clamp01(Math.max(0, elev - 0.5) / 3.5)) * 0.35)
    const resourceSupport = clamp01(resources.agriculturalPotential[r] * 0.65 + resources.fisheryPotential[r] * 0.2 + resources.forestryPotential[r] * 0.15)

    let hab = (tempComfort * 0.3 + moistureScore * 0.25 + terrainScore * 0.22 + resourceSupport * 0.23)
    if (biome === 'IceSheet')
      hab = 0
    else if (biome === 'AlpineTundra' || biome === 'Tundra')
      hab *= 0.25
    else if (biome === 'HotDesert' || biome === 'ColdDesert')
      hab *= hydrology.riverIndex[r] >= 0 || touchesSea ? 0.55 : 0.16

    hab = clamp01(hab)
    habitability[r] = hab

    if (hab > 0.01) {
      const cap = (145 * hab ** 1.85 + 45 * resources.agriculturalPotential[r])
        * (0.85 + 0.15 * (touchesSea ? 1 : 0) + 0.15 * (hydrology.riverIndex[r] >= 0 ? 1 : 0))
      carryingCapacityPerKm2[r] = Math.max(0, cap)
    }

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

  check?.(1)
  return {
    meshId: mesh.meshId,
    algorithmVersion: HABITABILITY_VERSION,
    regionCount: n,
    habitability,
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
    || !(output.carryingCapacityPerKm2 instanceof Float32Array) || output.carryingCapacityPerKm2.length !== n
    || !(output.movementCost instanceof Float32Array) || output.movementCost.length !== n
    || !(output.coastalMask instanceof Uint8Array) || output.coastalMask.length !== n
    || !(output.lakeShoreMask instanceof Uint8Array) || output.lakeShoreMask.length !== n) {
    throw new Error('Habitability field dtype or length mismatch')
  }
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(output.habitability[i]) || output.habitability[i] < 0 || output.habitability[i] > 1)
      throw new Error(`Invalid habitability value at ${i}`)
    if (!Number.isFinite(output.carryingCapacityPerKm2[i]) || output.carryingCapacityPerKm2[i] < 0)
      throw new Error(`Invalid carrying capacity at ${i}`)
    if (!Number.isFinite(output.movementCost[i]) || output.movementCost[i] <= 0)
      throw new Error(`Invalid movement cost at ${i}`)
    if ((output.coastalMask[i] !== 0 && output.coastalMask[i] !== 1) || (output.lakeShoreMask[i] !== 0 && output.lakeShoreMask[i] !== 1))
      throw new Error(`Invalid shore mask at ${i}`)
  }
}
