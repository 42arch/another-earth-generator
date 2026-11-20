import type { CivilizationContentBundle, ContentId, CultureArchetypeView, NamingStyleView, PeopleArchetypeView } from '#content/content-port'
import type { TerrainArtifact } from '#generation/nature/geography'
import type { StaticLakeArtifact } from '#generation/nature/hydrology/lakes'
import type { ResourcePotentialArtifact } from '#generation/nature/resources/resource-potential'
import type { SphericalMesh } from '#mesh/spherical-mesh'
import type { Culture, People, Settlement } from './civilization-types'
import type { HabitabilityArtifact } from './habitability'
import type { PopulationSettlementsArtifact, SettlementSite } from './population-settlements'
import type { TransportNetworkArtifact } from './transport-network'
import { civilizationContentSignature } from '#content/content-port'
import { UniqueNameAllocator } from '#generation/names/unique-naming'
import { IndexPriorityQueue } from '#generation/nature/common/priority-queue'
import { DeterministicRandom } from '#math/random'
import { greatCircleDistanceKm } from '#math/spherical'
import { REFERENCE_TRAVEL_KM_PER_DAY, SETTLEMENT_SUPPORT_AREA_KM2 } from './population-settlements'

export const PEOPLES_CULTURES_VERSION = 'peoples-cultures-v2' as const

export interface RegionCultureShare {
  readonly cultureIndex: number
  readonly share: number
}

export interface PeoplesCulturesArtifact {
  readonly meshId: string
  readonly algorithmVersion: typeof PEOPLES_CULTURES_VERSION
  readonly regionCount: number
  readonly enabled: boolean
  readonly peoples: readonly People[]
  readonly cultures: readonly Culture[]
  readonly namedSettlements: readonly Omit<Settlement, 'polityId'>[]
  /** Indexed by regionId; empty when population[r] === 0. Shares sum to 1. */
  readonly regionCultures: readonly (readonly RegionCultureShare[])[]
  readonly dominantCultureIndex: Int32Array
  readonly usedNames: readonly string[]
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

function scoreCultureArchetype(
  archetype: CultureArchetypeView,
  region: number,
  terrain: Pick<TerrainArtifact, 'elevationKm'>,
  habitability: Pick<HabitabilityArtifact, 'coastalMask'>,
  resources: Pick<ResourcePotentialArtifact, 'agriculturalPotential' | 'forestryPotential' | 'fisheryPotential'>,
): number {
  const key = `${archetype.id} ${archetype.tags.join(' ')} ${archetype.traits.join(' ')}`.toLowerCase()
  const isCoastal = habitability.coastalMask[region] === 1
  const elev = terrain.elevationKm[region]!
  const agri = resources.agriculturalPotential[region]!
  const forest = resources.forestryPotential[region]!
  const fish = resources.fisheryPotential[region]!

  let score = 1.0
  if (key.includes('archipelago') || key.includes('maritime') || key.includes('ocean') || key.includes('island'))
    score += isCoastal ? 2.4 + fish : -0.6
  if (key.includes('highland') || key.includes('mountain') || key.includes('pastoral'))
    score += elev >= 0.7 ? 2.2 : elev * 1.2
  if (key.includes('woodland') || key.includes('forest') || key.includes('craft'))
    score += forest * 2.5
  if (key.includes('river') || key.includes('agrarian') || key.includes('valley') || key.includes('alluvial'))
    score += agri * 2.2
  return Math.max(0.15, score)
}

function scorePeopleArchetype(
  archetype: PeopleArchetypeView,
  region: number,
  terrain: Pick<TerrainArtifact, 'elevationKm'>,
  habitability: Pick<HabitabilityArtifact, 'coastalMask'>,
  resources: Pick<ResourcePotentialArtifact, 'forestryPotential' | 'agriculturalPotential'>,
): number {
  const key = `${archetype.id} ${archetype.tags.join(' ')} ${archetype.description ?? ''}`.toLowerCase()
  const isCoastal = habitability.coastalMask[region] === 1
  const elev = terrain.elevationKm[region]!
  const forest = resources.forestryPotential[region]!
  const agri = resources.agriculturalPotential[region]!

  let score = 1.0
  if (key.includes('novari') || key.includes('coastal') || key.includes('海上') || key.includes('沿海'))
    score += isCoastal ? 2.2 : -0.5
  if (key.includes('taren') || key.includes('highland') || key.includes('高地'))
    score += elev >= 0.6 ? 2.0 : elev * 0.9
  if (key.includes('lomiri') || key.includes('forest') || key.includes('林地'))
    score += forest * 2.2
  if (key.includes('avilan') || key.includes('land') || key.includes('贸易'))
    score += agri * 1.5 + 0.4
  return Math.max(0.2, score)
}

function resolveStyle(styles: readonly NamingStyleView[], preferredId: ContentId): NamingStyleView {
  return styles.find(style => style.id === preferredId) ?? styles[0]!
}

export function generatePeoplesCultures(
  bundle: CivilizationContentBundle,
  bundleSignature: string,
  mesh: Pick<SphericalMesh, 'meshId' | 'regionCount' | 'centers' | 'areaKm2' | 'neighborOffsets' | 'neighbors' | 'physicalRadiusKm'>,
  terrain: Pick<TerrainArtifact, 'meshId' | 'landMask' | 'elevationKm'>,
  lakes: Pick<StaticLakeArtifact, 'meshId' | 'lakeIndex'>,
  resources: Pick<ResourcePotentialArtifact, 'meshId' | 'agriculturalPotential' | 'forestryPotential' | 'fisheryPotential'>,
  habitability: Pick<HabitabilityArtifact, 'meshId' | 'habitability' | 'movementCost' | 'coastalMask'>,
  settlements: Pick<PopulationSettlementsArtifact, 'meshId' | 'enabled' | 'population' | 'settlementSites'>,
  transport: Pick<TransportNetworkArtifact, 'meshId' | 'enabled' | 'nodes' | 'routes'>,
  worldSeed: string,
  check?: (fraction: number) => void,
): PeoplesCulturesArtifact {
  const n = mesh.regionCount
  if (!n || terrain.meshId !== mesh.meshId || lakes.meshId !== mesh.meshId || resources.meshId !== mesh.meshId || habitability.meshId !== mesh.meshId || settlements.meshId !== mesh.meshId || transport.meshId !== mesh.meshId)
    throw new Error('Peoples and cultures stage received mismatched mesh artifacts')
  if (bundleSignature !== civilizationContentSignature(bundle))
    throw new Error('Civilization content signature mismatch')

  const dominantCultureIndex = new Int32Array(n).fill(-1)
  if (!settlements.enabled) {
    check?.(1)
    return {
      meshId: mesh.meshId,
      algorithmVersion: PEOPLES_CULTURES_VERSION,
      regionCount: n,
      enabled: false,
      peoples: [],
      cultures: [],
      namedSettlements: [],
      regionCultures: Array.from({ length: n }, () => []),
      dominantCultureIndex,
      usedNames: [],
    }
  }

  if (bundle.peoples.length === 0 || bundle.cultures.length === 0 || bundle.namingStyles.length === 0)
    throw new Error('Civilization content bundle must provide peoples, cultures and namingStyles')

  let inhabitedCount = 0
  let maxPopRegion = -1
  let maxPop = 0
  for (let r = 0; r < n; r++) {
    const p = settlements.population[r]!
    if (p > 0) {
      inhabitedCount++
      if (p > maxPop) {
        maxPop = p
        maxPopRegion = r
      }
    }
  }

  if (inhabitedCount === 0) {
    check?.(1)
    return {
      meshId: mesh.meshId,
      algorithmVersion: PEOPLES_CULTURES_VERSION,
      regionCount: n,
      enabled: true,
      peoples: [],
      cultures: [],
      namedSettlements: [],
      regionCultures: Array.from({ length: n }, () => []),
      dominantCultureIndex,
      usedNames: [],
    }
  }

  const rng = new DeterministicRandom(JSON.stringify([worldSeed, PEOPLES_CULTURES_VERSION]))
  const allocator = new UniqueNameAllocator(worldSeed)

  // Pick well-spaced cultural hearth regions
  const sitesSorted: SettlementSite[] = [...settlements.settlementSites].sort((a, b) => (b.score !== a.score ? b.score - a.score : a.regionId - b.regionId))
  const targetCultureCount = sitesSorted.length === 0
    ? 1
    : Math.max(1, Math.min(sitesSorted.length, Math.min(12, Math.max(2, Math.round(Math.sqrt(sitesSorted.length) * 1.1)))))
  const hearthSpacingKm = Math.max(Math.sqrt(SETTLEMENT_SUPPORT_AREA_KM2) * 4, mesh.physicalRadiusKm * 0.25)

  const hearths: number[] = []
  const vecA = { x: 0, y: 0, z: 0 }
  const vecB = { x: 0, y: 0, z: 0 }

  for (const site of sitesSorted) {
    if (hearths.length >= targetCultureCount)
      break
    vecA.x = mesh.centers[3 * site.regionId]
    vecA.y = mesh.centers[3 * site.regionId + 1]
    vecA.z = mesh.centers[3 * site.regionId + 2]
    let farEnough = true
    for (const h of hearths) {
      vecB.x = mesh.centers[3 * h]
      vecB.y = mesh.centers[3 * h + 1]
      vecB.z = mesh.centers[3 * h + 2]
      if (greatCircleDistanceKm(vecA, vecB, mesh.physicalRadiusKm) < hearthSpacingKm) {
        farEnough = false
        break
      }
    }
    if (farEnough)
      hearths.push(site.regionId)
  }
  for (const site of sitesSorted) {
    if (hearths.length >= targetCultureCount)
      break
    if (!hearths.includes(site.regionId))
      hearths.push(site.regionId)
  }
  if (hearths.length === 0 && maxPopRegion >= 0)
    hearths.push(maxPopRegion)

  // Build transport shortcut adjacency between settlement regions
  const regionShortcuts = new Map<number, { readonly toRegion: number, readonly cost: number }[]>()
  const nodeRegion = new Map(transport.nodes.map(node => [node.id, node.regionId]))
  for (const route of transport.routes) {
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
    listA.push({ toRegion: b, cost: weight })
    let listB = regionShortcuts.get(b)
    if (!listB) {
      listB = []
      regionShortcuts.set(b, listB)
    }
    listB.push({ toRegion: a, cost: weight })
  }

  // Instantiate Peoples and Cultures anchored at hearths
  const peoples: People[] = []
  const cultures: Culture[] = []
  const peopleByArchetype = new Map<string, People[]>()

  const kmPerDay = REFERENCE_TRAVEL_KM_PER_DAY

  for (let idx = 0; idx < hearths.length; idx++) {
    const region = hearths[idx]!
    const cultureArchetype = chooseWeighted(
      bundle.cultures.map(arch => ({ item: arch, weight: scoreCultureArchetype(arch, region, terrain, habitability, resources) })),
      rng.fork(`culture-arch-${idx}`),
    )
    const style = resolveStyle(bundle.namingStyles, cultureArchetype.namingStyleId)

    const peopleArchetype = chooseWeighted(
      bundle.peoples.map(arch => ({ item: arch, weight: scorePeopleArchetype(arch, region, terrain, habitability, resources) })),
      rng.fork(`people-arch-${idx}`),
    )
    const existingGroup = peopleByArchetype.get(peopleArchetype.id) ?? []
    let people: People
    if (existingGroup.length === 0 || (peoples.length < Math.max(2, Math.ceil(hearths.length * 0.65)) && idx % 2 === 1)) {
      const peopleId = `people:${peoples.length}`
      const peopleName = allocator.allocate(style, bundleSignature, peopleId, 'people')
      people = {
        id: peopleId,
        name: peopleName,
        foundedAtYear: -Math.round(1800 + rng.nextInt(0, 2400)),
        archetypeId: peopleArchetype.id as ContentId,
      }
      peoples.push(people)
      existingGroup.push(people)
      peopleByArchetype.set(peopleArchetype.id, existingGroup)
    }
    else {
      people = existingGroup[idx % existingGroup.length]!
    }

    const cultureId = `culture:${idx}`
    const cultureName = allocator.allocate(style, bundleSignature, cultureId, 'culture')
    cultures.push({
      id: cultureId,
      name: cultureName,
      foundedAtYear: -Math.round(800 + rng.nextInt(0, 1400)),
      archetypeId: cultureArchetype.id as ContentId,
      peopleId: people.id,
      namingStyleId: style.id as ContentId,
    })
  }

  // Spread each culture from its hearth via overland + transport shortcuts
  const k = cultures.length
  const costs = Array.from({ length: k }, () => new Float32Array(n).fill(Infinity))
  const queue = new IndexPriorityQueue(Math.min(n, 4096))

  for (let c = 0; c < k; c++) {
    check?.(0.2 + (c / k) * 0.5)
    const dist = costs[c]!
    const start = hearths[c]!
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
        vecA.x = mesh.centers[3 * u]
        vecA.y = mesh.centers[3 * u + 1]
        vecA.z = mesh.centers[3 * u + 2]
        vecB.x = mesh.centers[3 * v]
        vecB.y = mesh.centers[3 * v + 1]
        vecB.z = mesh.centers[3 * v + 2]
        const stepKm = greatCircleDistanceKm(vecA, vecB, mesh.physicalRadiusKm)
        const resistance = 0.5 * (habitability.movementCost[u]! + habitability.movementCost[v]!)
        const nextCost = dU + (stepKm * resistance) / kmPerDay
        if (nextCost < dist[v]!) {
          dist[v] = nextCost
          queue.push(v, nextCost)
        }
      }

      const shortcuts = regionShortcuts.get(u)
      if (shortcuts) {
        for (const edge of shortcuts) {
          const nextCost = dU + edge.cost
          if (nextCost < dist[edge.toRegion]!) {
            dist[edge.toRegion] = nextCost
            queue.push(edge.toRegion, nextCost)
          }
        }
      }
    }
  }

  // Mix cultural shares smoothly along borders; preserve clear majority + boundary minorities
  const blendScale = Math.max(4.5, (mesh.physicalRadiusKm * 0.14) / kmPerDay)
  const regionCultures: RegionCultureShare[][] = Array.from({ length: n }, () => [])

  for (let r = 0; r < n; r++) {
    if ((r & 1023) === 0)
      check?.(0.7 + (r / n) * 0.2)
    if (settlements.population[r]! <= 0)
      continue

    let minCost = Infinity
    let bestC = 0
    for (let c = 0; c < k; c++) {
      const d = costs[c]![r]!
      if (d < minCost) {
        minCost = d
        bestC = c
      }
    }

    if (!Number.isFinite(minCost)) {
      // Unreachable island: assign deterministically by nearest spherical hearth
      let bestDist = Infinity
      vecA.x = mesh.centers[3 * r]
      vecA.y = mesh.centers[3 * r + 1]
      vecA.z = mesh.centers[3 * r + 2]
      for (let c = 0; c < k; c++) {
        const h = hearths[c]!
        vecB.x = mesh.centers[3 * h]
        vecB.y = mesh.centers[3 * h + 1]
        vecB.z = mesh.centers[3 * h + 2]
        const d = greatCircleDistanceKm(vecA, vecB, mesh.physicalRadiusKm)
        if (d < bestDist) {
          bestDist = d
          bestC = c
        }
      }
      dominantCultureIndex[r] = bestC
      regionCultures[r] = [{ cultureIndex: bestC, share: 1 }]
      continue
    }

    const rawWeights: { cultureIndex: number, weight: number }[] = []
    let weightSum = 0
    for (let c = 0; c < k; c++) {
      const d = costs[c]![r]!
      if (!Number.isFinite(d))
        continue
      const delta = d - minCost
      if (delta > blendScale * 3)
        continue
      const w = Math.exp(-delta / blendScale)
      if (w >= 0.08) {
        rawWeights.push({ cultureIndex: c, weight: w })
        weightSum += w
      }
    }

    rawWeights.sort((a, b) => (b.weight !== a.weight ? b.weight - a.weight : a.cultureIndex - b.cultureIndex))
    const kept = rawWeights.slice(0, 3)
    const keptSum = kept.reduce((sum, item) => sum + item.weight, 0) || weightSum || 1
    let normalizedSum = 0
    const shares: RegionCultureShare[] = kept.map((item, idx) => {
      if (idx === kept.length - 1) {
        return { cultureIndex: item.cultureIndex, share: Math.max(0, 1 - normalizedSum) }
      }
      const share = item.weight / keptSum
      normalizedSum += share
      return { cultureIndex: item.cultureIndex, share }
    })
    dominantCultureIndex[r] = shares[0]!.cultureIndex
    regionCultures[r] = shares
  }

  // Name every settlement using its dominant culture's NamingStyle
  const namedSettlements: Omit<Settlement, 'polityId'>[] = settlements.settlementSites.map((site) => {
    const domIdx = dominantCultureIndex[site.regionId]!
    const culture = cultures[domIdx >= 0 ? domIdx : 0]!
    const style = resolveStyle(bundle.namingStyles, culture.namingStyleId)
    const name = allocator.allocate(style, bundleSignature, site.id, 'settlement')
    return {
      id: site.id,
      name,
      foundedAtYear: site.foundedAtYear,
      regionId: site.regionId,
      cultureId: culture.id,
      tier: site.tier,
      isPort: site.isPort,
      population: site.population,
    }
  })

  check?.(1)
  return {
    meshId: mesh.meshId,
    algorithmVersion: PEOPLES_CULTURES_VERSION,
    regionCount: n,
    enabled: true,
    peoples,
    cultures,
    namedSettlements,
    regionCultures,
    dominantCultureIndex,
    usedNames: allocator
      ? [...new Set([
          ...peoples.map(p => p.name),
          ...cultures.map(c => c.name),
          ...namedSettlements.map(s => s.name),
        ])]
      : [],
  }
}

export function validatePeoplesCulturesArtifact(output: PeoplesCulturesArtifact): void {
  const n = output.regionCount
  if (!output.meshId || output.algorithmVersion !== PEOPLES_CULTURES_VERSION || !Number.isInteger(n) || n < 1)
    throw new Error('Invalid peoples and cultures metadata')
  if (!(output.dominantCultureIndex instanceof Int32Array) || output.dominantCultureIndex.length !== n)
    throw new Error('Dominant culture index dtype or length mismatch')
  if (!output.enabled && (output.peoples.length > 0 || output.cultures.length > 0 || output.namedSettlements.length > 0))
    throw new Error('Disabled civilization must emit empty peoples and cultures')
  const peopleIds = new Set(output.peoples.map(p => p.id))
  for (const culture of output.cultures) {
    if (!peopleIds.has(culture.peopleId))
      throw new Error(`Culture ${culture.id} references missing people ${culture.peopleId}`)
  }
  const names = new Set<string>()
  for (const item of [...output.peoples, ...output.cultures, ...output.namedSettlements]) {
    if (!item.name.trim() || names.has(item.name))
      throw new Error(`Duplicate or empty civilization name: ${item.name}`)
    names.add(item.name)
  }
}
