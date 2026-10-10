import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { Group, LineBasicMaterial, LineSegments } from 'three'
import { createTransportLineGeometry } from '@/core/rendering/shared/transport-line-geometry'

export class GlobeRouteLayer {
  readonly group = new Group()

  private geometry: ReturnType<typeof createTransportLineGeometry> | null = null
  private material: LineBasicMaterial | null = null
  private meshCopy: LineSegments | null = null

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    terrainVerticalScale: number,
    usesElevationGeometry: boolean,
    sunDirection?: readonly [number, number, number],
  ) {
    this.group.name = 'GlobeRoutes'
    this.build(mesh, data, params, terrainVerticalScale, usesElevationGeometry, sunDirection)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    terrainVerticalScale: number,
    usesElevationGeometry: boolean,
    sunDirection?: readonly [number, number, number],
  ): void {
    if (!params.appearance.overlays.routes || !data.society?.transport) {
      return
    }

    const scale = usesElevationGeometry ? terrainVerticalScale : 0
    this.geometry = createTransportLineGeometry(
      mesh,
      data,
      params.core.planetRadius,
      scale,
      sunDirection,
    )

    if ((this.geometry.getAttribute('position')?.count ?? 0) === 0) {
      this.geometry.dispose()
      this.geometry = null
      return
    }

    this.material = new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthTest: true,
      depthWrite: false,
    })

    this.meshCopy = new LineSegments(this.geometry, this.material)
    this.meshCopy.renderOrder = 7.5
    this.group.add(this.meshCopy)
  }

  dispose(): void {
    this.group.clear()
    this.geometry?.dispose()
    this.material?.dispose()
  }
}
