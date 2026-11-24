import type { PolityArchetypeView, ReligionArchetypeView } from '#content/content-port'
import type { EcologyArtifact } from '#generation/nature/ecology/ecology'
import type { TerrainArtifact } from '#generation/nature/geography'
import type { HydrologyArtifact } from '#generation/nature/hydrology/hydrology'
import type { ResourcePotentialArtifact } from '#generation/nature/resources/resource-potential'
import type { DeterministicRandom } from '#math/random'
import type { SphericalMesh } from '#mesh/spherical-mesh'
import type {
  CivilizationCapabilities,
  PolitySizeClass,
  PolityTraitId,
  Settlement,
  SettlementFeatureId,
} from './civilization-types'
import type { HabitabilityArtifact } from './habitability'
import type { RegionCultureShare } from './peoples-cultures'
import type { TransportNetworkArtifact } from './transport-network'
import { greatCircleDistanceKm } from '#math/spherical'
import { POLITY_TRAIT_IDS, SETTLEMENT_FEATURE_IDS } from './civilization-types'

export const SETTLEMENT_FEATURE_SET: ReadonlySet<string> = new Set(SETTLEMENT_FEATURE_IDS)
export const POLITY_TRAIT_SET: ReadonlySet<string> = new Set(POLITY_TRAIT_IDS)

export type SettlementFeatureScores = Record<SettlementFeatureId, number>

export interface SettlementFeatureProfile {
  readonly scores: SettlementFeatureScores
  readonly features: readonly SettlementFeatureId[]
}

export interface PolityExpansionModifiers {
  /** Base overland/shortcut speed multiplier (> 0), clamped to [0.38, 1.75]. */
  readonly baseRate: number
  /** Multiplier applied when claiming a region of the same dominant culture. */
  readonly sameCultureFactor: number
  /** Multiplier applied to cross-cultural movement penalties. */
  readonly diffCultureFactor: number
  /** Multiplier applied when claiming a region sharing the polity's dominant religion. */
  readonly sameReligionFactor: number
  /** Multiplier applied when claiming a region with a different dominant religion. */
  readonly diffReligionFactor: number
  /** Multiplier applied on rough/high-resistance land cells (movementCost >= 2.2). */
  readonly roughTerrainFactor: number
  /** Multiplier applied on open flat/low-resistance land cells (movementCost <= 1.35). */
  readonly flatSteppeFactor: number
  /** Multiplier applied to overland/river transport shortcuts. */
  readonly landShortcutFactor: number
  /** Multiplier applied to maritime transport shortcuts. */
  readonly seaShortcutFactor: number
  /** Multiplier applied to Pass 3 open-ocean territorial projection. */
  readonly oceanProjectionFactor: number
}

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value
}

/** Piecewise linear interpolation clamped to [vLo, vHi] across x in [lo, hi]. */
function lerpBand(x: number, lo: number, hi: number, vLo: number, vHi: number): number {
  if (x <= lo)
    return vLo
  if (x >= hi)
    return vHi
  const t = (x - lo) / (hi - lo)
  return vLo + (vHi - vLo) * t
}

function landCoverCode(ecology: Pick<EcologyArtifact, 'landCoverIds' | 'landCoverIndex'> | undefined, region: number): string {
  if (!ecology)
    return ''
  const idx = ecology.landCoverIndex[region]
  if (idx === undefined)
    return ''
  const id = ecology.landCoverIds[idx] ?? ''
  const slash = id.lastIndexOf('/')
  return (slash >= 0 ? id.slice(slash + 1) : id).toLowerCase()
}

function isPastoralCover(code: string): boolean {
  return code.includes('grass') || code.includes('steppe') || code.includes('savanna') || code.includes('shrub') || code.includes('tundra') || code.includes('meadow')
}

export interface SettlementFeatureContext {
  readonly mesh: Pick<SphericalMesh, 'regionCount' | 'neighborOffsets' | 'neighbors'>
  readonly terrain: Pick<TerrainArtifact, 'landMask' | 'elevationKm'> & { readonly slopeRadians?: Float32Array }
  readonly hydrology?: Pick<HydrologyArtifact, 'riverIndex' | 'downstreamRegion'>
  readonly ecology?: Pick<EcologyArtifact, 'landCoverIds' | 'landCoverIndex'>
  readonly resources: Pick<ResourcePotentialArtifact, 'agriculturalPotential'> & Partial<Pick<ResourcePotentialArtifact, 'forestryPotential' | 'fisheryPotential' | 'deposits'>>
  readonly habitability: Pick<HabitabilityArtifact, 'coastalMask'> & Partial<Pick<HabitabilityArtifact, 'economicOpportunity' | 'portPotential'>>
  readonly transport: Pick<TransportNetworkArtifact, 'nodes' | 'routes' | 'nodeCentrality'>
  readonly namedSettlements: readonly Omit<Settlement, 'polityId' | 'features'>[]
  readonly regionCultures: readonly (readonly RegionCultureShare[])[]
  readonly hearthRegions?: readonly number[]
  readonly religionOriginRegions: ReadonlySet<number>
  readonly dominantReligionIndex: Int32Array
  readonly religionCosts: readonly Float32Array[]
  readonly religionArchetypes: readonly ReligionArchetypeView[]
  readonly capabilities: Pick<CivilizationCapabilities, 'industrialCapability' | 'landTransportCapability' | 'seafaringCapability' | 'administrativeCapacity'>
  readonly urbanConcentration: number
}

export function evaluateSettlementFeatures(ctx: SettlementFeatureContext): Map<string, SettlementFeatureProfile> {
  const { mesh, terrain, hydrology, ecology, resources, habitability, transport, namedSettlements, regionCultures, capabilities, urbanConcentration } = ctx
  const n = mesh.regionCount

  // Precompute upstream river confluences if hydrology is available
  const upstreamRiverCount = new Uint8Array(n)
  if (hydrology) {
    for (let r = 0; r < n; r++) {
      const down = hydrology.downstreamRegion[r]!
      if (down >= 0 && down < n && hydrology.riverIndex[r]! >= 0)
        upstreamRiverCount[down]++
    }
  }

  // Precompute max mineral & energy deposit richness per region
  const regionMineralDeposit = new Float32Array(n)
  const regionEnergyDeposit = new Float32Array(n)
  if (resources.deposits) {
    for (const deposit of resources.deposits) {
      if (deposit.regionId < 0 || deposit.regionId >= n)
        continue
      if (deposit.category === 'mineral')
        regionMineralDeposit[deposit.regionId] = Math.max(regionMineralDeposit[deposit.regionId]!, deposit.richness)
      else if (deposit.category === 'energy')
        regionEnergyDeposit[deposit.regionId] = Math.max(regionEnergyDeposit[deposit.regionId]!, deposit.richness)
    }
  }

  // Precompute per-settlement transport stats
  const nodeCentralityBySettlement = new Map<string, number>()
  const nodeIdToSettlementId = new Map<string, string>()
  for (let i = 0; i < transport.nodes.length; i++) {
    const node = transport.nodes[i]!
    if (node.settlementId) {
      nodeCentralityBySettlement.set(node.settlementId, transport.nodeCentrality[i] ?? 0)
      nodeIdToSettlementId.set(node.id, node.settlementId)
    }
  }
  const seaRouteCount = new Map<string, number>()
  const seaTraffic = new Map<string, number>()
  const landRiverRouteCount = new Map<string, number>()
  let maxSeaTraffic = 0
  for (const route of transport.routes) {
    const sA = nodeIdToSettlementId.get(route.fromNodeId)
    const sB = nodeIdToSettlementId.get(route.toNodeId)
    for (const sId of [sA, sB]) {
      if (!sId)
        continue
      if (route.mode === 'sea') {
        seaRouteCount.set(sId, (seaRouteCount.get(sId) ?? 0) + 1)
        const nextTraffic = (seaTraffic.get(sId) ?? 0) + route.trafficScore
        seaTraffic.set(sId, nextTraffic)
        if (nextTraffic > maxSeaTraffic)
          maxSeaTraffic = nextTraffic
      }
      else {
        landRiverRouteCount.set(sId, (landRiverRouteCount.get(sId) ?? 0) + 1)
      }
    }
  }

  const hearthSet = new Set(ctx.hearthRegions ?? [])
  const avg1 = (field: Float32Array | undefined, region: number): number => {
    if (!field)
      return 0
    let sum = field[region]!
    let count = 1
    for (let e = mesh.neighborOffsets[region]; e < mesh.neighborOffsets[region + 1]; e++) {
      const nb = mesh.neighbors[e]!
      if (terrain.landMask[nb] === 1) {
        sum += field[nb]!
        count++
      }
    }
    return sum / count
  }
  const max1 = (field: Float32Array, region: number): number => {
    let best = field[region]!
    for (let e = mesh.neighborOffsets[region]; e < mesh.neighborOffsets[region + 1]; e++) {
      const nb = mesh.neighbors[e]!
      if (terrain.landMask[nb] === 1 && field[nb]! > best)
        best = field[nb]!
    }
    return best
  }

  // Population percentiles across named settlements
  const sortedPops = namedSettlements.map(s => s.population).sort((a, b) => a - b)
  const popPercentileOf = (pop: number): number => {
    if (sortedPops.length <= 1)
      return 0.5
    let lo = 0
    let hi = sortedPops.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sortedPops[mid]! < pop)
        lo = mid + 1
      else
        hi = mid
    }
    return lo / (sortedPops.length - 1)
  }

  const { industrialCapability: indCap, landTransportCapability: landCap, seafaringCapability: seaCap, administrativeCapacity: adminCap } = capabilities
  const lowSpecialization = urbanConcentration <= 0.25 && indCap < 0.2

  const profiles = new Map<string, SettlementFeatureProfile>()
  for (const s of namedSettlements) {
    const r = s.regionId
    const agri = avg1(resources.agriculturalPotential, r)
    const forest = avg1(resources.forestryPotential, r)
    const fishery = avg1(resources.fisheryPotential, r)
    const minDep = max1(regionMineralDeposit, r)
    const engDep = max1(regionEnergyDeposit, r)
    const econOpp = habitability.economicOpportunity ? habitability.economicOpportunity[r]! : 0
    const portPot = habitability.portPotential ? habitability.portPotential[r]! : (s.isPort ? 0.65 : 0)
    const isCoastal = habitability.coastalMask[r] === 1 || Boolean(s.isPort)
    const slope = terrain.slopeRadians ? terrain.slopeRadians[r]! : 0
    const flatness = 1 - clamp01(slope / 0.22)
    const elev = Math.max(0, terrain.elevationKm[r]!)
    const hasRiver = hydrology ? hydrology.riverIndex[r]! >= 0 : false
    const isConfluence = upstreamRiverCount[r]! >= 2
    const centrality = nodeCentralityBySettlement.get(s.id) ?? 0
    const sSeaRoutes = seaRouteCount.get(s.id) ?? 0
    const sSeaTraffic = maxSeaTraffic > 0 ? (seaTraffic.get(s.id) ?? 0) / maxSeaTraffic : 0
    const sLandRiverRoutes = landRiverRouteCount.get(s.id) ?? 0

    // Cultural hearth and diversity
    let isHearth = hearthSet.has(r)
    if (!isHearth && hearthSet.size > 0) {
      for (let e = mesh.neighborOffsets[r]; e < mesh.neighborOffsets[r + 1]; e++) {
        if (hearthSet.has(mesh.neighbors[e]!)) {
          isHearth = true
          break
        }
      }
    }
    const cShares = regionCultures[r] ?? []
    const secondaryCultureShare = cShares.length >= 2 ? cShares[1]!.share : 0
    const cultureMixScore = clamp01(secondaryCultureShare * 2.4 + (cShares.length >= 3 ? 0.25 : 0))

    // Religious origin or near-origin sanctuary
    const isReligionOrigin = ctx.religionOriginRegions.has(r)
    const domRel = ctx.dominantReligionIndex[r]!
    const isHierarchicalRel = domRel >= 0 && ctx.religionArchetypes[domRel]?.organization === 'hierarchical'
    let religionScore = 0
    if (isReligionOrigin) {
      religionScore = clamp01(0.85 + (isHierarchicalRel ? 0.15 : 0))
    }
    else if (domRel >= 0) {
      const relDist = ctx.religionCosts[domRel]?.[r] ?? Infinity
      if (Number.isFinite(relDist) && relDist <= 12) {
        religionScore = clamp01((1 - relDist / 12) * (isHierarchicalRel ? 0.62 : 0.45))
      }
    }

    // Feature scores
    const maritimeTradeScore = (s.isPort && seaCap >= 0.3 && sSeaRoutes > 0)
      ? clamp01((0.22 + 0.32 * portPot + 0.24 * Math.min(1, sSeaRoutes / 3) + 0.22 * Math.sqrt(sSeaTraffic)) * lerpBand(seaCap, 0.3, 0.8, 0.75, 1.1))
      : 0

    // economicOpportunity is a product of three [0,1] factors (industry * food * transport);
    // apply concave rescaling so industrial belts register clearly against ubiquitous agrarian baselines.
    const industrialSignal = Math.max(minDep, engDep * 0.9, Math.sqrt(minDep * Math.max(engDep, 0.25 * forest)))
    const industrialScore = indCap >= 0.35
      ? clamp01((0.58 * (econOpp > 0 ? econOpp ** 0.58 : 0) + 0.27 * industrialSignal + 0.15 * Math.sqrt(centrality)) * lerpBand(indCap, 0.35, 1.0, 0.72, 1.15))
      : 0

    const craftScore = lerpBand(indCap, 0.25, 0.55, 1.0, 0)
      * clamp01(0.35 * forest + 0.35 * Math.max(minDep, engDep * 0.7) + 0.3 * Math.sqrt(centrality) + (hasRiver ? 0.08 : 0))

    const miningScore = clamp01(Math.max(minDep, engDep) * (1.05 - 0.35 * industrialScore))

    const agrarianScore = clamp01((0.72 * agri + (hasRiver ? 0.14 : 0) + 0.08 * flatness) * (1 - 0.35 * industrialScore) * (1 - 0.3 * maritimeTradeScore))

    const cover = landCoverCode(ecology, r)
    const pastoralSignal = isPastoralCover(cover) ? 0.55 : (elev >= 0.65 ? 0.35 : 0)
    const pastoralScore = clamp01((pastoralSignal + 0.45 * clamp01(elev / 1.4)) * (1 - 0.65 * agri) * (1 - 0.55 * forest))
      * lerpBand(indCap, 0.2, 1.0, 1.0, 0.5)

    const forestryScore = clamp01(forest * (1.1 - 0.5 * agri))

    const fisheryScore = isCoastal
      ? clamp01(fishery * (1.1 - 0.45 * maritimeTradeScore))
      : 0

    const tradeHubScore = clamp01((0.42 * Math.sqrt(centrality) + 0.36 * Math.min(1, sLandRiverRoutes / 3) + (isConfluence ? 0.22 : 0))
      * lerpBand(landCap, 0.2, 0.6, 0.55, 1.08))

    const culturalScore = clamp01((isHearth ? 0.52 : 0) + 0.28 * cultureMixScore + 0.28 * (popPercentileOf(s.population) ** 1.4))

    const fortressScore = lerpBand(adminCap, 0.15, 0.4, 0.4, 1.0)
      * clamp01(0.42 * clamp01(elev / 1.2) + 0.33 * clamp01(slope / 0.16) + 0.25 * Math.min(1, sLandRiverRoutes / 2))
      * (1 - 0.25 * agri)

    const scores: SettlementFeatureScores = {
      'agrarian': agrarianScore,
      'pastoral': pastoralScore,
      'industrial': industrialScore,
      'craft': craftScore,
      'mining': miningScore,
      'forestry': forestryScore,
      'fishery': fisheryScore,
      'maritime-trade': maritimeTradeScore,
      'trade-hub': tradeHubScore,
      'cultural': culturalScore,
      'religious': religionScore,
      'fortress': fortressScore,
    }

    const features = selectSettlementFeatures(scores, s.tier === 'city', lowSpecialization)
    profiles.set(s.id, { scores, features })
  }

  return profiles
}

export function selectSettlementFeatures(
  scores: SettlementFeatureScores,
  isMajorOrCapital: boolean,
  lowSpecialization: boolean,
): readonly SettlementFeatureId[] {
  const ranked = SETTLEMENT_FEATURE_IDS.map((id, order) => ({ id, score: scores[id], order }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.order - b.order))

  const primary = ranked[0]!
  const maxSlots = lowSpecialization
    ? (isMajorOrCapital || primary.id === 'religious' ? 2 : 1)
    : (isMajorOrCapital ? 3 : 2)

  const selected: SettlementFeatureId[] = [primary.id]
  const minSecondaryScore = Math.max(0.45, primary.score * 0.65)
  for (let i = 1; i < ranked.length && selected.length < maxSlots; i++) {
    const candidate = ranked[i]!
    if (candidate.score >= minSecondaryScore)
      selected.push(candidate.id)
  }
  return selected
}

/** Optional diagnostic copy; never persisted or included in generation identity. */
export interface PolityPowerDiagnostic {
  readonly capitalSettlementId: string
  readonly selected: PolityTraitId
  readonly scores: readonly { readonly id: PolityTraitId, readonly score: number }[]
  readonly signals: Readonly<{
    capitalPrimacy: number
    largestRivalPopulation: number
    distributedCenters: number
    geographicFragmentation: number
    coreCulturalDiversity: number
    productiveCore: number
    civicFunction: number
    civicSpecialization: number
    administrativeReach: number
    corePopulation: number
    hinterlandSites: number
  }>
}

export interface PolityTraitContext {
  readonly mesh: Pick<SphericalMesh, 'centers' | 'physicalRadiusKm'>
  readonly terrain: Pick<TerrainArtifact, 'elevationKm'> & Partial<Pick<TerrainArtifact, 'slopeRadians'>>
  readonly habitability: Pick<HabitabilityArtifact, 'coastalMask'> & Partial<Pick<HabitabilityArtifact, 'movementCost'>>
  readonly capabilities: Pick<CivilizationCapabilities, 'industrialCapability' | 'seafaringCapability' | 'administrativeCapacity'>
  readonly urbanConcentration: number
  readonly namedSettlements: readonly Omit<Settlement, 'polityId' | 'features'>[]
  readonly settlementProfiles: ReadonlyMap<string, SettlementFeatureProfile>
  readonly regionCultures: readonly (readonly RegionCultureShare[])[]
  readonly dominantReligionIndex: Int32Array
  readonly religionArchetypes: readonly ReligionArchetypeView[]
  readonly onPowerEvaluated?: (diagnostic: PolityPowerDiagnostic) => void
  readonly territoryComponentIndex?: Int32Array
}

/**
 * Computes emergent 3-dimension polity traits from the capital and its local settlement hinterland
 * before territory boundaries are finalized, breaking any circular dependency with ownership.
 */
export function emergePolityTraitsForCapitals(
  capitals: readonly Omit<Settlement, 'polityId' | 'features'>[],
  ctx: PolityTraitContext,
  rng: DeterministicRandom,
  hinterlandRadiusKm: number,
  subsetSettlements?: readonly Omit<Settlement, 'polityId' | 'features'>[],
): readonly (readonly PolityTraitId[])[] {
  if (capitals.length === 0)
    return []

  const { mesh, terrain, habitability, capabilities, urbanConcentration, settlementProfiles, regionCultures, dominantReligionIndex, religionArchetypes } = ctx
  const { industrialCapability: indCap, seafaringCapability: seaCap, administrativeCapacity: adminCap } = capabilities
  const sites = subsetSettlements ?? ctx.namedSettlements

  // Assign each settlement to its nearest capital within hinterlandRadiusKm (Voronoi pre-aggregation)
  const hinterlandByCap: { readonly site: Omit<Settlement, 'polityId' | 'features'>, readonly weight: number }[][] = Array.from({ length: capitals.length }, () => [])
  const vecA = { x: 0, y: 0, z: 0 }
  const vecB = { x: 0, y: 0, z: 0 }
  const capitalIdIndex = new Map(capitals.map((c, idx) => [c.id, idx]))

  for (const site of sites) {
    const capIdx = capitalIdIndex.get(site.id)
    if (capIdx !== undefined)
      continue
    vecA.x = mesh.centers[3 * site.regionId]
    vecA.y = mesh.centers[3 * site.regionId + 1]
    vecA.z = mesh.centers[3 * site.regionId + 2]
    let bestCap = -1
    let bestDist = hinterlandRadiusKm
    for (let p = 0; p < capitals.length; p++) {
      const cap = capitals[p]!
      if (ctx.territoryComponentIndex && ctx.territoryComponentIndex[site.regionId] !== ctx.territoryComponentIndex[cap.regionId])
        continue
      vecB.x = mesh.centers[3 * cap.regionId]
      vecB.y = mesh.centers[3 * cap.regionId + 1]
      vecB.z = mesh.centers[3 * cap.regionId + 2]
      const d = greatCircleDistanceKm(vecA, vecB, mesh.physicalRadiusKm)
      if (d < bestDist) {
        bestDist = d
        bestCap = p
      }
    }
    if (bestCap >= 0) {
      const decay = 1 - bestDist / Math.max(1, hinterlandRadiusKm)
      hinterlandByCap[bestCap]!.push({ site, weight: 0.25 + 0.75 * decay })
    }
  }

  const lowSpecialization = urbanConcentration <= 0.25 && indCap < 0.2

  return capitals.map((cap, pIdx) => {
    const capProfile = settlementProfiles.get(cap.id)
    const agg: SettlementFeatureScores = {
      'agrarian': 0,
      'pastoral': 0,
      'industrial': 0,
      'craft': 0,
      'mining': 0,
      'forestry': 0,
      'fishery': 0,
      'maritime-trade': 0,
      'trade-hub': 0,
      'cultural': 0,
      'religious': 0,
      'fortress': 0,
    }
    const localSites = hinterlandByCap[pIdx]!
    const hasHinterland = localSites.length > 0
    // Blend capital (50%) + hinterland weighted average (25%) + hinterland peak (25%)
    // so specialized ports, industrial hubs, fortresses, or sanctuaries are not drowned out by rural towns.
    const capWeight = hasHinterland ? 0.5 : 1.0
    if (capProfile) {
      for (const id of SETTLEMENT_FEATURE_IDS)
        agg[id] += capProfile.scores[id] * capWeight
    }
    if (hasHinterland) {
      let totalW = 0
      for (const item of localSites)
        totalW += item.weight
      const avgScale = totalW > 0 ? 0.25 / totalW : 0
      const peakScores: Record<SettlementFeatureId, number> = {
        'agrarian': 0,
        'pastoral': 0,
        'industrial': 0,
        'craft': 0,
        'mining': 0,
        'forestry': 0,
        'fishery': 0,
        'maritime-trade': 0,
        'trade-hub': 0,
        'cultural': 0,
        'religious': 0,
        'fortress': 0,
      }
      for (const item of localSites) {
        const prof = settlementProfiles.get(item.site.id)
        if (!prof)
          continue
        for (const id of SETTLEMENT_FEATURE_IDS) {
          const val = prof.scores[id]
          agg[id] += val * item.weight * avgScale
          if (val > peakScores[id])
            peakScores[id] = val
        }
      }
      for (const id of SETTLEMENT_FEATURE_IDS)
        agg[id] += peakScores[id] * 0.25
    }

    const r = cap.regionId
    const isCoastal = habitability.coastalMask[r] === 1 || Boolean(cap.isPort)
    const elev = Math.max(0, terrain.elevationKm[r]!)
    // Power structure depends on the founding core, not the capital's rank across the world.
    // Nearby residents are weighted by the same physical-distance decay used for the hinterland.
    let corePopulation = 0
    let roughnessSum = 0
    let culturePopulation = 0
    const cultureWeights = new Map<number, number>()
    const accumulateCore = (site: Omit<Settlement, 'polityId' | 'features'>, weight: number) => {
      const residents = Math.max(0, site.population) * weight
      corePopulation += residents
      const slope = terrain.slopeRadians?.[site.regionId] ?? 0
      const resistance = habitability.movementCost?.[site.regionId] ?? 1
      // Same slope scale as settlement flatness; 2.2 is the expansion model's rough-land threshold.
      const roughness = Math.max(clamp01(slope / 0.22), clamp01((resistance - 1) / (2.2 - 1)))
      roughnessSum += residents * roughness
      for (const share of regionCultures[site.regionId] ?? []) {
        const amount = residents * share.share
        cultureWeights.set(share.cultureIndex, (cultureWeights.get(share.cultureIndex) ?? 0) + amount)
        culturePopulation += amount
      }
    }
    accumulateCore(cap, 1)
    for (const item of localSites)
      accumulateCore(item.site, item.weight)
    // Urban population outside the capital is normal even in centralized states.
    // Compare the capital to its strongest local center, never the sum of all other towns.
    const largestRivalPopulation = localSites.reduce((largest, item) => Math.max(largest, item.site.population * item.weight), 0)
    const capitalPrimacy = cap.population + largestRivalPopulation > 0 ? cap.population / (cap.population + largestRivalPopulation) : 0
    const distributedCenters = cap.population > 0 ? clamp01(largestRivalPopulation / cap.population) : 0
    const geographicFragmentation = corePopulation > 0 ? roughnessSum / corePopulation : 0
    let coreCulturalDiversity = 0
    if (culturePopulation > 0) {
      let sameCultureProbability = 0
      for (const amount of cultureWeights.values())
        sameCultureProbability += (amount / culturePopulation) ** 2
      coreCulturalDiversity = clamp01(1 - sameCultureProbability)
    }
    const productiveCore = Math.max(agg.agrarian, agg.industrial)
    // Culture can reinforce a civic economy; a cultural hearth alone does not imply city-state rule.
    const civicFunction = Math.max(agg['maritime-trade'], agg['trade-hub']) * (0.8 + 0.2 * agg.cultural)
    const civicSpecialization = clamp01(civicFunction - productiveCore)
    const administrativeReach = lerpBand(adminCap, 0.45, 0.9, 0.25, 1.0)
    const cShares = regionCultures[r] ?? []
    const multiCultural = cShares.length >= 2 ? clamp01(cShares[1]!.share * 2.5) : 0
    const domRel = dominantReligionIndex[r]!
    const relArch = domRel >= 0 ? religionArchetypes[domRel] : undefined
    const isHierarchicalRel = relArch?.organization === 'hierarchical'
    const lowRelTolerance = relArch ? clamp01(1 - relArch.tolerance) : 0
    const isTraditionalRel = relArch ? (relArch.tags.includes('ancestral') || relArch.tags.includes('animist') || relArch.tags.includes('local')) : false
    const capReligious = capProfile?.scores.religious ?? 0
    const capFortress = capProfile?.scores.fortress ?? 0
    const relSignal = Math.max(capReligious, agg.religious)
    const jitter = () => 0.9 + rng.nextFloat() * 0.2

    // Dimension 1: Power & territorial structure (pick 1)
    const dim1Candidates: { readonly id: PolityTraitId, readonly score: number }[] = [
      {
        id: 'centralized',
        score: adminCap >= 0.45
          ? (0.25 + 0.3 * administrativeReach + 0.45 * productiveCore)
          * (0.5 + 0.5 * capitalPrimacy)
          * (1 - 0.45 * coreCulturalDiversity)
          * (1 - 0.4 * geographicFragmentation) * jitter()
          : 0,
      },
      {
        id: 'city-state-civic',
        score: urbanConcentration >= 0.3
          ? civicFunction * (0.5 + 0.5 * civicSpecialization)
          * lerpBand(urbanConcentration, 0.3, 0.8, 0.75, 1.0)
          * (0.65 + 0.35 * capitalPrimacy) * jitter()
          : 0,
      },
      {
        id: 'decentralized',
        score: (0.18 + 0.25 * (1 - administrativeReach) + 0.45 * distributedCenters
          + 0.4 * geographicFragmentation + 0.45 * coreCulturalDiversity) * jitter(),
      },
      {
        id: 'tribal-kinship',
        score: (adminCap < 0.5 && urbanConcentration < 0.4)
          ? (0.42 + 0.35 * lerpBand(adminCap, 0.15, 0.5, 1.0, 0) + 0.25 * lerpBand(urbanConcentration, 0.1, 0.4, 1.0, 0) + 0.15 * Math.max(agg.agrarian, agg.forestry, agg.fishery, agg.pastoral)) * jitter()
          : 0,
      },
      {
        id: 'nomadic-pastoral',
        score: agg.pastoral > Math.max(agg.agrarian, agg.industrial, agg.forestry, agg.craft)
          && (!isCoastal || agg.pastoral >= 0.45)
          ? (0.1 + 0.7 * agg.pastoral + 0.25 * clamp01(elev / 1.3) + 0.15 * lerpBand(urbanConcentration, 0.1, 0.5, 1.0, 0.25)) * lerpBand(indCap, 0.3, 1.0, 1.0, 0.42) * jitter()
          : 0,
      },
    ]
    dim1Candidates.sort((a, b) => b.score - a.score)
    // These scores express institutional affinity, not a deterministic geographic law.
    // A seed-stable draw preserves viable alternatives when their support is comparable.
    const totalPowerWeight = dim1Candidates.reduce((sum, candidate) => sum + candidate.score, 0)
    let powerChoice = rng.fork(`power-structure:${cap.id}`).nextFloat() * totalPowerWeight
    let powerTrait = dim1Candidates[0]!.id
    for (const candidate of dim1Candidates) {
      if (candidate.score <= 0)
        continue
      if (powerChoice < candidate.score) {
        powerTrait = candidate.id
        break
      }
      powerChoice -= candidate.score
    }
    ctx.onPowerEvaluated?.(Object.freeze({
      capitalSettlementId: cap.id,
      selected: powerTrait,
      scores: Object.freeze(dim1Candidates.map(candidate => Object.freeze({ ...candidate }))),
      signals: Object.freeze({ capitalPrimacy, largestRivalPopulation, distributedCenters, geographicFragmentation, coreCulturalDiversity, productiveCore, civicFunction, civicSpecialization, administrativeReach, corePopulation, hinterlandSites: localSites.length }),
    }))

    // Dimension 2: Governance & legitimacy (pick 0 or 1 above threshold)
    const dim2Threshold = lowSpecialization ? 0.52 : 0.48
    const dim2Candidates: { readonly id: PolityTraitId, readonly score: number }[] = [
      {
        id: 'theocratic',
        score: relSignal >= 0.32
          ? (0.62 * relSignal + (isHierarchicalRel ? 0.22 : 0.08) + 0.18 * lowRelTolerance) * jitter()
          : 0,
      },
      {
        id: 'democratic',
        score: (urbanConcentration >= 0.35 && adminCap >= 0.35)
          ? (0.14 + 0.24 * lerpBand(urbanConcentration, 0.35, 0.8, 0.25, 1.0) + 0.36 * Math.max(agg['maritime-trade'], agg.industrial, agg.cultural, agg['trade-hub']) + (powerTrait === 'city-state-civic' ? 0.14 : 0) + (powerTrait === 'decentralized' ? 0.1 : 0) + 0.1 * multiCultural) * jitter()
          : 0,
      },
      {
        id: 'militaristic',
        score: (powerTrait !== 'city-state-civic')
          ? (0.1 + 0.56 * Math.max(capFortress, agg.fortress) + 0.36 * agg.mining + 0.14 * agg.industrial + (powerTrait === 'nomadic-pastoral' ? 0.22 : 0) + (powerTrait === 'centralized' ? 0.08 : 0)) * lerpBand(adminCap, 0.15, 0.4, 0.65, 1.0) * jitter()
          : 0,
      },
      {
        id: 'dynastic-aristocratic',
        score: adminCap >= 0.3
          ? (0.06 + 0.52 * agg.agrarian + 0.18 * (1 - multiCultural) + (powerTrait === 'centralized' ? 0.08 : 0)) * lerpBand(indCap, 0.2, 1.0, 1.05, 0.68) * jitter()
          : 0,
      },
      {
        id: 'ancestral-ritual',
        score: (indCap < 0.35 && urbanConcentration < 0.45)
          ? (0.24 + 0.38 * agg.agrarian + (isTraditionalRel ? 0.24 : 0.08) + 0.15 * lerpBand(indCap, 0, 0.35, 1.0, 0)) * jitter()
          : 0,
      },
    ]
    dim2Candidates.sort((a, b) => b.score - a.score)
    const governanceTrait = dim2Candidates[0]!.score >= dim2Threshold ? dim2Candidates[0]!.id : null

    // Dimension 3: Economic orientation (pick 1)
    const dim3Candidates: { readonly id: PolityTraitId, readonly score: number }[] = [
      {
        id: 'mercantile',
        score: seaCap >= 0.3
          ? (0.62 * agg['maritime-trade'] + 0.38 * agg['trade-hub'] + 0.18 * agg.fishery + (isCoastal ? 0.1 : 0) + (powerTrait === 'city-state-civic' ? 0.16 : 0)) * lerpBand(seaCap, 0.3, 0.85, 0.75, 1.18) * jitter()
          : 0,
      },
      {
        id: 'agrarian-realm',
        score: (0.76 * agg.agrarian + 0.22 * Math.max(agg.pastoral, agg.forestry)) * lerpBand(indCap, 0.2, 1.0, 1.05, 0.68) * jitter(),
      },
      {
        id: 'industrial-power',
        score: indCap >= 0.35
          ? (0.76 * agg.industrial + 0.34 * agg.mining + 0.12 * agg['trade-hub']) * lerpBand(indCap, 0.35, 1.0, 0.72, 1.25) * jitter()
          : 0,
      },
      {
        id: 'artisan-craft',
        score: indCap < 0.55
          ? (0.58 * agg.craft + 0.34 * agg.mining + 0.22 * agg.forestry) * lerpBand(indCap, 0.25, 0.55, 1.12, 0) * jitter()
          : 0,
      },
      {
        id: 'cultural-patron',
        score: (0.78 * agg.cultural + 0.22 * relSignal + 0.14 * agg['trade-hub']) * jitter(),
      },
    ]
    dim3Candidates.sort((a, b) => b.score - a.score)
    const economicTrait = dim3Candidates[0]!.id

    const traits: PolityTraitId[] = governanceTrait
      ? [powerTrait, governanceTrait, economicTrait]
      : [powerTrait, economicTrait]
    return traits
  })
}

export function computePolityExpansionModifiers(traits: readonly PolityTraitId[]): PolityExpansionModifiers {
  let baseRate = 1
  let sameCultureFactor = 1
  let diffCultureFactor = 1
  let sameReligionFactor = 1
  let diffReligionFactor = 1
  let roughTerrainFactor = 1
  let flatSteppeFactor = 1
  let landShortcutFactor = 1
  let seaShortcutFactor = 1
  let oceanProjectionFactor = 1

  for (const trait of traits) {
    switch (trait) {
      // Dimension 1
      case 'centralized':
        baseRate *= 1.3
        diffCultureFactor *= 0.88
        break
      case 'city-state-civic':
        baseRate *= 0.48
        seaShortcutFactor *= 0.8
        oceanProjectionFactor *= 0.82
        break
      case 'decentralized':
        baseRate *= 0.9
        diffCultureFactor *= 0.78
        break
      case 'tribal-kinship':
        baseRate *= 0.78
        diffCultureFactor *= 1.25
        seaShortcutFactor *= 1.25
        oceanProjectionFactor *= 1.25
        break
      case 'nomadic-pastoral':
        flatSteppeFactor *= 0.85
        roughTerrainFactor *= 1.12
        seaShortcutFactor *= 1.6
        oceanProjectionFactor *= 1.6
        break
      // Dimension 2
      case 'theocratic':
        sameReligionFactor *= 0.72
        diffReligionFactor *= 1.32
        break
      case 'democratic':
        baseRate *= 0.92
        diffCultureFactor *= 0.82
        break
      case 'militaristic':
        baseRate *= 1.2
        roughTerrainFactor *= 0.85
        break
      case 'dynastic-aristocratic':
        baseRate *= 1.08
        seaShortcutFactor *= 1.18
        oceanProjectionFactor *= 1.15
        break
      case 'ancestral-ritual':
        sameCultureFactor *= 0.86
        diffCultureFactor *= 1.15
        oceanProjectionFactor *= 1.15
        break
      // Dimension 3
      case 'mercantile':
        baseRate *= 0.88
        seaShortcutFactor *= 0.68
        oceanProjectionFactor *= 0.68
        break
      case 'agrarian-realm':
        baseRate *= 1.05
        oceanProjectionFactor *= 1.15
        break
      case 'industrial-power':
        landShortcutFactor *= 0.78
        seaShortcutFactor *= 0.78
        oceanProjectionFactor *= 0.82
        break
      case 'artisan-craft':
        baseRate *= 1.02
        landShortcutFactor *= 0.86
        break
      case 'cultural-patron':
        sameCultureFactor *= 0.8
        diffCultureFactor *= 1.12
        break
    }
  }

  return {
    baseRate: Math.max(0.38, Math.min(1.75, baseRate)),
    sameCultureFactor,
    diffCultureFactor,
    sameReligionFactor,
    diffReligionFactor,
    roughTerrainFactor,
    flatSteppeFactor,
    landShortcutFactor,
    seaShortcutFactor,
    oceanProjectionFactor,
  }
}

export function applyPolityTraitArchetypeWeight(
  baseScore: number,
  arch: PolityArchetypeView,
  traits: readonly PolityTraitId[],
  sizeClass: PolitySizeClass,
): number {
  if (arch.allowedSizeClasses && !arch.allowedSizeClasses.includes(sizeClass))
    return 0
  // Content traits are plain strings; compare by value so includes stays on PolityTraitId.
  const hasTrait = (id: string) => traits.some(trait => trait === id)
  if (arch.requiredTraits?.some(id => !hasTrait(id)))
    return 0
  let score = baseScore
  for (const affinity of arch.traitAffinities ?? []) {
    if (affinity.traits.every(hasTrait)
      && !affinity.excludedTraits?.some(hasTrait)
      && (!affinity.sizeClasses || affinity.sizeClasses.includes(sizeClass))) {
      score *= affinity.weight
      if (!Number.isFinite(score))
        throw new Error(`Nonfinite polity affinity weight for ${arch.id}`)
    }
  }
  return score
}
