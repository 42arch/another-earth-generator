import type { BufferGeometry } from 'three'
import type { OverlayViewOptions } from './overlay-view-options'
import type { WorldConfig } from '@/core/simulation/config'
import { Group, LineBasicMaterial, LineSegments } from 'three'
import { SphericalGraticuleGeometry } from '@/core/rendering/shared/geometries/graticule-geometry'
import { MapLineGeometry } from '@/core/rendering/shared/geometries/projected-line-geometry'
import { addWrappedCopies } from '@/core/rendering/shared/layers/wrap-copies'

const GRATICULE_LAYER_OFFSET = 0.5

/**
 * 统一经纬网格覆盖图层（兼具球面 3D 与投影 2D 渲染）
 */
export class GraticuleOverlayLayer {
  readonly group = new Group()

  private graticuleGeometryBuilder = new SphericalGraticuleGeometry()
  private lineGeometryBuilder = new MapLineGeometry()
  private geometry: BufferGeometry | null = null
  private material: LineBasicMaterial | null = null

  constructor(
    params: WorldConfig,
    options: OverlayViewOptions,
  ) {
    this.group.name = options.view === 'globe' ? 'GlobeGraticule' : 'MapGraticule'
    this.build(params, options)
  }

  private build(
    params: WorldConfig,
    options: OverlayViewOptions,
  ): void {
    if (options.view === 'globe') {
      const terrainClearance = options.usesElevationGeometry ? options.terrainVerticalScale : 0
      this.geometry = this.graticuleGeometryBuilder.create(
        options.planetRadius + GRATICULE_LAYER_OFFSET + terrainClearance,
      )
    }
    else {
      const sourceGeometry = this.graticuleGeometryBuilder.create(1)
      this.geometry = this.lineGeometryBuilder.create(
        sourceGeometry,
        options.projection,
        options.centralMeridian,
        0.28,
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
      opacity: 0.36,
      depthTest: options.view === 'globe',
      depthWrite: false,
    })

    const layer = new LineSegments(this.geometry, this.material)
    layer.renderOrder = options.view === 'globe' ? 4 : 3

    if (options.view === 'globe')
      this.group.add(layer)
    else
      addWrappedCopies(this.group, layer, options.projection)

    this.group.visible = Boolean(params.appearance.overlays.graticule)
  }

  dispose(): void {
    this.group.clear()
    this.geometry?.dispose()
    this.geometry = null
    this.material?.dispose()
    this.material = null
  }
}
