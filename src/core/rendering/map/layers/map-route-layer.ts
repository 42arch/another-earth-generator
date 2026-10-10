import type { BufferGeometry } from 'three'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { Group, LineBasicMaterial, LineSegments } from 'three'
import { MapLineGeometry } from '@/core/rendering/map/line-geometry'
import { createTransportLineGeometry } from '@/core/rendering/shared/transport-line-geometry'

export class MapRouteLayer {
  readonly group = new Group()

  private lineGeometryBuilder = new MapLineGeometry()
  private geometry: BufferGeometry | null = null
  private material: LineBasicMaterial | null = null

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
  ) {
    this.group.name = 'MapRoutes'
    this.build(mesh, data, params, projection, centralMeridian)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
  ): void {
    if (!params.appearance.overlays.routes || !data.society?.transport) {
      return
    }

    const sourceGeometry = createTransportLineGeometry(mesh, data)
    this.geometry = this.lineGeometryBuilder.create(
      sourceGeometry,
      projection,
      centralMeridian,
      0.4,
    )
    sourceGeometry.dispose()

    if ((this.geometry.getAttribute('position')?.count ?? 0) === 0) {
      this.geometry.dispose()
      this.geometry = null
      return
    }

    this.material = new LineBasicMaterial({
      color: 0xFFFFFF,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
    })

    const layer = new LineSegments(this.geometry, this.material)
    layer.renderOrder = 7.5
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
