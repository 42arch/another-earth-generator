import type { GlobeGenParams } from '@/core/spherical/config'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type {
  SphericalHumanData,
  SphericalSettlement,
} from '@/core/spherical/society/society-data'
import type { SphericalClimateData } from '@/core/spherical/climate/climate-data'
import type { SphericalRiverData } from '@/core/spherical/hydrology/hydrology-data'
import { REGION_FEATURE } from '@/core/spherical/geography/region-feature'
import { clamp, deterministicUnit } from '@/core/spherical/geometry/spherical-math'
import {
  TRADE_GOOD_COUNT,
} from '@/core/spherical/society/society-data'
import { SPHERICAL_BIOME } from '@/core/spherical/climate/climate-data'

const HUMAN_VARIATION_SEED = 92821
const HIGHLAND_SETTLEMENT_ELEVATION = 1200

export interface SphericalHumanGeneratorInput {
  elevation: Float32Array
  climateElevationMeters: Float32Array
  landMask: Uint8Array
  regionFeature: Uint8Array
  climate: SphericalClimateData
  rivers: SphericalRiverData
}

interface RegionQualities {
  habitability: Float32Array
  accessibility: Float32Array
  coastalMask: Uint8Array
  oceanCoastalMask: Uint8Array
}

interface SettlementCandidate {
  region: number
  score: number
  anchorKind?: 'major' | 'island'
}

export class SphericalHumanGenerator {
  generate(
    mesh: SphericalMesh,
    input: SphericalHumanGeneratorInput,
    params: GlobeGenParams,
  ): SphericalHumanData {
    const qualities = this.calculateRegionQualities(mesh, input, params.seed)
    const settlements = this.generateSettlements(mesh, input, qualities, params)
    const regionSettlementId = new Int32Array(mesh.numRegions).fill(-1)
    for (let settlementId = 0; settlementId < settlements.length; settlementId++)
      regionSettlementId[settlements[settlementId].region] = settlementId

    return {
      habitability: qualities.habitability,
      accessibility: qualities.accessibility,
      regionSettlementId,
      settlements,
      maritimeContacts: [],
      transport: {
        routes: [],
        roadMask: new Uint8Array(mesh.numRegions),
        roadIntensity: new Float32Array(mesh.numRegions),
        shippingIntensity: new Float32Array(mesh.numRegions),
      },
      trade: {
        settlementProduction: new Float32Array(settlements.length * TRADE_GOOD_COUNT),
        settlementDemand: new Float32Array(settlements.length * TRADE_GOOD_COUNT),
        settlementExports: new Float32Array(settlements.length),
        settlementImports: new Float32Array(settlements.length),
        settlementMarketAccess: new Float32Array(settlements.length),
        routeVolume: new Float32Array(0),
        regionTradeIntensity: new Float32Array(mesh.numRegions),
        totalVolume: 0,
      },
      culture: {
        regionCulture: new Int16Array(mesh.numRegions).fill(-1),
        cultureInfluence: new Float32Array(mesh.numRegions),
        cultures: [],
      },
      religion: {
        regionReligion: new Int16Array(mesh.numRegions).fill(-1),
        religionInfluence: new Float32Array(mesh.numRegions),
        holySiteMask: new Uint8Array(mesh.numRegions),
        religions: [],
      },
      politics: {
        regionPolity: new Int16Array(mesh.numRegions).fill(-1),
        politicalControl: new Float32Array(mesh.numRegions),
        polities: [],
      },
      naming: {
        languages: [],
        familyNames: [],
      },
    }
  }

  private calculateRegionQualities(
    mesh: SphericalMesh,
    input: SphericalHumanGeneratorInput,
    seed: number,
  ): RegionQualities {
    const habitability = new Float32Array(mesh.numRegions)
    const accessibility = new Float32Array(mesh.numRegions)
    const passability = new Float32Array(mesh.numRegions)
    const coastalMask = new Uint8Array(mesh.numRegions)
    const oceanCoastalMask = new Uint8Array(mesh.numRegions)

    for (let region = 0; region < mesh.numRegions; region++) {
      if (input.landMask[region] === 0)
        continue
      let maximumRelief = 0
      let hasWaterNeighbor = false
      let hasOceanNeighbor = false
      for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
        if (input.landMask[neighbor] === 0) {
          hasWaterNeighbor = true
          hasOceanNeighbor ||= input.regionFeature[neighbor] === REGION_FEATURE.Ocean
          continue
        }
        maximumRelief = Math.max(
          maximumRelief,
          Math.abs(input.elevation[region] - input.elevation[neighbor]),
        )
      }
      coastalMask[region] = hasWaterNeighbor ? 1 : 0
      oceanCoastalMask[region] = hasOceanNeighbor ? 1 : 0

      const temperatureScore = 1 - clamp(
        Math.abs(input.climate.temperature[region] - 16) / 32,
        0,
        1,
      )
      const precipitationScore = this.precipitationSuitability(
        input.climate.annualPrecipitationMm[region],
      )
      const runoffScore = clamp(input.climate.runoff[region] * 28, 0, 1)
      const reliefPenalty = clamp(maximumRelief / 0.07, 0, 1)
      const elevationPenalty = clamp(
        (input.climateElevationMeters[region] - 1100) / 2600,
        0,
        1,
      )
      const biomeScore = this.biomeSuitability(input.climate.biome[region])
      const coastalBonus = hasWaterNeighbor ? 0.07 : 0
      const variation = (deterministicUnit(HUMAN_VARIATION_SEED, seed, region) - 0.5) * 0.06
      habitability[region] = clamp(
        temperatureScore * 0.24
        + precipitationScore * 0.25
        + runoffScore * 0.13
        + (1 - reliefPenalty) * 0.16
        + (1 - elevationPenalty) * 0.1
        + biomeScore * 0.12
        + coastalBonus
        + variation,
        0,
        1,
      )
      passability[region] = clamp(
        (1 - reliefPenalty) * 0.52
        + (1 - elevationPenalty) * 0.2
        + biomeScore * 0.28,
        0,
        1,
      )
    }

    for (let region = 0; region < mesh.numRegions; region++) {
      if (input.landMask[region] === 0)
        continue
      let neighborPassability = 0
      let neighborCount = 0
      for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
        if (input.landMask[neighbor] === 0)
          continue
        neighborPassability += passability[neighbor]
        neighborCount++
      }
      const riverBonus = input.rivers.riverMask[region] !== 0 ? 0.12 : 0
      const coastalBonus = coastalMask[region] !== 0 ? 0.08 : 0
      accessibility[region] = clamp(
        passability[region] * 0.68
        + (neighborCount > 0 ? neighborPassability / neighborCount : 0) * 0.12
        + riverBonus
        + coastalBonus,
        0,
        1,
      )
    }

    return { habitability, accessibility, coastalMask, oceanCoastalMask }
  }

  private generateSettlements(
    mesh: SphericalMesh,
    input: SphericalHumanGeneratorInput,
    qualities: RegionQualities,
    params: GlobeGenParams,
  ): SphericalSettlement[] {
    const candidates: SettlementCandidate[] = []
    let landRegionCount = 0
    for (let region = 0; region < mesh.numRegions; region++) {
      if (input.landMask[region] === 0)
        continue
      landRegionCount++
      const riverBonus = input.rivers.riverMask[region] !== 0 ? 0.08 : 0
      const coastBonus = qualities.coastalMask[region] !== 0 ? 0.06 : 0
      const highlandBonus = input.climateElevationMeters[region] >= HIGHLAND_SETTLEMENT_ELEVATION
        && qualities.accessibility[region] >= 0.45
        ? 0.035
        : 0
      const variation = deterministicUnit(HUMAN_VARIATION_SEED + 1, params.seed, region) * 0.045
      candidates.push({
        region,
        score: qualities.habitability[region] * 0.62
          + qualities.accessibility[region] * 0.27
          + riverBonus
          + coastBonus
          + highlandBonus
          + variation,
      })
    }
    candidates.sort((a, b) => b.score - a.score || a.region - b.region)

    const landmassAnchors = this.selectLandmassAnchors(
      mesh,
      input,
      qualities,
      candidates,
      landRegionCount,
      params.seed,
    )
    const density = clamp(params.settlementDensity, 0.15, 2.5)
    const minimumCount = Math.min(4, landRegionCount)
    const maximumCount = Math.max(minimumCount, Math.floor(landRegionCount / 10))
    const targetCount = Math.max(
      landmassAnchors.length,
      clamp(
        Math.round(landRegionCount / 300 * density),
        minimumCount,
        maximumCount,
      ),
    )
    const highlandCandidates = candidates.filter(candidate => (
      this.isHighlandSettlementCandidate(candidate.region, input, qualities)
    ))
    const highlandTarget = targetCount >= 5 && highlandCandidates.length > 0
      ? Math.min(highlandCandidates.length, Math.max(1, Math.round(targetCount * 0.12)))
      : 0
    const highlandSettlements = this.selectSpacedCandidates(
      mesh,
      highlandCandidates,
      landmassAnchors.length + highlandTarget,
      landmassAnchors,
    )
    const inlandCandidates = candidates.filter(candidate => (
      this.isInlandSettlementCandidate(candidate.region, qualities)
    ))
    const inlandTarget = targetCount >= 5 && inlandCandidates.length > 0
      ? Math.min(inlandCandidates.length, Math.max(1, Math.round(targetCount * 0.3)))
      : 0
    const reservedSettlements = this.selectSpacedCandidates(
      mesh,
      inlandCandidates,
      highlandSettlements.length + inlandTarget,
      highlandSettlements,
    )
    const selected = this.selectSpacedCandidates(
      mesh,
      candidates,
      Math.max(targetCount, reservedSettlements.length),
      reservedSettlements,
    )
    selected.sort((a, b) => b.score - a.score || a.region - b.region)
    const majorAnchorRegions = new Set(
      landmassAnchors
        .filter(candidate => candidate.anchorKind === 'major')
        .map(candidate => candidate.region),
    )
    const islandAnchorRegions = new Set(
      landmassAnchors
        .filter(candidate => candidate.anchorKind === 'island')
        .map(candidate => candidate.region),
    )
    return selected.map((candidate, rank) => {
      const prosperity = clamp(
        qualities.habitability[candidate.region] * 0.67
        + qualities.accessibility[candidate.region] * 0.33,
        0,
        1,
      )
      const naturalType = rank < Math.max(1, Math.ceil(selected.length * 0.15))
        ? 'city'
        : prosperity >= 0.62
          ? 'town'
          : prosperity >= 0.44
            ? 'village'
            : 'camp'
      const isIslandAnchor = islandAnchorRegions.has(candidate.region)
      const type = isIslandAnchor
        ? prosperity >= 0.5 ? 'village' : 'camp'
        : naturalType === 'camp' && majorAnchorRegions.has(candidate.region)
          ? 'village'
          : naturalType
      const populationScale = type === 'city'
        ? 1
        : type === 'town'
          ? 0.26
          : type === 'village'
            ? 0.055
            : 0.012
      return {
        name: '',
        region: candidate.region,
        type,
        population: Math.round(350 + 95000 * prosperity ** 3 * populationScale),
        baseProsperity: prosperity,
        prosperity,
        isPort: qualities.oceanCoastalMask[candidate.region] !== 0,
      }
    })
  }

  private selectLandmassAnchors(
    mesh: SphericalMesh,
    input: SphericalHumanGeneratorInput,
    qualities: RegionQualities,
    candidates: SettlementCandidate[],
    landRegionCount: number,
    seed: number,
  ): SettlementCandidate[] {
    const regionComponent = new Int32Array(mesh.numRegions).fill(-1)
    const componentSize: number[] = []
    for (let start = 0; start < mesh.numRegions; start++) {
      if (input.landMask[start] === 0 || regionComponent[start] >= 0)
        continue
      const component = componentSize.length
      const queue = [start]
      regionComponent[start] = component
      for (let head = 0; head < queue.length; head++) {
        const region = queue[head]
        for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
          if (input.landMask[neighbor] !== 0 && regionComponent[neighbor] < 0) {
            regionComponent[neighbor] = component
            queue.push(neighbor)
          }
        }
      }
      componentSize.push(queue.length)
    }

    const bestCandidate: Array<SettlementCandidate | undefined> = []
    const bestPortCandidate: Array<SettlementCandidate | undefined> = []
    for (const candidate of candidates) {
      const component = regionComponent[candidate.region]
      if (component < 0)
        continue
      bestCandidate[component] ??= candidate
      if (qualities.oceanCoastalMask[candidate.region] !== 0)
        bestPortCandidate[component] ??= candidate
    }
    const minimumMajorSize = Math.max(10, Math.ceil(landRegionCount * 0.01))
    return componentSize
      .map((size, component) => ({ component, size }))
      .filter(({ component, size }) => {
        if (size >= minimumMajorSize)
          return true
        const candidate = bestPortCandidate[component] ?? bestCandidate[component]
        if (!candidate)
          return false
        const habitability = qualities.habitability[candidate.region]
        if (size >= 2) {
          if (habitability < 0.3 || candidate.score < 0.34)
            return false
          const inhabitedChance = clamp(
            0.16 + habitability * 0.52 + Math.log2(size) * 0.07,
            0.18,
            0.88,
          )
          return deterministicUnit(HUMAN_VARIATION_SEED + 4, seed, component, size)
            < inhabitedChance
        }
        const inhabitedChance = 0.12 + habitability * 0.38
        return habitability >= 0.52
          && deterministicUnit(HUMAN_VARIATION_SEED + 5, seed, component) < inhabitedChance
      })
      .sort((a, b) => b.size - a.size || a.component - b.component)
      .map(({ component, size }) => {
        const candidate = bestPortCandidate[component] ?? bestCandidate[component]
        if (candidate)
          candidate.anchorKind = size >= minimumMajorSize ? 'major' : 'island'
        return candidate
      })
      .filter((candidate): candidate is SettlementCandidate => candidate !== undefined)
  }

  private selectSpacedCandidates(
    mesh: SphericalMesh,
    candidates: SettlementCandidate[],
    targetCount: number,
    initialCandidates: SettlementCandidate[] = [],
  ): SettlementCandidate[] {
    if (targetCount === 0)
      return []
    const selected = [...initialCandidates]
    let minimumDistance = clamp(0.46 / Math.sqrt(targetCount), 0.085, 0.24)
    while (selected.length < targetCount && minimumDistance >= 0.04) {
      const minimumDot = Math.cos(minimumDistance)
      for (const candidate of candidates) {
        if (selected.length >= targetCount)
          break
        if (selected.some(selectedCandidate => (
          mesh.dotBetweenRegions(candidate.region, selectedCandidate.region) > minimumDot
        ))) {
          continue
        }
        selected.push(candidate)
      }
      minimumDistance *= 0.72
    }
    return selected
  }

  private isHighlandSettlementCandidate(
    region: number,
    input: SphericalHumanGeneratorInput,
    qualities: RegionQualities,
  ): boolean {
    if (
      input.climateElevationMeters[region] < HIGHLAND_SETTLEMENT_ELEVATION
      || qualities.habitability[region] < 0.3
      || qualities.accessibility[region] < 0.45
    ) {
      return false
    }
    const biome = input.climate.biome[region]
    return biome !== SPHERICAL_BIOME.Ice
      && biome !== SPHERICAL_BIOME.PolarDesert
      && biome !== SPHERICAL_BIOME.AlpineTundra
  }

  private isInlandSettlementCandidate(
    region: number,
    qualities: RegionQualities,
  ): boolean {
    return qualities.coastalMask[region] === 0
      && qualities.habitability[region] >= 0.32
      && qualities.accessibility[region] >= 0.42
  }

  private precipitationSuitability(precipitationMm: number): number {
    if (precipitationMm <= 100)
      return 0
    if (precipitationMm < 700)
      return (precipitationMm - 100) / 600
    if (precipitationMm <= 1600)
      return 1
    return 1 - clamp((precipitationMm - 1600) / 2600, 0, 1) * 0.35
  }

  private biomeSuitability(biome: number): number {
    switch (biome) {
      case SPHERICAL_BIOME.TemperateGrassland:
      case SPHERICAL_BIOME.TemperateWoodland:
      case SPHERICAL_BIOME.TemperateSeasonalForest:
      case SPHERICAL_BIOME.MediterraneanShrubland:
      case SPHERICAL_BIOME.TropicalSavanna:
      case SPHERICAL_BIOME.TropicalDryForest:
        return 1
      case SPHERICAL_BIOME.TemperateRainforest:
      case SPHERICAL_BIOME.TropicalSeasonalForest:
      case SPHERICAL_BIOME.MontaneCloudForest:
        return 0.78
      case SPHERICAL_BIOME.BorealForest:
      case SPHERICAL_BIOME.TropicalRainforest:
      case SPHERICAL_BIOME.MontaneConiferForest:
        return 0.58
      case SPHERICAL_BIOME.ColdDesert:
      case SPHERICAL_BIOME.XericShrubland:
      case SPHERICAL_BIOME.Tundra:
        return 0.24
      case SPHERICAL_BIOME.HotDesert:
      case SPHERICAL_BIOME.PolarDesert:
      case SPHERICAL_BIOME.AlpineTundra:
      case SPHERICAL_BIOME.Ice:
      default:
        return 0.03
    }
  }
}
