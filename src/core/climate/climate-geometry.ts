import type SphericalMesh from '@/core/mesh/mesh'

export const DEG = Math.PI / 180
export const EARTH_RADIUS_KM = 6371

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

export function smoothstep(low: number, high: number, value: number): number {
  const t = clamp((value - low) / (high - low), 0, 1)
  return t * t * (3 - 2 * t)
}

export function gaussian(distance: number, width: number): number {
  const x = distance / width
  return Math.exp(-0.5 * x * x)
}

/** Graph distance from the seed regions, constrained to the specified mask. */
export function graphDistance(mesh: SphericalMesh, allowed: Uint8Array, seeds: Uint8Array): Int32Array {
  const distance = new Int32Array(mesh.numRegions).fill(-1)
  const queue = new Uint32Array(mesh.numRegions)
  let tail = 0
  for (let region = 0; region < mesh.numRegions; region++) {
    if (allowed[region] && seeds[region]) {
      distance[region] = 0
      queue[tail++] = region
    }
  }
  for (let head = 0; head < tail; head++) {
    const region = queue[head]
    const nextDistance = distance[region] + 1
    for (let index = mesh.neighborOffsets[region]; index < mesh.neighborOffsets[region + 1]; index++) {
      const neighbor = mesh.neighbors[index]
      if (allowed[neighbor] && distance[neighbor] < 0) {
        distance[neighbor] = nextDistance
        queue[tail++] = neighbor
      }
    }
  }
  return distance
}

export function smoothMasked(mesh: SphericalMesh, field: Float32Array, mask: Uint8Array, passes: number): void {
  const next = new Float32Array(field.length)
  for (let pass = 0; pass < passes; pass++) {
    for (let region = 0; region < mesh.numRegions; region++) {
      if (!mask[region]) {
        next[region] = field[region]
        continue
      }
      let sum = field[region]
      let count = 1
      for (let index = mesh.neighborOffsets[region]; index < mesh.neighborOffsets[region + 1]; index++) {
        const neighbor = mesh.neighbors[index]
        if (mask[neighbor]) {
          sum += field[neighbor]
          count++
        }
      }
      next[region] = sum / count
    }
    field.set(next)
  }
}

export function averageEdgeKm(regionCount: number): number {
  return Math.PI * EARTH_RADIUS_KM / Math.sqrt(regionCount)
}
