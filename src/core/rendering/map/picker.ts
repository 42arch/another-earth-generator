import type { OrthographicCamera } from 'three'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import { Vector3 } from 'three'
import { geographicToCartesian } from '@/core/projections/projection-math'
import { findNearestMeshRegion, getNormalizedDeviceCoordinates } from '@/core/rendering/shared/picking/spherical-picking'

export class MapPicker {
  private readonly projected = new Vector3()

  pick(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    camera: OrthographicCamera,
    projection: MapProjection,
    centralMeridian: number,
    mesh: SphericalMesh,
  ): number | null {
    getNormalizedDeviceCoordinates(event, canvas, this.projected)
    this.projected.z = 0
    this.projected.unproject(camera)

    const geographic = projection.unproject(
      this.projected.x,
      this.projected.y,
      centralMeridian,
    )
    if (!geographic)
      return null

    const direction = geographicToCartesian(geographic.longitude, geographic.latitude)
    return findNearestMeshRegion(mesh, direction[0], direction[1], direction[2])
  }
}
