import type { BufferGeometry } from 'three'
import type { MapProjection } from '@/core/projections/map-projection'
import type { WorldConfig } from '@/core/simulation/config'
import { Group, LineBasicMaterial, LineSegments } from 'three'
import { MapLineGeometry } from '@/core/rendering/map/line-geometry'
import { SphericalGraticuleGeometry } from '@/core/rendering/shared/graticule-geometry'

export class MapGraticuleLayer {
  readonly group = new Group()

  private graticuleGeometryBuilder = new SphericalGraticuleGeometry()
  private lineGeometryBuilder = new MapLineGeometry()
  private geometry: BufferGeometry | null = null
  private material: LineBasicMaterial | null = null

  constructor(
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
  ) {
    this.group.name = 'MapGraticule'
    this.build(params, projection, centralMeridian)
  }

  private build(
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
  ): void {
    if (!params.appearance.overlays.graticule) {
      return
    }

    const sourceGeometry = this.graticuleGeometryBuilder.create(1)
    this.geometry = this.lineGeometryBuilder.create(
      sourceGeometry,
      projection,
      centralMeridian,
      0.28,
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
      opacity: 0.36,
      depthTest: false,
      depthWrite: false,
    })

    const layer = new LineSegments(this.geometry, this.material)
    layer.renderOrder = 3
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
