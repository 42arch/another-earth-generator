import type { SphericalMesh } from '#mesh/spherical-mesh'
import type { SeasonalCirculationData } from './climate-data'

type ProjectionMesh = Pick<SphericalMesh, 'centers' | 'regionCount' | 'neighborOffsets' | 'neighbors'>

/** Four seasonal anchors in the output mesh's local tangent frames, in model units. */
export type ProjectedCirculation = Pick<SeasonalCirculationData, 'windEast' | 'windNorth' | 'oceanEast' | 'oceanNorth' | 'oceanWarmth'>

function tangentBasis(centers: Float64Array, region: number) {
  const x = centers[3 * region]
  const y = centers[3 * region + 1]
  const z = centers[3 * region + 2]
  const horizontal = Math.hypot(x, z)
  // Longitude zero at an exact pole, matching the mesh's atan2(x, z) convention.
  const ex = horizontal > 0 ? z / horizontal : 1
  const ez = horizontal > 0 ? -x / horizontal : 0
  return { x, y, z, ex, ez, nx: y * ez, ny: horizontal, nz: -y * ex }
}

/** Rotation of east/north components under shortest-great-circle parallel transport. */
export function tangentTransportRotation(source: Float64Array, from: number, output: Float64Array, to: number): { cos: number, sin: number } {
  const p = tangentBasis(source, from)
  const q = tangentBasis(output, to)
  const denominator = 1 + p.x * q.x + p.y * q.y + p.z * q.z
  // At antipodes the shortest path is ambiguous; choose the source east rotation axis.
  const factor = denominator > 1e-12 ? (p.ex * q.x + p.ez * q.z) / denominator : 0
  const tx = p.ex - factor * (p.x + q.x)
  const ty = -factor * (p.y + q.y)
  const tz = p.ez - factor * (p.z + q.z)
  const cos = tx * q.ex + tz * q.ez
  const sin = tx * q.nx + ty * q.ny + tz * q.nz
  const length = Math.hypot(cos, sin)
  return { cos: cos / length, sin: sin / length }
}

function nearestWeights(output: ProjectionMesh, region: number, reference: ProjectionMesh, candidates: readonly number[]) {
  const selected = candidates.map((source) => {
    const dx = output.centers[3 * region] - reference.centers[3 * source]
    const dy = output.centers[3 * region + 1] - reference.centers[3 * source + 1]
    const dz = output.centers[3 * region + 2] - reference.centers[3 * source + 2]
    return { source, distanceSquared: dx * dx + dy * dy + dz * dz }
  }).sort((a, b) => a.distanceSquared - b.distanceSquared || a.source - b.source).slice(0, 3)
  if (selected[0].distanceSquared < 1e-20)
    return [{ source: selected[0].source, weight: 1 }]
  const total = selected.reduce((sum, item) => sum + 1 / item.distanceSquared, 0)
  return selected.map(item => ({ source: item.source, weight: (1 / item.distanceSquared) / total }))
}

export function projectSeasonalCirculation(
  output: ProjectionMesh,
  reference: ProjectionMesh,
  land: Uint8Array,
  referenceLand: Uint8Array,
  nearest: Uint32Array,
  water: { mapping: Int32Array, component: Int32Array, owner: Int32Array },
  source: SeasonalCirculationData,
  check?: (fraction: number) => void,
): ProjectedCirculation {
  const count = output.regionCount
  const result: ProjectedCirculation = {
    windEast: new Float32Array(4 * count),
    windNorth: new Float32Array(4 * count),
    oceanEast: new Float32Array(4 * count),
    oceanNorth: new Float32Array(4 * count),
    oceanWarmth: new Float32Array(4 * count),
  }
  for (let region = 0; region < count; region++) {
    if (region % 1024 === 0)
      check?.(region / count)
    for (const kind of ['wind', 'ocean'] as const) {
      const center = kind === 'wind' ? nearest[region] : water.mapping[region]
      if (center < 0)
        continue
      const candidates = [center]
      for (let edge = reference.neighborOffsets[center]; edge < reference.neighborOffsets[center + 1]; edge++) {
        const neighbor = reference.neighbors[edge]
        // An ocean candidate must be one water edge away and owned by this output water body.
        if (kind === 'wind' || (!referenceLand[neighbor] && water.owner[neighbor] === water.component[region]))
          candidates.push(neighbor)
      }
      const sameSurface = kind === 'wind' ? candidates.filter(r => referenceLand[r] === land[region]) : candidates
      const weights = nearestWeights(output, region, reference, sameSurface.length ? sameSurface : candidates)
      const east = kind === 'wind' ? 'windEast' : 'oceanEast'
      const north = kind === 'wind' ? 'windNorth' : 'oceanNorth'
      const samples = weights.map(({ source: from, weight }) => ({
        from,
        weight,
        ...tangentTransportRotation(reference.centers, from, output.centers, region),
      }))
      for (let season = 0; season < 4; season++) {
        let projectedEast = 0
        let projectedNorth = 0
        let warmth = 0
        for (const { from, weight, cos, sin } of samples) {
          const input = season * reference.regionCount + from
          const e = source[east][input]
          const n = source[north][input]
          projectedEast += weight * (cos * e - sin * n)
          projectedNorth += weight * (sin * e + cos * n)
          if (kind === 'ocean')
            warmth += weight * source.oceanWarmth[input]
        }
        const index = season * count + region
        result[east][index] = projectedEast
        result[north][index] = projectedNorth
        if (kind === 'ocean')
          result.oceanWarmth[index] = Math.max(-1, Math.min(1, warmth))
      }
    }
  }
  check?.(1)
  return result
}
