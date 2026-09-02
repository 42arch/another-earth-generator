import type { GlobeGenParams } from '@/core/spherical/config'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type {
  HumanRoute,
  ReligionTerrainAffinity,
  SphericalHumanData,
  SphericalReligiousData,
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

const RELIGION_SEED = 187751

export interface SphericalReligionGeneratorInput {
  elevation: Float32Array
  climateElevationMeters: Float32Array
  landMask: Uint8Array
  climate: SphericalClimateData
  rivers: SphericalRiverData
  human: SphericalHumanData
}

export class SphericalReligionGenerator {
  generate(
    mesh: SphericalMesh,
    input: SphericalReligionGeneratorInput,
    params: GlobeGenParams,
  ): SphericalReligiousData {
    const holySettlements = this.selectHolySettlements(mesh, input, params)
    const religions = holySettlements.map((holySettlement, religion) => {
      const settlement = input.human.settlements[holySettlement]
      return {
        name: '',
        holySettlement,
        originRegion: settlement.region,
        originCulture: input.human.culture.regionCulture[settlement.region],
        originPolity: input.human.politics.regionPolity[settlement.region],
        color: this.createColor(params.seed, religion),
        missionaryStrength: 0.48 + deterministicUnit(RELIGION_SEED + 1, params.seed, religion) * 0.5,
        tolerance: 0.2 + deterministicUnit(RELIGION_SEED + 2, params.seed, religion) * 0.72,
        stateSupport: 0.25 + deterministicUnit(RELIGION_SEED + 3, params.seed, religion) * 0.65,
        terrainAffinity: this.terrainAffinity(input, settlement.region, settlement.isPort),
        area: 0,
        followers: 0,
      }
    })
    const seedRegions = religions.map(religion => religion.originRegion)
    const cellAngle = Math.sqrt(4 * Math.PI / mesh.numRegions)
    const tradeRouteStrength = this.buildTradeRouteStrength(input.human)
    const routes = this.buildInfluenceRoutes(input.human, tradeRouteStrength)
    const spread = spreadSphericalInfluence(mesh, {
      landMask: input.landMask,
      seedRegions,
      routes,
      blending: clamp(0.62 - params.religiousProselytism * 0.2, 0.22, 0.7),
      edgeCost: (religion, from, to) => this.edgeCost(
        mesh,
        input,
        religions[religion],
        from,
        to,
        cellAngle,
        params,
      ),
      routeCost: (religion, route) => {
        const missionaryStrength = religions[religion]?.missionaryStrength ?? 0.5
        return route.baseCost
          * (0.42 + (1 - route.reliability) * 0.45)
          * (1 - route.tradeStrength * 0.42)
          / (route.kind === 'contact' ? 0.62 + route.strength * 0.42 : 1)
          / (0.72 + missionaryStrength * 0.42 + params.religiousProselytism * 0.25)
      },
    })

    const holySiteMask = new Uint8Array(mesh.numRegions)
    for (const religion of religions)
      holySiteMask[religion.originRegion] = 1
    for (let region = 0; region < mesh.numRegions; region++) {
      const religion = spread.regionOwner[region]
      if (religion >= 0)
        religions[religion].area += mesh.regionArea[region]
    }
    for (const settlement of input.human.settlements) {
      const religion = spread.regionOwner[settlement.region]
      if (religion >= 0)
        religions[religion].followers += settlement.population
    }
    return {
      regionReligion: spread.regionOwner,
      religionInfluence: spread.influence,
      holySiteMask,
      religions,
    }
  }

  private selectHolySettlements(
    mesh: SphericalMesh,
    input: SphericalReligionGeneratorInput,
    params: GlobeGenParams,
  ): number[] {
    const requestedCount = Math.max(0, Math.round(params.religionCount))
    if (requestedCount === 0)
      return []
    const candidates = input.human.settlements
      .map((settlement, settlementId) => {
        const elevationLandmark = clamp((input.climateElevationMeters[settlement.region] - 800) / 2600, 0, 1)
        const riverLandmark = input.rivers.riverMask[settlement.region] !== 0 ? 0.1 : 0
        const portLandmark = settlement.isPort ? 0.1 : 0
        const variation = deterministicUnit(RELIGION_SEED + 4, params.seed, settlementId) * 0.08
        return {
          settlementId,
          culture: input.human.culture.regionCulture[settlement.region],
          score: Math.log1p(settlement.population) * 0.045
            + settlement.prosperity * 0.32
            + elevationLandmark * 0.12
            + riverLandmark
            + portLandmark
            + variation,
        }
      })
      .sort((a, b) => b.score - a.score || a.settlementId - b.settlementId)
    const maritimeNetworks = buildSphericalMaritimeNetworks(mesh, input.landMask, input.human)
    const bestByNetwork = new Map<number, number>()
    for (const candidate of candidates) {
      const network = maritimeNetworks.settlementNetwork[candidate.settlementId]
      if (network >= 0 && !bestByNetwork.has(network))
        bestByNetwork.set(network, candidate.settlementId)
    }
    const selected = [...bestByNetwork.values()]
    const count = Math.min(candidates.length, Math.max(requestedCount, selected.length))
    const selectedCultures = new Set(selected.map((settlement) => (
      input.human.culture.regionCulture[input.human.settlements[settlement].region]
    )))
    for (const candidate of candidates) {
      if (selected.length >= count)
        break
      if (
        selected.includes(candidate.settlementId)
        || candidate.culture < 0
        || selectedCultures.has(candidate.culture)
      )
        continue
      selected.push(candidate.settlementId)
      selectedCultures.add(candidate.culture)
    }
    while (selected.length < count) {
      let bestSettlement = -1
      let bestScore = -Infinity
      for (const candidate of candidates) {
        if (selected.includes(candidate.settlementId))
          continue
        const region = input.human.settlements[candidate.settlementId].region
        let nearestAngle = Math.PI
        for (const holySettlement of selected) {
          nearestAngle = Math.min(
            nearestAngle,
            mesh.distanceBetweenRegions(
              region,
              input.human.settlements[holySettlement].region,
            ),
          )
        }
        const score = candidate.score + (selected.length === 0 ? 0 : nearestAngle / Math.PI * 0.45)
        if (score > bestScore) {
          bestScore = score
          bestSettlement = candidate.settlementId
        }
      }
      if (bestSettlement < 0)
        break
      selected.push(bestSettlement)
    }
    return selected
  }

  private edgeCost(
    mesh: SphericalMesh,
    input: SphericalReligionGeneratorInput,
    religion: SphericalReligiousData['religions'][number],
    from: number,
    to: number,
    cellAngle: number,
    params: GlobeGenParams,
  ): number {
    const distance = mesh.distanceBetweenRegions(from, to) / cellAngle
    const relief = clamp(Math.abs(input.elevation[to] - input.elevation[from]) / 0.07, 0, 1)
    const accessibilityPenalty = 1 - input.human.accessibility[to]
    const crossesCulture = input.human.culture.regionCulture[from]
      !== input.human.culture.regionCulture[to]
    const proselytism = clamp(params.religiousProselytism, 0, 1.5)
    const culturePenalty = crossesCulture
      ? (1 - religion.tolerance) * 0.34 * (1 - proselytism * 0.45)
      : 0
    const roadBonus = input.human.transport.roadMask[from] !== 0
      && input.human.transport.roadMask[to] !== 0
      ? 0.38
      : 0
    const tradeBonus = (
      input.human.trade.regionTradeIntensity[from]
      + input.human.trade.regionTradeIntensity[to]
    ) * 0.18
    const riverBonus = input.rivers.riverMask[from] !== 0 || input.rivers.riverMask[to] !== 0
      ? 0.14
      : 0
    const stateBonus = religion.originPolity >= 0
      && input.human.politics.regionPolity[to] === religion.originPolity
      ? religion.stateSupport * 0.22
      : 0
    const affinityBonus = this.matchesAffinity(input, to, religion.terrainAffinity) ? 0.2 : 0
    const spreadingPower = 0.76
      + religion.missionaryStrength * 0.44
      + proselytism * 0.28
    return distance * Math.max(
      0.24,
      1 + relief * 0.86 + accessibilityPenalty * 0.48 + culturePenalty
      - roadBonus - riverBonus - tradeBonus - stateBonus - affinityBonus,
    ) / spreadingPower
  }

  private terrainAffinity(
    input: SphericalReligionGeneratorInput,
    region: number,
    isPort: boolean,
  ): ReligionTerrainAffinity {
    if (isPort)
      return 'maritime'
    if (input.climateElevationMeters[region] >= 1800)
      return 'mountain'
    const biome = input.climate.biome[region]
    if (
      biome === SPHERICAL_BIOME.HotDesert
      || biome === SPHERICAL_BIOME.ColdDesert
      || biome === SPHERICAL_BIOME.XericShrubland
    ) {
      return 'desert'
    }
    if (this.isForestBiome(biome))
      return 'forest'
    return 'universal'
  }

  private matchesAffinity(
    input: SphericalReligionGeneratorInput,
    region: number,
    affinity: ReligionTerrainAffinity,
  ): boolean {
    if (affinity === 'universal')
      return false
    if (affinity === 'mountain')
      return input.climateElevationMeters[region] >= 1400
    if (affinity === 'maritime')
      return input.human.transport.shippingIntensity[region] > 0
    if (affinity === 'desert') {
      const biome = input.climate.biome[region]
      return biome === SPHERICAL_BIOME.HotDesert
        || biome === SPHERICAL_BIOME.ColdDesert
        || biome === SPHERICAL_BIOME.XericShrubland
    }
    return this.isForestBiome(input.climate.biome[region])
  }

  private isForestBiome(biome: number): boolean {
    return biome === SPHERICAL_BIOME.BorealForest
      || biome === SPHERICAL_BIOME.TemperateWoodland
      || biome === SPHERICAL_BIOME.TemperateSeasonalForest
      || biome === SPHERICAL_BIOME.TemperateRainforest
      || biome === SPHERICAL_BIOME.TropicalDryForest
      || biome === SPHERICAL_BIOME.TropicalSeasonalForest
      || biome === SPHERICAL_BIOME.TropicalRainforest
      || biome === SPHERICAL_BIOME.MontaneConiferForest
      || biome === SPHERICAL_BIOME.MontaneCloudForest
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

  private createColor(seed: number, religion: number): [number, number, number] {
    const hue = (religion * 0.754877666 + deterministicUnit(RELIGION_SEED, seed, religion) * 0.14) % 1
    return this.hslToRgb(hue, 0.62, 0.54)
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
