import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { DoubleSide, Group, Mesh, MeshLambertMaterial, NotEqualStencilFunc, ReplaceStencilOp } from 'three'
import { elevationKmToDisplayCoordinate } from '@/core/geography/elevation-units'
import { RiverGeometry } from '@/core/rendering/shared/river-geometry'

const OCEAN_DEPTH_SCALE = 0.3

export class GlobeRiverLayer {
  readonly group = new Group()

  private riverGeometryBuilder = new RiverGeometry()
  private geometry: ReturnType<typeof this.riverGeometryBuilder.create> | null = null
  private material: MeshLambertMaterial | null = null
  private meshCopy: Mesh | null = null

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    smoothedRegionCorners: Float32Array | null,
    terrainVerticalScale: number,
    usesElevationGeometry: boolean,
  ) {
    this.group.name = 'GlobeRivers'
    this.build(mesh, data, params, smoothedRegionCorners, terrainVerticalScale, usesElevationGeometry)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    smoothedRegionCorners: Float32Array | null,
    terrainVerticalScale: number,
    usesElevationGeometry: boolean,
  ): void {
    if (!params.appearance.overlays.rivers || !data.hydrology) {
      return
    }

    let surfaceOffsets: Float32Array | undefined
    if (usesElevationGeometry) {
      surfaceOffsets = new Float32Array(mesh.numRegions)
      for (let region = 0; region < mesh.numRegions; region++) {
        const displayElevation = elevationKmToDisplayCoordinate(data.geography.elevation[region])
        surfaceOffsets[region] = displayElevation
          * terrainVerticalScale
          * (displayElevation > 0 ? 1 : OCEAN_DEPTH_SCALE)
      }
    }

    const riverClearance = surfaceOffsets ? 0.22 : 0.05
    this.geometry = this.riverGeometryBuilder.create(
      mesh,
      data,
      params.core.planetRadius + riverClearance,
      surfaceOffsets,
      smoothedRegionCorners ?? undefined,
    )

    if ((this.geometry.getAttribute('position')?.count ?? 0) === 0) {
      this.geometry.dispose()
      this.geometry = null
      return
    }

    this.material = new MeshLambertMaterial({
      color: 0xFFFFFF,
      vertexColors: true,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.6,
      side: DoubleSide,
      toneMapped: false,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: NotEqualStencilFunc,
      stencilZPass: ReplaceStencilOp,
    })

    this.meshCopy = new Mesh(this.geometry, this.material)
    this.meshCopy.renderOrder = 7
    this.group.add(this.meshCopy)
  }

  dispose(): void {
    this.group.clear()
    this.geometry?.dispose()
    this.material?.dispose()
  }
}
