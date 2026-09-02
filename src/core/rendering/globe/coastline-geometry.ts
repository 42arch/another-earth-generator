import type { CoastEdgeInfo } from '@/core/spherical/features/spherical-coastline-source'
import type { SphericalLinePath, SphericalPoint } from '@/core/spherical/geometry/spherical-polyline'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import { BufferAttribute, BufferGeometry } from 'three'
import { sampleSmoothSphericalPath } from '@/core/spherical/geometry/spherical-polyline'

interface CoastlineGeometries {
  line: BufferGeometry
  seam: BufferGeometry
}

interface RibbonPair {
  left: SphericalPoint
  right: SphericalPoint
}

const COAST_SMOOTHNESS = 0.9
const COAST_SAMPLES_PER_SEGMENT = 5

/**
 * 海岸描边与填缝带共用一条平滑球面路径。
 *
 * 填缝带只连接原始 Voronoi 边与对应的平滑片段，而不对整个陆地闭环
 * 三角剖分。这样既能遮住两条边界间的缝隙，也不会把球面大洲误判为
 * 局部平面多边形而被海洋覆盖。
 */
export class GlobeCoastlineGeometry {
  create(
    mesh: SphericalMesh,
    paths: readonly SphericalLinePath[],
    edgeInfo: ReadonlyMap<string, CoastEdgeInfo>,
    colors: Float32Array,
    radius: number,
    lineWidth: number,
  ): CoastlineGeometries {
    const linePositions: number[] = []
    const seamPositions: number[] = []
    const seamColors: number[] = []

    for (const path of paths) {
      const keys = path.keys
      if (!keys || keys.length < 2)
        continue
      const sampled = sampleSmoothSphericalPath(path, COAST_SMOOTHNESS, COAST_SAMPLES_PER_SEGMENT)
      const linePairs = this.buildRibbonPairs(sampled, path.closed, lineWidth, radius)
      const segmentCount = path.closed ? path.points.length : path.points.length - 1
      for (let edge = 0; edge < segmentCount; edge++) {
        const nextEdge = (edge + 1) % path.points.length
        const key = this.getEdgeKey(keys[edge], keys[nextEdge])
        const info = edgeInfo.get(key)
        const rawStart = path.points[edge]
        const rawEnd = path.points[nextEdge]
        for (let sample = 0; sample < COAST_SAMPLES_PER_SEGMENT; sample++) {
          const sampledIndex = edge * COAST_SAMPLES_PER_SEGMENT + sample
          const nextSampledIndex = path.closed
            ? (sampledIndex + 1) % sampled.length
            : sampledIndex + 1
          const smoothStart = sampled[sampledIndex]
          const smoothEnd = sampled[nextSampledIndex]
          this.appendRibbon(linePositions, linePairs[sampledIndex], linePairs[nextSampledIndex])
          if (!info)
            continue
          const rawSegmentStart = this.interpolateOnSphere(
            rawStart,
            rawEnd,
            sample / COAST_SAMPLES_PER_SEGMENT,
          )
          const rawSegmentEnd = this.interpolateOnSphere(
            rawStart,
            rawEnd,
            (sample + 1) / COAST_SAMPLES_PER_SEGMENT,
          )
          const seamColor = this.getSeamColor(
            mesh,
            info,
            rawSegmentStart,
            rawSegmentEnd,
            smoothStart,
            smoothEnd,
            colors,
          )
          this.appendSeamQuad(
            seamPositions,
            seamColors,
            this.scale(rawSegmentStart, radius),
            this.scale(rawSegmentEnd, radius),
            this.scale(smoothStart, radius),
            this.scale(smoothEnd, radius),
            seamColor,
          )
        }
      }
    }

    return {
      line: this.createGeometry(linePositions),
      // 填缝带的法线沿球面径向，需与底层地表使用同一受光方向。
      seam: this.createGeometry(seamPositions, seamColors, true),
    }
  }

  private appendRibbon(
    positions: number[],
    startPair: RibbonPair,
    endPair: RibbonPair,
  ): void {
    positions.push(
      ...startPair.left,
      ...startPair.right,
      ...endPair.left,
      ...startPair.right,
      ...endPair.right,
      ...endPair.left,
    )
  }

  private appendSeamQuad(
    positions: number[],
    colors: number[],
    rawStart: SphericalPoint,
    rawEnd: SphericalPoint,
    smoothStart: SphericalPoint,
    smoothEnd: SphericalPoint,
    color: readonly number[],
  ): void {
    let vertexCount = 0
    if (this.appendOutwardTriangle(positions, rawStart, rawEnd, smoothStart))
      vertexCount += 3
    if (this.appendOutwardTriangle(positions, rawEnd, smoothEnd, smoothStart))
      vertexCount += 3
    for (let vertex = 0; vertex < vertexCount; vertex++)
      colors.push(color[0], color[1], color[2])
  }

  private appendOutwardTriangle(
    positions: number[],
    a: SphericalPoint,
    b: SphericalPoint,
    c: SphericalPoint,
  ): boolean {
    const faceNormal = this.cross(this.subtract(b, a), this.subtract(c, a))
    const surfaceNormal = this.normalize(this.add(this.add(a, b), c))
    const orientation = this.dot(faceNormal, surfaceNormal)
    // 平滑路径经过原始边界端点时可能产生零面积三角形，无需渲染。
    if (Math.abs(orientation) < 1e-8)
      return false
    if (orientation > 0) {
      positions.push(...a, ...b, ...c)
      return true
    }
    // 所有填缝三角形统一朝球外，避免双面材质翻转局部法线造成亮斑。
    positions.push(...a, ...c, ...b)
    return true
  }

  private getSeamColor(
    mesh: SphericalMesh,
    info: CoastEdgeInfo,
    rawStart: SphericalPoint,
    rawEnd: SphericalPoint,
    smoothStart: SphericalPoint,
    smoothEnd: SphericalPoint,
    colors: Float32Array,
  ): readonly number[] {
    const edgeNormal = this.normalize(this.cross(rawStart, rawEnd))
    const land = this.getRegionPosition(mesh, info.landRegion)
    const smoothMidpoint = this.normalize(this.add(smoothStart, smoothEnd))
    const landSide = this.dot(land, edgeNormal)
    const smoothSide = this.dot(smoothMidpoint, edgeNormal)
    // 平滑线向陆地移动时，原边与平滑线之间应补水；反之补陆地。
    const fillRegion = landSide * smoothSide > 0
      ? info.waterRegion
      : info.landRegion
    return this.getRegionColor(colors, fillRegion)
  }

  private buildRibbonPairs(
    sampled: readonly SphericalPoint[],
    closed: boolean,
    width: number,
    radius: number,
  ): RibbonPair[] {
    return sampled.map((center, index) => {
      const previous = closed
        ? sampled[(index - 1 + sampled.length) % sampled.length]
        : sampled[Math.max(0, index - 1)]
      const next = closed
        ? sampled[(index + 1) % sampled.length]
        : sampled[Math.min(sampled.length - 1, index + 1)]
      const tangent = this.projectToTangent(this.subtract(next, previous), center)
      const bank = this.normalize(this.cross(center, tangent))
      return this.getPair(center, bank, width, radius)
    })
  }

  private getPair(center: SphericalPoint, bank: SphericalPoint, width: number, radius: number): RibbonPair {
    const offset = width * 0.5 / radius
    return {
      left: this.scale(this.normalize(this.add(center, this.scale(bank, offset))), radius),
      right: this.scale(this.normalize(this.subtract(center, this.scale(bank, offset))), radius),
    }
  }

  private createGeometry(
    positions: number[],
    colors?: number[],
    useRadialNormals = false,
  ): BufferGeometry {
    const geometry = new BufferGeometry()
    const positionAttribute = new BufferAttribute(new Float32Array(positions), 3)
    geometry.setAttribute('position', positionAttribute)
    if (useRadialNormals) {
      const normals = new Float32Array(positions.length)
      for (let index = 0; index < positionAttribute.count; index++) {
        const x = positionAttribute.getX(index)
        const y = positionAttribute.getY(index)
        const z = positionAttribute.getZ(index)
        const length = Math.hypot(x, y, z) || 1
        const offset = index * 3
        normals[offset] = x / length
        normals[offset + 1] = y / length
        normals[offset + 2] = z / length
      }
      geometry.setAttribute('normal', new BufferAttribute(normals, 3))
    }
    if (colors)
      geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
    geometry.computeBoundingSphere()
    return geometry
  }

  private getRegionPosition(mesh: SphericalMesh, region: number): SphericalPoint {
    const index = region * 3
    return [
      mesh.regionPosition[index],
      mesh.regionPosition[index + 1],
      mesh.regionPosition[index + 2],
    ]
  }

  private getRegionColor(colors: Float32Array, region: number): readonly number[] {
    const index = region * 3
    return [colors[index], colors[index + 1], colors[index + 2]]
  }

  private getEdgeKey(a: string, b: string): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`
  }

  private interpolateOnSphere(a: SphericalPoint, b: SphericalPoint, amount: number): SphericalPoint {
    return this.normalize(this.add(this.scale(a, 1 - amount), this.scale(b, amount)))
  }

  private projectToTangent(vector: SphericalPoint, normal: SphericalPoint): SphericalPoint {
    return this.subtract(vector, this.scale(normal, this.dot(vector, normal)))
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

  private normalize(value: SphericalPoint): SphericalPoint {
    const length = Math.hypot(...value) || 1
    return [value[0] / length, value[1] / length, value[2] / length]
  }
}
