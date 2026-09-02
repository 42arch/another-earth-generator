import type {
  SphericalLinePath,
  SphericalLineSegment,
  SphericalPoint,
} from '@/core/spherical/geometry/spherical-polyline'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import { stitchSphericalSegments } from '@/core/spherical/geometry/spherical-polyline'

export interface CoastEdgeInfo {
  landRegion: number
  waterRegion: number
}

export interface SphericalCoastlineData {
  paths: SphericalLinePath[]
  edgeInfo: Map<string, CoastEdgeInfo>
}

/**
 * 从球面 Voronoi 拓扑中提取海陆分界。返回值不包含任何 Three.js 几何，
 * 因而可同时供 3D 球面填缝与 2D 投影描边使用。
 */
export class SphericalCoastlineSource {
  create(mesh: SphericalMesh, landMask: Uint8Array): SphericalCoastlineData {
    const corners = new Map<string, SphericalPoint>()
    const segments: SphericalLineSegment[] = []
    const edgeInfo = new Map<string, CoastEdgeInfo>()

    for (let edge = 0; edge < mesh.voronoi.edgeRegions.length / 2; edge++) {
      const index = edge * 2
      const regionA = mesh.voronoi.edgeRegions[index]
      const regionB = mesh.voronoi.edgeRegions[index + 1]
      if (landMask[regionA] === landMask[regionB])
        continue

      const cornerA = mesh.voronoi.edgeCorners[index]
      const cornerB = mesh.voronoi.edgeCorners[index + 1]
      const keyA = String(cornerA)
      const keyB = String(cornerB)
      corners.set(keyA, this.getCornerPosition(mesh, cornerA))
      corners.set(keyB, this.getCornerPosition(mesh, cornerB))
      segments.push({ start: keyA, end: keyB })

      const edgeKey = keyA < keyB ? `${keyA}:${keyB}` : `${keyB}:${keyA}`
      const landRegion = landMask[regionA] !== 0 ? regionA : regionB
      edgeInfo.set(edgeKey, {
        landRegion,
        waterRegion: landRegion === regionA ? regionB : regionA,
      })
    }

    return {
      paths: stitchSphericalSegments(segments, corners),
      edgeInfo,
    }
  }

  private getCornerPosition(mesh: SphericalMesh, corner: number): SphericalPoint {
    const index = corner * 3
    return [
      mesh.voronoi.cornerPosition[index],
      mesh.voronoi.cornerPosition[index + 1],
      mesh.voronoi.cornerPosition[index + 2],
    ]
  }
}
