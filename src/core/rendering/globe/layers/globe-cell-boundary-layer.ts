import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { Group, LineBasicMaterial, LineSegments } from 'three'
import { SphericalCellBoundaryGeometry } from '@/core/rendering/shared/cell-boundary-geometry'

const OCEAN_DEPTH_SCALE = 0.3

const CELL_BOUNDARY_LAYER_OFFSET = 0.5

export class GlobeCellBoundaryLayer {
  readonly group = new Group()

  private cellBoundaryGeometryBuilder = new SphericalCellBoundaryGeometry()
  private geometry: ReturnType<typeof this.cellBoundaryGeometryBuilder.create> | null = null
  private material: LineBasicMaterial | null = null
  private meshCopy: LineSegments | null = null

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    terrainVerticalScale: number,
    usesElevationGeometry: boolean,
    smoothedRegionCorners: Float32Array | null,
  ) {
    this.group.name = 'GlobeCellBoundaries'
    this.build(mesh, data, params, terrainVerticalScale, usesElevationGeometry, smoothedRegionCorners)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    terrainVerticalScale: number,
    usesElevationGeometry: boolean,
    smoothedRegionCorners: Float32Array | null,
  ): void {
    if (!params.appearance.overlays.wireframe || !mesh) {
      return
    }

    this.geometry = this.cellBoundaryGeometryBuilder.create(
      mesh,
      params.core.planetRadius + CELL_BOUNDARY_LAYER_OFFSET,
      Number.POSITIVE_INFINITY,
      usesElevationGeometry && data ? data.geography.elevation : undefined,
      terrainVerticalScale,
      OCEAN_DEPTH_SCALE,
      undefined,
      undefined,
      smoothedRegionCorners ?? undefined,
    )

    if ((this.geometry.getAttribute('position')?.count ?? 0) === 0) {
      this.geometry.dispose()
      this.geometry = null
      return
    }

    this.material = new LineBasicMaterial({
      color: 0xB8D6E8,
      transparent: true,
      opacity: 0.5,
      depthTest: true,
      depthWrite: false,
    })

    this.meshCopy = new LineSegments(this.geometry, this.material)
    this.meshCopy.renderOrder = 3
    this.group.add(this.meshCopy)
  }

  dispose(): void {
    this.group.clear()
    this.geometry?.dispose()
    this.material?.dispose()
  }
}
