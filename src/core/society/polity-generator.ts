import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import type { AdministrativeDistrict, Polity, PolityData, Settlement } from '@/core/society/society-data'
import { MinPriorityQueue } from '@/core/math/priority-queue'
import { landTravelCost, PHYSICAL_RADIUS_KM } from '@/core/society/travel-cost'

interface Frontier {
  region: number
  owner: number
  cost: number
}

interface SeaLink {
  region: number
  costKm: number
}

const MIN_CAPITAL_SPACING_KM = 900
const SEA_LOADING_COST_KM = 120
const GOVERNING_FORMS: Polity['governingForm'][] = ['kingdom', 'republic', 'league', 'city-state']
const FORM_SUFFIX: Record<Polity['governingForm'], string> = {
  kingdom: '王国',
  republic: '共和国',
  league: '联盟',
  'city-state': '城邦',
}

/** Assigns governance on the land graph; only selected port routes join islands. */
export class PolityGenerator {
  generate(mesh: SphericalMesh, data: WorldSimulationState, config: WorldConfig): PolityData {
    const society = data.society
    if (!society?.transport || !society.ethnicity)
      throw new Error('PolitiesAndAdministration requires transport and ethnicity')

    const land = data.geography.landMask
    const component = this.landComponents(mesh, land)
    const capitals = this.chooseCapitals(mesh, society.settlements, society.transport.marketAccess, component)
    const polities: Polity[] = capitals.map((capital, id) => {
      const languageId = society.ethnicity!.dominantLanguage[capital.region]
      const governingForm = GOVERNING_FORMS[(id + config.core.seed) % GOVERNING_FORMS.length]
      return {
        id,
        name: `${capital.name}${FORM_SUFFIX[governingForm]}`,
        capitalSettlementId: capital.id,
        governingForm,
        officialLanguageId: languageId,
        governanceBudgetKm: Math.min(3500, 850 + 200 * Math.log1p(capital.hinterlandPopulation / 1000)),
        population: 0,
        areaKm2: 0,
      }
    })
    const seaLinks = this.seaLinks(society.settlements, society.transport.routes)
    const polityByRegion = new Int32Array(mesh.numRegions).fill(-1)
    const controlStrength = new Float32Array(mesh.numRegions)
    const cost = new Float64Array(mesh.numRegions).fill(Infinity)
    const queue = new MinPriorityQueue<Frontier>()
    for (const polity of polities) {
      const region = society.settlements[polity.capitalSettlementId].region
      polityByRegion[region] = polity.id
      cost[region] = 0
      queue.push({ region, owner: polity.id, cost: 0 })
    }
    const offer = (region: number, owner: number, nextCost: number) => {
      if (!land[region] || nextCost > 1 || nextCost >= cost[region] - 1e-10)
        return
      polityByRegion[region] = owner
      cost[region] = nextCost
      queue.push({ region, owner, cost: nextCost })
    }
    while (queue.size > 0) {
      const current = queue.pop()
      if (polityByRegion[current.region] !== current.owner || current.cost !== cost[current.region])
        continue
      const budget = polities[current.owner].governanceBudgetKm
      for (let edge = mesh.neighborOffsets[current.region]; edge < mesh.neighborOffsets[current.region + 1]; edge++) {
        const next = mesh.neighbors[edge]
        if (land[next]) {
          offer(next, current.owner, current.cost + landTravelCost(
            mesh, data, config, current.region, next, edge, society.transport.roadRegionMask,
          ) / budget)
        }
      }
      for (const link of seaLinks.get(current.region) ?? [])
        offer(link.region, current.owner, current.cost + link.costKm / budget)
    }

    // A cheaper rival can take a corridor after another polity has already
    // expanded through it. Remove territory no longer connected to its capital.
    const connected = new Uint8Array(mesh.numRegions)
    const stack: number[] = []
    for (const polity of polities) {
      const capital = society.settlements[polity.capitalSettlementId].region
      connected[capital] = 1
      stack.push(capital)
      while (stack.length > 0) {
        const current = stack.pop()!
        for (const next of mesh.forEachNeighborOfRegion(current)) {
          if (polityByRegion[next] === polity.id && !connected[next]) {
            connected[next] = 1
            stack.push(next)
          }
        }
        for (const link of seaLinks.get(current) ?? []) {
          if (polityByRegion[link.region] === polity.id && !connected[link.region]) {
            connected[link.region] = 1
            stack.push(link.region)
          }
        }
      }
    }
    for (let region = 0; region < mesh.numRegions; region++) {
      if (polityByRegion[region] >= 0 && !connected[region]) {
        polityByRegion[region] = -1
        cost[region] = Infinity
      }
    }

    // The budget defines reliable control, not the edge of a formal claim.
    // Extend each connected polity through remaining land while preserving the
    // initial contested cores and the requirement for a real sea route.
    this.claimFrontier(mesh, data, config, polities, seaLinks, polityByRegion, cost)

    let unassignedPopulation = 0
    let unassignedAreaKm2 = 0
    for (let region = 0; region < mesh.numRegions; region++) {
      if (!land[region])
        continue
      const areaKm2 = mesh.regionArea[region] * PHYSICAL_RADIUS_KM ** 2
      const polity = polities[polityByRegion[region]]
      if (polity) {
        polity.population += society.population[region]
        polity.areaKm2 += areaKm2
        controlStrength[region] = Math.exp(-cost[region])
      }
      else {
        unassignedPopulation += society.population[region]
        unassignedAreaKm2 += areaKm2
      }
    }

    const districts: AdministrativeDistrict[] = []
    const districtByRegion = new Int32Array(mesh.numRegions).fill(-1)
    const districtCost = new Float64Array(mesh.numRegions).fill(Infinity)
    const districtQueue = new MinPriorityQueue<Frontier>()
    const centers = society.settlements.filter(settlement => polityByRegion[settlement.region] >= 0)
    const chosen = new Set<number>(polities.map(polity => polity.capitalSettlementId))
    for (const polity of polities) {
      const owned = centers.filter(settlement => polityByRegion[settlement.region] === polity.id)
      const limit = Math.max(1, Math.ceil(polity.areaKm2 / 2_000_000))
      owned.sort((a, b) => b.hinterlandPopulation - a.hinterlandPopulation || a.id - b.id)
      let selected = owned.filter(settlement => chosen.has(settlement.id)).length
      for (const settlement of owned) {
        if (selected >= limit)
          break
        if (chosen.has(settlement.id) || settlement.rank === 'village')
          continue
        chosen.add(settlement.id)
        selected++
      }
    }
    for (const settlement of centers) {
      if (!chosen.has(settlement.id))
        continue
      const polityId = polityByRegion[settlement.region]
      const id = districts.length
      districts.push({ id, polityId, centerSettlementId: settlement.id, name: `${settlement.name}区`, population: 0, areaKm2: 0 })
      districtByRegion[settlement.region] = id
      districtCost[settlement.region] = 0
      districtQueue.push({ region: settlement.region, owner: id, cost: 0 })
    }
    while (districtQueue.size > 0) {
      const current = districtQueue.pop()
      if (districtByRegion[current.region] !== current.owner || current.cost !== districtCost[current.region])
        continue
      const polityId = districts[current.owner].polityId
      const offerDistrict = (next: number, costKm: number) => {
        if (polityByRegion[next] !== polityId || costKm >= districtCost[next])
          return
        districtCost[next] = costKm
        districtByRegion[next] = current.owner
        districtQueue.push({ region: next, owner: current.owner, cost: costKm })
      }
      for (let edge = mesh.neighborOffsets[current.region]; edge < mesh.neighborOffsets[current.region + 1]; edge++) {
        const next = mesh.neighbors[edge]
        if (polityByRegion[next] === polityId) {
          offerDistrict(next, current.cost + landTravelCost(
            mesh, data, config, current.region, next, edge, society.transport.roadRegionMask,
          ))
        }
      }
      for (const link of seaLinks.get(current.region) ?? [])
        offerDistrict(link.region, current.cost + link.costKm)
    }
    // Governance may reach an isolated enclave through a route whose intermediate port
    // belongs to another polity. Give such territory a local district center.
    for (let region = 0; region < mesh.numRegions; region++) {
      const polityId = polityByRegion[region]
      if (polityId < 0 || districtByRegion[region] >= 0)
        continue
      const id = districts.length
      districts.push({ id, polityId, centerSettlementId: -1, name: `${polities[polityId].name}边区`, population: 0, areaKm2: 0 })
      districtByRegion[region] = id
      districtCost[region] = 0
      districtQueue.push({ region, owner: id, cost: 0 })
      while (districtQueue.size > 0) {
        const current = districtQueue.pop()
        for (let edge = mesh.neighborOffsets[current.region]; edge < mesh.neighborOffsets[current.region + 1]; edge++) {
          const next = mesh.neighbors[edge]
          if (polityByRegion[next] === polityId && districtByRegion[next] < 0) {
            districtByRegion[next] = id
            districtQueue.push({ region: next, owner: id, cost: 0 })
          }
        }
      }
    }
    for (let region = 0; region < mesh.numRegions; region++) {
      const district = districts[districtByRegion[region]]
      if (!district)
        continue
      district.population += society.population[region]
      district.areaKm2 += mesh.regionArea[region] * PHYSICAL_RADIUS_KM ** 2
    }
    return { polities, districts, polityByRegion, controlStrength, districtByRegion, unassignedPopulation, unassignedAreaKm2 }
  }

  private landComponents(mesh: SphericalMesh, land: Uint8Array): Int32Array {
    const component = new Int32Array(mesh.numRegions).fill(-1)
    const stack: number[] = []
    let id = 0
    for (let region = 0; region < mesh.numRegions; region++) {
      if (!land[region] || component[region] >= 0)
        continue
      component[region] = id
      stack.push(region)
      while (stack.length > 0) {
        const current = stack.pop()!
        for (const next of mesh.forEachNeighborOfRegion(current)) {
          if (land[next] && component[next] < 0) {
            component[next] = id
            stack.push(next)
          }
        }
      }
      id++
    }
    return component
  }

  private claimFrontier(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    config: WorldConfig,
    polities: Polity[],
    seaLinks: Map<number, SeaLink[]>,
    owners: Int32Array,
    cost: Float64Array,
  ): void {
    const land = data.geography.landMask
    const roadMask = data.society!.transport!.roadRegionMask
    const core = new Uint8Array(mesh.numRegions)
    const settled = new Uint8Array(mesh.numRegions)
    const queue = new MinPriorityQueue<Frontier>()
    for (let region = 0; region < mesh.numRegions; region++) {
      if (owners[region] < 0)
        continue
      core[region] = 1
      let bordersUnclaimed = false
      for (const next of mesh.forEachNeighborOfRegion(region)) {
        if (land[next] && owners[next] < 0) {
          bordersUnclaimed = true
          break
        }
      }
      if (!bordersUnclaimed)
        bordersUnclaimed = (seaLinks.get(region) ?? []).some(link => owners[link.region] < 0)
      if (bordersUnclaimed)
        queue.push({ region, owner: owners[region], cost: cost[region] })
    }
    const offer = (region: number, owner: number, nextCost: number) => {
      if (!land[region] || core[region] || settled[region] || nextCost >= cost[region])
        return
      owners[region] = owner
      cost[region] = nextCost
      queue.push({ region, owner, cost: nextCost })
    }
    while (queue.size > 0) {
      const current = queue.pop()
      if (owners[current.region] !== current.owner || cost[current.region] !== current.cost || settled[current.region])
        continue
      settled[current.region] = 1
      const budget = polities[current.owner].governanceBudgetKm
      for (let edge = mesh.neighborOffsets[current.region]; edge < mesh.neighborOffsets[current.region + 1]; edge++) {
        const next = mesh.neighbors[edge]
        if (land[next]) {
          offer(next, current.owner, current.cost + landTravelCost(
            mesh, data, config, current.region, next, edge, roadMask,
          ) / budget)
        }
      }
      for (const link of seaLinks.get(current.region) ?? [])
        offer(link.region, current.owner, current.cost + link.costKm / budget)
    }
  }

  private chooseCapitals(mesh: SphericalMesh, settlements: Settlement[], access: Float32Array, component: Int32Array): Settlement[] {
    const ranked = [...settlements].sort((a, b) => {
      const scoreA = a.hinterlandPopulation * (0.6 + access[a.region])
      const scoreB = b.hinterlandPopulation * (0.6 + access[b.region])
      return scoreB - scoreA || a.id - b.id
    })
    const capitals: Settlement[] = []
    const coveredComponents = new Set<number>()
    const target = Math.min(32, Math.max(1, Math.round(Math.sqrt(settlements.length) / 2)))
    for (const settlement of ranked) {
      const landComponent = component[settlement.region]
      if (landComponent < 0)
        continue
      const needed = !coveredComponents.has(landComponent)
      if (!needed && capitals.length >= target)
        continue
      if (!needed && capitals.some(capital => mesh.distanceBetweenRegions(capital.region, settlement.region) * PHYSICAL_RADIUS_KM < MIN_CAPITAL_SPACING_KM))
        continue
      capitals.push(settlement)
      coveredComponents.add(landComponent)
    }
    return capitals
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
      const costKm = route.costKm + SEA_LOADING_COST_KM
      links.set(from, [...(links.get(from) ?? []), { region: to, costKm }])
      links.set(to, [...(links.get(to) ?? []), { region: from, costKm }])
    }
    return links
  }
}
