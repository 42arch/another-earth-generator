import type { Matrix4 } from 'three'
import type SphericalMesh from '@/core/mesh/mesh'
import { Vector3 } from 'three'
import { computeTangentBasis } from '@/core/mesh/tangent-basis'
import { wrapLongitude } from '@/core/projections/projection-math'

export interface SpineLabelGlyph {
  char: string
  region: number
  lon: number // 弧度
  lat: number // 弧度
  normal: Vector3
  matrix3D: Matrix4
  angle2D: number // 2D 投影平面旋转角
}

export interface SpineResult {
  controlPoints: Vector3[]
  lengthRadians: number
}

/**
 * 依据区域集合，通过 PCA 主成分与分段切片提取版图的中轴样条控制点
 */
export function buildTerritorySpine(
  mesh: SphericalMesh,
  regions: number[],
  populationArray?: Float32Array,
): SpineResult | null {
  if (regions.length < 6)
    return null

  // 1. 计算三维加权几何中心 C
  let sumX = 0
  let sumY = 0
  let sumZ = 0
  let totalW = 0
  for (const r of regions) {
    const pop = populationArray ? populationArray[r] : 1
    const w = pop + 1
    const idx = r * 3
    sumX += mesh.regionPosition[idx] * w
    sumY += mesh.regionPosition[idx + 1] * w
    sumZ += mesh.regionPosition[idx + 2] * w
    totalW += w
  }
  const centerLen = Math.hypot(sumX, sumY, sumZ)
  if (centerLen < 1e-5)
    return null

  const C = new Vector3(sumX / centerLen, sumY / centerLen, sumZ / centerLen)

  // 2. 建立 C 点处的切平面正交坐标系 (East E, North U)
  const northRef = new Vector3(0, 1, 0)
  let U = northRef.clone().sub(C.clone().multiplyScalar(C.dot(northRef)))
  if (U.lengthSq() < 1e-6) {
    const poleFallback = new Vector3(0, 0, -Math.sign(C.y || 1))
    U = poleFallback.sub(C.clone().multiplyScalar(C.dot(poleFallback)))
  }
  U.normalize()
  const E = new Vector3().crossVectors(U, C).normalize()
  U.crossVectors(C, E).normalize()

  // 3. 计算切平面上的加权 2D 协方差矩阵 (PCA 分析版图延伸主方向)
  let meanX = 0
  let meanY = 0
  for (const r of regions) {
    const pop = populationArray ? populationArray[r] : 1
    const w = pop + 1
    const idx = r * 3
    const dx = mesh.regionPosition[idx] - C.x
    const dy = mesh.regionPosition[idx + 1] - C.y
    const dz = mesh.regionPosition[idx + 2] - C.z
    const u = dx * E.x + dy * E.y + dz * E.z
    const v = dx * U.x + dy * U.y + dz * U.z
    meanX += u * w
    meanY += v * w
  }
  meanX /= totalW
  meanY /= totalW

  let covXX = 0
  let covYY = 0
  let covXY = 0
  for (const r of regions) {
    const pop = populationArray ? populationArray[r] : 1
    const w = pop + 1
    const idx = r * 3
    const dx = mesh.regionPosition[idx] - C.x
    const dy = mesh.regionPosition[idx + 1] - C.y
    const dz = mesh.regionPosition[idx + 2] - C.z
    const u = (dx * E.x + dy * E.y + dz * E.z) - meanX
    const v = (dx * U.x + dy * U.y + dz * U.z) - meanY
    covXX += w * u * u
    covYY += w * v * v
    covXY += w * u * v
  }
  covXX /= totalW
  covYY /= totalW
  covXY /= totalW

  // 4. 计算特征值与主特征向量
  const trace = covXX + covYY
  const det = covXX * covYY - covXY * covXY
  const discr = Math.sqrt(Math.max(0, trace * trace * 0.25 - det))
  const lambda1 = trace * 0.5 + discr
  const lambda2 = Math.max(1e-8, trace * 0.5 - discr)
  const elongation = Math.sqrt(lambda1 / lambda2)

  // 细长度低于 1.35 说明版图较为圆整或紧凑，使用中心标签更佳，不强制弯曲
  if (elongation < 1.35)
    return null

  let v1x = 1
  let v1y = 0
  if (Math.abs(covXY) > 1e-8) {
    v1x = lambda1 - covYY
    v1y = covXY
  }
  else {
    v1x = covXX >= covYY ? 1 : 0
    v1y = covXX >= covYY ? 0 : 1
  }
  const v1Len = Math.hypot(v1x, v1y)
  if (v1Len < 1e-6)
    return null
  v1x /= v1Len
  v1y /= v1Len

  // 保证阅读方向大致从西向东 (若偏向西侧则反转)
  if (v1x < -0.15 || (Math.abs(v1x) <= 0.15 && v1y < 0)) {
    v1x = -v1x
    v1y = -v1y
  }

  // 5. 将各区域投影到主轴标量坐标 s_r
  const sValues: number[] = Array.from({ length: regions.length })
  let sMin = Infinity
  let sMax = -Infinity
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i]
    const idx = r * 3
    const dx = mesh.regionPosition[idx] - C.x
    const dy = mesh.regionPosition[idx + 1] - C.y
    const dz = mesh.regionPosition[idx + 2] - C.z
    const u = dx * E.x + dy * E.y + dz * E.z - meanX
    const v = dx * U.x + dy * U.y + dz * U.z - meanY
    const s = u * v1x + v * v1y
    sValues[i] = s
    if (s < sMin)
      sMin = s
    if (s > sMax)
      sMax = s
  }

  const span = sMax - sMin
  if (span < 0.14) // 弧度跨度过小则回退
    return null

  // 6. 沿主轴分为 5 个切片，计算各切片的空间加权质心作为样条控制点
  const sliceCount = 5
  const controlPoints: Vector3[] = []
  const sliceStep = span / sliceCount

  for (let sIdx = 0; sIdx < sliceCount; sIdx++) {
    const sStart = sMin + sIdx * sliceStep
    const sEnd = sStart + sliceStep
    let sliceSumX = 0
    let sliceSumY = 0
    let sliceSumZ = 0
    let sliceWeight = 0

    for (let i = 0; i < regions.length; i++) {
      const s = sValues[i]
      if (s >= sStart && (s < sEnd || (sIdx === sliceCount - 1 && s <= sEnd))) {
        const r = regions[i]
        const pop = populationArray ? populationArray[r] : 1
        const w = pop + 1
        const idx = r * 3
        sliceSumX += mesh.regionPosition[idx] * w
        sliceSumY += mesh.regionPosition[idx + 1] * w
        sliceSumZ += mesh.regionPosition[idx + 2] * w
        sliceWeight += w
      }
    }

    if (sliceWeight > 0) {
      controlPoints.push(new Vector3(sliceSumX, sliceSumY, sliceSumZ).normalize())
    }
  }

  if (controlPoints.length < 3)
    return null

  // 计算控制点总折线距离
  let totalLength = 0
  for (let i = 1; i < controlPoints.length; i++) {
    totalLength += controlPoints[i - 1].distanceTo(controlPoints[i])
  }

  if (totalLength < 0.14)
    return null

  return { controlPoints, lengthRadians: totalLength }
}

/**
 * Catmull-Rom 3D 样条插值求值
 */
export function evaluateCatmullRom(
  points: Vector3[],
  t: number,
): { pos: Vector3, tangent: Vector3 } {
  const n = points.length
  const p = Math.max(0, Math.min(1, t)) * (n - 1)
  const i = Math.min(Math.floor(p), n - 2)
  const f = p - i

  const p0 = points[Math.max(0, i - 1)]
  const p1 = points[i]
  const p2 = points[i + 1]
  const p3 = points[Math.min(n - 1, i + 2)]

  const f2 = f * f
  const f3 = f2 * f

  const posX = 0.5 * (2 * p1.x + (-p0.x + p2.x) * f + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * f2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * f3)
  const posY = 0.5 * (2 * p1.y + (-p0.y + p2.y) * f + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * f2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * f3)
  const posZ = 0.5 * (2 * p1.z + (-p0.z + p2.z) * f + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * f2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * f3)

  const tanX = 0.5 * ((-p0.x + p2.x) + 2 * (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * f + 3 * (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * f2) * (n - 1)
  const tanY = 0.5 * ((-p0.y + p2.y) + 2 * (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * f + 3 * (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * f2) * (n - 1)
  const tanZ = 0.5 * ((-p0.z + p2.z) + 2 * (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * f + 3 * (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * f2) * (n - 1)

  const pos = new Vector3(posX, posY, posZ).normalize()
  const tangent = new Vector3(tanX, tanY, tanZ)
  tangent.sub(pos.clone().multiplyScalar(tangent.dot(pos))).normalize()

  return { pos, tangent }
}

/**
 * 寻找最接近给定三维法向量的领土内部区域
 */
export function findClosestRegionInTerritory(
  mesh: SphericalMesh,
  regions: number[],
  pos: Vector3,
  fallback: number,
): number {
  let bestDot = -Infinity
  let bestRegion = fallback

  for (const r of regions) {
    const idx = r * 3
    const dot = mesh.regionPosition[idx] * pos.x
      + mesh.regionPosition[idx + 1] * pos.y
      + mesh.regionPosition[idx + 2] * pos.z
    if (dot > bestDot) {
      bestDot = dot
      bestRegion = r
    }
  }

  return bestRegion
}

/**
 * 计算实体在球面上的加权中心元（Medoid）区域
 */
export function findEntityMedoidRegion(
  mesh: SphericalMesh,
  dominantArray: Int32Array,
  entityId: number,
  fallbackRegion: number,
  populationArray?: Float32Array,
): { region: number, totalPopulation: number, memberRegions: number[] } {
  const numRegions = mesh.numRegions
  const memberRegions: number[] = []
  let sumX = 0
  let sumY = 0
  let sumZ = 0
  let totalPopulation = 0

  for (let r = 0; r < numRegions; r++) {
    if (dominantArray[r] === entityId) {
      memberRegions.push(r)
      const pop = populationArray ? populationArray[r] : 1
      const w = pop + 1
      const idx = r * 3
      sumX += mesh.regionPosition[idx] * w
      sumY += mesh.regionPosition[idx + 1] * w
      sumZ += mesh.regionPosition[idx + 2] * w
      totalPopulation += pop
    }
  }

  if (memberRegions.length === 0) {
    return {
      region: fallbackRegion >= 0 && fallbackRegion < numRegions ? fallbackRegion : -1,
      totalPopulation: 0,
      memberRegions,
    }
  }

  const len = Math.hypot(sumX, sumY, sumZ)
  if (len < 1e-5) {
    return {
      region: fallbackRegion >= 0 && fallbackRegion < numRegions ? fallbackRegion : -1,
      totalPopulation,
      memberRegions,
    }
  }

  const avgX = sumX / len
  const avgY = sumY / len
  const avgZ = sumZ / len

  let bestDot = -Infinity
  let bestRegion = -1

  for (const r of memberRegions) {
    const idx = r * 3
    const dot = mesh.regionPosition[idx] * avgX
      + mesh.regionPosition[idx + 1] * avgY
      + mesh.regionPosition[idx + 2] * avgZ
    if (dot > bestDot) {
      bestDot = dot
      bestRegion = r
    }
  }

  return {
    region: bestRegion >= 0 ? bestRegion : fallbackRegion,
    totalPopulation,
    memberRegions,
  }
}

/**
 * 为实体名称生成沿样条脊线排布的字符坐标序列，或回退到中心点
 */
export function layoutSpineLabel(
  mesh: SphericalMesh,
  name: string,
  memberRegions: number[],
  anchorRegion: number,
  populationArray?: Float32Array,
): { glyphs: SpineLabelGlyph[], isCurved: boolean } | null {
  if (anchorRegion < 0 || anchorRegion >= mesh.numRegions)
    return null

  const chars = Array.from(name)
  const charCount = chars.length
  const spine = charCount >= 3 ? buildTerritorySpine(mesh, memberRegions, populationArray) : null

  // 1. 若提取到了平滑中轴样条线，执行沿曲线的单字排版
  if (spine) {
    const glyphs: SpineLabelGlyph[] = []
    const tStart = 0.16
    const tEnd = 0.84

    for (let i = 0; i < charCount; i++) {
      const t = charCount > 1 ? tStart + (i / (charCount - 1)) * (tEnd - tStart) : 0.5
      const { pos, tangent } = evaluateCatmullRom(spine.controlPoints, t)

      const normal = pos.clone().normalize()
      const { matrix } = computeTangentBasis(normal, tangent)

      const lon = Math.atan2(normal.x, normal.z)
      const lat = Math.asin(Math.max(-1, Math.min(1, normal.y)))

      // 计算 2D 平面切向旋转角：切向量在投影平面的斜率
      const northRef = new Vector3(0, 1, 0)
      const U = northRef.clone().sub(normal.clone().multiplyScalar(normal.dot(northRef))).normalize()
      const E = new Vector3().crossVectors(U, normal).normalize()
      const dLon = tangent.dot(E)
      const dLat = tangent.dot(U)

      let angle2D = Math.atan2(dLat, dLon)
      // 避免文字上下倒置 (倒角区间翻转 180 度)
      if (Math.abs(angle2D) > Math.PI * 0.5) {
        angle2D = wrapLongitude(angle2D + Math.PI)
      }

      const glyphRegion = findClosestRegionInTerritory(mesh, memberRegions, normal, anchorRegion)

      glyphs.push({
        char: chars[i],
        region: glyphRegion,
        lon,
        lat,
        normal,
        matrix3D: matrix,
        angle2D,
      })
    }

    return { glyphs, isCurved: true }
  }

  // 2. 回退到单锚点整体切向排版
  const idx = anchorRegion * 3
  const normal = new Vector3(
    mesh.regionPosition[idx],
    mesh.regionPosition[idx + 1],
    mesh.regionPosition[idx + 2],
  ).normalize()

  const { matrix } = computeTangentBasis(normal)
  const lon = mesh.regionLongitude[anchorRegion]
  const lat = mesh.regionLatitude[anchorRegion]

  const singleGlyph: SpineLabelGlyph = {
    char: name,
    region: anchorRegion,
    lon,
    lat,
    normal,
    matrix3D: matrix,
    angle2D: 0,
  }

  return { glyphs: [singleGlyph], isCurved: false }
}
