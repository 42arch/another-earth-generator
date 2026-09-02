import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type { HumanRoute, HumanRouteMode } from '@/core/spherical/spherical-world-data'
import type { BufferGeometry } from 'three'
import { appendSphericalPosition, createLineGeometry } from '@/core/rendering/shared/spherical-line-geometry'
import { SphericalRouteSource } from '@/core/spherical/features/spherical-route-source'

export class GlobeRouteGeometry {
  private readonly source = new SphericalRouteSource()

  create(
    mesh: SphericalMesh,
    routes: HumanRoute[],
    mode: HumanRouteMode,
    radius: number,
  ): BufferGeometry {
    const positions: number[] = []
    for (const path of this.source.createNetwork(mesh, routes, mode)) {
      const segmentCount = path.closed ? path.points.length : path.points.length - 1
      for (let index = 0; index < segmentCount; index++) {
        appendSphericalPosition(positions, path.points[index].position, radius)
        appendSphericalPosition(
          positions,
          path.points[(index + 1) % path.points.length].position,
          radius,
        )
      }
    }
    return createLineGeometry(positions)
  }
}
