import type { ClimateArtifact, HydrologyArtifact, SphericalMesh, StaticLakeArtifact, TerrainArtifact } from '@another-earth/world-core'
import { sampleClimateCirculation } from '@another-earth/world-core'
import type { GeologyTheme } from './map-theme-data'

export interface MapOverlayGeometry {
  climateVectorPositions?: Float32Array
  climateVectorColors?: Float32Array
  waterPositions?: Float32Array
  waterIndices?: Uint32Array
  climateVectorKind?: 'wind' | 'ocean-current'
}

type Vector3 = readonly [number, number, number]

const VECTOR_RADIUS = 1.004
const MIN_VECTOR_STRENGTH = 0.05
const MAX_WIND_ARROWS = 2400
const MAX_CURRENT_ARROWS = 2800

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

function linearColor(hex: string): Vector3 {
  const value = Number.parseInt(hex.slice(1), 16)
  const convert = (shift: number) => {
    const channel = ((value >> shift) & 0xff) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }
  return [convert(16), convert(8), convert(0)]
}

function mixColor(a: Vector3, b: Vector3, amount: number): Vector3 {
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount]
}

function currentColor(warmth: number): Vector3 {
  const cold = linearColor('#2166AC')
  const neutral = linearColor('#F7F7F7')
  const warm = linearColor('#B2182B')
  const value = Math.max(-1, Math.min(1, warmth))
  return value < 0 ? mixColor(cold, neutral, value + 1) : mixColor(neutral, warm, value)
}

function climateVectorGeometry(mesh: SphericalMesh, climate: ClimateArtifact, month: number, kind: 'wind' | 'ocean-current', landMask?: Uint8Array): MapOverlayGeometry | undefined {
  const regionCount = mesh.regionCount
  if (!regionCount || climate.regionCount !== regionCount)
    return undefined

  const positions: number[] = []
  const colors: number[] | undefined = kind === 'ocean-current' ? [] : undefined
  const count = kind === 'wind'
    ? Math.min(MAX_WIND_ARROWS, Math.max(1, Math.round(regionCount * 0.9)))
    : Math.min(MAX_CURRENT_ARROWS, regionCount)
  const referenceStrength = kind === 'wind' ? 0.75 : 1.5

  const append = (start: Vector3, end: Vector3, color?: Vector3) => {
    positions.push(start[0] * VECTOR_RADIUS, start[1] * VECTOR_RADIUS, start[2] * VECTOR_RADIUS)
    positions.push(end[0] * VECTOR_RADIUS, end[1] * VECTOR_RADIUS, end[2] * VECTOR_RADIUS)
    if (colors && color)
      colors.push(...color, ...color)
  }

  for (let sample = 0; sample < count; sample++) {
    const hash = Math.imul(sample + 1, 0x9E3779B1) >>> 0
    const jitter = ((hash ^ (hash >>> 16)) >>> 0) / 0x1_0000_0000
    const region = Math.min(regionCount - 1, Math.floor((sample + jitter) * regionCount / count))
    if (kind === 'ocean-current' && (landMask?.[region] || climate.oceanReference[region] < 0))
      continue

    const eastField = kind === 'wind' ? 'windEast' : 'oceanEast'
    const northField = kind === 'wind' ? 'windNorth' : 'oceanNorth'
    const east = sampleClimateCirculation(climate, region, month, eastField)
    const north = sampleClimateCirculation(climate, region, month, northField)
    const strength = Math.hypot(east, north)
    if (!Number.isFinite(strength) || strength < MIN_VECTOR_STRENGTH)
      continue

    const offset = 3 * region
    const center = normalize(mesh.centers[offset], mesh.centers[offset + 1], mesh.centers[offset + 2])
    const latitude = Math.asin(Math.max(-1, Math.min(1, center[1])))
    const longitude = Math.atan2(center[0], center[2])
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
    const color = kind === 'ocean-current' ? currentColor(sampleClimateCirculation(climate, region, month, 'oceanWarmth')) : undefined
    append(start, tip, color)
    append(tip, left, color)
    append(tip, right, color)
  }

  if (!positions.length)
    return undefined
  return {
    climateVectorPositions: Float32Array.from(positions),
    climateVectorColors: colors ? Float32Array.from(colors) : undefined,
    climateVectorKind: kind,
  }
}

function dot(a: Vector3, b: Vector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function normalizePoint(point: Vector3): Vector3 {
  const length = Math.hypot(point[0], point[1], point[2]) || 1
  return [point[0] / length, point[1] / length, point[2] / length]
}

function catmullRom(a: Vector3, b: Vector3, c: Vector3, d: Vector3, t: number): Vector3 {
  const t2 = t * t
  const t3 = t2 * t
  return normalizePoint([
    0.5 * ((2 * b[0]) + (-a[0] + c[0]) * t + (2 * a[0] - 5 * b[0] + 4 * c[0] - d[0]) * t2 + (-a[0] + 3 * b[0] - 3 * c[0] + d[0]) * t3),
    0.5 * ((2 * b[1]) + (-a[1] + c[1]) * t + (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * t2 + (-a[1] + 3 * b[1] - 3 * c[1] + d[1]) * t3),
    0.5 * ((2 * b[2]) + (-a[2] + c[2]) * t + (2 * a[2] - 5 * b[2] + 4 * c[2] - d[2]) * t2 + (-a[2] + 3 * b[2] - 3 * c[2] + d[2]) * t3),
  ])
}

function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

function sharedBoundaryMidpoint(mesh: SphericalMesh, region: number, neighbor: number): Vector3 | undefined {
  const start = mesh.neighborOffsets[region]
  const end = mesh.neighborOffsets[region + 1]
  let edge = -1
  for (let slot = start; slot < end; slot++) {
    if (mesh.neighbors[slot] === neighbor) {
      edge = mesh.neighborEdges[slot]
      break
    }
  }
  if (edge < 0)
    return undefined
  const firstTriangle = mesh.edgeTriangles[edge * 2]
  const secondTriangle = mesh.edgeTriangles[edge * 2 + 1]
  const first = firstTriangle * 3
  const second = secondTriangle * 3
  return normalizePoint([
    mesh.dualVertices[first] + mesh.dualVertices[second],
    mesh.dualVertices[first + 1] + mesh.dualVertices[second + 1],
    mesh.dualVertices[first + 2] + mesh.dualVertices[second + 2],
  ])
}

function riverGeometry(mesh: SphericalMesh, hydrology: HydrologyArtifact, terrain?: TerrainArtifact | null, lakes?: StaticLakeArtifact | null): MapOverlayGeometry | undefined {
  if (hydrology.regionCount !== mesh.regionCount || !hydrology.rivers.length)
    return undefined

  const positions: number[] = []
  const indices: number[] = []
  let maximumFlow = 0
  for (let region = 0; region < hydrology.regionCount; region++) {
    if (hydrology.riverMask[region])
      maximumFlow = Math.max(maximumFlow, hydrology.accumulatedAnnualFlowM3s[region])
  }
  const baseCellAngle = Math.sqrt(4 * Math.PI / mesh.regionCount)
  const flowAt = (region: number) => Math.max(0, hydrology.accumulatedAnnualFlowM3s[region])
  const widthAt = (region: number) => {
    const share = maximumFlow > 0 ? Math.sqrt(Math.log1p(flowAt(region)) / Math.log1p(maximumFlow)) : 0
    return baseCellAngle * 0.22 * share ** 1.5
  }
  const upstreamCount = new Uint8Array(hydrology.regionCount)
  for (let region = 0; region < hydrology.regionCount; region++) {
    const downstream = hydrology.downstreamRegion[region]
    if (hydrology.riverMask[region] && downstream >= 0 && hydrology.riverMask[downstream])
      upstreamCount[downstream]++
  }

  const riverPaths = hydrology.rivers.map(river => ({ regions: Array.from(river.regions), mouthRegion: river.mouthRegion, synthetic: false }))
  if (lakes) {
    for (const lake of lakes.lakes) {
      const spill = lake.spillRegion
      const downstream = lake.downstreamRegion
      if (spill === null || downstream === null || hydrology.riverMask[spill] || !hydrology.riverMask[downstream])
        continue
      riverPaths.push({ regions: [spill, downstream], mouthRegion: downstream, synthetic: true })
    }
  }

  for (const river of riverPaths) {
    const pathRegions = [...river.regions]
    const downstream = hydrology.downstreamRegion[river.mouthRegion]
    let coastMouth: Vector3 | undefined
    if (downstream >= 0 && (hydrology.riverMask[downstream] || (lakes && lakes.lakeIndex[downstream] >= 0) || (terrain?.landMask[downstream] && hydrology.riverIndex[downstream] >= 0)))
      pathRegions.push(downstream)
    else if (downstream >= 0 && terrain?.landMask[river.mouthRegion] && !terrain.landMask[downstream]) {
      coastMouth = sharedBoundaryMidpoint(mesh, river.mouthRegion, downstream)
      if (coastMouth)
        pathRegions.push(river.mouthRegion)
    }
    if (pathRegions.length < 2)
      continue

    const centers: Vector3[] = pathRegions.map((region) => {
      const offset = region * 3
      return normalize(mesh.centers[offset], mesh.centers[offset + 1], mesh.centers[offset + 2])
    })
    if (coastMouth)
      centers[centers.length - 1] = coastMouth
    const headwater = !river.synthetic && upstreamCount[pathRegions[0]] === 0
    const pathDistance = new Float64Array(pathRegions.length)
    for (let index = 1; index < pathRegions.length; index++) {
      const angle = Math.acos(Math.max(-1, Math.min(1, dot(centers[index - 1], centers[index]))))
      pathDistance[index] = pathDistance[index - 1] + angle
    }
    const pathWidth = (index: number) => {
      const width = widthAt(pathRegions[index])
      if (!headwater)
        return width
      const sourceWidth = baseCellAngle * 0.08
      const growth = smoothstep(pathDistance[index] / (baseCellAngle * 3))
      return sourceWidth + Math.max(0, width - sourceWidth) * growth
    }
    const vertices: { center: Vector3, width: number }[] = []
    for (let index = 0; index < centers.length - 1; index++) {
      const subdivisions = Math.max(4, Math.ceil((pathDistance[index + 1] - pathDistance[index]) / (baseCellAngle * 0.2)))
      const widthA = pathWidth(index)
      const widthB = pathWidth(index + 1)
      const previous = centers[Math.max(0, index - 1)]
      const next = centers[Math.min(centers.length - 1, index + 2)]
      for (let step = 0; step < subdivisions; step++) {
        const t = step / subdivisions
        vertices.push({ center: catmullRom(previous, centers[index], centers[index + 1], next, t), width: widthA * (1 - t) + widthB * t })
      }
    }
    vertices.push({ center: centers[centers.length - 1], width: pathWidth(pathRegions.length - 1) })

    const ribbonBase = positions.length / 3
    for (let index = 0; index < vertices.length; index++) {
        const current = vertices[index]
        const previous = vertices[Math.max(0, index - 1)].center
        const next = vertices[Math.min(vertices.length - 1, index + 1)].center
        const tangent = normalizePoint([
          next[0] - previous[0] - current.center[0] * dot([next[0] - previous[0], next[1] - previous[1], next[2] - previous[2]], current.center),
          next[1] - previous[1] - current.center[1] * dot([next[0] - previous[0], next[1] - previous[1], next[2] - previous[2]], current.center),
          next[2] - previous[2] - current.center[2] * dot([next[0] - previous[0], next[1] - previous[1], next[2] - previous[2]], current.center),
        ])
        const side = normalizePoint(cross(current.center, tangent))
        const halfWidth = current.width * 0.5
        const left = normalizePoint([current.center[0] + side[0] * halfWidth, current.center[1] + side[1] * halfWidth, current.center[2] + side[2] * halfWidth])
        const right = normalizePoint([current.center[0] - side[0] * halfWidth, current.center[1] - side[1] * halfWidth, current.center[2] - side[2] * halfWidth])
        positions.push(left[0] * VECTOR_RADIUS, left[1] * VECTOR_RADIUS, left[2] * VECTOR_RADIUS)
        positions.push(right[0] * VECTOR_RADIUS, right[1] * VECTOR_RADIUS, right[2] * VECTOR_RADIUS)
        if (index > 0) {
          const previousPair = ribbonBase + (index - 1) * 2
          const currentPair = ribbonBase + index * 2
          indices.push(previousPair, previousPair + 1, currentPair + 1, previousPair, currentPair + 1, currentPair)
        }
    }
  }

  // Circular junction fills hide hairline gaps where independently routed
  // tributary ribbons meet at a confluence.
  for (let region = 0; region < hydrology.regionCount; region++) {
    if (!hydrology.riverMask[region] || upstreamCount[region] < 2)
      continue
    const offset = region * 3
    const center = normalize(mesh.centers[offset], mesh.centers[offset + 1], mesh.centers[offset + 2])
    const reference: Vector3 = Math.abs(center[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
    const tangentA = normalizePoint(cross(center, reference))
    const tangentB = normalizePoint(cross(center, tangentA))
    const radius = widthAt(region) * 0.58
    const diskBase = positions.length / 3
    positions.push(center[0] * VECTOR_RADIUS, center[1] * VECTOR_RADIUS, center[2] * VECTOR_RADIUS)
    const sides = 12
    for (let side = 0; side < sides; side++) {
      const angle = side / sides * Math.PI * 2
      const point = normalizePoint([
        center[0] + radius * (Math.cos(angle) * tangentA[0] + Math.sin(angle) * tangentB[0]),
        center[1] + radius * (Math.cos(angle) * tangentA[1] + Math.sin(angle) * tangentB[1]),
        center[2] + radius * (Math.cos(angle) * tangentA[2] + Math.sin(angle) * tangentB[2]),
      ])
      positions.push(point[0] * VECTOR_RADIUS, point[1] * VECTOR_RADIUS, point[2] * VECTOR_RADIUS)
    }
    for (let side = 0; side < sides; side++)
      indices.push(diskBase, diskBase + 1 + side, diskBase + 1 + (side + 1) % sides)
  }

  if (!indices.length)
    return undefined
  return { waterPositions: Float32Array.from(positions), waterIndices: Uint32Array.from(indices) }
}

function lakeGeometry(mesh: SphericalMesh, lakes: StaticLakeArtifact): MapOverlayGeometry | undefined {
  if (lakes.regionCount !== mesh.regionCount || !lakes.lakes.length)
    return undefined
  const positions: number[] = []
  const indices: number[] = []
  for (let lakeIndex = 0; lakeIndex < lakes.lakes.length; lakeIndex++) {
    const lake = lakes.lakes[lakeIndex]
    const adjacency = new Map<number, number[]>()
    const boundaryEdges: [number, number][] = []
    for (const region of lake.regions) {
      for (let slot = mesh.neighborOffsets[region]; slot < mesh.neighborOffsets[region + 1]; slot++) {
        if (lakes.lakeIndex[mesh.neighbors[slot]] === lakeIndex)
          continue
        const edge = mesh.neighborEdges[slot]
        const a = mesh.edgeTriangles[edge * 2]
        const b = mesh.edgeTriangles[edge * 2 + 1]
        boundaryEdges.push([a, b])
        adjacency.set(a, [...(adjacency.get(a) ?? []), b])
        adjacency.set(b, [...(adjacency.get(b) ?? []), a])
      }
    }
    const remaining = new Set(boundaryEdges.map(([a, b]) => `${Math.min(a, b)}:${Math.max(a, b)}`))
    while (remaining.size) {
      const [firstKey] = remaining
      if (!firstKey)
        break
      const [first, second] = firstKey.split(':').map(Number)
      const loop = [first]
      let previous = first
      let current = second
      remaining.delete(firstKey)
      let guard = boundaryEdges.length + 1
      while (current !== first && guard-- > 0) {
        loop.push(current)
        const next = (adjacency.get(current) ?? []).find(candidate => candidate !== previous && remaining.has(`${Math.min(current, candidate)}:${Math.max(current, candidate)}`))
        if (next === undefined)
          break
        remaining.delete(`${Math.min(current, next)}:${Math.max(current, next)}`)
        previous = current
        current = next
      }
      if (loop.length < 3 || current !== first)
        continue

      const corners = loop.map((triangle) => {
        const offset = triangle * 3
        return normalize(mesh.dualVertices[offset], mesh.dualVertices[offset + 1], mesh.dualVertices[offset + 2])
      })
      const contour: Vector3[] = []
      for (let index = 0; index < corners.length; index++) {
        const previous = corners[(index - 1 + corners.length) % corners.length]
        const current = corners[index]
        const next = corners[(index + 1) % corners.length]
        const afterNext = corners[(index + 2) % corners.length]
        for (let step = 0; step < 4; step++)
          contour.push(catmullRom(previous, current, next, afterNext, step / 4))
      }
      const centerSum: [number, number, number] = [0, 0, 0]
      for (const point of contour) {
        centerSum[0] += point[0]
        centerSum[1] += point[1]
        centerSum[2] += point[2]
      }
      const center = normalizePoint(centerSum)
      const centerIndex = positions.length / 3
      positions.push(center[0] * VECTOR_RADIUS, center[1] * VECTOR_RADIUS, center[2] * VECTOR_RADIUS)
      for (const point of contour)
        positions.push(point[0] * VECTOR_RADIUS, point[1] * VECTOR_RADIUS, point[2] * VECTOR_RADIUS)
      for (let corner = 0; corner < contour.length; corner++)
        indices.push(centerIndex, centerIndex + 1 + corner, centerIndex + 1 + (corner + 1) % contour.length)
    }
  }
  return indices.length ? { waterPositions: Float32Array.from(positions), waterIndices: Uint32Array.from(indices) } : undefined
}

export function prepareMapOverlayGeometry(
  mesh: SphericalMesh,
  theme: GeologyTheme,
  climate?: ClimateArtifact | null,
  month = 0,
  terrain?: TerrainArtifact | null,
  hydrology?: HydrologyArtifact | null,
  showRivers = false,
  lakes?: StaticLakeArtifact | null,
  showLakes = false,
): MapOverlayGeometry {
  const climateVectors = (theme === 'wind' || theme === 'ocean-current') && climate
    ? climateVectorGeometry(mesh, climate, month, theme === 'wind' ? 'wind' : 'ocean-current', terrain?.landMask)
    : undefined
  const rivers = (theme === 'rivers' || showRivers) && hydrology
    ? riverGeometry(mesh, hydrology, terrain, lakes)
    : undefined
  const lakeOverlay = (theme === 'lakes' || showLakes) && lakes
    ? lakeGeometry(mesh, lakes)
    : undefined
  if (!rivers?.waterPositions)
    return { ...climateVectors, ...lakeOverlay }
  if (!lakeOverlay?.waterPositions)
    return { ...climateVectors, ...rivers }
  const vertexOffset = rivers.waterPositions.length / 3
  const waterIndices = new Uint32Array(rivers.waterIndices!.length + lakeOverlay.waterIndices!.length)
  waterIndices.set(rivers.waterIndices!)
  for (let index = 0; index < lakeOverlay.waterIndices!.length; index++)
    waterIndices[rivers.waterIndices!.length + index] = lakeOverlay.waterIndices![index] + vertexOffset
  const waterPositions = new Float32Array(rivers.waterPositions.length + lakeOverlay.waterPositions.length)
  waterPositions.set(rivers.waterPositions)
  waterPositions.set(lakeOverlay.waterPositions, rivers.waterPositions.length)
  return { ...climateVectors, waterPositions, waterIndices }
}
