import type { SphericalLineSegment, SphericalPoint } from '@/core/spherical/geometry/spherical-polyline'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import {
  createSmoothSphericalLinePositions,
  stitchSphericalSegments,
} from '@/core/spherical/geometry/spherical-polyline'

export class SphericalContourGeometry {
  createLinePositions(
    mesh: SphericalMesh,
    values: Float32Array,
    thresholds: readonly number[],
    radius: number,
  ): Float32Array {
    const positions: number[] = []
    for (const threshold of thresholds) {
      const intersections = new Map<string, SphericalPoint>()
      const segments: SphericalLineSegment[] = []
      for (let triangle = 0; triangle < mesh.numTriangles; triangle++) {
        const side = triangle * 3
        const regions = [
          mesh.triangles[side],
          mesh.triangles[side + 1],
          mesh.triangles[side + 2],
        ]
        const minimum = Math.min(values[regions[0]], values[regions[1]], values[regions[2]])
        const maximum = Math.max(values[regions[0]], values[regions[1]], values[regions[2]])
        if (threshold <= minimum || threshold > maximum)
          continue

        const crossings: string[] = []
        for (let edge = 0; edge < 3; edge++) {
          const regionA = regions[edge]
          const regionB = regions[(edge + 1) % 3]
          const valueA = values[regionA]
          const valueB = values[regionB]
          if ((valueA < threshold) === (valueB < threshold))
            continue

          const key = regionA < regionB ? `${regionA}:${regionB}` : `${regionB}:${regionA}`
          const amount = (threshold - valueA) / (valueB - valueA)
          const a = regionA * 3
          const b = regionB * 3
          const x = mesh.regionPosition[a]
            + (mesh.regionPosition[b] - mesh.regionPosition[a]) * amount
          const y = mesh.regionPosition[a + 1]
            + (mesh.regionPosition[b + 1] - mesh.regionPosition[a + 1]) * amount
          const z = mesh.regionPosition[a + 2]
            + (mesh.regionPosition[b + 2] - mesh.regionPosition[a + 2]) * amount
          const length = Math.hypot(x, y, z) || 1
          intersections.set(key, [x / length, y / length, z / length])
          crossings.push(key)
        }
        if (crossings.length === 2)
          segments.push({ start: crossings[0], end: crossings[1] })
      }

      const paths = stitchSphericalSegments(segments, intersections)
      positions.push(...createSmoothSphericalLinePositions(paths, radius, 0.5, 3))
    }
    return new Float32Array(positions)
  }
}
