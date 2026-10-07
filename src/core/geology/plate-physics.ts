import type { SphericalCrustData } from '@/core/geology/geology-data'
import type SphericalMesh from '@/core/mesh/mesh'
import { CRUST_TYPE, PLATE_BOUNDARY } from '@/core/geology/geology-data'
import { MantleDynamicTopographyGenerator } from '@/core/geology/mantle-dynamic-topography'
import { SphericalPlateBoundaryAnalyzer } from '@/core/geology/plate-boundary-analyzer'
import { clamp } from '@/core/math/math'

const CONTINENTAL_DRAG_FACTOR = 0.35
const OCEAN_DRAG_FACTOR = 1
const SIZE_VELOCITY_POWER = 0.5
const SIZE_VELOCITY_MIN = 0.4
const SIZE_VELOCITY_MAX = 2.5
const SLAB_PULL_BLEND = 0.65
const RIDGE_PUSH_BLEND = 0.4
const MANTLE_POLE_BLEND = 0.45
const MANTLE_SPEED_ALIGN_STRENGTH = 0.35

interface PlatePairBoundary {
  plateA: number
  plateB: number
  total: number
  convergent: Array<{ subducting: number, oceanic: boolean, midpoint: readonly [number, number, number] }>
  divergent: Array<readonly [number, number, number]>
}

/** Applies reference-style drag, size scaling, mantle flow, slab pull and ridge push. */
export class PlatePhysicsProcessor {
  private readonly boundaryAnalyzer = new SphericalPlateBoundaryAnalyzer()
  private readonly mantleGenerator = new MantleDynamicTopographyGenerator()
  private latestMantleFlow: Float32Array | null = null

  get mantleFlow(): Float32Array | null {
    return this.latestMantleFlow
  }

  apply(
    mesh: SphericalMesh,
    regionPlate: Int16Array,
    angularVelocity: Float32Array,
    crust: SphericalCrustData,
    seed: number,
    strengthMultiplier = 1,
  ): Float32Array {
    const plateCount = angularVelocity.length / 3
    const result = Float32Array.from(angularVelocity)
    const area = new Float64Array(plateCount)
    const centroid = new Float64Array(plateCount * 3)
    for (let region = 0; region < mesh.numRegions; region++) {
      const plate = regionPlate[region]
      const weight = mesh.regionArea[region]
      area[plate] += weight
      const source = region * 3
      const target = plate * 3
      centroid[target] += mesh.regionPosition[source] * weight
      centroid[target + 1] += mesh.regionPosition[source + 1] * weight
      centroid[target + 2] += mesh.regionPosition[source + 2] * weight
    }
    for (let plate = 0; plate < plateCount; plate++)
      this.normalizeAt(centroid, plate * 3)

    const landAreas: number[] = []
    for (let plate = 0; plate < plateCount; plate++) {
      if (crust.plateCrustType[plate] === CRUST_TYPE.Continental)
        landAreas.push(area[plate])
    }
    const landMean = landAreas.length > 0
      ? landAreas.reduce((sum, value) => sum + value, 0) / landAreas.length
      : 0
    const landVariance = landAreas.length > 0
      ? landAreas.reduce((sum, value) => sum + (value - landMean) ** 2, 0) / landAreas.length
      : 0
    const landDeviation = Math.sqrt(landVariance) || 1
    const averageArea = 4 * Math.PI / Math.max(1, plateCount)

    for (let plate = 0; plate < plateCount; plate++) {
      let drag = OCEAN_DRAG_FACTOR
      if (crust.plateCrustType[plate] === CRUST_TYPE.Continental) {
        const sigmasBelow = Math.max(0, (landMean - area[plate]) / landDeviation)
        const smallPlateRelief = Math.min(1, sigmasBelow / 2)
        drag = CONTINENTAL_DRAG_FACTOR
          + (OCEAN_DRAG_FACTOR - CONTINENTAL_DRAG_FACTOR) * smallPlateRelief
      }
      const relativeArea = area[plate] / Math.max(averageArea, Number.EPSILON)
      const sizeFactor = clamp(
        relativeArea ** -SIZE_VELOCITY_POWER,
        SIZE_VELOCITY_MIN,
        SIZE_VELOCITY_MAX,
      )
      const scale = drag * sizeFactor
      const index = plate * 3
      result[index] *= scale
      result[index + 1] *= scale
      result[index + 2] *= scale
    }

    const initialBoundaries = this.boundaryAnalyzer.analyze(mesh, regionPlate, result, crust)
    const mantle = this.mantleGenerator.generateFromBoundaryTypes(
      mesh,
      initialBoundaries.regionBoundaryType,
      seed,
    )
    this.latestMantleFlow = mantle.normalizedFlow
    const mantleFlow = new Float64Array(plateCount * 3)
    for (let region = 0; region < mesh.numRegions; region++) {
      const plate = regionPlate[region]
      const source = region * 3
      const target = plate * 3
      const weight = mesh.regionArea[region]
      mantleFlow[target] += mantle.tangentFlow[source] * weight
      mantleFlow[target + 1] += mantle.tangentFlow[source + 1] * weight
      mantleFlow[target + 2] += mantle.tangentFlow[source + 2] * weight
    }
    for (let plate = 0; plate < plateCount; plate++) {
      const index = plate * 3
      const flowLength = Math.hypot(
        mantleFlow[index],
        mantleFlow[index + 1],
        mantleFlow[index + 2],
      )
      if (flowLength < 1e-10)
        continue
      this.biasVelocityDirection(
        result,
        index,
        centroid,
        index,
        mantleFlow[index],
        mantleFlow[index + 1],
        mantleFlow[index + 2],
        Math.min(0.9, MANTLE_POLE_BLEND * strengthMultiplier),
      )
      const cx = centroid[index]
      const cy = centroid[index + 1]
      const cz = centroid[index + 2]
      const wx = result[index]
      const wy = result[index + 1]
      const wz = result[index + 2]
      const vx = wy * cz - wz * cy
      const vy = wz * cx - wx * cz
      const vz = wx * cy - wy * cx
      const velocityLength = Math.hypot(vx, vy, vz)
      if (velocityLength > 1e-10) {
        const alignment = (vx * mantleFlow[index] + vy * mantleFlow[index + 1] + vz * mantleFlow[index + 2])
          / (velocityLength * flowLength)
        const speedMultiplier = 1 + MANTLE_SPEED_ALIGN_STRENGTH * Math.max(0, alignment)
        result[index] *= speedMultiplier
        result[index + 1] *= speedMultiplier
        result[index + 2] *= speedMultiplier
      }
    }

    const boundaries = this.boundaryAnalyzer.analyze(mesh, regionPlate, result, crust)
    const slabCenters = new Float64Array(plateCount * 3)
    const slabCounts = new Uint32Array(plateCount)
    const ridgeCenters = new Float64Array(plateCount * 3)
    const ridgeCounts = new Uint32Array(plateCount)
    const pairBoundaries = new Map<string, PlatePairBoundary>()
    const edgeCount = mesh.voronoi.edgeRegions.length / 2
    for (let edge = 0; edge < edgeCount; edge++) {
      const regionA = mesh.voronoi.edgeRegions[edge * 2]
      const regionB = mesh.voronoi.edgeRegions[edge * 2 + 1]
      const plateA = regionPlate[regionA]
      const plateB = regionPlate[regionB]
      if (plateA === plateB)
        continue
      const midpoint = this.edgeMidpoint(mesh, regionA, regionB)
      const lowerPlate = Math.min(plateA, plateB)
      const upperPlate = Math.max(plateA, plateB)
      const key = `${lowerPlate}:${upperPlate}`
      const pair = pairBoundaries.get(key) ?? {
        plateA: lowerPlate,
        plateB: upperPlate,
        total: 0,
        convergent: [],
        divergent: [],
      }
      pair.total++
      if (boundaries.edgeBoundaryType[edge] === PLATE_BOUNDARY.Convergent) {
        const subducting = boundaries.edgeSubductingPlate[edge]
        if (subducting >= 0) {
          const subductingRegion = subducting === plateA ? regionA : regionB
          pair.convergent.push({
            subducting,
            oceanic: crust.regionCrustType[subductingRegion] === CRUST_TYPE.Oceanic,
            midpoint,
          })
        }
      }
      else if (boundaries.edgeBoundaryType[edge] === PLATE_BOUNDARY.Divergent) {
        pair.divergent.push(midpoint)
      }
      pairBoundaries.set(key, pair)
    }
    for (const pair of pairBoundaries.values()) {
      if (pair.convergent.length > pair.total * 0.3) {
        for (const { subducting, oceanic, midpoint } of pair.convergent) {
          if (!oceanic)
            continue
          this.accumulate(slabCenters, subducting, midpoint)
          slabCounts[subducting]++
        }
      }
      if (pair.divergent.length > pair.total * 0.3) {
        for (const midpoint of pair.divergent) {
          this.accumulate(ridgeCenters, pair.plateA, midpoint)
          this.accumulate(ridgeCenters, pair.plateB, midpoint)
          ridgeCounts[pair.plateA]++
          ridgeCounts[pair.plateB]++
        }
      }
    }

    for (let plate = 0; plate < plateCount; plate++) {
      const index = plate * 3
      if (slabCounts[plate] > 0) {
        const target = this.normalizedAverage(slabCenters, plate, slabCounts[plate])
        this.biasVelocity(
          result,
          index,
          centroid,
          index,
          target,
          Math.min(0.9, SLAB_PULL_BLEND * strengthMultiplier),
          false,
        )
      }
      if (ridgeCounts[plate] > 0) {
        const target = this.normalizedAverage(ridgeCenters, plate, ridgeCounts[plate])
        this.biasVelocity(
          result,
          index,
          centroid,
          index,
          target,
          Math.min(0.9, RIDGE_PUSH_BLEND * strengthMultiplier),
          true,
        )
      }
    }
    return result
  }

  private biasVelocity(
    velocities: Float32Array,
    velocityIndex: number,
    centroids: Float64Array,
    centroidIndex: number,
    target: readonly [number, number, number],
    blend: number,
    away: boolean,
  ): void {
    const cx = centroids[centroidIndex]
    const cy = centroids[centroidIndex + 1]
    const cz = centroids[centroidIndex + 2]
    let dx = away ? cx - target[0] : target[0] - cx
    let dy = away ? cy - target[1] : target[1] - cy
    let dz = away ? cz - target[2] : target[2] - cz
    const radial = dx * cx + dy * cy + dz * cz
    dx -= radial * cx
    dy -= radial * cy
    dz -= radial * cz
    const directionLength = Math.hypot(dx, dy, dz)
    if (directionLength < 1e-10)
      return
    dx /= directionLength
    dy /= directionLength
    dz /= directionLength

    const wx = velocities[velocityIndex]
    const wy = velocities[velocityIndex + 1]
    const wz = velocities[velocityIndex + 2]
    const omega = Math.hypot(wx, wy, wz)
    if (omega < 1e-10)
      return
    const vx = wy * cz - wz * cy
    const vy = wz * cx - wx * cz
    const vz = wx * cy - wy * cx
    const speed = Math.hypot(vx, vy, vz)
    let tx = vx + dx * (blend * speed + 0.01)
    let ty = vy + dy * (blend * speed + 0.01)
    let tz = vz + dz * (blend * speed + 0.01)
    const targetLength = Math.hypot(tx, ty, tz) || 1
    tx /= targetLength
    ty /= targetLength
    tz /= targetLength
    let px = cy * tz - cz * ty
    let py = cz * tx - cx * tz
    let pz = cx * ty - cy * tx
    const poleLength = Math.hypot(px, py, pz) || 1
    px /= poleLength
    py /= poleLength
    pz /= poleLength
    const oldPx = wx / omega
    const oldPy = wy / omega
    const oldPz = wz / omega
    if (px * oldPx + py * oldPy + pz * oldPz < 0) {
      px = -px
      py = -py
      pz = -pz
    }
    let nextX = oldPx + (px - oldPx) * blend
    let nextY = oldPy + (py - oldPy) * blend
    let nextZ = oldPz + (pz - oldPz) * blend
    const nextLength = Math.hypot(nextX, nextY, nextZ) || 1
    nextX /= nextLength
    nextY /= nextLength
    nextZ /= nextLength
    velocities[velocityIndex] = nextX * omega
    velocities[velocityIndex + 1] = nextY * omega
    velocities[velocityIndex + 2] = nextZ * omega
  }

  private biasVelocityDirection(
    velocities: Float32Array,
    velocityIndex: number,
    centroids: Float64Array,
    centroidIndex: number,
    directionX: number,
    directionY: number,
    directionZ: number,
    blend: number,
  ): void {
    const cx = centroids[centroidIndex]
    const cy = centroids[centroidIndex + 1]
    const cz = centroids[centroidIndex + 2]
    const radial = directionX * cx + directionY * cy + directionZ * cz
    const tx = directionX - radial * cx
    const ty = directionY - radial * cy
    const tz = directionZ - radial * cz
    const length = Math.hypot(tx, ty, tz)
    if (length < 1e-10)
      return
    this.biasVelocity(
      velocities,
      velocityIndex,
      centroids,
      centroidIndex,
      [cx + tx / length, cy + ty / length, cz + tz / length],
      blend,
      false,
    )
  }

  private edgeMidpoint(mesh: SphericalMesh, regionA: number, regionB: number): [number, number, number] {
    const a = regionA * 3
    const b = regionB * 3
    const x = mesh.regionPosition[a] + mesh.regionPosition[b]
    const y = mesh.regionPosition[a + 1] + mesh.regionPosition[b + 1]
    const z = mesh.regionPosition[a + 2] + mesh.regionPosition[b + 2]
    const length = Math.hypot(x, y, z) || 1
    return [x / length, y / length, z / length]
  }

  private accumulate(target: Float64Array, plate: number, value: readonly number[]): void {
    const index = plate * 3
    target[index] += value[0]
    target[index + 1] += value[1]
    target[index + 2] += value[2]
  }

  private normalizedAverage(values: Float64Array, plate: number, count: number): [number, number, number] {
    const index = plate * 3
    const x = values[index] / count
    const y = values[index + 1] / count
    const z = values[index + 2] / count
    const length = Math.hypot(x, y, z) || 1
    return [x / length, y / length, z / length]
  }

  private normalizeAt(values: Float64Array, index: number): void {
    const length = Math.hypot(values[index], values[index + 1], values[index + 2]) || 1
    values[index] /= length
    values[index + 1] /= length
    values[index + 2] /= length
  }
}
