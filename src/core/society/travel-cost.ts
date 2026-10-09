import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { HYDROLOGY_RADIUS_M } from '@/core/hydrology/hydrology-units'
import { clamp } from '@/core/math/math'

export const PHYSICAL_RADIUS_KM = HYDROLOGY_RADIUS_M / 1000

function biomeResistance(biome: number): number {
  if (biome === 13)
    return 2
  if (biome === 4 || biome === 5)
    return 0.55
  if (biome === 12 || biome === 14)
    return 0.45
  return 0
}

/** Shared distance-equivalent land cost for transport and human diffusion. */
export function landTravelCost(
  mesh: SphericalMesh,
  data: WorldSimulationState,
  config: WorldConfig,
  from: number,
  to: number,
  edge: number,
  roadMask?: Uint8Array,
): number {
  const distanceKm = mesh.neighborDistances[edge] * PHYSICAL_RADIUS_KM
  const rise = Math.abs(data.geography.elevation[from] - data.geography.elevation[to])
  const slopePenalty = clamp(rise / Math.max(1, distanceKm) * 20, 0, 3)
  const fromBiome = data.biome?.biomeClass[from] ?? 0
  const toBiome = data.biome?.biomeClass[to] ?? 0
  const biomePenalty = (biomeResistance(fromBiome) + biomeResistance(toBiome)) * 0.5
  const river = data.hydrology?.riverMask
  const crossingPenalty = river && river[from] !== river[to] ? 0.12 : 0
  const resistance = 1 + config.society.terrainResistance * (slopePenalty + biomePenalty + crossingPenalty)
  return distanceKm * resistance * (roadMask?.[from] && roadMask[to] ? 0.6 : 1)
}
