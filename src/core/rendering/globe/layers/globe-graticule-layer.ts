import type { WorldConfig } from '@/core/simulation/config'
import { Group, LineBasicMaterial, LineSegments } from 'three'
import { SphericalGraticuleGeometry } from '@/core/rendering/shared/graticule-geometry'

const GRATICULE_LAYER_OFFSET = 0.5

export class GlobeGraticuleLayer {
  readonly group = new Group()

  private graticuleGeometryBuilder = new SphericalGraticuleGeometry()
  private geometry: ReturnType<typeof this.graticuleGeometryBuilder.create> | null = null
  private material: LineBasicMaterial | null = null
  private meshCopy: LineSegments | null = null

  constructor(
    params: WorldConfig,
    terrainVerticalScale: number,
    usesElevationGeometry: boolean,
  ) {
    this.group.name = 'GlobeGraticule'
    this.build(params, terrainVerticalScale, usesElevationGeometry)
  }

  private build(
    params: WorldConfig,
    terrainVerticalScale: number,
    usesElevationGeometry: boolean,
  ): void {
    if (!params.appearance.overlays.graticule) {
      return
    }

    const terrainClearance = usesElevationGeometry ? terrainVerticalScale : 0
    this.geometry = this.graticuleGeometryBuilder.create(
      params.core.planetRadius + GRATICULE_LAYER_OFFSET + terrainClearance,
    )

    if ((this.geometry.getAttribute('position')?.count ?? 0) === 0) {
      this.geometry.dispose()
      this.geometry = null
      return
    }

    this.material = new LineBasicMaterial({
      color: 0xB8D6E8,
      transparent: true,
      opacity: 0.36,
      depthTest: true,
      depthWrite: false,
    })

    this.meshCopy = new LineSegments(this.geometry, this.material)
    this.meshCopy.renderOrder = 4
    this.group.add(this.meshCopy)
  }

  dispose(): void {
    this.group.clear()
    this.geometry?.dispose()
    this.material?.dispose()
  }
}
