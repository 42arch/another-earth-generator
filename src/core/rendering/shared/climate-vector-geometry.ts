import type { ClimateVectorDisplayData } from '@/core/climate/climate-data'
import type SphericalMesh from '@/core/mesh/mesh'
import { BufferAttribute, BufferGeometry, Color } from 'three'
import { getOceanCurrentThermalColor } from '@/core/rendering/shared/climate-color-scale'

type Vector3 = readonly [number, number, number]

const MAX_ARROWS = 2800
const MAX_WIND_ARROWS = 2400
const WIND_ARROW_SAMPLE_RATIO = 0.9
const MIN_STRENGTH = 0.05

function normalize(x: number, y: number, z: number): Vector3 {
  const length = Math.hypot(x, y, z) || 1
  return [x / length, y / length, z / length]
}

function advance(center: Vector3, tangent: Vector3, angle: number): Vector3 {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return normalize(
    center[0] * cosine + tangent[0] * sine,
    center[1] * cosine + tangent[1] * sine,
    center[2] * cosine + tangent[2] * sine,
  )
}

function appendSegment(positions: number[], start: Vector3, end: Vector3, radius: number, colors?: number[], color?: Color): void {
  positions.push(
    start[0] * radius,
    start[1] * radius,
    start[2] * radius,
    end[0] * radius,
    end[1] * radius,
    end[2] * radius,
  )
  if (colors && color)
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b)
}

/** Sparse great-circle arrows with the same east/north basis as the climate solver. */
export function createClimateVectorGeometry(
  mesh: SphericalMesh,
  vectors: ClimateVectorDisplayData,
  landMask: Uint8Array,
  radius: number,
): BufferGeometry {
  if (vectors.east.length !== mesh.numRegions || vectors.north.length !== mesh.numRegions)
    throw new Error('Climate vector field does not match the output mesh')
  if (vectors.kind === 'ocean-current' && vectors.warmth?.length !== mesh.numRegions)
    throw new Error('Ocean-current thermal field does not match the output mesh')
  const positions: number[] = []
  const colors: number[] | undefined = vectors.kind === 'ocean-current' ? [] : undefined
  const count = vectors.kind === 'wind'
    ? Math.min(MAX_WIND_ARROWS, Math.max(1, Math.round(mesh.numRegions * WIND_ARROW_SAMPLE_RATIO)))
    : Math.min(MAX_ARROWS, mesh.numRegions)
  const referenceStrength = vectors.kind === 'wind' ? 0.75 : 1.5
  for (let sample = 0; sample < count; sample++) {
    // Jitter within equal-area Fibonacci index bands to avoid longitude aliasing.
    const hash = Math.imul(sample + 1, 0x9E3779B1) >>> 0
    const jitter = ((hash ^ (hash >>> 16)) >>> 0) / 0x100000000
    const region = Math.min(mesh.numRegions - 1, Math.floor((sample + jitter) * mesh.numRegions / count))
    if (vectors.kind === 'ocean-current' && landMask[region])
      continue
    const east = vectors.east[region]
    const north = vectors.north[region]
    const strength = Math.hypot(east, north)
    if (!Number.isFinite(strength) || strength < MIN_STRENGTH)
      continue

    const index = 3 * region
    const center: Vector3 = [mesh.regionPosition[index], mesh.regionPosition[index + 1], mesh.regionPosition[index + 2]]
    const latitude = mesh.regionLatitude[region]
    const longitude = mesh.regionLongitude[region]
    const sinLat = Math.sin(latitude)
    const cosLat = Math.cos(latitude)
    const sinLon = Math.sin(longitude)
    const cosLon = Math.cos(longitude)
    const tangent = normalize(
      (east * cosLon - north * sinLat * sinLon) / strength,
      north * cosLat / strength,
      (-east * sinLon - north * sinLat * cosLon) / strength,
    )
    const side = normalize(
      center[1] * tangent[2] - center[2] * tangent[1],
      center[2] * tangent[0] - center[0] * tangent[2],
      center[0] * tangent[1] - center[1] * tangent[0],
    )
    const length = (0.032 + 0.025 * Math.min(strength / referenceStrength, 1)) * 0.58
    const start = advance(center, tangent, -length * 0.5)
    const tip = advance(center, tangent, length * 0.5)
    const base = advance(center, tangent, length * 0.28)
    const headWidth = length * 0.075
    const left = normalize(base[0] + side[0] * headWidth, base[1] + side[1] * headWidth, base[2] + side[2] * headWidth)
    const right = normalize(base[0] - side[0] * headWidth, base[1] - side[1] * headWidth, base[2] - side[2] * headWidth)
    const color = colors ? new Color(getOceanCurrentThermalColor(vectors.warmth![region])) : undefined
    appendSegment(positions, start, tip, radius, colors, color)
    appendSegment(positions, tip, left, radius, colors, color)
    appendSegment(positions, tip, right, radius, colors, color)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  if (colors)
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  geometry.computeBoundingSphere()
  return geometry
}
