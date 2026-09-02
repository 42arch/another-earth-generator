import type { GlobeGenParams } from '@/core/spherical/config'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import { clamp } from '@/core/spherical/geometry/spherical-math'

const MIN_VECTOR_LENGTH = 1e-8
const CURRENT_SMOOTHING_PASSES = 3
const HEAT_TRANSPORT_ITERATIONS = 36
const MAX_SST_ANOMALY = 8
const SEA_WATER_FREEZING_POINT = -1.8

export interface SphericalOceanCurrentData {
  /** Tangential surface-current velocity; vector magnitude is relative speed. */
  oceanCurrent: Float32Array
  oceanCurrentSpeed: Float32Array
  seaSurfaceTemperature: Float32Array
  /** Difference from latitude-controlled radiative-equilibrium SST. */
  seaSurfaceTemperatureAnomaly: Float32Array
}

/**
 * Produces a deterministic wind-driven surface circulation and advects heat
 * over ocean cells. It is intentionally a climate-normal model rather than a
 * fluid solver: wind stress, Coriolis deflection and coast blocking establish
 * the current field, then a stable graph advection/diffusion pass produces SST.
 */
export class SphericalOceanCurrentGenerator {
  generate(
    mesh: SphericalMesh,
    climateLandMask: Uint8Array,
    annualWind: Float32Array,
    params: GlobeGenParams,
  ): SphericalOceanCurrentData {
    const oceanCurrent = this.generateCurrentField(
      mesh,
      climateLandMask,
      annualWind,
      params,
    )
    const oceanCurrentSpeed = new Float32Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      const index = region * 3
      oceanCurrentSpeed[region] = Math.hypot(
        oceanCurrent[index],
        oceanCurrent[index + 1],
        oceanCurrent[index + 2],
      )
    }
    const {
      seaSurfaceTemperature,
      seaSurfaceTemperatureAnomaly,
    } = this.transportOceanHeat(
      mesh,
      climateLandMask,
      oceanCurrent,
      oceanCurrentSpeed,
      params,
    )
    return {
      oceanCurrent,
      oceanCurrentSpeed,
      seaSurfaceTemperature,
      seaSurfaceTemperatureAnomaly,
    }
  }

  private generateCurrentField(
    mesh: SphericalMesh,
    landMask: Uint8Array,
    wind: Float32Array,
    params: GlobeGenParams,
  ): Float32Array {
    let current = new Float32Array(mesh.numRegions * 3)
    const strength = clamp(params.oceanCurrentStrength, 0, 1.5)
    for (let region = 0; region < mesh.numRegions; region++) {
      if (landMask[region] !== 0)
        continue
      const index = region * 3
      const x = mesh.regionPosition[index]
      const y = mesh.regionPosition[index + 1]
      const z = mesh.regionPosition[index + 2]
      const latitude = mesh.regionLatitude[region]
      const coriolis = Math.sign(latitude)
        * clamp(Math.abs(Math.sin(latitude)) * 0.48, 0, 0.48)
      const cosDeflection = Math.cos(coriolis)
      const sinDeflection = Math.sin(coriolis)
      const rightX = y * wind[index + 2] - z * wind[index + 1]
      const rightY = z * wind[index] - x * wind[index + 2]
      const rightZ = x * wind[index + 1] - y * wind[index]
      const direction = this.applyCoastConstraint(
        mesh,
        landMask,
        region,
        wind[index] * cosDeflection + rightX * sinDeflection,
        wind[index + 1] * cosDeflection + rightY * sinDeflection,
        wind[index + 2] * cosDeflection + rightZ * sinDeflection,
      )
      const oceanNeighborFraction = this.getOceanNeighborFraction(
        mesh,
        landMask,
        region,
      )
      const speed = strength
        * (0.55 + Math.cos(latitude) * 0.45)
        * (0.68 + oceanNeighborFraction * 0.32)
      current[index] = direction[0] * speed
      current[index + 1] = direction[1] * speed
      current[index + 2] = direction[2] * speed
    }

    for (let pass = 0; pass < CURRENT_SMOOTHING_PASSES; pass++) {
      const next = new Float32Array(current.length)
      for (let region = 0; region < mesh.numRegions; region++) {
        if (landMask[region] !== 0)
          continue
        const index = region * 3
        let averageX = 0
        let averageY = 0
        let averageZ = 0
        let oceanNeighborCount = 0
        for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
          if (landMask[neighbor] !== 0)
            continue
          const neighborIndex = neighbor * 3
          averageX += current[neighborIndex]
          averageY += current[neighborIndex + 1]
          averageZ += current[neighborIndex + 2]
          oceanNeighborCount++
        }
        if (oceanNeighborCount > 0) {
          averageX /= oceanNeighborCount
          averageY /= oceanNeighborCount
          averageZ /= oceanNeighborCount
        }
        const direction = this.applyCoastConstraint(
          mesh,
          landMask,
          region,
          current[index] * 0.72 + averageX * 0.28,
          current[index + 1] * 0.72 + averageY * 0.28,
          current[index + 2] * 0.72 + averageZ * 0.28,
        )
        const speed = Math.hypot(
          current[index],
          current[index + 1],
          current[index + 2],
        )
        next[index] = direction[0] * speed
        next[index + 1] = direction[1] * speed
        next[index + 2] = direction[2] * speed
      }
      current = next
    }
    return current
  }

  private applyCoastConstraint(
    mesh: SphericalMesh,
    landMask: Uint8Array,
    region: number,
    inputX: number,
    inputY: number,
    inputZ: number,
  ): readonly [number, number, number] {
    const index = region * 3
    const x = mesh.regionPosition[index]
    const y = mesh.regionPosition[index + 1]
    const z = mesh.regionPosition[index + 2]
    const radial = inputX * x + inputY * y + inputZ * z
    let currentX = inputX - x * radial
    let currentY = inputY - y * radial
    let currentZ = inputZ - z * radial

    for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
      if (landMask[neighbor] === 0)
        continue
      const neighborIndex = neighbor * 3
      const projection = x * mesh.regionPosition[neighborIndex]
        + y * mesh.regionPosition[neighborIndex + 1]
        + z * mesh.regionPosition[neighborIndex + 2]
      let towardX = mesh.regionPosition[neighborIndex] - x * projection
      let towardY = mesh.regionPosition[neighborIndex + 1] - y * projection
      let towardZ = mesh.regionPosition[neighborIndex + 2] - z * projection
      const towardLength = Math.hypot(towardX, towardY, towardZ)
      if (towardLength <= MIN_VECTOR_LENGTH)
        continue
      towardX /= towardLength
      towardY /= towardLength
      towardZ /= towardLength
      const intoCoast = currentX * towardX
        + currentY * towardY
        + currentZ * towardZ
      if (intoCoast <= 0)
        continue
      currentX -= towardX * intoCoast * 1.35
      currentY -= towardY * intoCoast * 1.35
      currentZ -= towardZ * intoCoast * 1.35
    }

    const length = Math.hypot(currentX, currentY, currentZ)
    if (length > MIN_VECTOR_LENGTH) {
      return [
        currentX / length,
        currentY / length,
        currentZ / length,
      ]
    }
    return [0, 0, 0]
  }

  private getOceanNeighborFraction(
    mesh: SphericalMesh,
    landMask: Uint8Array,
    region: number,
  ): number {
    let oceanCount = 0
    let neighborCount = 0
    for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
      oceanCount += landMask[neighbor] === 0 ? 1 : 0
      neighborCount++
    }
    return neighborCount > 0 ? oceanCount / neighborCount : 0
  }

  private transportOceanHeat(
    mesh: SphericalMesh,
    landMask: Uint8Array,
    current: Float32Array,
    currentSpeed: Float32Array,
    params: GlobeGenParams,
  ) {
    const equilibrium = new Float32Array(mesh.numRegions)
    let temperature = new Float32Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      if (landMask[region] !== 0)
        continue
      const latitudeFactor = Math.abs(Math.sin(mesh.regionLatitude[region]))
        ** params.latitudeTemperatureExponent
      equilibrium[region] = clamp(
        params.equatorTemperature
        + (params.poleTemperature - params.equatorTemperature) * latitudeFactor,
        SEA_WATER_FREEZING_POINT,
        32,
      )
      temperature[region] = equilibrium[region]
    }

    for (let iteration = 0; iteration < HEAT_TRANSPORT_ITERATIONS; iteration++) {
      const next = new Float32Array(mesh.numRegions)
      for (let region = 0; region < mesh.numRegions; region++) {
        if (landMask[region] !== 0)
          continue
        const index = region * 3
        const speed = currentSpeed[region]
        const currentLength = Math.max(speed, MIN_VECTOR_LENGTH)
        const currentX = current[index] / currentLength
        const currentY = current[index + 1] / currentLength
        const currentZ = current[index + 2] / currentLength
        let upstreamTemperature = 0
        let upstreamWeight = 0
        let neighborTemperature = 0
        let oceanNeighborCount = 0
        for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
          if (landMask[neighbor] !== 0)
            continue
          oceanNeighborCount++
          neighborTemperature += temperature[neighbor]
          const direction = this.directionToNeighbor(mesh, region, neighbor)
          const alignment = Math.max(0, -(
            currentX * direction[0]
            + currentY * direction[1]
            + currentZ * direction[2]
          )) ** 3
          upstreamTemperature += temperature[neighbor] * alignment
          upstreamWeight += alignment
        }
        const neighborMean = oceanNeighborCount > 0
          ? neighborTemperature / oceanNeighborCount
          : temperature[region]
        const upstream = upstreamWeight > MIN_VECTOR_LENGTH
          ? upstreamTemperature / upstreamWeight
          : temperature[region]
        const advection = clamp(
          params.oceanHeatTransport * speed * 0.42,
          0,
          0.58,
        )
        const diffusion = 0.14 * clamp(params.oceanHeatTransport, 0, 1.5)
        const radiativeRelaxation = 0.08
        const local = 1 - advection - diffusion - radiativeRelaxation
        next[region] = clamp(
          temperature[region] * local
          + upstream * advection
          + neighborMean * diffusion
          + equilibrium[region] * radiativeRelaxation,
          SEA_WATER_FREEZING_POINT,
          32,
        )
      }
      temperature = next
    }

    const anomaly = new Float32Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      if (landMask[region] !== 0)
        continue
      anomaly[region] = clamp(
        temperature[region] - equilibrium[region],
        -MAX_SST_ANOMALY,
        MAX_SST_ANOMALY,
      )
    }
    return {
      seaSurfaceTemperature: temperature,
      seaSurfaceTemperatureAnomaly: anomaly,
    }
  }

  private directionToNeighbor(
    mesh: SphericalMesh,
    region: number,
    neighbor: number,
  ): readonly [number, number, number] {
    const index = region * 3
    const neighborIndex = neighbor * 3
    const x = mesh.regionPosition[index]
    const y = mesh.regionPosition[index + 1]
    const z = mesh.regionPosition[index + 2]
    const projection = x * mesh.regionPosition[neighborIndex]
      + y * mesh.regionPosition[neighborIndex + 1]
      + z * mesh.regionPosition[neighborIndex + 2]
    const directionX = mesh.regionPosition[neighborIndex] - x * projection
    const directionY = mesh.regionPosition[neighborIndex + 1] - y * projection
    const directionZ = mesh.regionPosition[neighborIndex + 2] - z * projection
    const length = Math.max(
      MIN_VECTOR_LENGTH,
      Math.hypot(directionX, directionY, directionZ),
    )
    return [directionX / length, directionY / length, directionZ / length]
  }
}
