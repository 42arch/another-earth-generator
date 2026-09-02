import type { Mesh, PerspectiveCamera } from 'three'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import { Raycaster, Vector2 } from 'three'

export class GlobePicker {
  private readonly raycaster = new Raycaster()
  private readonly pointer = new Vector2()

  pick(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    camera: PerspectiveCamera,
    surface: Mesh,
    mesh: SphericalMesh,
  ): number | null {
    const bounds = canvas.getBoundingClientRect()
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, camera)
    const intersection = this.raycaster.intersectObject(surface, false)[0]
    if (!intersection || intersection.faceIndex === undefined)
      return null

    const faceRegions = surface.geometry.userData.faceRegions as Uint32Array | undefined
    if (faceRegions)
      return faceRegions[intersection.faceIndex] ?? null

    const triangleIndex = intersection.faceIndex * 3
    const candidates = [
      mesh.triangles[triangleIndex],
      mesh.triangles[triangleIndex + 1],
      mesh.triangles[triangleIndex + 2],
    ]
    const direction = surface.worldToLocal(intersection.point.clone()).normalize()
    let selected = candidates[0]
    let bestDot = -Infinity
    for (const region of candidates) {
      const index = region * 3
      const dot = direction.x * mesh.regionPosition[index]
        + direction.y * mesh.regionPosition[index + 1]
        + direction.z * mesh.regionPosition[index + 2]
      if (dot > bestDot) {
        bestDot = dot
        selected = region
      }
    }
    return selected
  }
}
