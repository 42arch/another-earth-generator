import type { BufferGeometry } from 'three'
import type { OverlayViewOptions } from './overlay-view-options'
import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { Group, LineBasicMaterial, LineSegments } from 'three'
import { SphericalCellBoundaryGeometry } from '@/core/rendering/shared/geometries/cell-boundary-geometry'
import { MapLineGeometry } from '@/core/rendering/shared/geometries/projected-line-geometry'
import { addWrappedCopies } from '@/core/rendering/shared/layers/wrap-copies'

const OCEAN_DEPTH_SCALE = 0.3
const CELL_BOUNDARY_LAYER_OFFSET = 0.5

/**
 * 统一网格胞元边界覆盖图层（兼具球面 3D 与投影 2D 渲染）
 */
export class CellBoundaryOverlayLayer {
  readonly group = new Group()

  private cellBoundaryGeometryBuilder = new SphericalCellBoundaryGeometry()
  private lineGeometryBuilder = new MapLineGeometry()
  private geometry: BufferGeometry | null = null
  private material: LineBasicMaterial | null = null

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    options: OverlayViewOptions,
  ) {
    this.group.name = options.view === 'globe' ? 'GlobeCellBoundaries' : 'MapCellBoundaries'
    this.build(mesh, data, params, options)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    options: OverlayViewOptions,
  ): void {
    if (options.view === 'globe') {
      this.geometry = this.cellBoundaryGeometryBuilder.create(
        mesh,
        options.planetRadius + CELL_BOUNDARY_LAYER_OFFSET,
        options.usesElevationGeometry ? data.geography.elevation : undefined,
        options.terrainVerticalScale,
        OCEAN_DEPTH_SCALE,
      )
    }
    else {
      const sourceGeometry = this.cellBoundaryGeometryBuilder.create(mesh, 1)
      this.geometry = this.lineGeometryBuilder.create(
        sourceGeometry,
        options.projection,
        options.centralMeridian,
        0.24,
      )
      sourceGeometry.dispose()
    }

    if ((this.geometry.getAttribute('position')?.count ?? 0) === 0) {
      this.geometry.dispose()
      this.geometry = null
      return
    }

    this.material = new LineBasicMaterial({
      color: 0xB8D6E8,
      transparent: true,
      opacity: 0.5,
      depthTest: options.view === 'globe',
      depthWrite: false,
    })

    const layer = new LineSegments(this.geometry, this.material)
    layer.renderOrder = options.view === 'globe' ? 5 : 2

    if (options.view === 'globe')
      this.group.add(layer)
    else
      addWrappedCopies(this.group, layer, options.projection)

    this.group.visible = Boolean(params.appearance.overlays.cellBoundaries)
  }

  dispose(): void {
    this.group.clear()
    this.geometry?.dispose()
    this.geometry = null
    this.material?.dispose()
    this.material = null
  }
}
