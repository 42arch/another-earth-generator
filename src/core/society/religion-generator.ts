import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import type { Religion, ReligionData, SacredSite, Settlement } from '@/core/society/society-data'
import { MinPriorityQueue } from '@/core/math/priority-queue'
import { landTravelCost, PHYSICAL_RADIUS_KM } from '@/core/society/travel-cost'

interface Frontier {
  region: number
  religion: number
  cost: number
}

interface SeaLink {
  region: number
  costKm: number
}

const MAX_LOCAL_RELIGIONS = 3
const MAX_SPREAD_COST_KM = 9000
const MIN_ORIGIN_SPACING_KM = 850
const BRANCH_DISTANCE_KM = 1700
const NAME_PREFIX = ['星', '山', '河', '月', '林', '海', '火', '石', '风', '光', '云', '泉']

/** One deterministic snapshot of exclusive primary affiliation, not overlapping practices. */
export class ReligionGenerator {
  generate(mesh: SphericalMesh, data: WorldSimulationState, config: WorldConfig): ReligionData {
    const society = data.society
    if (!society?.transport || !society.ethnicity || !society.polities)
      throw new Error('ReligionsAndBeliefs requires transport, ethnicity, and polities')

    for (const polity of society.polities.polities)
      polity.patronReligionId = undefined
    const { origins, landComponent } = this.selectOrigins(mesh, data, config.core.seed)
    const religions: Religion[] = []
    const sacredSites: SacredSite[] = []
    for (const settlement of origins) {
      const id = religions.length
      const region = settlement.region
      let parentReligionId = -1
      let nearestKm = BRANCH_DISTANCE_KM
      for (const older of religions) {
        const olderRegion = society.settlements[older.originSettlementId].region
        if (landComponent[region] !== landComponent[olderRegion])
          continue
        const distanceKm = mesh.distanceBetweenRegions(region, olderRegion) * PHYSICAL_RADIUS_KM
        if (distanceKm < nearestKm) {
          nearestKm = distanceKm
          parentReligionId = older.id
        }
      }
      const prefix = NAME_PREFIX[this.hash(region ^ config.core.seed ^ 0x52454C47) % NAME_PREFIX.length]
      religions.push({
        id,
        name: parentReligionId >= 0
          ? `${settlement.name}派`
          : `${prefix}${settlement.name}教`,
        originSettlementId: settlement.id,
        parentReligionId,
        originEthnicGroupId: society.ethnicity.dominantGroup[region],
        sacredSiteIds: [id],
      })
      sacredSites.push({ id, religionId: id, settlementId: settlement.id, region, name: `${settlement.name}圣所` })
      const polityId = society.polities.polityByRegion[region]
      const polity = society.polities.polities[polityId]
      if (polity && polity.patronReligionId === undefined)
        polity.patronReligionId = id
    }

    const count = mesh.numRegions
    const localIds = new Int32Array(count * MAX_LOCAL_RELIGIONS).fill(-1)
    const localCosts = new Float64Array(count * MAX_LOCAL_RELIGIONS).fill(Infinity)
    const queue = new MinPriorityQueue<Frontier>()
    const offer = (region: number, religion: number, cost: number) => {
      if (cost > MAX_SPREAD_COST_KM)
        return
      const base = region * MAX_LOCAL_RELIGIONS
      let slot = -1
      for (let index = 0; index < MAX_LOCAL_RELIGIONS; index++) {
        if (localIds[base + index] === religion) {
          slot = index
          break
        }
      }
      if (slot < 0)
        slot = MAX_LOCAL_RELIGIONS - 1
      if (cost >= localCosts[base + slot])
        return
      localIds[base + slot] = religion
      localCosts[base + slot] = cost
      while (slot > 0 && localCosts[base + slot] < localCosts[base + slot - 1]) {
        const previousCost = localCosts[base + slot - 1]
        const previousId = localIds[base + slot - 1]
        localCosts[base + slot - 1] = localCosts[base + slot]
        localIds[base + slot - 1] = localIds[base + slot]
        localCosts[base + slot] = previousCost
        localIds[base + slot] = previousId
        slot--
      }
      queue.push({ region, religion, cost })
    }
    const seaLinks = this.seaLinks(society.settlements, society.transport.routes)
    for (const religion of religions)
      offer(society.settlements[religion.originSettlementId].region, religion.id, 0)
    const land = data.geography.landMask
    const marketAccess = society.transport.marketAccess
    const polityByRegion = society.polities.polityByRegion
    while (queue.size > 0) {
      const current = queue.pop()
      const { region, religion, cost } = current
      const base = region * MAX_LOCAL_RELIGIONS
      let active = false
      for (let slot = 0; slot < MAX_LOCAL_RELIGIONS; slot++) {
        if (localIds[base + slot] === religion && localCosts[base + slot] === cost) {
          active = true
          break
        }
      }
      if (!active)
        continue
      for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
        const next = mesh.neighbors[edge]
        if (!land[next])
          continue
        const polityId = polityByRegion[next]
        const borderFactor = polityId !== polityByRegion[region] ? 1.14 : 1
        const patronFactor = society.polities.polities[polityId]?.patronReligionId === religion ? 0.82 : 1
        const contactFactor = 1 - 0.22 * marketAccess[next]
        const edgeCost = landTravelCost(mesh, data, config, region, next, edge, society.transport.roadRegionMask)
          * borderFactor * patronFactor * contactFactor
        offer(next, religion, cost + edgeCost)
      }
      for (const link of seaLinks.get(region) ?? [])
        offer(link.region, religion, cost + link.costKm * (1 - 0.15 * marketAccess[link.region]))
    }

    const regionOffsets = new Uint32Array(count + 1)
    for (let region = 0; region < count; region++) {
      if (society.population[region] > 0)
        regionOffsets[region + 1] = this.localShares(region, localIds, localCosts, religions, data).length
      regionOffsets[region + 1] += regionOffsets[region]
    }
    const affiliationIds = new Int32Array(regionOffsets[count])
    const residents = new Float64Array(regionOffsets[count])
    const dominantAffiliation = new Int32Array(count).fill(-2)
    const dominantShare = new Float32Array(count)
    for (let region = 0; region < count; region++) {
      const start = regionOffsets[region]
      if (start === regionOffsets[region + 1])
        continue
      const population = society.population[region]
      const local = this.localShares(region, localIds, localCosts, religions, data)
      let allocated = 0
      for (let index = 0; index < local.length; index++) {
        const entry = local[index]
        const amount = index === local.length - 1 ? population - allocated : population * entry.share
        affiliationIds[start + index] = entry.id
        residents[start + index] = amount
        allocated += amount
      }
      dominantAffiliation[region] = local[0].id
      dominantShare[region] = residents[start] / population
    }
    return { religions, sacredSites, regionOffsets, affiliationIds, residents, dominantAffiliation, dominantShare }
  }

  private localShares(
    region: number,
    ids: Int32Array,
    costs: Float64Array,
    religions: Religion[],
    data: WorldSimulationState,
  ): Array<{ id: number, share: number }> {
    const base = region * MAX_LOCAL_RELIGIONS
    if (ids[base] < 0)
      return [{ id: -1, share: 1 }]
    const society = data.society!
    const access = society.transport!.marketAccess[region]
    const bestCost = costs[base]
    const faithMass = 3 * Math.exp(-bestCost / 5500)
    const weighted: Array<{ id: number, weight: number }> = []
    for (let slot = 0; slot < MAX_LOCAL_RELIGIONS; slot++) {
      const id = ids[base + slot]
      if (id < 0)
        break
      const groupId = religions[id].originEthnicGroupId
      let inheritedShare = 0
      if (groupId >= 0 && society.ethnicity) {
        for (let index = society.ethnicity.regionOffsets[region]; index < society.ethnicity.regionOffsets[region + 1]; index++) {
          if (society.ethnicity.groupIds[index] === groupId)
            inheritedShare = society.ethnicity.residents[index] / society.population[region]
        }
      }
      const gap = Math.max(0, costs[base + slot] - bestCost)
      const weight = faithMass * Math.exp(-gap / (420 * (1 + 0.3 * access))) * (1 + 0.45 * inheritedShare)
      weighted.push({ id, weight })
    }
    weighted.push({ id: -1, weight: 0.35 + 0.25 * (1 - access) })
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0)
    const kept = weighted.filter(entry => entry.id === -1 || entry.weight / total >= 0.01)
    const keptTotal = kept.reduce((sum, entry) => sum + entry.weight, 0)
    return kept.map(entry => ({ id: entry.id, share: entry.weight / keptTotal }))
      .sort((a, b) => b.share - a.share || a.id - b.id)
  }

  private selectOrigins(mesh: SphericalMesh, data: WorldSimulationState, seed: number): { origins: Settlement[], landComponent: Int32Array } {
    const society = data.society!
    const land = data.geography.landMask
    const component = new Int32Array(mesh.numRegions).fill(-1)
    const stack: number[] = []
    let componentCount = 0
    for (let region = 0; region < mesh.numRegions; region++) {
      if (!land[region] || component[region] >= 0)
        continue
      component[region] = componentCount
      stack.push(region)
      while (stack.length > 0) {
        const current = stack.pop()!
        for (const next of mesh.forEachNeighborOfRegion(current)) {
          if (land[next] && component[next] < 0) {
            component[next] = componentCount
            stack.push(next)
          }
        }
      }
      componentCount++
    }
    const ranked = [...society.settlements].sort((a, b) => {
      const score = (settlement: Settlement) => settlement.hinterlandPopulation
        * (0.75 + society.transport!.marketAccess[settlement.region])
        * (0.985 + this.hash(settlement.region ^ seed ^ 0x52454C47) / 0xFFFFFFFF * 0.03)
      return score(b) - score(a) || a.id - b.id
    })
    const origins: Settlement[] = []
    const representedComponents = new Set<number>()
    const target = Math.min(24, Math.max(2, Math.round(Math.sqrt(ranked.length))))
    for (const settlement of ranked) {
      const landComponent = component[settlement.region]
      if (landComponent < 0 || society.population[settlement.region] <= 0)
        continue
      const required = !representedComponents.has(landComponent)
      if (!required && origins.length >= target)
        continue
      if (!required && origins.some(origin => mesh.distanceBetweenRegions(origin.region, settlement.region) * PHYSICAL_RADIUS_KM < MIN_ORIGIN_SPACING_KM))
        continue
      origins.push(settlement)
      representedComponents.add(landComponent)
    }
    return { origins, landComponent: component }
  }

  private seaLinks(settlements: Settlement[], routes: { kind: string, fromSettlement: number, toSettlement: number, costKm: number }[]): Map<number, SeaLink[]> {
    const links = new Map<number, SeaLink[]>()
    for (const route of routes) {
      if (route.kind !== 'sea')
        continue
      const from = settlements[route.fromSettlement]?.region
      const to = settlements[route.toSettlement]?.region
      if (from === undefined || to === undefined)
        continue
      const costKm = route.costKm + 120
      links.set(from, [...(links.get(from) ?? []), { region: to, costKm }])
      links.set(to, [...(links.get(to) ?? []), { region: from, costKm }])
    }
    return links
  }

  private hash(value: number): number {
    let hash = value | 0
    hash ^= hash >>> 16
    hash = Math.imul(hash, 0x7FEB352D)
    hash ^= hash >>> 15
    hash = Math.imul(hash, 0x846CA68B)
    hash ^= hash >>> 16
    return hash >>> 0
  }
}
