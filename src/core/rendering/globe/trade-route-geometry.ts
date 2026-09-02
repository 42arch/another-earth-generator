import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type { HumanRoute } from '@/core/spherical/spherical-world-data'
import type { BufferGeometry } from 'three'
import { appendSphericalPosition, createLineGeometry } from '@/core/rendering/shared/spherical-line-geometry'
import { SphericalRouteSource } from '@/core/spherical/features/spherical-route-source'

export class GlobeTradeRouteGeometry {
  private readonly source = new SphericalRouteSource()

  create(
    mesh: SphericalMesh,
    routes: HumanRoute[],
    routeVolume: Float32Array,
    radius: number,
  ): BufferGeometry {
    const positions: number[] = []
    const colors: number[] = []
    for (const path of this.source.createTrade(mesh, routes, routeVolume)) {
      for (let index = 1; index < path.points.length; index++) {
        const start = path.points[index - 1]
        const end = path.points[index]
        appendSphericalPosition(positions, start.position, radius)
        appendSphericalPosition(positions, end.position, radius)
        colors.push(
          ...(start.color ?? [1, 1, 1]),
          ...(end.color ?? [1, 1, 1]),
        )
      }
    }
    return createLineGeometry(positions, colors)
  }
}
