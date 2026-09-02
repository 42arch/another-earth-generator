import type {
  SphericalPoint,
  SphericalStrokePath,
} from '@/core/spherical/geometry/spherical-polyline'
import type { SphericalRiverJunction } from '@/core/spherical/features/spherical-river-source'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type { SphericalRiverData } from '@/core/spherical/spherical-world-data'
import { BufferAttribute, BufferGeometry } from 'three'
import { SphericalRiverSource } from '@/core/spherical/features/spherical-river-source'

interface RibbonPair {
  left: SphericalPoint
  right: SphericalPoint
}

const JUNCTION_SEGMENTS = 16

export class GlobeRiverGeometry {
  private readonly source = new SphericalRiverSource()

  create(
    mesh: SphericalMesh,
    rivers: SphericalRiverData,
    landMask: Uint8Array,
    radius: number,
    hiddenRegionMask?: Uint8Array,
  ): BufferGeometry {
    const data = this.source.create(mesh, rivers, landMask, hiddenRegionMask)
    const positions: number[] = []

    for (const path of data.paths)
      this.appendRibbon(positions, path, radius)
    for (const junction of data.junctions)
      this.appendJunctionPatch(positions, junction, radius)

    const geometry = new BufferGeometry()
    const positionAttribute = new BufferAttribute(new Float32Array(positions), 3)
    geometry.setAttribute('position', positionAttribute)
    geometry.setAttribute('normal', this.createRadialNormals(positionAttribute))
    geometry.userData.riverPathCount = data.paths.length
    geometry.userData.riverJunctionCount = data.junctions.length
    geometry.computeBoundingSphere()
    return geometry
  }

  private appendRibbon(
    positions: number[],
    path: SphericalStrokePath,
    radius: number,
  ): void {
    const pairs: RibbonPair[] = []
    for (let index = 0; index < path.points.length; index++) {
      const center = path.points[index].position
      const previous = path.points[Math.max(0, index - 2)].position
      const next = path.points[Math.min(path.points.length - 1, index + 2)].position
      const tangent = this.projectToTangent(this.subtract(next, previous), center)
      const bankDirection = this.normalize(this.cross(center, tangent))
      pairs.push(this.getRibbonPair(center, bankDirection, path.points[index].width, radius))
    }

    for (let index = 1; index < pairs.length; index++) {
      const previous = pairs[index - 1]
      const current = pairs[index]
      this.appendOutwardTriangle(positions, previous.left, previous.right, current.left)
      this.appendOutwardTriangle(positions, previous.right, current.right, current.left)
    }
  }

  private appendJunctionPatch(
    positions: number[],
    junction: SphericalRiverJunction,
    radius: number,
  ): void {
    const center = junction.position
    const reference: SphericalPoint = Math.abs(center[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]
    const tangent = this.normalize(this.cross(reference, center))
    const bitangent = this.normalize(this.cross(center, tangent))
    const angularRadius = junction.width * 0.56 / radius
    const scaledCenter = this.scale(center, radius)

    for (let segment = 0; segment < JUNCTION_SEGMENTS; segment++) {
      const angleA = segment / JUNCTION_SEGMENTS * Math.PI * 2
      const angleB = (segment + 1) / JUNCTION_SEGMENTS * Math.PI * 2
      const pointA = this.pointOnTangentCircle(
        center,
        tangent,
        bitangent,
        angleA,
        angularRadius,
        radius,
      )
      const pointB = this.pointOnTangentCircle(
        center,
        tangent,
        bitangent,
        angleB,
        angularRadius,
        radius,
      )
      this.appendOutwardTriangle(positions, scaledCenter, pointA, pointB)
    }
  }

  private pointOnTangentCircle(
    center: SphericalPoint,
    tangent: SphericalPoint,
    bitangent: SphericalPoint,
    angle: number,
    angularRadius: number,
    radius: number,
  ): SphericalPoint {
    const direction = this.add(
      this.scale(tangent, Math.cos(angle)),
      this.scale(bitangent, Math.sin(angle)),
    )
    return this.scale(
      this.normalize(this.add(center, this.scale(direction, angularRadius))),
      radius,
    )
  }

  private getRibbonPair(
    center: SphericalPoint,
    bankDirection: SphericalPoint,
    width: number,
    radius: number,
  ): RibbonPair {
    const offset = width * 0.5 / radius
    return {
      left: this.scale(
        this.normalize(this.add(center, this.scale(bankDirection, offset))),
        radius,
      ),
      right: this.scale(
        this.normalize(this.subtract(center, this.scale(bankDirection, offset))),
        radius,
      ),
    }
  }

  private appendOutwardTriangle(
    positions: number[],
    a: SphericalPoint,
    b: SphericalPoint,
    c: SphericalPoint,
  ): void {
    const faceNormal = this.cross(this.subtract(b, a), this.subtract(c, a))
    const surfaceNormal = this.normalize(this.add(this.add(a, b), c))
    if (this.dot(faceNormal, surfaceNormal) >= 0) {
      positions.push(...a, ...b, ...c)
      return
    }
    positions.push(...a, ...c, ...b)
  }

  private createRadialNormals(positions: BufferAttribute): BufferAttribute {
    const normals = new Float32Array(positions.count * 3)
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index)
      const y = positions.getY(index)
      const z = positions.getZ(index)
      const length = Math.hypot(x, y, z) || 1
      const offset = index * 3
      normals[offset] = x / length
      normals[offset + 1] = y / length
      normals[offset + 2] = z / length
    }
    return new BufferAttribute(normals, 3)
  }

  private projectToTangent(vector: SphericalPoint, normal: SphericalPoint): SphericalPoint {
    const projection = this.dot(vector, normal)
    const tangent = this.subtract(vector, this.scale(normal, projection))
    if (this.distance(tangent, [0, 0, 0]) > 1e-8)
      return tangent
    const reference: SphericalPoint = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]
    return this.cross(reference, normal)
  }

  private add(a: SphericalPoint, b: SphericalPoint): SphericalPoint {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
  }

  private subtract(a: SphericalPoint, b: SphericalPoint): SphericalPoint {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  }

  private scale(value: SphericalPoint, amount: number): SphericalPoint {
    return [value[0] * amount, value[1] * amount, value[2] * amount]
  }

  private cross(a: SphericalPoint, b: SphericalPoint): SphericalPoint {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ]
  }

  private dot(a: SphericalPoint, b: SphericalPoint): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  }

  private distance(a: SphericalPoint, b: SphericalPoint): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  }

  private normalize(value: SphericalPoint): SphericalPoint {
    const length = Math.hypot(...value) || 1
    return [value[0] / length, value[1] / length, value[2] / length]
  }
}
