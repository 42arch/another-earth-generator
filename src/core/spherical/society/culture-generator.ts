import type { GlobeGenParams } from '@/core/spherical/config'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type {
  HumanRoute,
  SphericalCulturalData,
  SphericalHumanData,
} from '@/core/spherical/society/society-data'
import type { SphericalClimateData } from '@/core/spherical/climate/climate-data'
import type { SphericalRiverData } from '@/core/spherical/hydrology/hydrology-data'
import {
  spreadSphericalInfluence,
  type SphericalInfluenceRoute,
} from '@/core/spherical/algorithms/influence-spread'
import { buildSphericalMaritimeNetworks } from '@/core/spherical/society/maritime-networks'
import { clamp, deterministicUnit } from '@/core/spherical/geometry/spherical-math'
import { SPHERICAL_BIOME } from '@/core/spherical/climate/climate-data'

const CULTURE_COLOR_SEED = 153421

export interface SphericalCultureGeneratorInput {
  elevation: Float32Array
  climateElevationMeters: Float32Array
  landMask: Uint8Array
  climate: SphericalClimateData
  rivers: SphericalRiverData
  human: SphericalHumanData
}

export class SphericalCultureGenerator {
  generate(
    mesh: SphericalMesh,
    input: SphericalCultureGeneratorInput,
    params: GlobeGenParams,
  ): SphericalCulturalData {
    const coreSettlements = this.selectCoreSettlements(mesh, input, params)
    const seedRegions = coreSettlements.map(settlement => input.human.settlements[settlement].region)
    const cellAngle = Math.sqrt(4 * Math.PI / mesh.numRegions)
    const tradeRouteStrength = this.buildTradeRouteStrength(input.human)
    const routes = this.buildInfluenceRoutes(input.human, tradeRouteStrength)
    const spread = spreadSphericalInfluence(mesh, {
      landMask: input.landMask,
      seedRegions,
      routes,
      blending: params.culturalBlending,
      edgeCost: (_culture, from, to) => this.edgeCost(mesh, input, from, to, cellAngle),
      routeCost: (_culture, route) => route.baseCost
        * (0.62 + (1 - route.reliability) * 0.55)
        * (1 - route.tradeStrength * 0.38)
        / (route.kind === 'contact' ? 0.72 + route.strength * 0.48 : 1),
    })

    const area = new Float32Array(coreSettlements.length)
    const population = new Float32Array(coreSettlements.length)
    for (let region = 0; region < mesh.numRegions; region++) {
      const culture = spread.regionOwner[region]
      if (culture >= 0)
        area[culture] += mesh.regionArea[region]
    }
    for (const settlement of input.human.settlements) {
      const culture = spread.regionOwner[settlement.region]
      if (culture >= 0)
        population[culture] += settlement.population
    }
    const cultures = coreSettlements.map((coreSettlement, culture) => ({
      name: '',
      language: -1,
      coreSettlement,
      coreRegion: input.human.settlements[coreSettlement].region,
      parentCulture: -1,
      color: this.createColor(params.seed, culture),
      area: area[culture],
      population: population[culture],
    }))
    return {
      regionCulture: spread.regionOwner,
      cultureInfluence: spread.influence,
      cultures,
    }
  }

  private selectCoreSettlements(
    mesh: SphericalMesh,
    input: SphericalCultureGeneratorInput,
    params: GlobeGenParams,
  ): number[] {
    const requestedCount = Math.max(0, Math.round(params.cultureCount))
    if (requestedCount === 0)
      return []
    const components = this.buildLandComponents(mesh, input.landMask)
    const maritimeNetworks = buildSphericalMaritimeNetworks(mesh, input.landMask, input.human)
    const available = input.human.settlements
      .map((settlement, settlementId) => ({
        settlementId,
        component: components.regionComponent[settlement.region],
        network: maritimeNetworks.settlementNetwork[settlementId],
        value: settlement.population * (0.62 + settlement.prosperity * 0.38),
      }))
      .sort((a, b) => b.value - a.value || a.settlementId - b.settlementId)
    if (available.length === 0)
      return []

    const cores: number[] = []
    const bestByComponent = new Map<number, number>()
    for (const candidate of available) {
      if (candidate.component >= 0 && !bestByComponent.has(candidate.component))
        bestByComponent.set(candidate.component, candidate.settlementId)
    }
    const minimumMajorSize = Math.max(10, Math.ceil(components.landRegionCount * 0.01))
    const majorComponents = components.componentSize
      .map((size, component) => ({ component, size }))
      .filter(({ component, size }) => size >= minimumMajorSize && bestByComponent.has(component))
      .sort((a, b) => b.size - a.size || a.component - b.component)
    for (const { component } of majorComponents) {
      cores.push(bestByComponent.get(component)!)
    }

    const bestByNetwork = new Map<number, number>()
    for (const candidate of available) {
      if (candidate.network >= 0 && !bestByNetwork.has(candidate.network))
        bestByNetwork.set(candidate.network, candidate.settlementId)
    }
    for (const settlement of bestByNetwork.values()) {
      if (!cores.includes(settlement))
        cores.push(settlement)
    }
    const count = Math.min(
      available.length,
      Math.max(requestedCount, cores.length),
    )

    while (cores.length < count) {
      let bestSettlement = -1
      let bestScore = -Infinity
      for (const candidate of available) {
        if (cores.includes(candidate.settlementId))
          continue
        const region = input.human.settlements[candidate.settlementId].region
        let nearestAngle = Math.PI
        for (const core of cores) {
          nearestAngle = Math.min(
            nearestAngle,
            mesh.distanceBetweenRegions(region, input.human.settlements[core].region),
          )
        }
        const populationScore = candidate.value / Math.max(available[0].value, 1)
        const isolationScore = cores.length === 0 ? 0 : nearestAngle / Math.PI
        const variation = deterministicUnit(CULTURE_COLOR_SEED + 1, params.seed, candidate.settlementId)
        const score = populationScore * 0.4 + isolationScore * 0.58 + variation * 0.02
        if (score > bestScore) {
          bestScore = score
          bestSettlement = candidate.settlementId
        }
      }
      if (bestSettlement < 0)
        break
      cores.push(bestSettlement)
    }
    return cores
  }

  private edgeCost(
    mesh: SphericalMesh,
    input: SphericalCultureGeneratorInput,
    from: number,
    to: number,
    cellAngle: number,
  ): number {
    const distance = mesh.distanceBetweenRegions(from, to) / cellAngle
    const relief = clamp(Math.abs(input.elevation[to] - input.elevation[from]) / 0.06, 0, 1)
    const elevationPenalty = clamp((input.climateElevationMeters[to] - 1500) / 2800, 0, 1)
    const accessibilityPenalty = 1 - input.human.accessibility[to]
    const biomePenalty = this.biomeBarrier(input.climate.biome[to])
    const riverBonus = input.rivers.riverMask[from] !== 0 || input.rivers.riverMask[to] !== 0
      ? 0.2
      : 0
    const roadBonus = input.human.transport.roadMask[from] !== 0
      && input.human.transport.roadMask[to] !== 0
      ? 0.34
      : 0
    const tradeBonus = (
      input.human.trade.regionTradeIntensity[from]
      + input.human.trade.regionTradeIntensity[to]
    ) * 0.16
    return distance * Math.max(
      0.28,
      1 + relief * 1.3 + elevationPenalty * 0.55 + accessibilityPenalty * 0.62
      + biomePenalty - riverBonus - roadBonus - tradeBonus,
    )
  }

  private buildInfluenceRoutes(
    human: SphericalHumanData,
    tradeRouteStrength: Map<HumanRoute, number>,
  ): SphericalInfluenceRoute[] {
    const routes: SphericalInfluenceRoute[] = human.transport.routes
      .filter(route => route.mode === 'shipping')
      .map(route => ({
        sourceRegion: human.settlements[route.sourceSettlement].region,
        targetRegion: human.settlements[route.targetSettlement].region,
        kind: 'shipping' as const,
        baseCost: route.baseCost,
        reliability: route.reliability,
        strength: route.capacity,
        tradeStrength: tradeRouteStrength.get(route) ?? 0,
      }))
    for (const contact of human.maritimeContacts) {
      routes.push({
        sourceRegion: contact.sourceRegion,
        targetRegion: contact.targetRegion,
        kind: 'contact',
        baseCost: contact.baseCost,
        reliability: contact.reliability,
        strength: contact.strength,
        tradeStrength: 0,
      })
    }
    return routes
  }

  private buildTradeRouteStrength(human: SphericalHumanData): Map<HumanRoute, number> {
    const strengths = new Map<HumanRoute, number>()
    let maximumVolume = 0
    for (const volume of human.trade.routeVolume)
      maximumVolume = Math.max(maximumVolume, volume)
    for (let routeIndex = 0; routeIndex < human.transport.routes.length; routeIndex++) {
      strengths.set(
        human.transport.routes[routeIndex],
        maximumVolume > 0 ? human.trade.routeVolume[routeIndex] / maximumVolume : 0,
      )
    }
    return strengths
  }

  private buildLandComponents(
    mesh: SphericalMesh,
    landMask: Uint8Array,
  ): { regionComponent: Int32Array, componentSize: number[], landRegionCount: number } {
    const regionComponent = new Int32Array(mesh.numRegions).fill(-1)
    const componentSize: number[] = []
    let landRegionCount = 0
    for (let start = 0; start < mesh.numRegions; start++) {
      if (landMask[start] === 0 || regionComponent[start] >= 0)
        continue
      const component = componentSize.length
      const queue = [start]
      regionComponent[start] = component
      for (let head = 0; head < queue.length; head++) {
        const region = queue[head]
        landRegionCount++
        for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
          if (landMask[neighbor] !== 0 && regionComponent[neighbor] < 0) {
            regionComponent[neighbor] = component
            queue.push(neighbor)
          }
        }
      }
      componentSize.push(queue.length)
    }
    return { regionComponent, componentSize, landRegionCount }
  }

  private biomeBarrier(biome: number): number {
    switch (biome) {
      case SPHERICAL_BIOME.Ice:
      case SPHERICAL_BIOME.PolarDesert:
      case SPHERICAL_BIOME.AlpineTundra:
        return 1.35
      case SPHERICAL_BIOME.HotDesert:
      case SPHERICAL_BIOME.ColdDesert:
      case SPHERICAL_BIOME.Tundra:
      case SPHERICAL_BIOME.TropicalRainforest:
        return 0.48
      case SPHERICAL_BIOME.MontaneCloudForest:
      case SPHERICAL_BIOME.MontaneConiferForest:
        return 0.28
      default:
        return 0
    }
  }

  private createColor(seed: number, culture: number): [number, number, number] {
    const hue = (culture * 0.61803398875 + deterministicUnit(CULTURE_COLOR_SEED, seed, culture) * 0.12) % 1
    return this.hslToRgb(hue, 0.48, 0.52)
  }

  private hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
    const hueToRgb = (p: number, q: number, value: number) => {
      let channel = value
      if (channel < 0)
        channel += 1
      if (channel > 1)
        channel -= 1
      if (channel < 1 / 6)
        return p + (q - p) * channel * 6
      if (channel < 1 / 2)
        return q
      if (channel < 2 / 3)
        return p + (q - p) * (2 / 3 - channel) * 6
      return p
    }
    const q = lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation
    const p = lightness * 2 - q
    return [
      hueToRgb(p, q, hue + 1 / 3),
      hueToRgb(p, q, hue),
      hueToRgb(p, q, hue - 1 / 3),
    ]
  }
}
