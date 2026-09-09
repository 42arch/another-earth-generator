import type { GlobeGenParams } from '@/core/spherical/config'
import type { SphericalMeshData } from '@/core/spherical/mesh/icosphere-builder'
import type { SphericalVoronoiData } from '@/core/spherical/mesh/spherical-voronoi'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type { SphericalWorldData } from '@/core/spherical/spherical-world-data'
import type { GenerationStage } from '@/core/world/generation-plan'

export interface MeshSnapshot extends SphericalMeshData {
  voronoi: SphericalVoronoiData
}

export interface GenerationRequest {
  id: number
  params: GlobeGenParams
  stage: GenerationStage | null
  meshRevision: number
}

export interface GenerationResult {
  type: 'result'
  id: number
  mesh?: MeshSnapshot
  meshRevision: number
  data: SphericalWorldData
  stage: GenerationStage | null
  timings: Record<string, number>
}

export type GenerationResponse = GenerationResult
  | { type: 'progress', id: number, stage: string }
  | { type: 'error', id: number, message: string }

export function snapshotMesh(mesh: SphericalMesh): MeshSnapshot {
  const v = mesh.voronoi
  return {
    numRegions: mesh.numRegions,
    numTriangles: mesh.numTriangles,
    regionPosition: mesh.regionPosition,
    regionLatitude: mesh.regionLatitude,
    regionLongitude: mesh.regionLongitude,
    regionArea: mesh.regionArea,
    neighborOffsets: mesh.neighborOffsets,
    neighbors: mesh.neighbors,
    triangles: mesh.triangles,
    voronoi: {
      cornerPosition: v.cornerPosition,
      cellCornerOffsets: v.cellCornerOffsets,
      cellCorners: v.cellCorners,
      cellArea: v.cellArea,
      edgeRegions: v.edgeRegions,
      edgeCorners: v.edgeCorners,
    },
  }
}
