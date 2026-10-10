import type { BufferGeometry } from 'three'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { Group, LineBasicMaterial, LineSegments } from 'three'
import { MapLineGeometry } from '@/core/rendering/map/line-geometry'
import { SphericalCellBoundaryGeometry } from '@/core/rendering/shared/cell-boundary-geometry'

export class MapCellBoundaryLayer {
  readonly group = new Group()

  private cellBoundaryGeometryBuilder = new SphericalCellBoundaryGeometry()
  private lineGeometryBuilder = new MapLineGeometry()
  private geometry: BufferGeometry | null = null
  private material: LineBasicMaterial | null = null

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
    smoothedRegionCorners: Float32Array | null,
  ) {
    this.group.name = 'MapCellBoundaries'
    this.build(mesh, data, params, projection, centralMeridian, smoothedRegionCorners)
  }

  private build(
    mesh: SphericalMesh,
    _data: WorldSimulationState,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
    smoothedRegionCorners: Float32Array | null,
  ): void {
    if (!params.appearance.overlays.wireframe || !mesh) {
      return
    }

    const sourceGeometry = this.cellBoundaryGeometryBuilder.create(
      mesh,
      1,
      Number.POSITIVE_INFINITY,
      undefined,
      0,
      1,
      undefined,
      undefined,
      smoothedRegionCorners ?? undefined,
    )

    this.geometry = this.lineGeometryBuilder.create(
      sourceGeometry,
      projection,
      centralMeridian,
      0.24,
    )
    sourceGeometry.dispose()

    if ((this.geometry.getAttribute('position')?.count ?? 0) === 0) {
      this.geometry.dispose()
      this.geometry = null
      return
    }

    this.material = new LineBasicMaterial({
      color: 0xB8D6E8,
      vertexColors: false,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
      depthWrite: false,
    })

    const layer = new LineSegments(this.geometry, this.material)
    layer.renderOrder = 2
    this.addWrappedCopies(layer, projection)
  }

  private addWrappedCopies(baseLayer: LineSegments, projection: MapProjection): void {
    const worldOffsets = projection.wrapX
      ? [-projection.worldWidth, 0, projection.worldWidth]
      : [0]

    for (const worldOffset of worldOffsets) {
      const object = worldOffset === 0 ? baseLayer : baseLayer.clone()
      object.position.x += worldOffset
      this.group.add(object)
    }
  }

  dispose(): void {
    this.group.clear()
    this.geometry?.dispose()
    this.material?.dispose()
  }
}
