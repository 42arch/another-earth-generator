import type SphericalMesh from '@/core/mesh/mesh'
import { BufferAttribute, BufferGeometry } from 'three'
import { elevationKmToDisplayCoordinate } from '@/core/simulation/geography/elevation-units'

export class SphericalCellBoundaryGeometry {
  create(
    mesh: SphericalMesh,
    radius: number,
    terrainElevation?: Float32Array,
    terrainScale = 0,
    oceanDepthScale = 1,
    regionIds?: Int32Array,
    boundaryEdges?: Uint32Array,
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

    const edgeCount = boundaryEdges?.length ?? edges.length / 2
    for (let index = 0; index < edgeCount; index++) {
      const edge = boundaryEdges?.[index] ?? index
      const edgeOffset = edge * 2
      if (regionIds) {
        const regionA = mesh.voronoi.edgeRegions[edgeOffset]
        const regionB = mesh.voronoi.edgeRegions[edgeOffset + 1]
        if (regionIds[regionA] === regionIds[regionB])
          continue
      }
      const start = edges[edgeOffset] * 3
      const end = edges[edgeOffset + 1] * 3
      const radiusA = radius + this.elevationOffset(
        cornerElevations?.[edges[edgeOffset]] ?? 0,
        terrainScale,
        oceanDepthScale,
      )
      const radiusB = radius + this.elevationOffset(
        cornerElevations?.[edges[edgeOffset + 1]] ?? 0,
        terrainScale,
        oceanDepthScale,
      )
      positions.push(
        corners[start] * radiusA,
        corners[start + 1] * radiusA,
        corners[start + 2] * radiusA,
        corners[end] * radiusB,
        corners[end + 1] * radiusB,
        corners[end + 2] * radiusB,
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
}
