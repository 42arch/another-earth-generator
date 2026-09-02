import type SphericalMesh from '@/core/spherical/spherical-mesh'
import { clamp } from '@/core/spherical/geometry/spherical-math'

const THERMAL_EROSION_PASSES = 2
const FLUVIAL_EROSION_PASSES = 2
const TALUS_METERS_PER_RADIAN = 18000
const MAX_THERMAL_TRANSFER_METERS = 55
const MAX_FLUVIAL_EROSION_METERS = 42

/**
 * Applies a bounded, area-conservative geomorphic relaxation to the raw
 * physical terrain. The model moves material between spherical regions; it
 * never creates or destroys global rock volume.
 */
export class SphericalGeomorphologyGenerator {
  evolve(
    mesh: SphericalMesh,
    rawElevationMeters: Float64Array,
    provisionalLandMask: Uint8Array,
  ): Float64Array {
    const elevation = new Float64Array(rawElevationMeters)
    for (let pass = 0; pass < THERMAL_EROSION_PASSES; pass++)
      this.applyThermalErosion(mesh, elevation, provisionalLandMask)
    for (let pass = 0; pass < FLUVIAL_EROSION_PASSES; pass++)
      this.applyFluvialErosion(mesh, elevation, provisionalLandMask)
    return elevation
  }

  private applyThermalErosion(
    mesh: SphericalMesh,
    elevation: Float64Array,
    landMask: Uint8Array,
  ): void {
    const delta = new Float64Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
        if (neighbor <= region)
          continue
        const high = elevation[region] >= elevation[neighbor]
          ? region
          : neighbor
        const low = high === region ? neighbor : region
        if (landMask[high] === 0)
          continue
        const distance = mesh.distanceBetweenRegions(high, low)
        const excess = elevation[high] - elevation[low]
          - TALUS_METERS_PER_RADIAN * distance
        if (excess <= 0)
          continue
        const transferHeight = Math.min(
          MAX_THERMAL_TRANSFER_METERS,
          excess * 0.12,
        )
        const transferVolume = transferHeight
          * Math.min(mesh.regionArea[high], mesh.regionArea[low])
        delta[high] -= transferVolume / mesh.regionArea[high]
        delta[low] += transferVolume / mesh.regionArea[low]
      }
    }
    for (let region = 0; region < mesh.numRegions; region++)
      elevation[region] += delta[region]
  }

  private applyFluvialErosion(
    mesh: SphericalMesh,
    elevation: Float64Array,
    landMask: Uint8Array,
  ): void {
    const downstream = new Int32Array(mesh.numRegions).fill(-1)
    const order: number[] = []
    for (let region = 0; region < mesh.numRegions; region++) {
      if (landMask[region] === 0)
        continue
      order.push(region)
      let steepestSlope = 0
      for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
        const drop = elevation[region] - elevation[neighbor]
        if (drop <= 0)
          continue
        const slope = drop / mesh.distanceBetweenRegions(region, neighbor)
        if (slope > steepestSlope) {
          steepestSlope = slope
          downstream[region] = neighbor
        }
      }
    }
    order.sort((a, b) => elevation[b] - elevation[a] || a - b)

    const averageArea = 4 * Math.PI / mesh.numRegions
    const flow = new Float64Array(mesh.numRegions)
    for (const region of order) {
      const latitude = mesh.regionLatitude[region]
      const tropicalRain = Math.exp(-((latitude / 0.48) ** 2))
      const temperateRain = Math.exp(
        -(((Math.abs(latitude) - 0.82) / 0.34) ** 2),
      )
      const subtropicalDryness = Math.exp(
        -(((Math.abs(latitude) - 0.48) / 0.2) ** 2),
      )
      const runoffProxy = clamp(
        0.38 + tropicalRain * 0.62 + temperateRain * 0.34
        - subtropicalDryness * 0.28,
        0.12,
        1.25,
      )
      flow[region] += mesh.regionArea[region] * runoffProxy
      const target = downstream[region]
      if (target >= 0)
        flow[target] += flow[region]
    }

    const delta = new Float64Array(mesh.numRegions)
    const sedimentVolume = new Float64Array(mesh.numRegions)
    for (const region of order) {
      const target = downstream[region]
      if (target < 0) {
        delta[region] += sedimentVolume[region] / mesh.regionArea[region]
        continue
      }
      const distance = mesh.distanceBetweenRegions(region, target)
      const slope = Math.max(
        0,
        (elevation[region] - elevation[target]) / distance,
      )
      const flowCells = flow[region] / averageArea
      const erosionHeight = Math.min(
        MAX_FLUVIAL_EROSION_METERS,
        Math.log1p(flowCells) * 2.2 * Math.sqrt(slope / 30000),
      )
      const erodedVolume = erosionHeight * mesh.regionArea[region]
      delta[region] -= erosionHeight
      const availableSediment = sedimentVolume[region] + erodedVolume

      if (landMask[target] === 0) {
        delta[target] += availableSediment / mesh.regionArea[target]
        continue
      }

      const transportCapacity = clamp(Math.log1p(flowCells) / 5, 0, 1)
      const lowSlope = 1 - clamp(slope / 90000, 0, 1)
      const depositFraction = clamp(
        0.04 + lowSlope * (0.58 - transportCapacity * 0.28),
        0.04,
        0.62,
      )
      const depositedVolume = availableSediment * depositFraction
      delta[region] += depositedVolume / mesh.regionArea[region]
      sedimentVolume[target] += availableSediment - depositedVolume
    }

    for (let region = 0; region < mesh.numRegions; region++)
      elevation[region] += delta[region]
  }
}
