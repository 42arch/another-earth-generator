import type { GlobeGenParams } from '@/core/spherical/config'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type {
  HumanRoute,
  SphericalHumanData,
  SphericalTransportData,
} from '@/core/spherical/society/society-data'
import type { SphericalClimateData } from '@/core/spherical/climate/climate-data'
import type { SphericalRiverData } from '@/core/spherical/hydrology/hydrology-data'
import { REGION_FEATURE } from '@/core/spherical/geography/region-feature'
import { findSphericalPath } from '@/core/spherical/algorithms/pathfinder'
import { clamp, dot3 } from '@/core/spherical/geometry/spherical-math'
import { CLIMATE_SEASON_COUNT, SPHERICAL_BIOME } from '@/core/spherical/climate/climate-data'

interface SettlementPair {
  source: number
  target: number
}

interface PairDistance extends SettlementPair {
  distance: number
}

export interface SphericalTransportGeneratorInput {
  elevation: Float32Array
  climateElevationMeters: Float32Array
  landMask: Uint8Array
  regionFeature: Uint8Array
  climate: SphericalClimateData
  rivers: SphericalRiverData
  human: SphericalHumanData
}

export class SphericalTransportGenerator {
  generate(
    mesh: SphericalMesh,
    input: SphericalTransportGeneratorInput,
    params: GlobeGenParams,
  ): SphericalTransportData {
    const roadMask = new Uint8Array(mesh.numRegions)
    const roadIntensity = new Float32Array(mesh.numRegions)
    const shippingIntensity = new Float32Array(mesh.numRegions)
    const routes: HumanRoute[] = []
    const cellAngle = Math.sqrt(4 * Math.PI / mesh.numRegions)
    const landComponent = this.buildLandComponents(mesh, input.landMask)

    const roadSettlements = input.human.settlements
      .map((settlement, settlementId) => ({ settlement, settlementId }))
      .filter(({ settlement }) => settlement.type !== 'camp')
      .map(({ settlementId }) => settlementId)
    const roadPairs = this.buildRoadPairs(
      mesh,
      input.human,
      roadSettlements,
      landComponent,
      params.roadDensity,
    )
    for (const pair of roadPairs) {
      const route = this.createRoadRoute(mesh, input, pair, cellAngle)
      if (!route)
        continue
      routes.push(route)
      for (const region of route.regions) {
        roadMask[region] = 1
        roadIntensity[region] += route.capacity
      }
    }

    const portGateways = this.findPortGateways(mesh, input)
    const shippingPairs = this.buildShippingPairs(
      mesh,
      input.human,
      [...portGateways.keys()],
      landComponent,
      params.shippingRouteDensity,
      params.shippingMaxRange,
    )
    const oceanDistance = this.buildOceanDistance(mesh, input.regionFeature)
    for (const pair of shippingPairs) {
      const forward = this.createShippingRoute(
        mesh,
        input,
        pair.source,
        pair.target,
        portGateways,
        oceanDistance,
        cellAngle,
        params,
      )
      if (forward) {
        routes.push(forward)
        for (const region of forward.regions)
          shippingIntensity[region] += forward.capacity
      }
      const reverse = this.createShippingRoute(
        mesh,
        input,
        pair.target,
        pair.source,
        portGateways,
        oceanDistance,
        cellAngle,
        params,
      )
      if (reverse) {
        routes.push(reverse)
        for (const region of reverse.regions)
          shippingIntensity[region] += reverse.capacity
      }
    }

    this.normalizeIntensity(roadIntensity)
    this.normalizeIntensity(shippingIntensity)
    return { routes, roadMask, roadIntensity, shippingIntensity }
  }

  private createRoadRoute(
    mesh: SphericalMesh,
    input: SphericalTransportGeneratorInput,
    pair: SettlementPair,
    cellAngle: number,
  ): HumanRoute | null {
    const sourceRegion = input.human.settlements[pair.source].region
    const targetRegion = input.human.settlements[pair.target].region
    const edgeCost = (from: number, to: number) => (
      this.roadEdgeCost(mesh, input, from, to, cellAngle)
    )
    const path = findSphericalPath(mesh, sourceRegion, targetRegion, {
      isPassable: region => input.landMask[region] !== 0,
      edgeCost,
      heuristicCost: (region, target) => mesh.distanceBetweenRegions(region, target) / cellAngle * 0.3,
    })
    if (path.length < 2)
      return null
    const baseCost = this.sumPathCost(path, edgeCost)
    const distance = this.pathDistance(mesh, path)
    const seasonalCost = new Float32Array(CLIMATE_SEASON_COUNT).fill(baseCost)
    const source = input.human.settlements[pair.source]
    const target = input.human.settlements[pair.target]
    return {
      mode: 'road',
      sourceSettlement: pair.source,
      targetSettlement: pair.target,
      regions: path,
      distance,
      baseCost,
      seasonalCost,
      reliability: clamp(distance / Math.max(baseCost * cellAngle, Number.EPSILON), 0.25, 1),
      capacity: Math.sqrt(source.population * target.population),
    }
  }

  private createShippingRoute(
    mesh: SphericalMesh,
    input: SphericalTransportGeneratorInput,
    sourceSettlement: number,
    targetSettlement: number,
    portGateways: Map<number, number>,
    oceanDistance: Int16Array,
    cellAngle: number,
    params: GlobeGenParams,
  ): HumanRoute | null {
    const sourceGateway = portGateways.get(sourceSettlement)
    const targetGateway = portGateways.get(targetSettlement)
    if (sourceGateway === undefined || targetGateway === undefined)
      return null
    const representativeCost = (from: number, to: number) => (
      this.shippingEdgeCost(
        mesh,
        input,
        from,
        to,
        oceanDistance,
        cellAngle,
        params,
        -1,
      )
    )
    const oceanPath = findSphericalPath(mesh, sourceGateway, targetGateway, {
      isPassable: region => input.regionFeature[region] === REGION_FEATURE.Ocean,
      edgeCost: representativeCost,
      heuristicCost: (region, target) => mesh.distanceBetweenRegions(region, target) / cellAngle / 2.5,
    })
    if (oceanPath.length === 0)
      return null

    const sourceRegion = input.human.settlements[sourceSettlement].region
    const targetRegion = input.human.settlements[targetSettlement].region
    const routeRegions = new Uint32Array(oceanPath.length + 2)
    routeRegions[0] = sourceRegion
    routeRegions.set(oceanPath, 1)
    routeRegions[routeRegions.length - 1] = targetRegion
    const baseCost = this.sumPathCost(oceanPath, representativeCost)
    const seasonalCost = new Float32Array(CLIMATE_SEASON_COUNT)
    for (let season = 0; season < CLIMATE_SEASON_COUNT; season++) {
      seasonalCost[season] = this.sumPathCost(oceanPath, (from, to) => (
        this.shippingEdgeCost(
          mesh,
          input,
          from,
          to,
          oceanDistance,
          cellAngle,
          params,
          season,
        )
      ))
    }
    let minimumSeasonalCost = Infinity
    let maximumSeasonalCost = 0
    for (const cost of seasonalCost) {
      minimumSeasonalCost = Math.min(minimumSeasonalCost, cost)
      maximumSeasonalCost = Math.max(maximumSeasonalCost, cost)
    }
    const source = input.human.settlements[sourceSettlement]
    const target = input.human.settlements[targetSettlement]
    const reliability = clamp(
      minimumSeasonalCost / Math.max(maximumSeasonalCost, Number.EPSILON),
      0.15,
      1,
    )
    return {
      mode: 'shipping',
      sourceSettlement,
      targetSettlement,
      regions: routeRegions,
      distance: this.pathDistance(mesh, routeRegions),
      baseCost,
      seasonalCost,
      reliability,
      capacity: Math.sqrt(source.population * target.population) * reliability,
    }
  }

  private roadEdgeCost(
    mesh: SphericalMesh,
    input: SphericalTransportGeneratorInput,
    from: number,
    to: number,
    cellAngle: number,
  ): number {
    const edgeDistance = mesh.distanceBetweenRegions(from, to) / cellAngle
    const relief = clamp(Math.abs(input.elevation[to] - input.elevation[from]) / 0.055, 0, 1)
    const elevationPenalty = clamp((input.climateElevationMeters[to] - 1600) / 2800, 0, 1)
    const biomePenalty = this.roadBiomePenalty(input.climate.biome[to])
    const riverBonus = input.rivers.riverMask[from] !== 0 || input.rivers.riverMask[to] !== 0
      ? 0.18
      : 0
    const accessibilityBonus = input.human.accessibility[to] * 0.24
    return edgeDistance * Math.max(
      0.32,
      1 + relief * 1.5 + elevationPenalty * 0.65 + biomePenalty
      - riverBonus - accessibilityBonus,
    )
  }

  private shippingEdgeCost(
    mesh: SphericalMesh,
    input: SphericalTransportGeneratorInput,
    from: number,
    to: number,
    oceanDistance: Int16Array,
    cellAngle: number,
    params: GlobeGenParams,
    season: number,
  ): number {
    const fromIndex = from * 3
    const toIndex = to * 3
    const fx = mesh.regionPosition[fromIndex]
    const fy = mesh.regionPosition[fromIndex + 1]
    const fz = mesh.regionPosition[fromIndex + 2]
    const projection = dot3(
      fx,
      fy,
      fz,
      mesh.regionPosition[toIndex],
      mesh.regionPosition[toIndex + 1],
      mesh.regionPosition[toIndex + 2],
    )
    let dx = mesh.regionPosition[toIndex] - fx * projection
    let dy = mesh.regionPosition[toIndex + 1] - fy * projection
    let dz = mesh.regionPosition[toIndex + 2] - fz * projection
    const directionLength = Math.max(Math.hypot(dx, dy, dz), Number.EPSILON)
    dx /= directionLength
    dy /= directionLength
    dz /= directionLength

    const currentAssist = dot3(
      input.climate.oceanCurrent[fromIndex],
      input.climate.oceanCurrent[fromIndex + 1],
      input.climate.oceanCurrent[fromIndex + 2],
      dx,
      dy,
      dz,
    )
    const windIndex = season >= 0
      ? season * mesh.numRegions * 3 + fromIndex
      : fromIndex
    const wind = season >= 0 ? input.climate.seasonalWind : input.climate.wind
    const windAssist = dot3(
      wind[windIndex],
      wind[windIndex + 1],
      wind[windIndex + 2],
      dx,
      dy,
      dz,
    )
    const effectiveSpeed = clamp(
      1
      + currentAssist * params.shippingCurrentInfluence * 0.55
      + windAssist * params.shippingWindInfluence * 0.35,
      0.25,
      2.5,
    )
    const coldRisk = clamp((2 - input.climate.seaSurfaceTemperature[from]) / 14, 0, 1) * 0.55
    const openOceanRisk = clamp(oceanDistance[from] / 14, 0, 1) * params.shippingOpenOceanRisk
    return mesh.distanceBetweenRegions(from, to) / cellAngle
      / effectiveSpeed
      * (1 + coldRisk + openOceanRisk)
  }

  private buildRoadPairs(
    mesh: SphericalMesh,
    human: SphericalHumanData,
    settlements: number[],
    landComponent: Int32Array,
    density: number,
  ): SettlementPair[] {
    if (density <= 0)
      return []
    const groups = new Map<number, number[]>()
    for (const settlement of settlements) {
      const component = landComponent[human.settlements[settlement].region]
      if (component < 0)
        continue
      const group = groups.get(component)
      if (group)
        group.push(settlement)
      else
        groups.set(component, [settlement])
    }
    const pairs = new Map<string, SettlementPair>()
    const connectionCount = 1 + Math.round(clamp(density, 0, 1) * 3)
    for (const group of groups.values()) {
      this.addMinimumSpanningPairs(mesh, human, group, pairs)
      this.addNearestPairs(mesh, human, group, connectionCount, Infinity, pairs)
    }
    return [...pairs.values()]
  }

  private buildShippingPairs(
    mesh: SphericalMesh,
    human: SphericalHumanData,
    ports: number[],
    landComponent: Int32Array,
    density: number,
    maximumRange: number,
  ): SettlementPair[] {
    if (density <= 0)
      return []
    const pairs = new Map<string, SettlementPair>()
    const connectionCount = 1 + Math.round(clamp(density, 0, 1) * 2)
    const routeRange = clamp(maximumRange, 0.08, Math.PI)
    this.addNearestPairs(
      mesh,
      human,
      ports,
      connectionCount,
      routeRange,
      pairs,
    )
    this.addShippingBackbonePairs(
      mesh,
      human,
      ports,
      landComponent,
      routeRange,
      pairs,
    )
    return [...pairs.values()]
  }

  private addShippingBackbonePairs(
    mesh: SphericalMesh,
    human: SphericalHumanData,
    ports: number[],
    landComponent: Int32Array,
    maximumRange: number,
    pairs: Map<string, SettlementPair>,
  ): void {
    const componentIndex = new Map<number, number>()
    for (const port of ports) {
      const component = landComponent[human.settlements[port].region]
      if (component >= 0 && !componentIndex.has(component))
        componentIndex.set(component, componentIndex.size)
    }
    if (componentIndex.size < 2)
      return

    const edges: Array<PairDistance & { sourceComponent: number, targetComponent: number }> = []
    for (let sourceIndex = 0; sourceIndex < ports.length; sourceIndex++) {
      const source = ports[sourceIndex]
      const sourceRegion = human.settlements[source].region
      const sourceComponent = landComponent[sourceRegion]
      for (let targetIndex = sourceIndex + 1; targetIndex < ports.length; targetIndex++) {
        const target = ports[targetIndex]
        const targetRegion = human.settlements[target].region
        const targetComponent = landComponent[targetRegion]
        if (sourceComponent < 0 || targetComponent < 0 || sourceComponent === targetComponent)
          continue
        const distance = mesh.distanceBetweenRegions(sourceRegion, targetRegion)
        if (distance > maximumRange)
          continue
        edges.push({ source, target, distance, sourceComponent, targetComponent })
      }
    }
    edges.sort((a, b) => a.distance - b.distance || a.source - b.source || a.target - b.target)

    const parent = new Int32Array(componentIndex.size)
    for (let index = 0; index < parent.length; index++)
      parent[index] = index
    const findRoot = (index: number): number => {
      let root = index
      while (parent[root] !== root)
        root = parent[root]
      while (parent[index] !== index) {
        const next = parent[index]
        parent[index] = root
        index = next
      }
      return root
    }
    for (const edge of edges) {
      const sourceRoot = findRoot(componentIndex.get(edge.sourceComponent)!)
      const targetRoot = findRoot(componentIndex.get(edge.targetComponent)!)
      if (sourceRoot === targetRoot)
        continue
      parent[targetRoot] = sourceRoot
      this.addPair(pairs, edge.source, edge.target)
    }
  }

  private addMinimumSpanningPairs(
    mesh: SphericalMesh,
    human: SphericalHumanData,
    settlements: number[],
    pairs: Map<string, SettlementPair>,
  ): void {
    if (settlements.length < 2)
      return
    const edges: PairDistance[] = []
    for (let a = 0; a < settlements.length; a++) {
      for (let b = a + 1; b < settlements.length; b++) {
        edges.push({
          source: settlements[a],
          target: settlements[b],
          distance: mesh.distanceBetweenRegions(
            human.settlements[settlements[a]].region,
            human.settlements[settlements[b]].region,
          ),
        })
      }
    }
    edges.sort((a, b) => a.distance - b.distance || a.source - b.source || a.target - b.target)
    const parent = new Int32Array(settlements.length)
    const settlementIndex = new Map<number, number>()
    for (let index = 0; index < settlements.length; index++) {
      parent[index] = index
      settlementIndex.set(settlements[index], index)
    }
    const findRoot = (index: number): number => {
      let root = index
      while (parent[root] !== root)
        root = parent[root]
      while (parent[index] !== index) {
        const next = parent[index]
        parent[index] = root
        index = next
      }
      return root
    }
    for (const edge of edges) {
      const sourceRoot = findRoot(settlementIndex.get(edge.source)!)
      const targetRoot = findRoot(settlementIndex.get(edge.target)!)
      if (sourceRoot === targetRoot)
        continue
      parent[targetRoot] = sourceRoot
      this.addPair(pairs, edge.source, edge.target)
    }
  }

  private addNearestPairs(
    mesh: SphericalMesh,
    human: SphericalHumanData,
    settlements: number[],
    connectionCount: number,
    maximumRange: number,
    pairs: Map<string, SettlementPair>,
  ): void {
    for (const source of settlements) {
      const sourceRegion = human.settlements[source].region
      const neighbors = settlements
        .filter(target => target !== source)
        .map(target => ({
          target,
          distance: mesh.distanceBetweenRegions(sourceRegion, human.settlements[target].region),
        }))
        .filter(candidate => candidate.distance <= maximumRange)
        .sort((a, b) => a.distance - b.distance || a.target - b.target)
      for (let index = 0; index < Math.min(connectionCount, neighbors.length); index++)
        this.addPair(pairs, source, neighbors[index].target)
    }
  }

  private addPair(
    pairs: Map<string, SettlementPair>,
    source: number,
    target: number,
  ): void {
    const low = Math.min(source, target)
    const high = Math.max(source, target)
    pairs.set(`${low}:${high}`, { source: low, target: high })
  }

  private findPortGateways(
    mesh: SphericalMesh,
    input: SphericalTransportGeneratorInput,
  ): Map<number, number> {
    const gateways = new Map<number, number>()
    for (let settlementId = 0; settlementId < input.human.settlements.length; settlementId++) {
      const settlement = input.human.settlements[settlementId]
      if (!settlement.isPort)
        continue
      let gateway = -1
      for (const neighbor of mesh.forEachNeighborOfRegion(settlement.region)) {
        if (
          input.regionFeature[neighbor] === REGION_FEATURE.Ocean
          && (gateway < 0 || neighbor < gateway)
        ) {
          gateway = neighbor
        }
      }
      if (gateway >= 0)
        gateways.set(settlementId, gateway)
    }
    return gateways
  }

  private buildLandComponents(mesh: SphericalMesh, landMask: Uint8Array): Int32Array {
    const component = new Int32Array(mesh.numRegions).fill(-1)
    let componentId = 0
    for (let start = 0; start < mesh.numRegions; start++) {
      if (landMask[start] === 0 || component[start] >= 0)
        continue
      const queue = [start]
      component[start] = componentId
      for (let head = 0; head < queue.length; head++) {
        const region = queue[head]
        for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
          if (landMask[neighbor] !== 0 && component[neighbor] < 0) {
            component[neighbor] = componentId
            queue.push(neighbor)
          }
        }
      }
      componentId++
    }
    return component
  }

  private buildOceanDistance(mesh: SphericalMesh, regionFeature: Uint8Array): Int16Array {
    const distance = new Int16Array(mesh.numRegions).fill(-1)
    const queue: number[] = []
    for (let region = 0; region < mesh.numRegions; region++) {
      if (regionFeature[region] !== REGION_FEATURE.Ocean)
        continue
      for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
        if (regionFeature[neighbor] !== REGION_FEATURE.Ocean) {
          distance[region] = 0
          queue.push(region)
          break
        }
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const region = queue[head]
      for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
        if (regionFeature[neighbor] === REGION_FEATURE.Ocean && distance[neighbor] < 0) {
          distance[neighbor] = distance[region] + 1
          queue.push(neighbor)
        }
      }
    }
    return distance
  }

  private roadBiomePenalty(biome: number): number {
    switch (biome) {
      case SPHERICAL_BIOME.Ice:
      case SPHERICAL_BIOME.PolarDesert:
      case SPHERICAL_BIOME.AlpineTundra:
        return 1.5
      case SPHERICAL_BIOME.HotDesert:
      case SPHERICAL_BIOME.ColdDesert:
      case SPHERICAL_BIOME.Tundra:
      case SPHERICAL_BIOME.TropicalRainforest:
        return 0.58
      case SPHERICAL_BIOME.XericShrubland:
      case SPHERICAL_BIOME.MontaneCloudForest:
      case SPHERICAL_BIOME.MontaneConiferForest:
        return 0.32
      default:
        return 0
    }
  }

  private sumPathCost(
    path: Uint32Array,
    edgeCost: (from: number, to: number) => number,
  ): number {
    let cost = 0
    for (let index = 1; index < path.length; index++)
      cost += edgeCost(path[index - 1], path[index])
    return cost
  }

  private pathDistance(mesh: SphericalMesh, path: Uint32Array): number {
    let distance = 0
    for (let index = 1; index < path.length; index++)
      distance += mesh.distanceBetweenRegions(path[index - 1], path[index])
    return distance
  }

  private normalizeIntensity(intensity: Float32Array): void {
    let maximum = 0
    for (const value of intensity)
      maximum = Math.max(maximum, value)
    if (maximum <= 0)
      return
    for (let region = 0; region < intensity.length; region++)
      intensity[region] /= maximum
  }
}
