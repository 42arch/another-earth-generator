import type { SphericalMesh } from '@another-earth/world-core'
import type { MapOverlayGeometry } from './map-overlay-data'

export type MeshViewMode = 'icosphere' | 'voronoi'
export interface ViewStats {
  level: number
  irregularity: number
  seed: string
  fiveNeighborRegions: number
  regions: number
  edges: number
  faces: number
  generationMs: number
  cacheHit: boolean
  cacheBytes: number
  preparationMs: number
  renderBytes: number
  copyMs: number
  meshBytes: number
  receiveMs: number
  workerInitMs: number
  hydrateMs: number
  postMessageMs: number
}
export interface RenderGeometry {
  positions: Float32Array
  colors: Float32Array
  lines: Float32Array
  fiveNeighborCenters: Float32Array
  /** Per-vertex land classification, present only for the satellite surface shader. */
  satelliteLandMask?: Uint8Array
  climateVectorPositions?: Float32Array
  climateVectorColors?: Float32Array
  climateVectorKind?: 'wind' | 'ocean-current'
  waterPositions?: Float32Array
  waterIndices?: Uint32Array
}
export interface RegionSelection {
  region: number
  neighbors: number[]
  areaKm2: number
  ring: Float32Array
  spokes: Float32Array
  centers: Float32Array
}
/** Display-only conversion. Never changes the core-owned topology or transfers its buffers. */
export function prepareRenderGeometry(mesh: SphericalMesh, mode: MeshViewMode, regionColor?: (region: number) => readonly [number, number, number], landMask?: Uint8Array, overlays: MapOverlayGeometry = {}): RenderGeometry {
  const corners = mesh.boundaryCorners
  const vertexCount = mode === 'icosphere' ? mesh.triangles.length : corners.length * 3
  const positions = new Float32Array(vertexCount * 3)
  const colors = new Float32Array(vertexCount * 3)
  const satelliteLandMask = landMask ? new Uint8Array(vertexCount) : undefined
  const lines = new Float32Array(mesh.edgeRegions.length * 3)
  let fiveNeighborRegions = 0
  for (let r = 0; r < mesh.regionCount; r++) {
    if (mesh.neighborOffsets[r + 1] - mesh.neighborOffsets[r] === 5)
      fiveNeighborRegions++
  }
  const fiveNeighborCenters = new Float32Array(fiveNeighborRegions * 3)
  let fiveNeighborOffset = 0
  for (let r = 0; r < mesh.regionCount; r++) {
    if (mesh.neighborOffsets[r + 1] - mesh.neighborOffsets[r] === 5) {
      for (let axis = 0; axis < 3; axis++) fiveNeighborCenters[fiveNeighborOffset++] = mesh.centers[r * 3 + axis] * 1.002
    }
  }
  const color = (r: number, offset: number) => {
    if (satelliteLandMask && landMask)
      satelliteLandMask[offset / 3] = landMask[r]
    if (regionColor) {
      colors.set(regionColor(r), offset)
      return
    }
    const five = mesh.neighborOffsets[r + 1] - mesh.neighborOffsets[r] === 5
    const shade = 0.8 + (r * 137 % 31) / 155
    colors[offset] = (five ? 0.88 : 0.18) * shade
    colors[offset + 1] = (five ? 0.48 : 0.53) * shade
    colors[offset + 2] = (five ? 0.2 : 0.68) * shade
  }
  if (mode === 'icosphere') {
    for (let face = 0; face < mesh.triangles.length; face += 3) {
      const a = mesh.triangles[face]
      const b = mesh.triangles[face + 1]
      const c = mesh.triangles[face + 2]
      const touchesFiveNeighbor = mesh.neighborOffsets[a + 1] - mesh.neighborOffsets[a] === 5
        || mesh.neighborOffsets[b + 1] - mesh.neighborOffsets[b] === 5
        || mesh.neighborOffsets[c + 1] - mesh.neighborOffsets[c] === 5
      for (let corner = 0; corner < 3; corner++) {
        const region = mesh.triangles[face + corner]
        const offset = (face + corner) * 3
        for (let axis = 0; axis < 3; axis++) positions[offset + axis] = mesh.centers[region * 3 + axis]
        if (regionColor) {
          color(region, offset)
        }
        else {
          colors[offset] = touchesFiveNeighbor ? 0.88 : 0.18
          colors[offset + 1] = touchesFiveNeighbor ? 0.48 : 0.53
          colors[offset + 2] = touchesFiveNeighbor ? 0.2 : 0.68
        }
      }
    }
  }
  else {
    let offset = 0
    for (let r = 0; r < mesh.regionCount; r++) {
      const start = mesh.neighborOffsets[r]
      const end = mesh.neighborOffsets[r + 1]
      for (let i = start; i < end; i++) {
        const a = corners[i]
        const b = corners[i + 1 < end ? i + 1 : start]
        for (let axis = 0; axis < 3; axis++) {
          positions[offset + axis] = mesh.centers[r * 3 + axis]
          positions[offset + 3 + axis] = mesh.dualVertices[a * 3 + axis]
          positions[offset + 6 + axis] = mesh.dualVertices[b * 3 + axis]
        }
        for (let v = 0; v < 3; v++) color(r, offset + v * 3)
        offset += 9
      }
    }
  }
  const source = mode === 'icosphere' ? mesh.centers : mesh.dualVertices
  const edges = mode === 'icosphere' ? mesh.edgeRegions : mesh.edgeTriangles
  for (let i = 0; i < edges.length; i++) {
    for (let axis = 0; axis < 3; axis++) lines[i * 3 + axis] = source[edges[i] * 3 + axis] * 1.0005
  }
  return { positions, colors, lines, fiveNeighborCenters, satelliteLandMask, ...overlays }
}

export function prepareRegionSelection(mesh: SphericalMesh, region: number): RegionSelection {
  const start = mesh.neighborOffsets[region]
  const end = mesh.neighborOffsets[region + 1]
  const neighbors = Array.from(mesh.neighbors.subarray(start, end))
  const ring = new Float32Array((end - start) * 6)
  const arcSegments = 16
  const spokes = new Float32Array((end - start) * 6 * arcSegments)
  const centers = new Float32Array((neighbors.length + 1) * 3)
  for (let i = start; i < end; i++) {
    const a = mesh.boundaryCorners[i]
    const b = mesh.boundaryCorners[i + 1 < end ? i + 1 : start]
    const n = mesh.neighbors[i]
    const offset = (i - start) * 6
    // Subdivide and normalize display arcs so adjacency links stay outside the sphere.
    for (let segment = 0; segment < arcSegments; segment++) {
      for (let endpoint = 0; endpoint < 2; endpoint++) {
        const t = (segment + endpoint) / arcSegments
        const x = mesh.centers[region * 3] * (1 - t) + mesh.centers[n * 3] * t
        const y = mesh.centers[region * 3 + 1] * (1 - t) + mesh.centers[n * 3 + 1] * t
        const z = mesh.centers[region * 3 + 2] * (1 - t) + mesh.centers[n * 3 + 2] * t
        const scale = 1.004 / Math.hypot(x, y, z)
        const target = (i - start) * 6 * arcSegments + segment * 6 + endpoint * 3
        spokes[target] = x * scale
        spokes[target + 1] = y * scale
        spokes[target + 2] = z * scale
      }
    }
    for (let axis = 0; axis < 3; axis++) {
      ring[offset + axis] = mesh.dualVertices[a * 3 + axis] * 1.004
      ring[offset + 3 + axis] = mesh.dualVertices[b * 3 + axis] * 1.004
      centers[(i - start + 1) * 3 + axis] = mesh.centers[n * 3 + axis] * 1.006
    }
  }
  for (let axis = 0; axis < 3; axis++) centers[axis] = mesh.centers[region * 3 + axis] * 1.006
  return { region, neighbors, areaKm2: mesh.areaKm2[region], ring, spokes, centers }
}
