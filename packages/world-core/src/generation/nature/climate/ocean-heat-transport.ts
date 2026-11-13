import type { ClimateMesh } from './climate-mesh'
import { clamp } from '#math/math'

/**
 * A bounded upstream relaxation of the seasonal boundary warmth proxy.
 * Currents are relative, so distance is measured in reference-mesh edges.
 */
export function transportOceanWarmth(
  mesh: ClimateMesh,
  ocean: Uint8Array,
  east: Float32Array,
  north: Float32Array,
  boundaryWarmth: Float32Array,
  relaxationEdges: number,
): void {
  const weights = new Float32Array(mesh.neighbors.length)
  const blend = new Float32Array(mesh.numRegions)
  const renewal = 1 - Math.exp(-1 / relaxationEdges)
  const active = new Uint32Array(mesh.numRegions)
  let activeCount = 0
  for (let r = 0; r < mesh.numRegions; r++) {
    if (!ocean[r])
      continue
    const speed = Math.hypot(east[r], north[r])
    if (speed === 0)
      continue
    const latitude = mesh.regionLatitude[r]
    const longitude = mesh.regionLongitude[r]
    const sinLat = Math.sin(latitude)
    const sinLon = Math.sin(longitude)
    const cosLon = Math.cos(longitude)
    const x = east[r] * cosLon - north[r] * sinLat * sinLon
    const y = north[r] * Math.cos(latitude)
    const z = -east[r] * sinLon - north[r] * sinLat * cosLon
    const first = mesh.neighborOffsets[r]
    const end = mesh.neighborOffsets[r + 1]
    let total = 0
    for (let edge = first; edge < end; edge++) {
      if (!ocean[mesh.neighbors[edge]])
        continue
      const dx = mesh.neighborDx[edge]
      const dy = mesh.neighborDy[edge]
      const dz = mesh.neighborDz[edge]
      const alignment = (x * dx + y * dy + z * dz) / Math.hypot(dx, dy, dz)
      if (alignment > 0) {
        weights[edge] = alignment
        total += alignment
      }
    }
    if (total <= 0)
      continue
    for (let edge = first; edge < end; edge++)
      weights[edge] /= total
    blend[r] = (1 - renewal) * speed / (1 + speed)
    active[activeCount++] = r
  }

  let previous = new Float32Array(boundaryWarmth)
  let next = new Float32Array(boundaryWarmth)
  for (let step = 0; step < relaxationEdges; step++) {
    for (let i = 0; i < activeCount; i++) {
      const r = active[i]
      let upstream = 0
      for (let edge = mesh.neighborOffsets[r]; edge < mesh.neighborOffsets[r + 1]; edge++)
        upstream += weights[edge] * previous[mesh.neighbors[edge]]
      next[r] = clamp((1 - blend[r] - renewal) * previous[r] + blend[r] * upstream + renewal * boundaryWarmth[r], -1, 1)
    }
    const swap = previous
    previous = next
    next = swap
  }
  boundaryWarmth.set(previous)
}
