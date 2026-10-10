import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { Group, Mesh } from 'three'
import { MapRibbonGeometry } from '@/core/rendering/map/ribbon-geometry'
import { MapRibbonMaterial } from '@/core/rendering/map/ribbon-material'
import { RiverGeometry } from '@/core/rendering/shared/river-geometry'

export class MapRiverLayer {
  readonly group = new Group()

  private riverGeometryBuilder = new RiverGeometry()
  private riverRibbonGeometryBuilder = new MapRibbonGeometry()

  private geometry: ReturnType<typeof this.riverRibbonGeometryBuilder.create> | null = null
  private material: MapRibbonMaterial | null = null

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
    smoothedRegionCorners: Float32Array | null,
    viewportWidth: number,
    viewportHeight: number,
  ) {
    this.group.name = 'MapRivers'
    this.build(mesh, data, params, projection, centralMeridian, smoothedRegionCorners, viewportWidth, viewportHeight)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
    smoothedRegionCorners: Float32Array | null,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    if (!params.appearance.overlays.rivers || !data.hydrology) {
      return
    }

    this.geometry = this.riverRibbonGeometryBuilder.create(
      this.riverGeometryBuilder.createStrokePaths(
        mesh,
        data,
        undefined,
        smoothedRegionCorners ?? undefined,
      ),
      projection,
      centralMeridian,
      0.3,
    )

    if ((this.geometry.getAttribute('position')?.count ?? 0) === 0) {
      this.geometry.dispose()
      this.geometry = null
      return
    }

    this.material = new MapRibbonMaterial(
      0xFFFFFF,
      0.6,
      viewportWidth,
      viewportHeight,
    )

    const layer = new Mesh(this.geometry, this.material)
    layer.renderOrder = 7
    this.addWrappedCopies(layer, projection)
  }

  private addWrappedCopies(baseLayer: Mesh, projection: MapProjection): void {
    this.group.add(baseLayer)
    if (projection.wrapX) {
      const leftCopy = new Mesh(baseLayer.geometry, baseLayer.material)
      leftCopy.position.x = -projection.worldWidth
      leftCopy.renderOrder = baseLayer.renderOrder

      const rightCopy = new Mesh(baseLayer.geometry, baseLayer.material)
      rightCopy.position.x = projection.worldWidth
      rightCopy.renderOrder = baseLayer.renderOrder

      this.group.add(leftCopy, rightCopy)
    }
  }

  updateWidthScale(zoom: number): void {
    if (this.material) {
      // Base scale 100 multiplied by zoom ensures rivers shrink when zooming out
      // and grow proportionally when zooming in. Capped at 15000 to prevent overflow at zoom 300.
      this.material.setWidthScale(Math.min(15000, 100 * zoom))
    }
  }

  updateViewport(width: number, height: number): void {
    if (this.material) {
      this.material.setResolution(width, height)
    }
  }

  dispose(): void {
    this.group.clear()
    this.geometry?.dispose()
    this.material?.dispose()
  }
}
