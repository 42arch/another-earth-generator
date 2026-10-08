import type SphericalMesh from '@/core/mesh/mesh'
import { BufferAttribute, BufferGeometry } from 'three'
import { elevationKmToDisplayCoordinate } from '@/core/geography/elevation-units'

export class GlobeSurfaceGeometry {
  create(
    mesh: SphericalMesh,
    planetRadius: number,
    colors: Float32Array,
    regionMask?: Uint8Array,
    terrainElevation?: Float32Array,
    terrainScale = 0,
    oceanDepthScale = 1,
    cornerColors?: Float32Array,
    cornerColorRegionMask?: Uint8Array,
    cornerPositions?: Float32Array,
  ): BufferGeometry {
    const surfaceCornerPositions = cornerPositions ?? mesh.voronoi.cornerPosition
    const displayElevations = terrainElevation?.length === mesh.numRegions
      ? this.buildDisplayElevations(terrainElevation)
      : null
    const cornerElevations = displayElevations
      ? this.buildCornerElevations(mesh, displayElevations)
      : null
    let triangleCount = mesh.voronoi.cellCorners.length
    if (regionMask) {
      triangleCount = 0
      for (let region = 0; region < mesh.numRegions; region++) {
        if (regionMask[region] === 0)
          continue
        triangleCount += mesh.voronoi.cellCornerOffsets[region + 1]
          - mesh.voronoi.cellCornerOffsets[region]
      }
    }
    const vertexCount = triangleCount * 3
    const positions = new Float32Array(vertexCount * 3)
    const normals = new Float32Array(vertexCount * 3)
    const vertexColors = new Float32Array(vertexCount * 3)
    const faceRegions = new Uint32Array(triangleCount)
    let face = 0

    for (let region = 0; region < mesh.numRegions; region++) {
      if (regionMask && regionMask[region] === 0)
        continue
      const center = region * 3
      const start = mesh.voronoi.cellCornerOffsets[region]
      const end = mesh.voronoi.cellCornerOffsets[region + 1]
      const useCornerColors = cornerColors !== undefined
        && (!cornerColorRegionMask || cornerColorRegionMask[region] !== 0)
      const regionCornerColors = useCornerColors ? cornerColors : colors
      for (let index = start; index < end; index++) {
        const cornerA = mesh.voronoi.cellCorners[index] * 3
        const cornerB = mesh.voronoi.cellCorners[index + 1 < end ? index + 1 : start] * 3
        this.writeVertex(
          positions,
          normals,
          vertexColors,
          face * 9,
          mesh.regionPosition,
          center,
          colors,
          center,
          planetRadius + this.elevationOffset(
            displayElevations?.[region] ?? 0,
            terrainScale,
            oceanDepthScale,
          ),
        )
        this.writeVertex(
          positions,
          normals,
          vertexColors,
          face * 9 + 3,
          surfaceCornerPositions,
          cornerA,
          regionCornerColors,
          useCornerColors ? cornerA : center,
          planetRadius + this.elevationOffset(
            cornerElevations?.[mesh.voronoi.cellCorners[index]] ?? 0,
            terrainScale,
            oceanDepthScale,
          ),
        )
        this.writeVertex(
          positions,
          normals,
          vertexColors,
          face * 9 + 6,
          surfaceCornerPositions,
          cornerB,
          regionCornerColors,
          useCornerColors ? cornerB : center,
          planetRadius + this.elevationOffset(
            cornerElevations?.[mesh.voronoi.cellCorners[index + 1 < end ? index + 1 : start]] ?? 0,
            terrainScale,
            oceanDepthScale,
          ),
        )
        faceRegions[face] = region
        face++
      }
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new BufferAttribute(normals, 3))
    geometry.setAttribute('color', new BufferAttribute(vertexColors, 3))
    geometry.userData.faceRegions = faceRegions
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

  updateColors(geometry: BufferGeometry, colors: Float32Array): void {
    const faceRegions = geometry.userData.faceRegions as Uint32Array | undefined
    const colorAttribute = geometry.getAttribute('color') as BufferAttribute
    if (!faceRegions)
      return
    for (let face = 0; face < faceRegions.length; face++) {
      const source = faceRegions[face] * 3
      const target = face * 9
      for (let vertex = 0; vertex < 3; vertex++) {
        const offset = target + vertex * 3
        colorAttribute.array[offset] = colors[source]
        colorAttribute.array[offset + 1] = colors[source + 1]
        colorAttribute.array[offset + 2] = colors[source + 2]
      }
    }
    colorAttribute.needsUpdate = true
  }

  private writeVertex(
    positions: Float32Array,
    normals: Float32Array,
    vertexColors: Float32Array,
    target: number,
    sourcePositions: Float32Array,
    source: number,
    colors: Float32Array,
    colorSource: number,
    radius: number,
  ): void {
    positions[target] = sourcePositions[source] * radius
    positions[target + 1] = sourcePositions[source + 1] * radius
    positions[target + 2] = sourcePositions[source + 2] * radius
    normals[target] = sourcePositions[source]
    normals[target + 1] = sourcePositions[source + 1]
    normals[target + 2] = sourcePositions[source + 2]
    vertexColors[target] = colors[colorSource]
    vertexColors[target + 1] = colors[colorSource + 1]
    vertexColors[target + 2] = colors[colorSource + 2]
  }
}
