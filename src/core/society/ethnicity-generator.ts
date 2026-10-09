import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import type { EthnicGroup, EthnicityData, Language, LanguageFamily } from '@/core/society/society-data'
import { MinPriorityQueue } from '@/core/math/priority-queue'
import { landTravelCost, PHYSICAL_RADIUS_KM } from '@/core/society/travel-cost'

const MIN_ORIGIN_SPACING_KM = 650
const SHARED_LANGUAGE_DISTANCE_KM = 1100
const LANGUAGE_FAMILY_DISTANCE_KM = 2500
const MIXING_DISTANCE_KM = 200
const MAX_LOCAL_GROUPS = 3
const NAME_START = ['岚', '云', '澜', '苍', '青', '赤', '金', '霜', '星', '月', '松', '石', '长', '清', '丹', '风', '溪', '海', '山', '川', '河', '林', '泉', '北']
const NAME_END = ['原', '谷', '岭', '泽', '丘', '川', '林', '河', '山', '湾', '海', '峰', '渡', '汀', '洲', '泉', '田', '岸', '浦', '岬', '森', '岚', '溪', '港']

interface Frontier {
  region: number
  group: number
  cost: number
}

interface SeaLink {
  target: number
  cost: number
}

/** Deterministic resident affiliations on the final land graph. */
export class EthnicityGenerator {
  generate(mesh: SphericalMesh, data: WorldSimulationState, config: WorldConfig): EthnicityData {
    const society = data.society
    if (!society?.transport)
      throw new Error('Ethnicity generation requires population and transport data')

    const count = mesh.numRegions
    const { origins, landComponent, componentCount } = this.selectOrigins(mesh, data, config.core.seed)
    const contactParent = new Int32Array(componentCount)
    for (let id = 0; id < componentCount; id++)
      contactParent[id] = id
    const findContact = (id: number): number => {
      while (contactParent[id] !== id) {
        contactParent[id] = contactParent[contactParent[id]]
        id = contactParent[id]
      }
      return id
    }
    for (const route of society.transport.routes) {
      if (route.kind !== 'sea')
        continue
      const from = society.settlements[route.fromSettlement]?.region
      const to = society.settlements[route.toSettlement]?.region
      if (from === undefined || to === undefined || landComponent[from] < 0 || landComponent[to] < 0)
        continue
      contactParent[findContact(landComponent[from])] = findContact(landComponent[to])
    }
    const sameContactNetwork = (a: number, b: number) => findContact(landComponent[a]) === findContact(landComponent[b])
    const groups: EthnicGroup[] = []
    const languages: Language[] = []
    const languageFamilies: LanguageFamily[] = []
    const usedNames = new Set<string>()
    for (const originRegion of origins) {
      const id = groups.length
      const root = this.uniqueName(originRegion, id, config.core.seed, usedNames)
      let languageId = -1
      let nearestLanguageKm = SHARED_LANGUAGE_DISTANCE_KM
      for (const language of languages) {
        if (!sameContactNetwork(originRegion, language.originRegion))
          continue
        const distanceKm = mesh.distanceBetweenRegions(originRegion, language.originRegion) * PHYSICAL_RADIUS_KM
        if (distanceKm < nearestLanguageKm) {
          nearestLanguageKm = distanceKm
          languageId = language.id
        }
      }
      if (languageId < 0) {
        let familyId = -1
        let nearestFamilyKm = LANGUAGE_FAMILY_DISTANCE_KM
        for (const family of languageFamilies) {
          if (!sameContactNetwork(originRegion, family.originRegion))
            continue
          const distanceKm = mesh.distanceBetweenRegions(originRegion, family.originRegion) * PHYSICAL_RADIUS_KM
          if (distanceKm < nearestFamilyKm) {
            nearestFamilyKm = distanceKm
            familyId = family.id
          }
        }
        if (familyId < 0) {
          familyId = languageFamilies.length
          languageFamilies.push({ id: familyId, name: `${root}语系`, originRegion })
        }
        languageId = languages.length
        languages.push({ id: languageId, name: `${root}语`, originRegion, familyId, ethnicGroupIds: [] })
      }
      groups.push({ id, name: `${root}族`, originRegion, languageId, relatedGroupIds: [] })
      languages[languageId].ethnicGroupIds.push(id)
    }
    for (const group of groups) {
      const familyId = languages[group.languageId].familyId
      group.relatedGroupIds = groups
        .filter(other => other.id !== group.id && languages[other.languageId].familyId === familyId)
        .map(other => other.id)
    }

    const localGroups = new Int32Array(count * MAX_LOCAL_GROUPS).fill(-1)
    const localCosts = new Float64Array(count * MAX_LOCAL_GROUPS).fill(Infinity)
    const queue = new MinPriorityQueue<Frontier>()
    const offer = (region: number, group: number, cost: number) => {
      const base = region * MAX_LOCAL_GROUPS
      let slot = -1
      for (let index = 0; index < MAX_LOCAL_GROUPS; index++) {
        if (localGroups[base + index] === group) {
          slot = index
          break
        }
      }
      if (slot < 0)
        slot = MAX_LOCAL_GROUPS - 1
      if (cost >= localCosts[base + slot])
        return
      localGroups[base + slot] = group
      localCosts[base + slot] = cost
      while (slot > 0 && localCosts[base + slot] < localCosts[base + slot - 1]) {
        const previousCost = localCosts[base + slot - 1]
        const previousGroup = localGroups[base + slot - 1]
        localCosts[base + slot - 1] = localCosts[base + slot]
        localGroups[base + slot - 1] = localGroups[base + slot]
        localCosts[base + slot] = previousCost
        localGroups[base + slot] = previousGroup
        slot--
      }
      queue.push({ region, group, cost })
    }

    const seaLinks = new Map<number, SeaLink[]>()
    for (const route of society.transport.routes) {
      if (route.kind !== 'sea')
        continue
      const from = society.settlements[route.fromSettlement]?.region
      const to = society.settlements[route.toSettlement]?.region
      if (from === undefined || to === undefined)
        continue
      const cost = route.costKm + 120
      const fromLinks = seaLinks.get(from) ?? []
      fromLinks.push({ target: to, cost })
      seaLinks.set(from, fromLinks)
      const toLinks = seaLinks.get(to) ?? []
      toLinks.push({ target: from, cost })
      seaLinks.set(to, toLinks)
    }
    for (let group = 0; group < origins.length; group++)
      offer(origins[group], group, 0)

    const landMask = data.geography.landMask
    const roadMask = society.transport.roadRegionMask
    while (queue.size > 0) {
      const current = queue.pop()
      const { region, group, cost } = current
      const base = region * MAX_LOCAL_GROUPS
      let active = false
      for (let slot = 0; slot < MAX_LOCAL_GROUPS; slot++) {
        if (localGroups[base + slot] === group && localCosts[base + slot] === cost)
          active = true
      }
      if (!active) {
        continue
      }
      for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
        const next = mesh.neighbors[edge]
        if (!landMask[next])
          continue
        offer(next, group, cost + landTravelCost(mesh, data, config, region, next, edge, roadMask))
      }
      for (const link of seaLinks.get(region) ?? [])
        offer(link.target, group, cost + link.cost)
    }

    const regionOffsets = new Uint32Array(count + 1)
    for (let region = 0; region < count; region++) {
      const population = society.population[region]
      if (population > 0)
        regionOffsets[region + 1] = this.localShares(region, localGroups, localCosts, society.transport.marketAccess[region]).length
      regionOffsets[region + 1] += regionOffsets[region]
    }

    const groupIds = new Uint32Array(regionOffsets[count])
    const residents = new Float64Array(regionOffsets[count])
    const dominantGroup = new Int32Array(count).fill(-1)
    const dominantGroupShare = new Float32Array(count)
    const dominantLanguage = new Int32Array(count).fill(-1)
    const dominantLanguageShare = new Float32Array(count)
    for (let region = 0; region < count; region++) {
      const start = regionOffsets[region]
      if (start === regionOffsets[region + 1])
        continue
      const population = society.population[region]
      const local = this.localShares(region, localGroups, localCosts, society.transport.marketAccess[region])
      const languageShares = new Map<number, number>()
      let allocated = 0
      for (let index = 0; index < local.length; index++) {
        const entry = local[index]
        const residentsHere = index === local.length - 1 ? population - allocated : population * entry.share
        groupIds[start + index] = entry.group
        residents[start + index] = residentsHere
        allocated += residentsHere
        const languageId = groups[entry.group].languageId
        languageShares.set(languageId, (languageShares.get(languageId) ?? 0) + residentsHere)
      }
      dominantGroup[region] = local[0].group
      dominantGroupShare[region] = residents[start] / population
      for (const [id, speakers] of languageShares) {
        const share = speakers / population
        if (share > dominantLanguageShare[region]) {
          dominantLanguage[region] = id
          dominantLanguageShare[region] = share
        }
      }
    }
    return {
      groups,
      languages,
      languageFamilies,
      regionOffsets,
      groupIds,
      residents,
      dominantGroup,
      dominantGroupShare,
      dominantLanguage,
      dominantLanguageShare,
    }
  }

  private localShares(
    region: number,
    localGroups: Int32Array,
    localCosts: Float64Array,
    marketAccess: number,
  ): Array<{ group: number, share: number }> {
    const base = region * MAX_LOCAL_GROUPS
    if (localGroups[base] < 0)
      return []
    const contact = 1 + 0.2 * marketAccess
    const weighted: Array<{ group: number, weight: number }> = []
    for (let slot = 0; slot < MAX_LOCAL_GROUPS; slot++) {
      const group = localGroups[base + slot]
      if (group < 0)
        break
      const gap = Math.max(0, localCosts[base + slot] - localCosts[base])
      weighted.push({ group, weight: slot === 0 ? 1 : Math.exp(-gap / (MIXING_DISTANCE_KM * contact)) })
    }
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0)
    const kept = weighted.filter(entry => entry.weight / total >= 0.01)
    const keptTotal = kept.reduce((sum, entry) => sum + entry.weight, 0)
    return kept.map(entry => ({ group: entry.group, share: entry.weight / keptTotal }))
  }

  private selectOrigins(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    seed: number,
  ): { origins: number[], landComponent: Int32Array, componentCount: number } {
    const society = data.society!
    const count = mesh.numRegions
    const landMask = data.geography.landMask
    const component = new Int32Array(count).fill(-1)
    const componentOrigins: number[] = []
    const componentPopulations: number[] = []
    const frontier = new Uint32Array(count)
    for (let region = 0; region < count; region++) {
      if (!landMask[region] || component[region] >= 0)
        continue
      const id = componentOrigins.length
      let head = 0
      let tail = 0
      frontier[tail++] = region
      component[region] = id
      let origin = region
      let maximumPopulation = 0
      while (head < tail) {
        const current = frontier[head++]
        const population = society.population[current]
        if (population > maximumPopulation) {
          maximumPopulation = population
          origin = current
        }
        for (let edge = mesh.neighborOffsets[current]; edge < mesh.neighborOffsets[current + 1]; edge++) {
          const next = mesh.neighbors[edge]
          if (!landMask[next] || component[next] >= 0)
            continue
          component[next] = id
          frontier[tail++] = next
        }
      }
      componentOrigins.push(origin)
      componentPopulations.push(maximumPopulation)
    }
    const origins = componentOrigins.filter((_, id) => componentPopulations[id] > 0)
    if (origins.length === 0)
      return { origins, landComponent: component, componentCount: componentOrigins.length }
    const target = Math.max(origins.length, Math.min(36, Math.max(2, Math.round(Math.sqrt(society.totalPopulation / 2_500_000)))))
    const candidates = society.settlements
      .filter(settlement => society.population[settlement.region] > 0)
      .sort((a, b) => {
        const aScore = a.hinterlandPopulation * (0.985 + this.hash(a.region ^ seed ^ 0x4554484E) / 0xFFFFFFFF * 0.03)
        const bScore = b.hinterlandPopulation * (0.985 + this.hash(b.region ^ seed ^ 0x4554484E) / 0xFFFFFFFF * 0.03)
        return bScore - aScore || a.region - b.region
      })
    for (const settlement of candidates) {
      if (origins.length >= target)
        break
      const region = settlement.region
      if (origins.some(origin => mesh.distanceBetweenRegions(region, origin) * PHYSICAL_RADIUS_KM < MIN_ORIGIN_SPACING_KM))
        continue
      origins.push(region)
    }
    return { origins, landComponent: component, componentCount: componentOrigins.length }
  }

  private uniqueName(region: number, id: number, seed: number, usedNames: Set<string>): string {
    const first = NAME_START[this.hash(region ^ seed ^ 0x4E54484E) % NAME_START.length]
    const second = NAME_END[this.hash(region ^ seed ^ 0x4C414E47) % NAME_END.length]
    const proposed = `${first}${second}`
    const name = usedNames.has(proposed) ? `${proposed}${id + 1}` : proposed
    usedNames.add(name)
    return name
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
