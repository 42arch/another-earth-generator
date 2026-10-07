import {
  interpolateBlues,
  interpolateRdYlGn,
} from 'd3-scale-chromatic'
import { clamp } from '@/core/math/math'

export const HEIGHTMAP_MAX_OCEAN_DEPTH_KM = 8
export const HEIGHTMAP_MAX_LAND_ELEVATION_KM = 6
const HEIGHTMAP_OCEAN_PALETTE_START = 0.52

/** Map ocean depth to the D3 Blues palette, independently of land elevation. */
export function getHeightmapOceanColor(depthKm: number): string {
  const depth = clamp(depthKm / HEIGHTMAP_MAX_OCEAN_DEPTH_KM, 0, 1)
  const t = HEIGHTMAP_OCEAN_PALETTE_START + (1 - HEIGHTMAP_OCEAN_PALETTE_START) * depth
  return interpolateBlues(t)
}

/** Map land elevation to D3's RdYlGn scheme, with higher elevations trending red. */
export function getHeightmapLandColor(elevationKm: number): string {
  const elevation = clamp(elevationKm, 0, HEIGHTMAP_MAX_LAND_ELEVATION_KM)
  const t = 1 - elevation / HEIGHTMAP_MAX_LAND_ELEVATION_KM
  return interpolateRdYlGn(t)
}
