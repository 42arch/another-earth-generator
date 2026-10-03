import type SphericalMesh from '@/core/mesh/mesh'
import { BufferAttribute, BufferGeometry } from 'three'
import { elevationKmToDisplayCoordinate } from '@/core/geography/elevation-units'

const DEFAULT_MAXIMUM_ARC_STEP = Math.PI / 90

export class SphericalCellBoundaryGeometry {
  create(
    mesh: SphericalMesh,
    radius: number,
    maximumArcStep = DEFAULT_MAXIMUM_ARC_STEP,
    terrainElevation?: Float32Array,
    terrainScale = 0,
    oceanDepthScale = 1,
  ): BufferGeometry {
    const positions: number[] = []
    const corners = mesh.voronoi.cornerPosition
    const edges = mesh.voronoi.edgeCorners
    const displayElevations = terrainElevation?.length === mesh.numRegions
      ? this.buildDisplayElevations(terrainElevation)
      : null
    const cornerElevations = displayElevations
      ? this.buildCornerElevations(mesh, displayElevations)
      : null

    for (let edge = 0; edge < edges.length; edge += 2) {
      const start = edges[edge] * 3
      const end = edges[edge + 1] * 3
      this.appendArc(
        positions,
        corners[start],
        corners[start + 1],
        corners[start + 2],
        corners[end],
        corners[end + 1],
        corners[end + 2],
        radius + this.elevationOffset(
          cornerElevations?.[edges[edge]] ?? 0,
          terrainScale,
          oceanDepthScale,
        ),
        radius + this.elevationOffset(
          cornerElevations?.[edges[edge + 1]] ?? 0,
          terrainScale,
          oceanDepthScale,
        ),
        maximumArcStep,
      )
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    geometry.computeBoundingSphere()
    return geometry
  }

  private elevationOffset(
    displayElevation: number,
    terrainScale: number,
    oceanDepthScale: number,
  ): number {
    return displayElevation
      * terrainScale
      * (displayElevation > 0 ? 1 : oceanDepthScale)
  }

  private buildDisplayElevations(elevationKm: Float32Array): Float32Array {
    const result = new Float32Array(elevationKm.length)
    for (let region = 0; region < elevationKm.length; region++)
      result[region] = elevationKmToDisplayCoordinate(elevationKm[region])
    return result
  }

  private buildCornerElevations(
    mesh: SphericalMesh,
    regionElevation: Float32Array,
  ): Float32Array {
    const cornerCount = mesh.voronoi.cornerPosition.length / 3
    const cornerElevations = new Float32Array(cornerCount)
    const cornerCounts = new Uint8Array(cornerCount)
    for (let region = 0; region < mesh.numRegions; region++) {
      const start = mesh.voronoi.cellCornerOffsets[region]
      const end = mesh.voronoi.cellCornerOffsets[region + 1]
      for (let index = start; index < end; index++) {
        const corner = mesh.voronoi.cellCorners[index]
        cornerElevations[corner] += regionElevation[region]
        cornerCounts[corner]++
      }
    }
    for (let corner = 0; corner < cornerCount; corner++) {
      if (cornerCounts[corner] > 0)
        cornerElevations[corner] /= cornerCounts[corner]
    }
    return cornerElevations
  }

  private appendArc(
    positions: number[],
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    radiusA: number,
    radiusB: number,
    maximumArcStep: number,
  ): void {
    const dot = Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz))
    const angle = Math.acos(dot)
    const segmentCount = Math.max(1, Math.ceil(angle / maximumArcStep))

    for (let segment = 0; segment < segmentCount; segment++) {
      this.appendInterpolatedPoint(positions, ax, ay, az, bx, by, bz, segment / segmentCount, angle, radiusA, radiusB)
      this.appendInterpolatedPoint(positions, ax, ay, az, bx, by, bz, (segment + 1) / segmentCount, angle, radiusA, radiusB)
    }
  }

  private appendInterpolatedPoint(
    positions: number[],
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    amount: number,
    angle: number,
    radiusA: number,
    radiusB: number,
  ): void {
    const radius = radiusA + (radiusB - radiusA) * amount
    if (angle <= Number.EPSILON) {
      positions.push(ax * radius, ay * radius, az * radius)
      return
    }

    const sinAngle = Math.sin(angle)
    const weightA = Math.sin((1 - amount) * angle) / sinAngle
    const weightB = Math.sin(amount * angle) / sinAngle
    positions.push(
      (ax * weightA + bx * weightB) * radius,
      (ay * weightA + by * weightB) * radius,
      (az * weightA + bz * weightB) * radius,
    )
  }
}
