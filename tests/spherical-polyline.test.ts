import type { SphericalPoint } from '@/core/spherical/geometry/spherical-polyline'
import { describe, expect, it } from 'vitest'
import { GlobeCoastlineGeometry } from '@/core/rendering/globe/coastline-geometry'
import { SphericalContourGeometry } from '@/core/rendering/shared/spherical-contour-geometry'
import {
  createSmoothSphericalLinePositions,

  stitchSphericalSegments,
} from '@/core/spherical/geometry/spherical-polyline'
import { cloneGlobeGenParams, DEFAULT_GLOBE_GEN_PARAMS } from '@/core/spherical/config'
import { SphericalWorldGenerator } from '@/core/spherical/spherical-world-generator'

describe('spherical polyline smoothing', () => {
  it('stitches a closed boundary and keeps every sampled point on its sphere', () => {
    const points = new Map<string, SphericalPoint>([
      ['a', [1, 0, 0]],
      ['b', [0, 1, 0]],
      ['c', [-1, 0, 0]],
      ['d', [0, -1, 0]],
    ])
    const paths = stitchSphericalSegments([
      { start: 'a', end: 'b' },
      { start: 'c', end: 'd' },
      { start: 'b', end: 'c' },
      { start: 'd', end: 'a' },
    ], points)

    expect(paths).toHaveLength(1)
    expect(paths[0].closed).toBe(true)
    expect(paths[0].points).toHaveLength(4)

    const radius = 100.18
    const positions = createSmoothSphericalLinePositions(paths, radius, 0.7, 3)
    expect(positions.length).toBe(4 * 3 * 2 * 3)
    for (let index = 0; index < positions.length; index += 3) {
      expect(Math.hypot(
        positions[index],
        positions[index + 1],
        positions[index + 2],
      )).toBeCloseTo(radius, 4)
    }
  })

  it('connects contour fragments into non-degenerate smoothed spherical line segments', () => {
    const params = cloneGlobeGenParams(DEFAULT_GLOBE_GEN_PARAMS)
    params.seed = 42
    params.subdivision = 3
    const world = new SphericalWorldGenerator().generate(params)
    const radius = params.planetRadius + 0.12
    const positions = new SphericalContourGeometry().createLinePositions(
      world.mesh,
      world.data.elevation,
      [0.35, 0.5, 0.65],
      radius,
    )

    expect(positions.length).toBeGreaterThan(0)
    expect(positions.length % 6).toBe(0)
    for (let index = 0; index < positions.length; index += 6) {
      const startRadius = Math.hypot(positions[index], positions[index + 1], positions[index + 2])
      const endRadius = Math.hypot(positions[index + 3], positions[index + 4], positions[index + 5])
      expect(startRadius).toBeCloseTo(radius, 4)
      expect(endRadius).toBeCloseTo(radius, 4)
      expect(Math.hypot(
        positions[index] - positions[index + 3],
        positions[index + 1] - positions[index + 4],
        positions[index + 2] - positions[index + 5],
      )).toBeGreaterThan(1e-5)
    }
  })

  it('builds shared-radius coastline and seam geometry', () => {
    const params = cloneGlobeGenParams(DEFAULT_GLOBE_GEN_PARAMS)
    params.seed = 42
    params.subdivision = 2
    const world = new SphericalWorldGenerator().generate(params)
    const corners = new Map<string, SphericalPoint>()
    const segments: Array<{ start: string, end: string }> = []
    const edgeInfo = new Map<string, { landRegion: number, waterRegion: number }>()

    for (let edge = 0; edge < world.mesh.voronoi.edgeRegions.length / 2; edge++) {
      const index = edge * 2
      const regionA = world.mesh.voronoi.edgeRegions[index]
      const regionB = world.mesh.voronoi.edgeRegions[index + 1]
      if (world.data.landMask[regionA] === world.data.landMask[regionB])
        continue
      const cornerA = world.mesh.voronoi.edgeCorners[index]
      const cornerB = world.mesh.voronoi.edgeCorners[index + 1]
      const keyA = String(cornerA)
      const keyB = String(cornerB)
      const positionA = cornerA * 3
      const positionB = cornerB * 3
      corners.set(keyA, [
        world.mesh.voronoi.cornerPosition[positionA],
        world.mesh.voronoi.cornerPosition[positionA + 1],
        world.mesh.voronoi.cornerPosition[positionA + 2],
      ])
      corners.set(keyB, [
        world.mesh.voronoi.cornerPosition[positionB],
        world.mesh.voronoi.cornerPosition[positionB + 1],
        world.mesh.voronoi.cornerPosition[positionB + 2],
      ])
      segments.push({ start: keyA, end: keyB })
      const edgeKey = keyA < keyB ? `${keyA}:${keyB}` : `${keyB}:${keyA}`
      edgeInfo.set(edgeKey, world.data.landMask[regionA] !== 0
        ? { landRegion: regionA, waterRegion: regionB }
        : { landRegion: regionB, waterRegion: regionA })
    }

    const paths = stitchSphericalSegments(segments, corners)
    expect(paths.length).toBeGreaterThan(0)
    const colors = new Float32Array(world.mesh.numRegions * 3).fill(0.5)
    const geometries = new GlobeCoastlineGeometry().create(
      world.mesh,
      paths,
      edgeInfo,
      colors,
      100.18,
      0.275,
    )

    for (const geometry of [geometries.line, geometries.seam]) {
      const positions = geometry.getAttribute('position')
      expect(positions.count).toBeGreaterThan(0)
      if (geometry === geometries.seam) {
        expect(geometry.getAttribute('color').count).toBe(positions.count)
        expect(geometry.getAttribute('normal').count).toBe(positions.count)
        for (let vertex = 0; vertex < positions.count; vertex += 3) {
          const ax = positions.getX(vertex)
          const ay = positions.getY(vertex)
          const az = positions.getZ(vertex)
          const bx = positions.getX(vertex + 1)
          const by = positions.getY(vertex + 1)
          const bz = positions.getZ(vertex + 1)
          const cx = positions.getX(vertex + 2)
          const cy = positions.getY(vertex + 2)
          const cz = positions.getZ(vertex + 2)
          const normalX = (by - ay) * (cz - az) - (bz - az) * (cy - ay)
          const normalY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
          const normalZ = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
          expect(normalX * (ax + bx + cx) + normalY * (ay + by + cy) + normalZ * (az + bz + cz))
            .toBeGreaterThan(0)
        }
      }
      for (let vertex = 0; vertex < positions.count; vertex++) {
        expect(Math.hypot(
          positions.getX(vertex),
          positions.getY(vertex),
          positions.getZ(vertex),
        )).toBeCloseTo(100.18, 3)
      }
      geometry.dispose()
    }
  })
})
