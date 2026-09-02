import type SphericalMesh from '@/core/spherical/spherical-mesh'
import { BufferAttribute, BufferGeometry } from 'three'
import { clamp } from '@/core/spherical/geometry/spherical-math'

const TARGET_ARROW_COUNT = 420
const ARROW_HEAD_ANGLE = 0.55

export class SphericalWindGeometry {
  create(
    mesh: SphericalMesh,
    wind: Float32Array,
    radius: number,
    regionMask?: Uint8Array,
  ): BufferGeometry {
    const positions: number[] = []
    let visibleRegionCount = mesh.numRegions
    if (regionMask) {
      visibleRegionCount = 0
      for (const visible of regionMask)
        visibleRegionCount += visible !== 0 ? 1 : 0
    }
    const stride = Math.max(1, Math.ceil(visibleRegionCount / TARGET_ARROW_COUNT))
    const shaftAngle = clamp(Math.sqrt(4 * Math.PI / mesh.numRegions) * 0.65, 0.018, 0.065)
    const headAngle = shaftAngle * 0.34
    let visibleIndex = 0
    let arrowCount = 0

    for (let region = 0; region < mesh.numRegions; region++) {
      if (regionMask && regionMask[region] === 0)
        continue
      if (visibleIndex++ % stride !== 0)
        continue
      const index = region * 3
      const pointX = mesh.regionPosition[index]
      const pointY = mesh.regionPosition[index + 1]
      const pointZ = mesh.regionPosition[index + 2]
      const windLength = Math.hypot(wind[index], wind[index + 1], wind[index + 2])
      if (windLength <= Number.EPSILON)
        continue
      const windX = wind[index] / windLength
      const windY = wind[index + 1] / windLength
      const windZ = wind[index + 2] / windLength
      const cosShaft = Math.cos(shaftAngle)
      const sinShaft = Math.sin(shaftAngle)
      const tipX = pointX * cosShaft + windX * sinShaft
      const tipY = pointY * cosShaft + windY * sinShaft
      const tipZ = pointZ * cosShaft + windZ * sinShaft
      const forwardX = -pointX * sinShaft + windX * cosShaft
      const forwardY = -pointY * sinShaft + windY * cosShaft
      const forwardZ = -pointZ * sinShaft + windZ * cosShaft
      const sideX = tipY * forwardZ - tipZ * forwardY
      const sideY = tipZ * forwardX - tipX * forwardZ
      const sideZ = tipX * forwardY - tipY * forwardX
      const cosHeadDirection = Math.cos(ARROW_HEAD_ANGLE)
      const sinHeadDirection = Math.sin(ARROW_HEAD_ANGLE)
      const cosHead = Math.cos(headAngle)
      const sinHead = Math.sin(headAngle)

      this.pushSegment(
        positions,
        pointX,
        pointY,
        pointZ,
        tipX,
        tipY,
        tipZ,
        radius,
      )
      for (const sideSign of [-1, 1]) {
        const branchX = -forwardX * cosHeadDirection
          + sideX * sinHeadDirection * sideSign
        const branchY = -forwardY * cosHeadDirection
          + sideY * sinHeadDirection * sideSign
        const branchZ = -forwardZ * cosHeadDirection
          + sideZ * sinHeadDirection * sideSign
        this.pushSegment(
          positions,
          tipX,
          tipY,
          tipZ,
          tipX * cosHead + branchX * sinHead,
          tipY * cosHead + branchY * sinHead,
          tipZ * cosHead + branchZ * sinHead,
          radius,
        )
      }
      arrowCount++
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    geometry.userData.arrowCount = arrowCount
    geometry.computeBoundingSphere()
    return geometry
  }

  private pushSegment(
    positions: number[],
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    radius: number,
  ): void {
    positions.push(
      ax * radius,
      ay * radius,
      az * radius,
      bx * radius,
      by * radius,
      bz * radius,
    )
  }
}
