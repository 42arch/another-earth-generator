import type { OrthographicCamera } from 'three'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import { Vector3 } from 'three'
import { geographicToCartesian } from '@/core/projections/projection-math'

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
    const bounds = canvas.getBoundingClientRect()
    this.projected.set(
      ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1,
      -((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 + 1,
      0,
    ).unproject(camera)

    const geographic = projection.unproject(
      this.projected.x,
      this.projected.y,
      centralMeridian,
    )
    if (!geographic)
      return null

    const direction = geographicToCartesian(geographic.longitude, geographic.latitude)
    let selected = 0
    let bestDot = -Infinity
    for (let region = 0; region < mesh.numRegions; region++) {
      const index = region * 3
      const dot = direction[0] * mesh.regionPosition[index]
        + direction[1] * mesh.regionPosition[index + 1]
        + direction[2] * mesh.regionPosition[index + 2]
      if (dot > bestDot) {
        bestDot = dot
        selected = region
      }
    }
    return selected
  }
}
