import type { GlobeGenParams } from '@/core/spherical/config'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type {
  HumanRoute,
  SphericalHumanData,
  SphericalTradeData,
} from '@/core/spherical/society/society-data'
import type { SphericalClimateData } from '@/core/spherical/climate/climate-data'
import type { SphericalRiverData } from '@/core/spherical/hydrology/hydrology-data'
import { REGION_FEATURE } from '@/core/spherical/geography/region-feature'
import { clamp, deterministicUnit } from '@/core/spherical/geometry/spherical-math'
import {
  TRADE_GOOD,
  TRADE_GOOD_COUNT,
} from '@/core/spherical/society/society-data'
import { SPHERICAL_BIOME } from '@/core/spherical/climate/climate-data'

const TRADE_VARIATION_SEED = 213791

export interface SphericalTradeGeneratorInput {
  elevation: Float32Array
  climateElevationMeters: Float32Array
  landMask: Uint8Array
  regionFeature: Uint8Array
  tectonicStress: Float32Array
  climate: SphericalClimateData
  rivers: SphericalRiverData
  human: SphericalHumanData
}

interface IndexedRoute {
  route: HumanRoute
  routeIndex: number
  efficiency: number
}

export class SphericalTradeGenerator {
  generate(
    mesh: SphericalMesh,
    input: SphericalTradeGeneratorInput,
    params: GlobeGenParams,
  ): SphericalTradeData {
    const settlementCount = input.human.settlements.length
    const production = new Float32Array(settlementCount * TRADE_GOOD_COUNT)
    const demand = new Float32Array(settlementCount * TRADE_GOOD_COUNT)
    const exports = new Float32Array(settlementCount)
    const imports = new Float32Array(settlementCount)
    const marketAccess = new Float32Array(settlementCount)
    const routes = input.human.transport.routes
    const routeVolume = new Float32Array(routes.length)
    const regionTradeIntensity = new Float32Array(mesh.numRegions)
    const specialization = clamp(params.tradeSpecialization, 0, 1)

    for (let settlement = 0; settlement < settlementCount; settlement++) {
      const settlementData = input.human.settlements[settlement]
      const suitability = this.productionSuitability(mesh, input, settlementData.region, settlementData.isPort)
      const populationScale = Math.sqrt(Math.max(1, settlementData.population) / 350)
      const prosperity = settlementData.baseProsperity ?? settlementData.prosperity
      for (let good = 0; good < TRADE_GOOD_COUNT; good++) {
        const variation = 0.88
          + deterministicUnit(TRADE_VARIATION_SEED, params.seed, settlement * TRADE_GOOD_COUNT + good) * 0.24
        const specializedOutput = suitability[good]
          * (1.25 + specialization * suitability[good] * 1.35)
        const index = settlement * TRADE_GOOD_COUNT + good
        production[index] = populationScale
          * (0.48 + prosperity * 0.52)
          * specializedOutput
          * variation
        demand[index] = populationScale
          * this.demandWeight(good)
          * (0.62 + prosperity * 0.58)
      }
    }

    const remainingSupply = new Float32Array(production.length)
    const remainingDemand = new Float32Array(demand.length)
    for (let index = 0; index < production.length; index++) {
      remainingSupply[index] = Math.max(0, production[index] - demand[index])
      remainingDemand[index] = Math.max(0, demand[index] - production[index])
    }

    const activity = clamp(params.tradeActivity, 0, 1.5)
    let maximumRouteCapacity = 0
    for (const route of routes)
      maximumRouteCapacity = Math.max(maximumRouteCapacity, route.capacity)
    const routeOrder: IndexedRoute[] = routes
      .map((route, routeIndex) => ({
        route,
        routeIndex,
        efficiency: route.baseCost / Math.max(route.reliability, 0.1),
      }))
      .sort((a, b) => a.efficiency - b.efficiency || a.routeIndex - b.routeIndex)

    for (const { route, routeIndex } of routeOrder) {
      const capacityRatio = maximumRouteCapacity > 0
        ? Math.sqrt(route.capacity / maximumRouteCapacity)
        : 0
      const capacity = (5 + capacityRatio * 42)
        * activity
        * route.reliability
        / (1 + route.baseCost * 0.018)
      if (capacity <= 0)
        continue
      const volume = this.allocateRouteTrade(
        route,
        capacity,
        remainingSupply,
        remainingDemand,
        exports,
        imports,
      )
      routeVolume[routeIndex] = volume
      if (volume <= 0)
        continue
      const perRegionVolume = volume / Math.max(1, Math.sqrt(route.regions.length))
      for (const region of route.regions)
        regionTradeIntensity[region] += perRegionVolume
    }

    let maximumMarketAccess = 0
    for (let settlement = 0; settlement < settlementCount; settlement++) {
      const populationScale = Math.sqrt(
        Math.max(1, input.human.settlements[settlement].population) / 350,
      )
      marketAccess[settlement] = (exports[settlement] + imports[settlement])
        / Math.max(populationScale, Number.EPSILON)
      maximumMarketAccess = Math.max(maximumMarketAccess, marketAccess[settlement])
    }
    if (maximumMarketAccess > 0) {
      for (let settlement = 0; settlement < settlementCount; settlement++)
        marketAccess[settlement] /= maximumMarketAccess
    }
    this.normalize(regionTradeIntensity)

    for (let settlement = 0; settlement < settlementCount; settlement++) {
      const settlementData = input.human.settlements[settlement]
      const baseProsperity = settlementData.baseProsperity ?? settlementData.prosperity
      settlementData.prosperity = clamp(
        baseProsperity + marketAccess[settlement] * 0.22 * Math.min(1, activity),
        0,
        1,
      )
    }

    let totalVolume = 0
    for (const volume of routeVolume)
      totalVolume += volume
    return {
      settlementProduction: production,
      settlementDemand: demand,
      settlementExports: exports,
      settlementImports: imports,
      settlementMarketAccess: marketAccess,
      routeVolume,
      regionTradeIntensity,
      totalVolume,
    }
  }

  private allocateRouteTrade(
    route: HumanRoute,
    capacity: number,
    supply: Float32Array,
    demand: Float32Array,
    exports: Float32Array,
    imports: Float32Array,
  ): number {
    const source = route.sourceSettlement
    const target = route.targetSettlement
    const forwardPotential = new Float32Array(TRADE_GOOD_COUNT)
    const reversePotential = new Float32Array(TRADE_GOOD_COUNT)
    let totalPotential = 0
    for (let good = 0; good < TRADE_GOOD_COUNT; good++) {
      const sourceIndex = source * TRADE_GOOD_COUNT + good
      const targetIndex = target * TRADE_GOOD_COUNT + good
      forwardPotential[good] = Math.min(supply[sourceIndex], demand[targetIndex])
      totalPotential += forwardPotential[good]
      if (route.mode === 'road') {
        reversePotential[good] = Math.min(supply[targetIndex], demand[sourceIndex])
        totalPotential += reversePotential[good]
      }
    }
    if (totalPotential <= 0)
      return 0

    const allocationRatio = Math.min(1, capacity / totalPotential)
    let volume = 0
    for (let good = 0; good < TRADE_GOOD_COUNT; good++) {
      const sourceIndex = source * TRADE_GOOD_COUNT + good
      const targetIndex = target * TRADE_GOOD_COUNT + good
      const forward = forwardPotential[good] * allocationRatio
      if (forward > 0) {
        supply[sourceIndex] -= forward
        demand[targetIndex] -= forward
        exports[source] += forward
        imports[target] += forward
        volume += forward
      }
      const reverse = reversePotential[good] * allocationRatio
      if (reverse > 0) {
        supply[targetIndex] -= reverse
        demand[sourceIndex] -= reverse
        exports[target] += reverse
        imports[source] += reverse
        volume += reverse
      }
    }
    return volume
  }

  private productionSuitability(
    mesh: SphericalMesh,
    input: SphericalTradeGeneratorInput,
    region: number,
    isPort: boolean,
  ): [number, number, number, number, number] {
    const biome = input.climate.biome[region]
    let relief = 0
    let hasLakeNeighbor = false
    let hasOceanNeighbor = false
    for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
      if (input.landMask[neighbor] !== 0) {
        relief = Math.max(relief, Math.abs(input.elevation[region] - input.elevation[neighbor]))
      }
      else if (input.regionFeature[neighbor] === REGION_FEATURE.Lake) {
        hasLakeNeighbor = true
      }
      else if (input.regionFeature[neighbor] === REGION_FEATURE.Ocean) {
        hasOceanNeighbor = true
      }
    }
    const food = clamp(
      input.human.habitability[region] * 0.72
      + clamp(input.climate.runoff[region] * 24, 0, 1) * 0.18
      + (input.rivers.riverMask[region] !== 0 ? 0.1 : 0),
      0,
      1,
    )
    const timber = this.forestSuitability(biome)
    const livestock = this.livestockSuitability(biome)
    const minerals = clamp(
      clamp((input.climateElevationMeters[region] - 700) / 2600, 0, 1) * 0.42
      + clamp(relief / 0.075, 0, 1) * 0.32
      + clamp(input.tectonicStress[region], 0, 1) * 0.26,
      0,
      1,
    )
    let fisheries = 0.06
    if (isPort || hasOceanNeighbor)
      fisheries = 1
    else if (hasLakeNeighbor)
      fisheries = 0.68
    else if (input.rivers.riverMask[region] !== 0)
      fisheries = 0.56
    return [food, timber, livestock, minerals, fisheries]
  }

  private forestSuitability(biome: number): number {
    switch (biome) {
      case SPHERICAL_BIOME.TemperateRainforest:
      case SPHERICAL_BIOME.TropicalRainforest:
      case SPHERICAL_BIOME.MontaneCloudForest:
        return 1
      case SPHERICAL_BIOME.BorealForest:
      case SPHERICAL_BIOME.TemperateSeasonalForest:
      case SPHERICAL_BIOME.TropicalSeasonalForest:
      case SPHERICAL_BIOME.MontaneConiferForest:
        return 0.82
      case SPHERICAL_BIOME.TemperateWoodland:
      case SPHERICAL_BIOME.TropicalDryForest:
        return 0.56
      default:
        return 0.08
    }
  }

  private livestockSuitability(biome: number): number {
    switch (biome) {
      case SPHERICAL_BIOME.TemperateGrassland:
      case SPHERICAL_BIOME.TropicalSavanna:
        return 1
      case SPHERICAL_BIOME.MediterraneanShrubland:
      case SPHERICAL_BIOME.XericShrubland:
      case SPHERICAL_BIOME.Tundra:
        return 0.66
      case SPHERICAL_BIOME.TemperateWoodland:
      case SPHERICAL_BIOME.ColdDesert:
      case SPHERICAL_BIOME.HotDesert:
        return 0.42
      default:
        return 0.12
    }
  }

  private demandWeight(good: number): number {
    switch (good) {
      case TRADE_GOOD.Food:
        return 0.9
      case TRADE_GOOD.Timber:
        return 0.42
      case TRADE_GOOD.Livestock:
        return 0.52
      case TRADE_GOOD.Minerals:
        return 0.34
      case TRADE_GOOD.Fisheries:
        return 0.46
      default:
        return 0.4
    }
  }

  private normalize(values: Float32Array): void {
    let maximum = 0
    for (const value of values)
      maximum = Math.max(maximum, value)
    if (maximum <= 0)
      return
    for (let index = 0; index < values.length; index++)
      values[index] /= maximum
  }
}
