import type { GlobeGenParams } from '@/core/spherical/config'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type {
  LakeIceStateCode,
  SphericalLakeData,
} from '@/core/spherical/hydrology/hydrology-data'
import type { SphericalClimateData } from '@/core/spherical/climate/climate-data'
import { MinPriorityQueue } from '@/core/spherical/algorithms/priority-queue'
import { clamp } from '@/core/spherical/geometry/spherical-math'
import {
  LAKE_ICE_STATE,
} from '@/core/spherical/hydrology/hydrology-data'
import { CLIMATE_SEASON_COUNT } from '@/core/spherical/climate/climate-data'

const FLOOD_EPSILON = 1e-5
const MIN_BASIN_DEPTH = 1e-4
// Climate precipitation is normalized to an annual 0-1 scale, while the
// moisture transport evaporation control is a per-iteration source term.
const LAKE_EVAPORATION_NORMALIZATION = 12.5
const SEASON_REPRESENTATIVE_MONTHS = [0, 3, 6, 9] as const
const SEASONAL_LAKE_DRY_FILL_RATIO = 0.35
const SEASONAL_LAKE_MIN_FILL_RANGE = 0.2

interface FloodNode {
  region: number
  cost: number
}

interface LakeCandidate {
  regions: number[]
  area: number
  volume: number
  surfaceElevation: number
  bottomElevation: number
  maxDepth: number
  outletRegion: number
  outletTarget: number
  score: number
}

export interface SphericalLakeResult {
  elevation: Float32Array
  landMask: Uint8Array
  lakes: SphericalLakeData
  landArea: number
}

/**
 * Topographic lake basins are detected from the difference between raw terrain
 * and a priority-flood drainage surface. L2 then balances those maximum basins
 * against catchment inflow and open-water evaporation.
 */
export class SphericalLakeGenerator {
  generate(
    mesh: SphericalMesh,
    elevation: Float32Array,
    baseLandMask: Uint8Array,
    params: GlobeGenParams,
  ): SphericalLakeResult {
    const landMask = new Uint8Array(baseLandMask)
    const lakeMask = new Uint8Array(mesh.numRegions)
    const regionLakeId = new Int32Array(mesh.numRegions).fill(-1)
    const baseLandArea = this.getLandArea(mesh, baseLandMask)
    const filledElevation = this.fillDepressions(mesh, elevation, baseLandMask)
    const coastDistance = this.computeCoastDistance(mesh, baseLandMask)
    const candidates = this.extractCandidates(
      mesh,
      elevation,
      filledElevation,
      baseLandMask,
      coastDistance,
      params,
    )
    candidates.sort((a, b) => b.score - a.score || a.regions[0] - b.regions[0])

    const density = clamp(params.lakeDensity, 0, 1)
    const targetCount = density > 0 && candidates.length > 0
      ? Math.max(1, Math.round(candidates.length * density))
      : 0
    const maximumLakeArea = baseLandArea
      * clamp(params.lakeMaxLandCoverage, 0, 0.15)
    let selectedArea = 0
    const selected: LakeCandidate[] = []

    for (const candidate of candidates) {
      if (selected.length >= targetCount)
        break
      if (selectedArea + candidate.area > maximumLakeArea)
        continue
      const lakeId = selected.length
      selected.push(candidate)
      selectedArea += candidate.area
      for (const region of candidate.regions) {
        lakeMask[region] = 1
        regionLakeId[region] = lakeId
        landMask[region] = 0
      }
    }

    const surfaceElevation = new Float32Array(selected.length)
    const bottomElevation = new Float32Array(selected.length)
    const area = new Float32Array(selected.length)
    const volume = new Float32Array(selected.length)
    const outletRegion = new Int32Array(selected.length).fill(-1)
    const outletTarget = new Int32Array(selected.length).fill(-1)
    const lakeElevation = new Float32Array(elevation)
    for (let lake = 0; lake < selected.length; lake++) {
      const candidate = selected[lake]
      surfaceElevation[lake] = candidate.surfaceElevation
      bottomElevation[lake] = candidate.bottomElevation
      area[lake] = candidate.area
      volume[lake] = candidate.volume
      outletRegion[lake] = candidate.outletRegion
      outletTarget[lake] = candidate.outletTarget
      for (const region of candidate.regions)
        lakeElevation[region] = candidate.surfaceElevation
    }

    return {
      elevation: lakeElevation,
      landMask,
      lakes: {
        lakeMask,
        regionLakeId,
        surfaceElevation,
        bottomElevation,
        area,
        volume,
        outletRegion,
        outletTarget,
        inflow: new Float32Array(selected.length),
        seasonalInflow: new Float32Array(selected.length * CLIMATE_SEASON_COUNT),
        evaporation: new Float32Array(selected.length),
        seasonalEvaporation: new Float32Array(
          selected.length * CLIMATE_SEASON_COUNT,
        ),
        fillRatio: new Float32Array(selected.length).fill(1),
        seasonalFillRatio: new Float32Array(
          selected.length * CLIMATE_SEASON_COUNT,
        ).fill(1),
        salinity: new Float32Array(selected.length),
        isEndorheic: new Uint8Array(selected.length).fill(1),
        isSeasonal: new Uint8Array(selected.length),
        iceState: new Uint8Array(selected.length),
      },
      landArea: baseLandArea - selectedArea,
    }
  }

  balanceWater(
    mesh: SphericalMesh,
    baseElevation: Float32Array,
    baseLandMask: Uint8Array,
    topographic: SphericalLakeResult,
    inflow: Float32Array,
    temperature: Float32Array,
    warmestMonthTemperature: Float32Array,
    params: GlobeGenParams,
  ): SphericalLakeResult {
    const fullLakes = topographic.lakes
    const fullRegions = Array.from(
      { length: fullLakes.area.length },
      () => [] as number[],
    )
    for (let region = 0; region < mesh.numRegions; region++) {
      const lakeId = fullLakes.regionLakeId[region]
      if (lakeId >= 0)
        fullRegions[lakeId].push(region)
    }

    const lakeMask = new Uint8Array(mesh.numRegions)
    const regionLakeId = new Int32Array(mesh.numRegions).fill(-1)
    const landMask = new Uint8Array(baseLandMask)
    const elevation = new Float32Array(baseElevation)
    const surfaces: number[] = []
    const bottoms: number[] = []
    const areas: number[] = []
    const volumes: number[] = []
    const outlets: number[] = []
    const outletTargets: number[] = []
    const inflows: number[] = []
    const evaporations: number[] = []
    const fillRatios: number[] = []
    const salinities: number[] = []
    const endorheicFlags: number[] = []
    const seasonalFlags: number[] = []
    const iceStates: number[] = []
    const evaporationStrength = Math.max(0, params.lakeEvaporationStrength)
    const overflowThreshold = Math.max(0.05, params.lakeOverflowThreshold)
    const minimumFillRatio = clamp(params.lakeMinFillRatio, 0, 0.95)
    let selectedArea = 0

    for (let oldLakeId = 0; oldLakeId < fullRegions.length; oldLakeId++) {
      const regions = fullRegions[oldLakeId]
      if (regions.length === 0)
        continue

      let weightedTemperature = 0
      let weightedWarmestMonthTemperature = 0
      let temperatureArea = 0
      for (const region of regions) {
        const regionArea = mesh.regionArea[region]
        weightedTemperature += temperature[region] * regionArea
        weightedWarmestMonthTemperature += warmestMonthTemperature[region]
          * regionArea
        temperatureArea += regionArea
      }
      const meanTemperature = temperatureArea > 0
        ? weightedTemperature / temperatureArea
        : 0
      const meanWarmestMonthTemperature = temperatureArea > 0
        ? weightedWarmestMonthTemperature / temperatureArea
        : 0
      const iceState: LakeIceStateCode = meanWarmestMonthTemperature < 0
        ? LAKE_ICE_STATE.Subglacial
        : meanWarmestMonthTemperature < 4
          ? LAKE_ICE_STATE.SeasonallyFrozen
          : LAKE_ICE_STATE.OpenWater
      const warmFactor = clamp((meanTemperature + 5) / 35, 0, 1)
      const openWaterFraction = iceState === LAKE_ICE_STATE.Subglacial
        ? 0
        : iceState === LAKE_ICE_STATE.SeasonallyFrozen
          ? clamp(meanWarmestMonthTemperature / 4, 0, 1)
          : 1
      const evaporationRate = Math.max(1e-6, params.oceanEvaporation)
        * (0.35 + warmFactor * 0.65)
        * evaporationStrength
        * LAKE_EVAPORATION_NORMALIZATION
        * openWaterFraction
      const evaporation = fullLakes.area[oldLakeId] * evaporationRate
      const lakeInflow = Math.max(0, inflow[oldLakeId] ?? 0)
      const isSubglacial = iceState === LAKE_ICE_STATE.Subglacial
      const waterBalanceRatio = isSubglacial
        ? Number.POSITIVE_INFINITY
        : lakeInflow / Math.max(evaporation, 1e-8)
      const isOverflowing = !isSubglacial
        && waterBalanceRatio >= overflowThreshold
      const fillRatio = isSubglacial || isOverflowing
        ? 1
        : clamp(
            (waterBalanceRatio / overflowThreshold) ** 0.65,
            0,
            0.995,
          )
      if (fillRatio < minimumFillRatio)
        continue

      const bottom = fullLakes.bottomElevation[oldLakeId]
      const spill = fullLakes.surfaceElevation[oldLakeId]
      const surface = bottom + (spill - bottom) * fillRatio
      const activeRegions = isOverflowing
        ? regions
        : this.collectConnectedFloodedRegions(
            mesh,
            regions,
            oldLakeId,
            fullLakes.regionLakeId,
            baseElevation,
            surface,
          )
      if (activeRegions.length === 0)
        continue

      const lakeId = areas.length
      let area = 0
      let volume = 0
      for (const region of activeRegions) {
        const regionArea = mesh.regionArea[region]
        area += regionArea
        volume += regionArea * Math.max(0, surface - baseElevation[region])
        lakeMask[region] = 1
        regionLakeId[region] = lakeId
        landMask[region] = 0
        elevation[region] = surface
      }
      selectedArea += area
      surfaces.push(surface)
      bottoms.push(bottom)
      areas.push(area)
      volumes.push(volume)
      outlets.push(isOverflowing ? fullLakes.outletRegion[oldLakeId] : -1)
      outletTargets.push(isOverflowing ? fullLakes.outletTarget[oldLakeId] : -1)
      inflows.push(lakeInflow)
      evaporations.push(evaporation)
      fillRatios.push(fillRatio)
      salinities.push(isSubglacial || isOverflowing
        ? 0
        : clamp(1 - waterBalanceRatio / overflowThreshold, 0, 1))
      endorheicFlags.push(isOverflowing ? 0 : 1)
      // Final seasonal state is evaluated after the balanced lake receives
      // four-season inflow from the final river network.
      seasonalFlags.push(0)
      iceStates.push(iceState)
    }

    return {
      elevation,
      landMask,
      lakes: {
        lakeMask,
        regionLakeId,
        surfaceElevation: new Float32Array(surfaces),
        bottomElevation: new Float32Array(bottoms),
        area: new Float32Array(areas),
        volume: new Float32Array(volumes),
        outletRegion: new Int32Array(outlets),
        outletTarget: new Int32Array(outletTargets),
        inflow: new Float32Array(inflows),
        seasonalInflow: new Float32Array(
          areas.length * CLIMATE_SEASON_COUNT,
        ),
        evaporation: new Float32Array(evaporations),
        seasonalEvaporation: new Float32Array(
          areas.length * CLIMATE_SEASON_COUNT,
        ),
        fillRatio: new Float32Array(fillRatios),
        seasonalFillRatio: new Float32Array(
          areas.length * CLIMATE_SEASON_COUNT,
        ).fill(1),
        salinity: new Float32Array(salinities),
        isEndorheic: new Uint8Array(endorheicFlags),
        isSeasonal: new Uint8Array(seasonalFlags),
        iceState: new Uint8Array(iceStates),
      },
      landArea: this.getLandArea(mesh, baseLandMask) - selectedArea,
    }
  }

  updateSeasonalWaterBalance(
    mesh: SphericalMesh,
    lakes: SphericalLakeData,
    climate: SphericalClimateData,
    seasonalInflow: Float32Array,
    params: GlobeGenParams,
  ): void {
    const lakeCount = lakes.area.length
    const valueCount = lakeCount * CLIMATE_SEASON_COUNT
    lakes.seasonalInflow = new Float32Array(valueCount)
    lakes.seasonalEvaporation = new Float32Array(valueCount)
    lakes.seasonalFillRatio = new Float32Array(valueCount).fill(1)
    lakes.seasonalInflow.set(seasonalInflow.subarray(0, valueCount))
    lakes.isSeasonal.fill(0)
    if (lakeCount === 0)
      return

    const lakeArea = new Float32Array(lakeCount)
    const seasonalTemperature = new Float32Array(valueCount)
    for (let region = 0; region < mesh.numRegions; region++) {
      const lakeId = lakes.regionLakeId[region]
      if (lakeId < 0)
        continue
      const regionArea = mesh.regionArea[region]
      lakeArea[lakeId] += regionArea
      for (let season = 0; season < CLIMATE_SEASON_COUNT; season++) {
        const month = SEASON_REPRESENTATIVE_MONTHS[season]
        seasonalTemperature[season * lakeCount + lakeId]
          += climate.monthlyTemperature[month * mesh.numRegions + region]
            * regionArea
      }
    }

    const overflowThreshold = Math.max(0.05, params.lakeOverflowThreshold)
    for (let lake = 0; lake < lakeCount; lake++) {
      if (lakes.iceState[lake] === LAKE_ICE_STATE.Subglacial)
        continue

      const evaporationWeights = new Float32Array(CLIMATE_SEASON_COUNT)
      let evaporationWeightTotal = 0
      for (let season = 0; season < CLIMATE_SEASON_COUNT; season++) {
        const index = season * lakeCount + lake
        const temperature = lakeArea[lake] > 0
          ? seasonalTemperature[index] / lakeArea[lake]
          : 0
        const openWaterWeight = temperature > 0
          ? 0.35 + clamp((temperature + 5) / 35, 0, 1) * 0.65
          : 0
        evaporationWeights[season] = openWaterWeight
        evaporationWeightTotal += openWaterWeight
      }

      let minimumFill = 1
      let maximumFill = 0
      let openSeasonCount = 0
      for (let season = 0; season < CLIMATE_SEASON_COUNT; season++) {
        const index = season * lakeCount + lake
        const seasonalEvaporation = evaporationWeightTotal > 0
          ? lakes.evaporation[lake]
          * evaporationWeights[season] / evaporationWeightTotal
          : 0
        lakes.seasonalEvaporation[index] = seasonalEvaporation
        if (seasonalEvaporation <= Number.EPSILON) {
          lakes.seasonalFillRatio[index] = lakes.fillRatio[lake]
          continue
        }
        openSeasonCount++
        const balanceRatio = lakes.seasonalInflow[index]
          / seasonalEvaporation
        const fillRatio = clamp(
          (balanceRatio / overflowThreshold) ** 0.65,
          0,
          1,
        )
        lakes.seasonalFillRatio[index] = fillRatio
        minimumFill = Math.min(minimumFill, fillRatio)
        maximumFill = Math.max(maximumFill, fillRatio)
      }

      if (
        lakes.isEndorheic[lake] !== 0
        && openSeasonCount > 0
        && minimumFill < SEASONAL_LAKE_DRY_FILL_RATIO
        && (
          maximumFill - minimumFill >= SEASONAL_LAKE_MIN_FILL_RANGE
          || lakes.fillRatio[lake] < 0.48
        )
      ) {
        lakes.isSeasonal[lake] = 1
      }
    }
  }

  private collectConnectedFloodedRegions(
    mesh: SphericalMesh,
    regions: number[],
    lakeId: number,
    regionLakeId: Int32Array,
    elevation: Float32Array,
    surfaceElevation: number,
  ): number[] {
    let bottomRegion = regions[0]
    for (const region of regions) {
      if (
        elevation[region] < elevation[bottomRegion]
        || (elevation[region] === elevation[bottomRegion] && region < bottomRegion)
      ) {
        bottomRegion = region
      }
    }

    const flooded: number[] = []
    const visited = new Uint8Array(mesh.numRegions)
    const queue = [bottomRegion]
    visited[bottomRegion] = 1
    for (let head = 0; head < queue.length; head++) {
      const region = queue[head]
      if (elevation[region] > surfaceElevation + FLOOD_EPSILON)
        continue
      flooded.push(region)
      for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
        if (
          visited[neighbor] === 0
          && regionLakeId[neighbor] === lakeId
          && elevation[neighbor] <= surfaceElevation + FLOOD_EPSILON
        ) {
          visited[neighbor] = 1
          queue.push(neighbor)
        }
      }
    }
    return flooded
  }

  private fillDepressions(
    mesh: SphericalMesh,
    elevation: Float32Array,
    landMask: Uint8Array,
  ): Float32Array {
    const filledElevation = new Float32Array(elevation)
    const visited = new Uint8Array(mesh.numRegions)
    const queue = new MinPriorityQueue<FloodNode>()
    for (let region = 0; region < mesh.numRegions; region++) {
      if (landMask[region] !== 0)
        continue
      visited[region] = 1
      queue.push({ region, cost: filledElevation[region] })
    }

    while (queue.size > 0) {
      const current = queue.pop()
      for (const neighbor of mesh.forEachNeighborOfRegion(current.region)) {
        if (visited[neighbor] !== 0)
          continue
        visited[neighbor] = 1
        filledElevation[neighbor] = Math.max(
          elevation[neighbor],
          current.cost + FLOOD_EPSILON,
        )
        queue.push({ region: neighbor, cost: filledElevation[neighbor] })
      }
    }
    return filledElevation
  }

  private computeCoastDistance(
    mesh: SphericalMesh,
    landMask: Uint8Array,
  ): Int16Array {
    const distance = new Int16Array(mesh.numRegions).fill(-1)
    const queue = new Int32Array(mesh.numRegions)
    let tail = 0
    for (let region = 0; region < mesh.numRegions; region++) {
      if (landMask[region] !== 0)
        continue
      distance[region] = 0
      queue[tail++] = region
    }
    for (let head = 0; head < tail; head++) {
      const region = queue[head]
      for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
        if (distance[neighbor] !== -1)
          continue
        distance[neighbor] = distance[region] + 1
        queue[tail++] = neighbor
      }
    }
    return distance
  }

  private extractCandidates(
    mesh: SphericalMesh,
    elevation: Float32Array,
    filledElevation: Float32Array,
    landMask: Uint8Array,
    coastDistance: Int16Array,
    params: GlobeGenParams,
  ): LakeCandidate[] {
    const minimumDepth = Math.max(MIN_BASIN_DEPTH, params.lakeMinDepth)
    const basinEdgeDepth = Math.max(MIN_BASIN_DEPTH, minimumDepth * 0.12)
    const minimumRegionCount = Math.max(1, Math.floor(params.lakeMinRegionCount))
    const minimumCoastDistance = Math.max(0, Math.floor(params.lakeMinCoastDistance))
    const basinMask = new Uint8Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      if (
        landMask[region] !== 0
        && filledElevation[region] - elevation[region] >= basinEdgeDepth
      ) {
        basinMask[region] = 1
      }
    }

    const visited = new Uint8Array(mesh.numRegions)
    const candidates: LakeCandidate[] = []
    for (let start = 0; start < mesh.numRegions; start++) {
      if (basinMask[start] === 0 || visited[start] !== 0)
        continue
      const regions = [start]
      visited[start] = 1
      let area = 0
      let maxDepth = 0
      let bottomElevation = elevation[start]
      let minimumDistance = coastDistance[start]
      let outletCost = Infinity
      let outletRegion = -1
      let outletTarget = -1

      for (let head = 0; head < regions.length; head++) {
        const region = regions[head]
        const depth = filledElevation[region] - elevation[region]
        area += mesh.regionArea[region]
        maxDepth = Math.max(maxDepth, depth)
        bottomElevation = Math.min(bottomElevation, elevation[region])
        minimumDistance = Math.min(minimumDistance, coastDistance[region])
        for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
          if (basinMask[neighbor] !== 0) {
            if (visited[neighbor] === 0) {
              visited[neighbor] = 1
              regions.push(neighbor)
            }
            continue
          }
          const cost = Math.max(filledElevation[region], filledElevation[neighbor])
          if (cost < outletCost || (cost === outletCost && neighbor < outletTarget)) {
            outletCost = cost
            outletRegion = region
            outletTarget = neighbor
          }
        }
      }

      if (
        regions.length < minimumRegionCount
        || maxDepth < minimumDepth
        || minimumDistance < minimumCoastDistance
        || !Number.isFinite(outletCost)
      ) {
        continue
      }

      const surfaceElevation = clamp(outletCost, bottomElevation, 1)
      let volume = 0
      for (const region of regions) {
        volume += mesh.regionArea[region]
          * Math.max(0, surfaceElevation - elevation[region])
      }
      const score = maxDepth * Math.sqrt(area)
        * (1 + Math.log2(regions.length + 1) * 0.2)
      candidates.push({
        regions,
        area,
        volume,
        surfaceElevation,
        bottomElevation,
        maxDepth,
        outletRegion,
        outletTarget,
        score,
      })
    }
    return candidates
  }

  private getLandArea(mesh: SphericalMesh, landMask: Uint8Array): number {
    let area = 0
    for (let region = 0; region < mesh.numRegions; region++) {
      if (landMask[region] !== 0)
        area += mesh.regionArea[region]
    }
    return area
  }
}
