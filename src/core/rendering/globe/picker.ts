import type { Mesh, PerspectiveCamera } from 'three'
import type SphericalMesh from '@/core/mesh/mesh'
import { Raycaster, Vector2 } from 'three'
import { findNearestCandidateRegion, findNearestMeshRegion, getNormalizedDeviceCoordinates } from '@/core/rendering/shared/picking/spherical-picking'

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
    getNormalizedDeviceCoordinates(event, canvas, this.pointer)
    this.raycaster.setFromCamera(this.pointer, camera)
    const intersection = this.raycaster.intersectObject(surface, false)[0]
    if (!intersection || intersection.faceIndex === undefined)
      return null

    const faceRegions = surface.geometry.userData.faceRegions as Uint32Array | undefined
    if (faceRegions)
      return faceRegions[intersection.faceIndex!] ?? null

    const direction = surface.worldToLocal(intersection.point.clone()).normalize()
    if (surface.userData.cartographicOcean) {
      return findNearestMeshRegion(mesh, direction.x, direction.y, direction.z)
    }

    const triangleIndex = intersection.faceIndex! * 3
    const candidates = [
      mesh.triangles[triangleIndex],
      mesh.triangles[triangleIndex + 1],
      mesh.triangles[triangleIndex + 2],
    ]
    return findNearestCandidateRegion(mesh, direction.x, direction.y, direction.z, candidates)
  }
}
