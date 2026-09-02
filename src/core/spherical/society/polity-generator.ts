import type { GlobeGenParams } from '@/core/spherical/config'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type {
  HumanRoute,
  SphericalHumanData,
  SphericalMaritimeContact,
  SphericalPoliticalData,
} from '@/core/spherical/society/society-data'
import type { SphericalClimateData } from '@/core/spherical/climate/climate-data'
import type { SphericalRiverData } from '@/core/spherical/hydrology/hydrology-data'
import { MinPriorityQueue } from '@/core/spherical/algorithms/priority-queue'
import { buildSphericalMaritimeNetworks } from '@/core/spherical/society/maritime-networks'
import { clamp, deterministicUnit } from '@/core/spherical/geometry/spherical-math'
import { SPHERICAL_BIOME } from '@/core/spherical/climate/climate-data'

const POLITY_CAPITAL_SEED = 114701
const POLITY_COLOR_SEED = 114719

interface PolityFrontier {
  region: number
  polity: number
  cost: number
}

export interface SphericalPolityGeneratorInput {
  elevation: Float32Array
  landMask: Uint8Array
  regionIslandGroup: Int16Array
  climate: SphericalClimateData
  rivers: SphericalRiverData
  human: SphericalHumanData
}

export class SphericalPolityGenerator {
  generate(
    mesh: SphericalMesh,
    input: SphericalPolityGeneratorInput,
    params: GlobeGenParams,
  ): SphericalPoliticalData {
    const regionPolity = new Int16Array(mesh.numRegions).fill(-1)
    const politicalControl = new Float32Array(mesh.numRegions)
    const capitalSettlements = this.selectCapitals(mesh, input, params)
    if (capitalSettlements.length === 0) {
      return { regionPolity, politicalControl, polities: [] }
    }

    const bestCost = new Float64Array(mesh.numRegions).fill(Infinity)
    const queue = new MinPriorityQueue<PolityFrontier>()
    const shippingRoutes = this.groupShippingRoutesBySource(input.human)
    const maritimeContacts = this.groupMaritimeContactsBySource(input.human)
    const tradeRouteStrength = this.buildTradeRouteStrength(input.human)
    for (let polity = 0; polity < capitalSettlements.length; polity++) {
      const capitalSettlement = capitalSettlements[polity]
      const capitalRegion = input.human.settlements[capitalSettlement].region
      bestCost[capitalRegion] = 0
      regionPolity[capitalRegion] = polity
      queue.push({ region: capitalRegion, polity, cost: 0 })
    }

    const cohesion = clamp(params.politicalCohesion, 0, 1)
    while (queue.size > 0) {
      const current = queue.pop()
      if (
        current.cost !== bestCost[current.region]
        || current.polity !== regionPolity[current.region]
      ) {
        continue
      }
      for (const neighbor of mesh.forEachNeighborOfRegion(current.region)) {
        if (input.landMask[neighbor] === 0)
          continue
        const nextCost = current.cost + this.governanceCost(
          current.region,
          neighbor,
          input,
          cohesion,
        )
        const existingCost = bestCost[neighbor]
        const winsTie = nextCost === existingCost && current.polity < regionPolity[neighbor]
        if (nextCost > existingCost || (nextCost === existingCost && !winsTie))
          continue
        bestCost[neighbor] = nextCost
        regionPolity[neighbor] = current.polity
        queue.push({ region: neighbor, polity: current.polity, cost: nextCost })
      }
      if (params.overseasExpansion <= 0)
        continue
      for (const route of shippingRoutes.get(current.region) ?? []) {
        const targetRegion = input.human.settlements[route.targetSettlement].region
        const nextCost = current.cost
          + route.baseCost
          * (1.45 - clamp(params.overseasExpansion, 0, 1) * 0.9)
          * (1 - (tradeRouteStrength.get(route) ?? 0) * 0.34)
        if (nextCost >= bestCost[targetRegion])
          continue
        bestCost[targetRegion] = nextCost
        regionPolity[targetRegion] = current.polity
        queue.push({ region: targetRegion, polity: current.polity, cost: nextCost })
      }
      const overseasExpansion = clamp(params.overseasExpansion, 0, 1)
      const minimumContactStrength = 0.28 + (1 - overseasExpansion) * 0.22
      for (const contact of maritimeContacts.get(current.region) ?? []) {
        if (contact.strength < minimumContactStrength)
          continue
        const nextCost = current.cost
          + contact.baseCost
          * (2.05 - overseasExpansion * 1.05)
          * (1.18 - contact.reliability * 0.36)
          / (0.68 + contact.strength * 0.46)
        if (nextCost >= bestCost[contact.targetRegion])
          continue
        bestCost[contact.targetRegion] = nextCost
        regionPolity[contact.targetRegion] = current.polity
        queue.push({
          region: contact.targetRegion,
          polity: current.polity,
          cost: nextCost,
        })
      }
    }

    const nominalIslandControl = this.claimUninhabitedIslands(
      mesh,
      input,
      params,
      regionPolity,
      bestCost,
    )

    const maximumCost = new Float64Array(capitalSettlements.length)
    const area = new Float32Array(capitalSettlements.length)
    for (let region = 0; region < mesh.numRegions; region++) {
      const polity = regionPolity[region]
      if (polity < 0)
        continue
      maximumCost[polity] = Math.max(maximumCost[polity], bestCost[region])
      area[polity] += mesh.regionArea[region]
    }
    const population = new Float32Array(capitalSettlements.length)
    for (const settlement of input.human.settlements) {
      const polity = regionPolity[settlement.region]
      if (polity >= 0)
        population[polity] += settlement.population
    }
    for (let region = 0; region < mesh.numRegions; region++) {
      const polity = regionPolity[region]
      if (polity < 0)
        continue
      const controlSpan = Math.max(
        1,
        maximumCost[polity] * (0.85 + cohesion * 0.65),
      )
      politicalControl[region] = nominalIslandControl[region] > 0
        ? nominalIslandControl[region]
        : clamp(1 - bestCost[region] / controlSpan, 0.12, 1)
    }

    const polities = capitalSettlements.map((capitalSettlement, polity) => {
      const capitalRegion = input.human.settlements[capitalSettlement].region
      return {
        name: '',
        adjective: '',
        capitalSettlement,
        capitalRegion,
        color: this.createColor(params.seed, polity),
        area: area[polity],
        population: population[polity],
      }
    })
    return { regionPolity, politicalControl, polities }
  }

  private selectCapitals(
    mesh: SphericalMesh,
    input: SphericalPolityGeneratorInput,
    params: GlobeGenParams,
  ): number[] {
    const requestedCount = Math.max(1, Math.round(params.polityCount))
    const landComponents = this.buildLandComponents(mesh, input.landMask)
    const overseasExpansion = clamp(params.overseasExpansion, 0, 1)
    const minimumContactStrength = 0.28 + (1 - overseasExpansion) * 0.22
    const maritimeNetworks = buildSphericalMaritimeNetworks(
      mesh,
      input.landMask,
      input.human,
      contact => overseasExpansion > 0 && contact.strength >= minimumContactStrength,
    )
    const available = input.human.settlements
      .map((settlement, settlementId) => ({
        settlementId,
        value: settlement.population * (0.75 + settlement.prosperity * 0.25),
        component: landComponents.regionComponent[settlement.region],
        network: maritimeNetworks.settlementNetwork[settlementId],
      }))
      .sort((a, b) => b.value - a.value || a.settlementId - b.settlementId)
    const capitals: number[] = []
    const bestByComponent = new Map<number, number>()
    for (const candidate of available) {
      if (candidate.component >= 0 && !bestByComponent.has(candidate.component))
        bestByComponent.set(candidate.component, candidate.settlementId)
    }
    const minimumMajorSize = Math.max(10, Math.ceil(landComponents.landRegionCount * 0.01))
    const majorComponents = landComponents.componentSize
      .map((size, component) => ({ component, size }))
      .filter(({ component, size }) => size >= minimumMajorSize && bestByComponent.has(component))
      .sort((a, b) => b.size - a.size || a.component - b.component)
    for (const { component } of majorComponents) {
      capitals.push(bestByComponent.get(component)!)
    }

    const bestByNetwork = new Map<number, number>()
    for (const candidate of available) {
      if (candidate.network >= 0 && !bestByNetwork.has(candidate.network))
        bestByNetwork.set(candidate.network, candidate.settlementId)
    }
    for (const settlement of bestByNetwork.values()) {
      if (!capitals.includes(settlement))
        capitals.push(settlement)
    }
    const count = Math.min(
      available.length,
      Math.max(requestedCount, capitals.length),
    )

    while (capitals.length < count) {
      let bestSettlement = -1
      let bestScore = -Infinity
      for (const candidate of available) {
        if (capitals.includes(candidate.settlementId))
          continue
        const region = input.human.settlements[candidate.settlementId].region
        let nearestAngle = Math.PI
        for (const capital of capitals) {
          nearestAngle = Math.min(
            nearestAngle,
            mesh.distanceBetweenRegions(region, input.human.settlements[capital].region),
          )
        }
        const populationScore = candidate.value / Math.max(available[0].value, 1)
        const distanceScore = capitals.length === 0 ? 0 : nearestAngle / Math.PI
        const variation = deterministicUnit(POLITY_CAPITAL_SEED, params.seed, candidate.settlementId)
        const score = populationScore * (capitals.length === 0 ? 1 : 0.35)
          + distanceScore * 0.65
          + variation * 0.015
        if (score > bestScore) {
          bestScore = score
          bestSettlement = candidate.settlementId
        }
      }
      if (bestSettlement >= 0)
        capitals.push(bestSettlement)
      else
        break
    }
    return capitals
  }

  private buildLandComponents(
    mesh: SphericalMesh,
    landMask: Uint8Array,
  ): {
    regionComponent: Int32Array
    componentSize: number[]
    landRegionCount: number
  } {
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

  private governanceCost(
    from: number,
    to: number,
    input: SphericalPolityGeneratorInput,
    cohesion: number,
  ): number {
    const relief = clamp(Math.abs(input.elevation[to] - input.elevation[from]) / 0.065, 0, 1)
    const accessibilityPenalty = 1 - input.human.accessibility[to]
    const biomePenalty = this.biomeGovernancePenalty(input.climate.biome[to])
    const riverBonus = input.rivers.riverMask[from] !== 0 || input.rivers.riverMask[to] !== 0
      ? 0.22
      : 0
    const roadBonus = input.human.transport.roadMask[from] !== 0
      && input.human.transport.roadMask[to] !== 0
      ? 0.32
      : 0
    const tradeBonus = (
      input.human.trade.regionTradeIntensity[from]
      + input.human.trade.regionTradeIntensity[to]
    ) * 0.1
    const terrainPenalty = relief * 1.15 + accessibilityPenalty * 0.9 + biomePenalty
    return Math.max(
      0.3,
      1 + terrainPenalty * (1.25 - cohesion * 0.65)
      - riverBonus - roadBonus - tradeBonus,
    )
  }

  private claimUninhabitedIslands(
    mesh: SphericalMesh,
    input: SphericalPolityGeneratorInput,
    params: GlobeGenParams,
    regionPolity: Int16Array,
    bestCost: Float64Array,
  ): Float32Array {
    const nominalControl = new Float32Array(mesh.numRegions)
    const components = this.buildLandComponents(mesh, input.landMask)
    const regionsByComponent = Array.from(
      { length: components.componentSize.length },
      () => [] as number[],
    )
    const componentOwner = new Int16Array(components.componentSize.length).fill(-1)
    const componentIslandGroup = new Int16Array(components.componentSize.length).fill(-1)
    const groupOwnerCounts = new Map<number, Map<number, number>>()
    const claimedRegions: number[] = []

    for (let region = 0; region < mesh.numRegions; region++) {
      const component = components.regionComponent[region]
      if (component < 0)
        continue
      regionsByComponent[component].push(region)
      const islandGroup = input.regionIslandGroup[region]
      if (islandGroup >= 0)
        componentIslandGroup[component] = islandGroup
      const polity = regionPolity[region]
      if (polity < 0)
        continue
      componentOwner[component] = polity
      claimedRegions.push(region)
      if (islandGroup < 0)
        continue
      let owners = groupOwnerCounts.get(islandGroup)
      if (!owners) {
        owners = new Map<number, number>()
        groupOwnerCounts.set(islandGroup, owners)
      }
      owners.set(polity, (owners.get(polity) ?? 0) + 1)
    }
    if (claimedRegions.length === 0)
      return nominalControl

    const groupOwner = new Map<number, number>()
    for (const [group, owners] of groupOwnerCounts) {
      let bestPolity = -1
      let bestCount = -1
      for (const [polity, count] of owners) {
        if (count > bestCount || (count === bestCount && polity < bestPolity)) {
          bestPolity = polity
          bestCount = count
        }
      }
      if (bestPolity >= 0)
        groupOwner.set(group, bestPolity)
    }

    const overseasExpansion = clamp(params.overseasExpansion, 0, 1)
    const cellAngle = Math.sqrt(4 * Math.PI / mesh.numRegions)
    for (let component = 0; component < regionsByComponent.length; component++) {
      const islandGroup = componentIslandGroup[component]
      if (componentOwner[component] >= 0 || islandGroup < 0)
        continue
      const regions = regionsByComponent[component]
      if (regions.length === 0)
        continue
      const inheritedPolity = groupOwner.get(islandGroup) ?? -1
      const maximumRange = Math.max(
        cellAngle * (inheritedPolity >= 0 ? 7 : 4),
        params.shippingMaxRange
        * (inheritedPolity >= 0
          ? 0.48 + overseasExpansion * 0.18
          : 0.22 + overseasExpansion * 0.35),
      )
      let bestSource = -1
      let bestDistance = Infinity
      let bestPolity = inheritedPolity
      for (const islandRegion of regions) {
        for (const sourceRegion of claimedRegions) {
          const polity = regionPolity[sourceRegion]
          if (inheritedPolity >= 0 && polity !== inheritedPolity)
            continue
          const distance = mesh.distanceBetweenRegions(islandRegion, sourceRegion)
          if (distance < bestDistance) {
            bestDistance = distance
            bestSource = sourceRegion
            bestPolity = polity
          }
        }
      }
      if (bestSource < 0 || bestPolity < 0 || bestDistance > maximumRange)
        continue
      const reach = clamp(1 - bestDistance / maximumRange, 0, 1)
      const smallIslandBonus = 1 - clamp((regions.length - 1) / 24, 0, 1)
      const groupBonus = inheritedPolity >= 0 ? 0.3 : 0
      const variation = deterministicUnit(
        POLITY_CAPITAL_SEED + 17,
        params.seed,
        component,
        islandGroup,
      )
      const claimScore = reach * 0.55
        + overseasExpansion * 0.16
        + smallIslandBonus * 0.12
        + groupBonus
        + variation * 0.12
      const threshold = inheritedPolity >= 0 ? 0.34 : 0.5
      if (claimScore < threshold)
        continue

      const claimControl = clamp(
        0.06 + reach * 0.18 + overseasExpansion * 0.08 + groupBonus * 0.18,
        0.06,
        0.38,
      )
      const sourceCost = Number.isFinite(bestCost[bestSource]) ? bestCost[bestSource] : 0
      const claimCost = sourceCost
        + bestDistance / cellAngle * (1.8 - overseasExpansion * 0.55)
        + 8
      for (const region of regions) {
        regionPolity[region] = bestPolity
        bestCost[region] = claimCost
        nominalControl[region] = claimControl
      }
    }
    return nominalControl
  }

  private groupShippingRoutesBySource(human: SphericalHumanData): Map<number, HumanRoute[]> {
    const routes = new Map<number, HumanRoute[]>()
    for (const route of human.transport.routes) {
      if (route.mode !== 'shipping')
        continue
      const sourceRegion = human.settlements[route.sourceSettlement].region
      const group = routes.get(sourceRegion)
      if (group)
        group.push(route)
      else
        routes.set(sourceRegion, [route])
    }
    return routes
  }

  private groupMaritimeContactsBySource(
    human: SphericalHumanData,
  ): Map<number, SphericalMaritimeContact[]> {
    const contacts = new Map<number, SphericalMaritimeContact[]>()
    for (const contact of human.maritimeContacts) {
      const group = contacts.get(contact.sourceRegion)
      if (group)
        group.push(contact)
      else
        contacts.set(contact.sourceRegion, [contact])
    }
    return contacts
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

  private biomeGovernancePenalty(biome: number): number {
    switch (biome) {
      case SPHERICAL_BIOME.Ice:
      case SPHERICAL_BIOME.PolarDesert:
      case SPHERICAL_BIOME.AlpineTundra:
        return 1.6
      case SPHERICAL_BIOME.HotDesert:
      case SPHERICAL_BIOME.ColdDesert:
      case SPHERICAL_BIOME.XericShrubland:
      case SPHERICAL_BIOME.Tundra:
        return 0.65
      case SPHERICAL_BIOME.MontaneConiferForest:
      case SPHERICAL_BIOME.MontaneCloudForest:
      case SPHERICAL_BIOME.TropicalRainforest:
        return 0.35
      default:
        return 0
    }
  }

  private createColor(seed: number, polity: number): [number, number, number] {
    const hue = (polity * 0.61803398875 + deterministicUnit(POLITY_COLOR_SEED, seed, polity) * 0.08) % 1
    return this.hslToRgb(hue, 0.56, 0.49)
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
