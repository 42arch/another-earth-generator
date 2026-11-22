import type { CivilizationContentBundle, ContentId, NamingStyleView, PolityArchetypeView, ReligionArchetypeView } from '#content/content-port'
import type { EcologyArtifact } from '#generation/nature/ecology/ecology'
import type { TerrainArtifact } from '#generation/nature/geography'
import type { HydrologyArtifact } from '#generation/nature/hydrology/hydrology'
import type { StaticLakeArtifact } from '#generation/nature/hydrology/lakes'
import type { ResourcePotentialArtifact } from '#generation/nature/resources/resource-potential'
import type { SphericalMesh } from '#mesh/spherical-mesh'
import type { CivilizationParameters, Polity, PolitySizeClass, PolityTraitId, PopulationGroup, Religion, Settlement } from './civilization-types'
import type { HabitabilityArtifact } from './habitability'
import type { PolityPowerDiagnostic } from './civilization-traits'
import type { PeoplesCulturesArtifact } from './peoples-cultures'
import type { PopulationSettlementsArtifact } from './population-settlements'
import type { TransportNetworkArtifact } from './transport-network'
import { civilizationContentSignature } from '#content/content-port'
import { UniqueNameAllocator } from '#generation/names/unique-naming'
import { IndexPriorityQueue } from '#generation/nature/common/priority-queue'
import { DeterministicRandom } from '#math/random'
import { greatCircleDistanceKm } from '#math/spherical'
import { resolveCivilizationParameters } from './civilization-parameters'
import {
  applyPolityTraitArchetypeWeight,
  computePolityExpansionModifiers,
  emergePolityTraitsForCapitals,
  evaluateSettlementFeatures,
  POLITY_TRAIT_SET,
  selectSettlementFeatures,
  SETTLEMENT_FEATURE_SET,
} from './civilization-traits'
import { classifyPolitySize } from './civilization-scale'
import { buildTerritoryComponents, checkPolityCountBudget, createPolityAreaTargets, growPolityTerritories, selectPolityCapitals } from './polity-layout'
import { claimMaritimeTerritory } from './nearshore-territory'
import { REFERENCE_TRAVEL_KM_PER_DAY, SETTLEMENT_SUPPORT_AREA_KM2 } from './population-settlements'

export const POLITIES_RELIGIONS_VERSION = 'polities-religions-v15' as const

export interface PolitiesReligionsArtifact {
  readonly meshId: string
  readonly algorithmVersion: typeof POLITIES_RELIGIONS_VERSION
  readonly regionCount: number
  readonly enabled: boolean
  readonly religions: readonly Religion[]
  readonly polities: readonly Polity[]
  readonly settlements: readonly Settlement[]
  readonly population: Float64Array
  readonly populationGroups: readonly PopulationGroup[]
  /** Land ownership, length N. `-1` is unowned; ocean is always `-1`. */
  readonly territoryPolityIndex: Int32Array
}

export interface PolitiesReligionsExtraContext {
  readonly hydrology?: Pick<HydrologyArtifact, 'meshId' | 'riverIndex' | 'downstreamRegion'>
  readonly ecology?: Pick<EcologyArtifact, 'meshId' | 'landCoverIds' | 'landCoverIndex'>
  readonly onPowerEvaluated?: (diagnostic: PolityPowerDiagnostic) => void
}

function chooseWeighted<T>(items: readonly { readonly item: T, readonly weight: number }[], random: DeterministicRandom): T {
  let total = 0
  for (const entry of items)
    total += Math.max(0, entry.weight)
  if (total <= 0)
    return items[0]!.item
  let target = random.nextFloat() * total
  for (const entry of items) {
    const w = Math.max(0, entry.weight)
    if (w <= 0)
      continue
    if (target < w)
      return entry.item
    target -= w
  }
  return items[items.length - 1]!.item
}

function resolveStyle(styles: readonly NamingStyleView[], preferredId: ContentId): NamingStyleView {
  return styles.find(style => style.id === preferredId) ?? styles[0]!
}

function polityFormTitle(bundle: CivilizationContentBundle, displayNameKey: string): string {
  const locales = Object.keys(bundle.translations).sort()
  for (const locale of locales) {
    const text = bundle.translations[locale]?.[displayNameKey]?.trim()
    if (text)
      return text
  }
  return ''
}

function appendPoliticalForm(properName: string, formTitle: string): string {
  const form = formTitle.trim()
  if (!form || properName.endsWith(form))
    return properName
  return /[\u3400-\u9fff]/.test(`${properName}${form}`) ? `${properName}${form}` : `${properName} ${form}`
}

function scorePolityArchetype(
  arch: PolityArchetypeView,
  sizeClass: PolitySizeClass,
  isCoastalCapital: boolean,
  isHighlandCapital: boolean,
  administrativeCapacity: number,
  traits: readonly PolityTraitId[],
): number {
  let score = Math.max(0.05, arch.weight)
  const form = arch.politicalForm
  if (sizeClass === 'empire') {
    if (form === 'empire' || form === 'kingdom' || form === 'dynastic-monarchy' || form === 'federation' || form === 'sultanate')
      score *= 3.2
    else if (form === 'city-state' || form === 'commune' || form === 'chiefdom')
      score *= 0.2
  }
  else if (sizeClass === 'kingdom') {
    if (form === 'kingdom' || form === 'dynastic-monarchy' || form === 'republic' || form === 'federation' || form === 'principality' || form === 'emirate' || form === 'sultanate')
      score *= 2.4
    else if (form === 'city-state')
      score *= 0.25
  }
  else if (sizeClass === 'city-state') {
    if (form === 'city-state' || form === 'merchant-republic' || form === 'free-territory' || form === 'commune' || form === 'league')
      score *= 3.5
    else if (form === 'empire')
      score *= 0.1
  }
  else {
    if (form === 'republic' || form === 'principality' || form === 'confederation' || form === 'league' || form === 'theocracy' || form === 'protectorate')
      score *= 2.0
  }

  if (isCoastalCapital && (form === 'merchant-republic' || form === 'league' || form === 'city-state'))
    score *= 1.8
  if (isHighlandCapital && (form === 'khanate' || form === 'tribal-confederation' || form === 'chiefdom'))
    score *= 1.9
  if (administrativeCapacity < 0.4 && (form === 'confederation' || form === 'tribal-confederation' || form === 'chiefdom' || form === 'free-territory'))
    score *= 1.5
  return applyPolityTraitArchetypeWeight(score, arch, traits, sizeClass)
}

function scoreReligionArchetype(
  arch: ReligionArchetypeView,
  region: number,
  terrain: Pick<TerrainArtifact, 'elevationKm'>,
  habitability: Pick<HabitabilityArtifact, 'coastalMask'>,
  resources: Pick<ResourcePotentialArtifact, 'agriculturalPotential'>,
): number {
  let score = Math.max(0.05, arch.weight)
  const tags = new Set([...arch.tags, ...arch.traits])
  const isCoastal = habitability.coastalMask[region] === 1
  const elev = terrain.elevationKm[region]!
  const agri = resources.agriculturalPotential[region]!

  if (tags.has('maritime') || tags.has('seafaring-rites'))
    score *= isCoastal ? 2.8 : 0.45
  if (tags.has('pastoral') || tags.has('sky-worship') || tags.has('nomadic-shrines'))
    score *= elev >= 0.6 || agri < 0.35 ? 2.4 : 0.65
  if (tags.has('agrarian') || tags.has('ancestral') || tags.has('civic-harmony'))
    score *= 0.7 + agri * 2.2
  if (tags.has('scholarly') || tags.has('philosophical') || tags.has('civic'))
    score *= 0.8 + agri * 1.6
  if (tags.has('local') || tags.has('animist'))
    score *= 1.15
  return score
}

export function generatePolitiesReligions(
  bundle: CivilizationContentBundle,
  bundleSignature: string,
  mesh: Pick<SphericalMesh, 'meshId' | 'regionCount' | 'centers' | 'areaKm2' | 'neighborOffsets' | 'neighbors' | 'physicalRadiusKm'>,
  terrain: Pick<TerrainArtifact, 'meshId' | 'landMask' | 'elevationKm'> & Partial<Pick<TerrainArtifact, 'slopeRadians'>>,
  lakes: Pick<StaticLakeArtifact, 'meshId' | 'lakeIndex'>,
  resources: Pick<ResourcePotentialArtifact, 'meshId' | 'agriculturalPotential'> & Partial<Pick<ResourcePotentialArtifact, 'forestryPotential' | 'fisheryPotential' | 'deposits'>>,
  habitability: Pick<HabitabilityArtifact, 'meshId' | 'movementCost' | 'coastalMask'> & Partial<Pick<HabitabilityArtifact, 'economicOpportunity' | 'portPotential'>>,
  popSettlements: Pick<PopulationSettlementsArtifact, 'meshId' | 'enabled' | 'population'>,
  transport: Pick<TransportNetworkArtifact, 'meshId' | 'nodes' | 'routes' | 'nodeCentrality'>,
  peoplesCultures: Pick<PeoplesCulturesArtifact, 'meshId' | 'peoples' | 'cultures' | 'namedSettlements' | 'regionCultures' | 'dominantCultureIndex' | 'usedNames'> & Partial<Pick<PeoplesCulturesArtifact, 'hearthRegions'>>,
  params: Pick<CivilizationParameters, 'enabled' | 'polityCount' | 'politySizeVariation'> & Partial<Pick<CivilizationParameters, 'urbanConcentration'>> & {
    readonly capabilities: Pick<CivilizationParameters['capabilities'], 'administrativeCapacity'>
      & Partial<Pick<CivilizationParameters['capabilities'], 'seafaringCapability' | 'industrialCapability' | 'landTransportCapability'>>
  },
  worldSeed: string,
  check?: (fraction: number) => void,
  extra?: PolitiesReligionsExtraContext,
): PolitiesReligionsArtifact {
  const n = mesh.regionCount
  if (!n || terrain.meshId !== mesh.meshId || lakes.meshId !== mesh.meshId || resources.meshId !== mesh.meshId || habitability.meshId !== mesh.meshId || popSettlements.meshId !== mesh.meshId || transport.meshId !== mesh.meshId || peoplesCultures.meshId !== mesh.meshId)
    throw new Error('Polities and religions stage received mismatched mesh artifacts')
  if ((extra?.hydrology && extra.hydrology.meshId !== mesh.meshId) || (extra?.ecology && extra.ecology.meshId !== mesh.meshId))
    throw new Error('Polities and religions stage received mismatched auxiliary mesh artifacts')
  if (bundleSignature !== civilizationContentSignature(bundle))
    throw new Error('Civilization content signature mismatch')

  const resolvedParams = resolveCivilizationParameters(params)
  const { polityCount, politySizeVariation, urbanConcentration, capabilities } = resolvedParams
  const { administrativeCapacity, seafaringCapability, industrialCapability } = capabilities
  const lowSpecialization = urbanConcentration <= 0.25 && industrialCapability < 0.2

  const population = popSettlements.population.slice()
  if (!params.enabled) {
    check?.(1)
    return {
      meshId: mesh.meshId,
      algorithmVersion: POLITIES_RELIGIONS_VERSION,
      regionCount: n,
      enabled: false,
      religions: [],
      polities: [],
      settlements: [],
      population,
      populationGroups: [],
      territoryPolityIndex: new Int32Array(n).fill(-1),
    }
  }

  if (bundle.polities.length === 0 || bundle.religions.length === 0 || bundle.namingStyles.length === 0)
    throw new Error('Civilization content bundle must provide polities, religions and namingStyles')

  let inhabitedCount = 0
  for (let r = 0; r < n; r++) {
    if (population[r]! > 0)
      inhabitedCount++
  }
  if (inhabitedCount === 0) {
    check?.(1)
    return {
      meshId: mesh.meshId,
      algorithmVersion: POLITIES_RELIGIONS_VERSION,
      regionCount: n,
      enabled: true,
      religions: [],
      polities: [],
      settlements: [],
      population,
      populationGroups: [],
      territoryPolityIndex: new Int32Array(n).fill(-1),
    }
  }

  // Retain the v8 random stream so changes to power scoring can be compared independently.
  const rng = new DeterministicRandom(JSON.stringify([worldSeed, 'polities-religions-v8']))
  const allocator = new UniqueNameAllocator(worldSeed, peoplesCultures.usedNames)

  const centralityBySettlement = new Map<string, number>()
  for (let i = 0; i < transport.nodes.length; i++) {
    const node = transport.nodes[i]!
    if (node.settlementId)
      centralityBySettlement.set(node.settlementId, transport.nodeCentrality[i] ?? 0)
  }

  const cultureMap = new Map(peoplesCultures.cultures.map((c, idx) => [c.id, { culture: c, index: idx }]))

  // Transport shortcuts map for religion spread and polity projection
  const regionShortcuts = new Map<number, { readonly toRegion: number, readonly cost: number, readonly isSea: boolean }[]>()
  const nodeRegion = new Map(transport.nodes.map(node => [node.id, node.regionId]))
  for (const route of transport.routes) {
    if (route.mode === 'sea' && seafaringCapability <= 0)
      continue
    const a = nodeRegion.get(route.fromNodeId)
    const b = nodeRegion.get(route.toNodeId)
    if (a === undefined || b === undefined)
      continue
    const weight = route.cost * (route.mode === 'sea' ? 1.15 : 0.72)
    let listA = regionShortcuts.get(a)
    if (!listA) {
      listA = []
      regionShortcuts.set(a, listA)
    }
    listA.push({ toRegion: b, cost: weight, isSea: route.mode === 'sea' })
    let listB = regionShortcuts.get(b)
    if (!listB) {
      listB = []
      regionShortcuts.set(b, listB)
    }
    listB.push({ toRegion: a, cost: weight, isSea: route.mode === 'sea' })
  }

  const kmPerDay = REFERENCE_TRAVEL_KM_PER_DAY

  const siteScore = (site: Omit<Settlement, 'polityId' | 'features'>) =>
    site.population * (0.65 + 0.55 * (centralityBySettlement.get(site.id) ?? 0))

  const uniqueSites = new Map(peoplesCultures.namedSettlements.filter(site => terrain.landMask[site.regionId] === 1 && lakes.lakeIndex[site.regionId]! < 0 && site.population > 0).map(site => [site.regionId, site]))
  const rankedSites = [...uniqueSites.values()].sort((a, b) => {
    const scoreA = siteScore(a)
    const scoreB = siteScore(b)
    return scoreB !== scoreA ? scoreB - scoreA : a.regionId - b.regionId
  })

  checkPolityCountBudget(polityCount, rankedSites.length)
  const components = buildTerritoryComponents(mesh, terrain.landMask, lakes.lakeIndex, population, regionShortcuts, () => check?.(0.05))
  // Religion origin spacing remains independent of political layout controls.
  const baseCapitalSpacingKm = Math.max(Math.sqrt(SETTLEMENT_SUPPORT_AREA_KM2) * (3.2 + 0.6 * 3.2), mesh.physicalRadiusKm * (0.14 + 0.6 * 0.16))
  const capitalSpacingKm = Math.sqrt(components.areaKm2.reduce((sum, area) => sum + area, 0) / polityCount)

  const queue = new IndexPriorityQueue(Math.min(n, 8192))
  const vecA = { x: 0, y: 0, z: 0 }
  const vecB = { x: 0, y: 0, z: 0 }

  // Step 1. Seed and spread Religions BEFORE settlement features and territory expansion
  // so religious sanctuaries and theocratic traits are grounded without circularity.
  check?.(0.1)
  const religionTargetCount = Math.max(1, Math.min(6, Math.max(1, Math.round(peoplesCultures.cultures.length * 0.75))))
  const religionOrigins: { region: number, cultureId: string }[] = []
  const usedReligionRegions = new Set<number>()

  for (const s of rankedSites) {
    if (religionOrigins.length >= religionTargetCount)
      break
    if (usedReligionRegions.has(s.regionId))
      continue
    vecA.x = mesh.centers[3 * s.regionId]
    vecA.y = mesh.centers[3 * s.regionId + 1]
    vecA.z = mesh.centers[3 * s.regionId + 2]
    let spaced = true
    for (const o of religionOrigins) {
      vecB.x = mesh.centers[3 * o.region]
      vecB.y = mesh.centers[3 * o.region + 1]
      vecB.z = mesh.centers[3 * o.region + 2]
      if (greatCircleDistanceKm(vecA, vecB, mesh.physicalRadiusKm) < baseCapitalSpacingKm * 0.8) {
        spaced = false
        break
      }
    }
    if (spaced) {
      usedReligionRegions.add(s.regionId)
      religionOrigins.push({ region: s.regionId, cultureId: s.cultureId })
    }
  }
  if (religionOrigins.length === 0) {
    let bestR = 0
    for (let r = 1; r < n; r++) {
      if (population[r]! > population[bestR]!)
        bestR = r
    }
    const domC = peoplesCultures.dominantCultureIndex[bestR]!
    religionOrigins.push({
      region: bestR,
      cultureId: peoplesCultures.cultures[domC >= 0 ? domC : 0]!.id,
    })
  }

  const religionArchetypes: ReligionArchetypeView[] = []
  const religions: Religion[] = religionOrigins.map((origin, idx) => {
    const arch = chooseWeighted(
      bundle.religions.map(a => ({
        item: a,
        weight: scoreReligionArchetype(a, origin.region, terrain, habitability, resources),
      })),
      rng.fork(`religion-arch-${idx}`),
    )
    religionArchetypes.push(arch)
    const culture = cultureMap.get(origin.cultureId)?.culture ?? peoplesCultures.cultures[0]!
    const style = resolveStyle(bundle.namingStyles, culture.namingStyleId)
    const id = `religion:${idx}`
    const name = allocator.allocate(style, bundleSignature, id, 'religion')
    return {
      id,
      name,
      foundedAtYear: -Math.round(350 + rng.nextInt(0, 1600)),
      archetypeId: arch.id as ContentId,
    }
  })

  const relCount = religions.length
  const relCosts = Array.from({ length: relCount }, () => new Float32Array(n).fill(Infinity))
  for (let rel = 0; rel < relCount; rel++) {
    const dist = relCosts[rel]!
    const start = religionOrigins[rel]!.region
    const spreadBias = Math.max(0.15, religionArchetypes[rel]!.spreadBias)
    const speedFactor = 0.55 + spreadBias * 0.9
    queue.size = 0
    dist[start] = 0
    queue.push(start, 0)

    while (queue.size > 0) {
      const u = queue.pop()
      const dU = dist[u]!
      for (let e = mesh.neighborOffsets[u]; e < mesh.neighborOffsets[u + 1]; e++) {
        const v = mesh.neighbors[e]!
        if (terrain.landMask[v] !== 1 || lakes.lakeIndex[v] >= 0)
          continue
        const stepKm = greatCircleDistanceKm(
          { x: mesh.centers[3 * u], y: mesh.centers[3 * u + 1], z: mesh.centers[3 * u + 2] },
          { x: mesh.centers[3 * v], y: mesh.centers[3 * v + 1], z: mesh.centers[3 * v + 2] },
          mesh.physicalRadiusKm,
        )
        const resistance = 0.5 * (habitability.movementCost[u]! + habitability.movementCost[v]!)
        const nextCost = dU + ((stepKm * resistance) / kmPerDay) / speedFactor
        if (nextCost < dist[v]!) {
          dist[v] = nextCost
          queue.push(v, nextCost)
        }
      }
      const shortcuts = regionShortcuts.get(u)
      if (shortcuts) {
        for (const edge of shortcuts) {
          const nextCost = dU + edge.cost / speedFactor
          if (nextCost < dist[edge.toRegion]!) {
            dist[edge.toRegion] = nextCost
            queue.push(edge.toRegion, nextCost)
          }
        }
      }
    }
  }

  const relScale = Math.max(5.0, (mesh.physicalRadiusKm * 0.16) / kmPerDay)
  const dominantReligionIndex = new Int32Array(n).fill(-1)
  for (let r = 0; r < n; r++) {
    let minRelCost = Infinity
    for (let rel = 0; rel < relCount; rel++) {
      if (relCosts[rel]![r]! < minRelCost)
        minRelCost = relCosts[rel]![r]!
    }
    if (!Number.isFinite(minRelCost))
      continue
    let bestRel = -1
    let bestWeight = -1
    for (let rel = 0; rel < relCount; rel++) {
      const d = relCosts[rel]![r]!
      if (!Number.isFinite(d))
        continue
      const w = Math.exp(-(d - minRelCost) / relScale) * (0.6 + religionArchetypes[rel]!.spreadBias * 0.8)
      if (w > bestWeight) {
        bestWeight = w
        bestRel = rel
      }
    }
    dominantReligionIndex[r] = bestRel
  }

  // Step 2. Evaluate objective + capability-gated settlement features
  check?.(0.24)
  const settlementProfiles = evaluateSettlementFeatures({
    mesh,
    terrain,
    hydrology: extra?.hydrology,
    ecology: extra?.ecology,
    resources,
    habitability,
    transport,
    namedSettlements: peoplesCultures.namedSettlements,
    regionCultures: peoplesCultures.regionCultures,
    hearthRegions: peoplesCultures.hearthRegions,
    religionOriginRegions: usedReligionRegions,
    dominantReligionIndex,
    religionCosts: relCosts,
    religionArchetypes,
    capabilities,
    urbanConcentration,
  })

  // Step 3. Select polity capitals from top settlements
  const capitals = selectPolityCapitals(rankedSites, polityCount, mesh, components, siteScore, () => check?.(0.3))

  // Step 4. Emerge polity traits from each capital and its local settlement hinterland
  check?.(0.32)
  const traitContext = {
    mesh,
    terrain,
    habitability,
    capabilities,
    urbanConcentration,
    territoryComponentIndex: components.index,
    namedSettlements: peoplesCultures.namedSettlements,
    settlementProfiles,
    regionCultures: peoplesCultures.regionCultures,
    dominantReligionIndex,
    religionArchetypes,
    onPowerEvaluated: extra?.onPowerEvaluated,
  }
  const polityTraits: (readonly PolityTraitId[])[] = [
    ...emergePolityTraitsForCapitals(capitals, traitContext, rng.fork('polity-traits-main'), capitalSpacingKm * 0.9),
  ]
  const polityModifiers = polityTraits.map(traits => computePolityExpansionModifiers(traits))

  // Step 5. Trait-modulated multi-source territory expansion and maritime projection
  const capitalCultureIndices = capitals.map(cap => cultureMap.get(cap.cultureId)?.index ?? -1)
  const capitalReligionIndices = capitals.map(cap => dominantReligionIndex[cap.regionId]!)
  const targetAreasKm2 = createPolityAreaTargets(mesh, capitals.map(cap => cap.regionId), components, politySizeVariation,
    capitals.map((cap, p) => rng.fork(`polity-area-rank:${cap.id}`).nextFloat() * polityModifiers[p]!.baseRate))
  const culturalCost = (p: number, v: number, shortcut: boolean) => {
    const mod = polityModifiers[p]!
    return peoplesCultures.dominantCultureIndex[v] === capitalCultureIndices[p]
      ? (shortcut ? 0.82 : 0.78) * mod.sameCultureFactor
      : Math.max(shortcut ? 0.78 : 0.75, ((shortcut ? 1.12 : 1.08) + (0.6 - administrativeCapacity) * 0.6) * mod.diffCultureFactor)
  }
  const religiousCost = (p: number, v: number) => {
    const religion = capitalReligionIndices[p]!
    const local = dominantReligionIndex[v]!
    const mod = polityModifiers[p]!
    return religion >= 0 && local >= 0 ? (religion === local ? mod.sameReligionFactor : mod.diffReligionFactor) : 1
  }
  const regionPolity = growPolityTerritories({
    mesh,
    landMask: terrain.landMask,
    lakeIndex: lakes.lakeIndex,
    capitalRegions: capitals.map(cap => cap.regionId),
    targetAreasKm2,
    shortcuts: regionShortcuts,
    landStepCost(p, u, v) {
      const mod = polityModifiers[p]!
      const stepKm = greatCircleDistanceKm(
        { x: mesh.centers[3 * u], y: mesh.centers[3 * u + 1], z: mesh.centers[3 * u + 2] },
        { x: mesh.centers[3 * v], y: mesh.centers[3 * v + 1], z: mesh.centers[3 * v + 2] },
        mesh.physicalRadiusKm,
      )
      const resistance = 0.5 * (habitability.movementCost[u]! + habitability.movementCost[v]!)
      const terrainFactor = resistance >= 2.2 ? mod.roughTerrainFactor : (resistance <= 1.35 ? mod.flatSteppeFactor : 1)
      return stepKm * resistance * terrainFactor / kmPerDay * culturalCost(p, v, false) * religiousCost(p, v) / mod.baseRate
    },
    shortcutCost(p, _u, edge) {
      const mod = polityModifiers[p]!
      const penalty = edge.isSea ? (1.4 - administrativeCapacity * 0.35) * mod.seaShortcutFactor : 0.85 * mod.landShortcutFactor
      return edge.cost * penalty * culturalCost(p, edge.toRegion, true) * religiousCost(p, edge.toRegion) / mod.baseRate
    },
    check: () => check?.(0.45),
  })

  // Step 5b. Capability-driven maritime territorial projection and isolated island polities
  const referenceCellKm = Math.sqrt(SETTLEMENT_SUPPORT_AREA_KM2)
  const adminSeaFactor = 1.25 - 0.4 * administrativeCapacity

  // Pass 1: coastal & strait projection from all owned coasts (unbiased by polity sea trait)
  if (seafaringCapability > 0) {
    claimMaritimeTerritory(mesh, terrain.landMask, regionPolity, {
      maxWaterBudgetKm: referenceCellKm * 2.2 * seafaringCapability,
      seaCostMultiplier: adminSeaFactor,
      islandHopPenaltyKm: referenceCellKm * 0.4,
      movementCost: habitability.movementCost,
      check: () => check?.(0.48),
    })
  }

  // Isolated island capitals were included in the original budget; projection cannot create polities.

  // Pass 3: open-ocean projection launched primarily from owned ports, modulated by each polity's sea trait.
  if (seafaringCapability > 0) {
    const oceanBudgetKm = mesh.physicalRadiusKm * 5.0 * (seafaringCapability ** 3.5) * (0.65 + 0.6 * administrativeCapacity)
    const ownedPortMask = new Uint8Array(n)
    let hasOwnedPort = false
    for (const s of peoplesCultures.namedSettlements) {
      if (s.isPort && regionPolity[s.regionId]! >= 0) {
        ownedPortMask[s.regionId] = 1
        hasOwnedPort = true
      }
    }
    const politySeaCostFactors = polityModifiers.map(mod => mod.oceanProjectionFactor)
    claimMaritimeTerritory(mesh, terrain.landMask, regionPolity, {
      maxWaterBudgetKm: oceanBudgetKm,
      seaCostMultiplier: adminSeaFactor,
      islandHopPenaltyKm: referenceCellKm * 1.2,
      prioritySourceMask: hasOwnedPort ? ownedPortMask : undefined,
      nonPriorityPenaltyKm: hasOwnedPort ? Math.min(oceanBudgetKm * 0.25, referenceCellKm * 6) : 0,
      movementCost: habitability.movementCost,
      politySeaCostFactors,
      check: () => check?.(0.62),
    })
  }

  // Step 6. Tally territory stats, align PolityArchetype with traits, finalize settlements & PopulationGroup[]
  const polityAreaKm2 = new Float64Array(capitals.length)
  const polityPop = new Float64Array(capitals.length)
  for (let r = 0; r < n; r++) {
    const p = regionPolity[r]!
    if (p >= 0) {
      if (lakes.lakeIndex[r]! < 0)
        polityAreaKm2[p] += mesh.areaKm2[r]!
      polityPop[p] += population[r]!
    }
  }

  const capitalSet = new Set(capitals.map(c => c.id))
  const totalOwnedPop = Math.max(1, capitals.reduce((sum, _, idx) => sum + polityPop[idx]!, 0))
  const polities: Polity[] = capitals.map((cap, pIdx) => {
    const sizeClass = classifyPolitySize(polityAreaKm2[pIdx]!, polityPop[pIdx]! / totalOwnedPop)
    const traits: PolityTraitId[] = [
      ...polityTraits[pIdx]!,
      ...(bundle.polityTraits ?? [])
        .filter(trait => trait.dimension === 'territory' && trait.sizeClasses?.includes(sizeClass))
        .map(trait => trait.id as PolityTraitId),
    ]

    const candidates = bundle.polities.map(a => ({
      item: a,
      weight: scorePolityArchetype(
        a,
        sizeClass,
        habitability.coastalMask[cap.regionId] === 1,
        terrain.elevationKm[cap.regionId]! >= 0.7,
        administrativeCapacity,
        traits,
      ),
    })).filter(candidate => candidate.weight > 0)
    if (!candidates.length)
      throw new Error(`No polity archetype matches traits or territory size for capital ${cap.id}`)
    const arch = chooseWeighted(candidates, rng.fork(`polity-arch-${pIdx}`))

    const culture = cultureMap.get(cap.cultureId)!.culture
    const style = resolveStyle(bundle.namingStyles, culture.namingStyleId)
    const id = `polity:${pIdx}`
    const name = appendPoliticalForm(
      allocator.allocate(style, bundleSignature, id, 'polity'),
      polityFormTitle(bundle, arch.displayNameKey),
    )
    return {
      id,
      name,
      foundedAtYear: Math.min(-1, cap.foundedAtYear + rng.nextInt(20, 200)),
      archetypeId: arch.id as ContentId,
      cultureId: culture.id,
      capitalSettlementId: cap.id,
      sizeClass,
      traits: [...traits],
    }
  })

  // Update settlement tiers, polity links, and finalized feature slots (capitals get major-city slot allowance)
  const settlements: Settlement[] = peoplesCultures.namedSettlements.map((s) => {
    const pIdx = regionPolity[s.regionId]!
    const polityId = pIdx >= 0 ? polities[pIdx]!.id : null
    const isCapital = capitalSet.has(s.id)
    const profile = settlementProfiles.get(s.id)
    const features = profile
      ? (isCapital ? selectSettlementFeatures(profile.scores, true, lowSpecialization) : profile.features)
      : (['agrarian'] as const)
    return {
      ...s,
      polityId,
      tier: isCapital ? 'capital' : s.tier,
      features: [...features],
    }
  })

  // Assemble sparse conservative PopulationGroup[]
  check?.(0.78)
  const populationGroups: PopulationGroup[] = []

  for (let r = 0; r < n; r++) {
    const regionPop = population[r]!
    if (regionPop <= 0)
      continue

    const cShares = peoplesCultures.regionCultures[r] ?? []
    if (cShares.length === 0)
      continue

    const pIdx = regionPolity[r]!
    const polityId = pIdx >= 0 ? polities[pIdx]!.id : null

    // Compute regional religion shares (up to 2 faiths + small unaffiliated minority)
    let minRelCost = Infinity
    for (let rel = 0; rel < relCount; rel++) {
      if (relCosts[rel]![r]! < minRelCost)
        minRelCost = relCosts[rel]![r]!
    }
    const relEntries: { religionId: string | null, weight: number }[] = []
    if (!Number.isFinite(minRelCost)) {
      relEntries.push({ religionId: null, weight: 1 })
    }
    else {
      for (let rel = 0; rel < relCount; rel++) {
        const d = relCosts[rel]![r]!
        if (!Number.isFinite(d))
          continue
        const w = Math.exp(-(d - minRelCost) / relScale) * (0.6 + religionArchetypes[rel]!.spreadBias * 0.8)
        if (w >= 0.12)
          relEntries.push({ religionId: religions[rel]!.id, weight: w })
      }
      relEntries.sort((a, b) => b.weight - a.weight)
      if (relEntries.length > 2)
        relEntries.length = 2
      const topSum = relEntries.reduce((s, item) => s + item.weight, 0)
      if (topSum > 0) {
        const unaffiliatedShare = minRelCost > relScale * 2.5 ? 0.35 : 0.06
        for (const item of relEntries)
          item.weight = (item.weight / topSum) * (1 - unaffiliatedShare)
        relEntries.push({ religionId: null, weight: unaffiliatedShare })
      }
      else {
        relEntries.push({ religionId: null, weight: 1 })
      }
    }

    // Build sparse joint groups per region
    const rawGroups: { peopleId: string, cultureId: string, religionId: string | null, polityId: string | null, weight: number }[] = []
    for (const cs of cShares) {
      const culture = peoplesCultures.cultures[cs.cultureIndex]!
      for (const rs of relEntries) {
        const w = cs.share * rs.weight
        if (w >= 0.02 || rawGroups.length === 0) {
          rawGroups.push({
            peopleId: culture.peopleId,
            cultureId: culture.id,
            religionId: rs.religionId,
            polityId,
            weight: w,
          })
        }
      }
    }
    rawGroups.sort((a, b) => b.weight - a.weight)
    const keptGroups = rawGroups.slice(0, 5)
    const totalW = keptGroups.reduce((s, g) => s + g.weight, 0) || 1

    let assigned = 0
    for (let i = 0; i < keptGroups.length; i++) {
      const g = keptGroups[i]!
      const groupPop = i === keptGroups.length - 1
        ? Math.max(0, regionPop - assigned)
        : Math.round((regionPop * (g.weight / totalW)) * 1000) / 1000
      assigned += groupPop
      if (groupPop > 0 || i === keptGroups.length - 1) {
        populationGroups.push({
          regionId: r,
          peopleId: g.peopleId,
          cultureId: g.cultureId,
          religionId: g.religionId,
          polityId: g.polityId,
          population: groupPop,
        })
      }
    }
  }

  const territoryPolityIndex = new Int32Array(n).fill(-1)
  for (let r = 0; r < n; r++) {
    if (terrain.landMask[r] === 1)
      territoryPolityIndex[r] = regionPolity[r]!
  }

  check?.(1)
  return {
    meshId: mesh.meshId,
    algorithmVersion: POLITIES_RELIGIONS_VERSION,
    regionCount: n,
    enabled: true,
    religions,
    polities,
    settlements,
    population,
    populationGroups,
    territoryPolityIndex,
  }
}

export function validatePolitiesReligionsArtifact(output: PolitiesReligionsArtifact): void {
  const n = output.regionCount
  if (!output.meshId || output.algorithmVersion !== POLITIES_RELIGIONS_VERSION || !Number.isInteger(n) || n < 1)
    throw new Error('Invalid polities and religions metadata')
  if (!(output.population instanceof Float64Array) || output.population.length !== n)
    throw new Error('Population array dtype or length mismatch')
  if (!(output.territoryPolityIndex instanceof Int32Array) || output.territoryPolityIndex.length !== n)
    throw new Error('Territory ownership array dtype or length mismatch')
  for (let r = 0; r < n; r++) {
    const owner = output.territoryPolityIndex[r]!
    if (owner < -1 || owner >= output.polities.length)
      throw new Error(`Invalid territory ownership at region ${r}`)
  }
  if (!output.enabled && (output.religions.length > 0 || output.polities.length > 0 || output.settlements.length > 0 || output.populationGroups.length > 0 || output.territoryPolityIndex.some(owner => owner !== -1)))
    throw new Error('Disabled civilization must emit empty polities, religions, settlements and groups')
  const settlementMap = new Map(output.settlements.map(s => [s.id, s]))
  for (const settlement of output.settlements) {
    if (!Array.isArray(settlement.features) || settlement.features.length < 1 || settlement.features.length > 3)
      throw new Error(`Settlement ${settlement.id} must have 1-3 valid features`)
    const seen = new Set<string>()
    for (const f of settlement.features) {
      if (!SETTLEMENT_FEATURE_SET.has(f) || seen.has(f))
        throw new Error(`Settlement ${settlement.id} has invalid or duplicate feature "${String(f)}"`)
      seen.add(f)
    }
  }
  for (const polity of output.polities) {
    if (polity.capitalSettlementId !== null && settlementMap.get(polity.capitalSettlementId)?.polityId !== polity.id)
      throw new Error(`Polity ${polity.id} capital ownership mismatch`)
    if (!Array.isArray(polity.traits) || polity.traits.length < 1 || polity.traits.length > 4)
      throw new Error(`Polity ${polity.id} must have 1-4 valid traits`)
    const seen = new Set<string>()
    for (const t of polity.traits) {
      if (!POLITY_TRAIT_SET.has(t) || seen.has(t))
        throw new Error(`Polity ${polity.id} has invalid or duplicate trait "${String(t)}"`)
      seen.add(t)
    }
  }
  const totals = new Float64Array(n)
  for (const g of output.populationGroups) {
    if (!Number.isFinite(g.population) || g.population < 0 || g.regionId < 0 || g.regionId >= n)
      throw new Error(`Invalid population group at region ${g.regionId}`)
    totals[g.regionId] += g.population
  }
  for (let r = 0; r < n; r++) {
    const pop = output.population[r]!
    if (Math.abs(totals[r]! - pop) > Math.max(1e-6, pop * 1e-9))
      throw new Error(`Population group conservation mismatch at region ${r}`)
  }
}
