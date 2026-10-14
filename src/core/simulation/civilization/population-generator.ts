import type SphericalMesh from '@/core/mesh/mesh'
import type { CivilizationData, Settlement, SettlementRank } from '@/core/simulation/civilization/civilization-data'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { computeSphericalDistanceField } from '@/core/math/distance-field'
import { clamp } from '@/core/math/math'
import { IndexPriorityQueue } from '@/core/math/priority-queue'
import { BIOME_CODES } from '@/core/simulation/ecology/biome-data'
import { HYDROLOGY_RADIUS_M } from '@/core/simulation/hydrology/hydrology-units'

const PHYSICAL_RADIUS_KM = HYDROLOGY_RADIUS_M / 1000
const AREA_SCALE_KM2 = PHYSICAL_RADIUS_KM ** 2
const BIN_ANGLE = Math.PI / 90
const LONGITUDE_BINS = 180
const LATITUDE_BINS = 90
const MAX_SETTLEMENTS = 1000
const ICE_SHEET_BIOME = BIOME_CODES.indexOf('IceSheet')
const AGRARIAN_DENSITY_PER_KM2 = 25
const SETTLEMENT_SERVICE_AREA_KM2 = 180_000
const MIN_SERVICE_COMPONENT_POPULATION = 100_000
const LOCAL_CENTRE_RESIDENTS = 5_000
const CLEARING_FACTOR: Record<string, number> = {
  TropicalRainforest: 0.5,
  TropicalSeasonalForest: 0.82,
  Savanna: 0.88,
  HotDesert: 0.6,
  ColdDesert: 0.65,
  Steppe: 0.75,
  MediterraneanShrubland: 0.94,
  TemperateGrassland: 1,
  TemperateSeasonalForest: 0.92,
  TemperateRainforest: 0.78,
  BorealForest: 0.58,
  Tundra: 0.36,
  AlpineTundra: 0.3,
}
const NAME_START = ['青', '白', '赤', '金', '云', '星', '霜', '月', '松', '枫', '石', '岚', '远', '长', '清', '苍', '丹', '北', '南', '东', '西', '新', '古', '风', '晴', '溪', '海', '山', '川', '河', '林', '泉']
const NAME_END = ['湾', '原', '渡', '谷', '岭', '浦', '泽', '岗', '台', '港', '溪', '丘', '汀', '峪', '坡', '岸', '关', '洲', '桥', '林', '田', '岬', '泊', '川', '河', '山', '城', '津', '畔', '峰', '森', '海']

interface Candidate {
  region: number
  score: number
}

export class PopulationGenerator {
  generate(mesh: SphericalMesh, data: WorldSimulationState, config: WorldConfig): CivilizationData {
    if (!data.biome || !data.hydrology)
      throw new Error('Population generation requires biome and hydrology data')

    const count = mesh.numRegions
    const habitability = new Float32Array(count)
    const population = new Float32Array(count)
    const populationDensity = new Float32Array(count)
    const settlementByRegion = new Int32Array(count).fill(-1)
    const landMask = data.geography.landMask
    const riverMask = data.hydrology.riverMask
    const riverDistance = computeSphericalDistanceField(
      mesh,
      region => riverMask[region] !== 0,
      (_from, to) => landMask[to] !== 0,
      400 / PHYSICAL_RADIUS_KM,
    )
    const edgeDistances = mesh.neighborDistances
    const floodRisk = new Float32Array(count)
    let maximumDischarge = 0
    for (let region = 0; region < count; region++) {
      if (riverMask[region])
        maximumDischarge = Math.max(maximumDischarge, data.hydrology.discharge[region])
    }
    const dischargeScale = Math.log1p(maximumDischarge)
    let habitableArea = 0

    for (let region = 0; region < count; region++) {
      if (!landMask[region] || data.biome.biomeClass[region] === ICE_SHEET_BIOME)
        continue
      const temperature = data.biome.annualTemperatureC[region]
      const season = clamp(data.biome.growingSeasonMonths[region] / 10, 0, 1)
      const warmth = clamp(1 - Math.abs(temperature - 18) / 34, 0, 1)
      const moisture = clamp(data.biome.aridityIndex[region] / 0.75, 0, 1)
      const rainfall = data.biome.annualPrecipitationMm[region]
      const elevation = data.geography.elevation[region]
      let steepestSlope = 0
      let localRelief = 0
      let coastal = false
      for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
        const neighbor = mesh.neighbors[edge]
        if (!landMask[neighbor]) {
          coastal = true
          continue
        }
        const edgeKm = Math.max(1, edgeDistances[edge] * PHYSICAL_RADIUS_KM)
        const heightDifference = Math.abs(elevation - data.geography.elevation[neighbor])
        steepestSlope = Math.max(steepestSlope, heightDifference / edgeKm)
        localRelief = Math.max(localRelief, heightDifference)
      }
      const terrain = Math.exp(-8 * steepestSlope - Math.max(0, elevation - 1.5) * 0.4)
      const distanceToRiverKm = riverDistance[region] * PHYSICAL_RADIUS_KM
      const water = Number.isFinite(distanceToRiverKm)
        ? Math.exp(-distanceToRiverKm / 180)
        : 0
      const flowStrength = riverMask[region] && dischargeScale > 0
        ? Math.log1p(data.hydrology.discharge[region]) / dischargeScale
        : 0
      const flatness = Math.exp(-localRelief / 0.12)
      const wetExcess = clamp((rainfall - 1800) / 2200, 0, 1)
      floodRisk[region] = flowStrength * flatness * (0.5 + 0.5 * wetExcess)
      const clearing = CLEARING_FACTOR[BIOME_CODES[data.biome.biomeClass[region]]] ?? 0.8
      const production = season * (0.25 + 0.75 * warmth) * (0.04 + 0.96 * moisture)
      const wetLandUse = 1 - 0.18 * wetExcess
      const heatLoad = clamp((temperature - 24) / 14, 0, 1)
      const heatStress = 1 - 0.12 * heatLoad * moisture
      const irrigation = 0.2 * (1 - moisture) * flowStrength * flatness
      // Rainfall governs broad cropland capacity; river proximity is a modest
      // supplement because a river-marked cell covers much more land on coarse meshes.
      const score = clamp((production * clearing * wetLandUse * heatStress + irrigation)
        * terrain * (0.9 + 0.1 * water) * (1 - 0.12 * floodRisk[region])
        + (coastal ? 0.02 * season * moisture : 0), 0, 1)
      habitability[region] = score
      if (score < 0.08)
        continue
      const density = AGRARIAN_DENSITY_PER_KM2 * config.civilization.populationScale * score ** 1.8
      const areaKm2 = mesh.regionArea[region] * AREA_SCALE_KM2
      populationDensity[region] = density
      population[region] = density * areaKm2
      habitableArea += areaKm2
    }

    const settlements = this.selectSettlements(mesh, data, config, habitability, floodRisk, population, habitableArea)
    for (const settlement of settlements)
      settlementByRegion[settlement.region] = settlement.id
    this.concentrateUrbanPopulation(mesh, data, config, population, populationDensity, settlements)

    let totalPopulation = 0
    for (const residents of population)
      totalPopulation += residents
    return { habitability, population, populationDensity, settlementByRegion, settlements, totalPopulation }
  }

  private selectSettlements(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    config: WorldConfig,
    habitability: Float32Array,
    floodRisk: Float32Array,
    population: Float32Array,
    habitableArea: number,
  ): Settlement[] {
    if (habitableArea === 0 || config.civilization.settlementDensity <= 0)
      return []
    const baseTarget = Math.min(MAX_SETTLEMENTS, Math.max(1, Math.round(habitableArea / SETTLEMENT_SERVICE_AREA_KM2 * config.civilization.settlementDensity)))
    const bestByBin = new Map<number, Candidate>()
    const binPopulation = new Map<number, number>()
    const bestByComponent = new Map<number, Candidate>()
    const landMask = data.geography.landMask
    const riverMask = data.hydrology!.riverMask
    const component = new Int32Array(mesh.numRegions).fill(-1)
    const componentPopulation: number[] = []
    const stack: number[] = []
    for (let region = 0; region < mesh.numRegions; region++) {
      if (!landMask[region] || component[region] >= 0)
        continue
      const id = componentPopulation.length
      componentPopulation.push(0)
      component[region] = id
      stack.push(region)
      while (stack.length > 0) {
        const current = stack.pop()!
        componentPopulation[id] += population[current]
        for (const next of mesh.forEachNeighborOfRegion(current)) {
          if (landMask[next] && component[next] < 0) {
            component[next] = id
            stack.push(next)
          }
        }
      }
    }
    for (let region = 0; region < mesh.numRegions; region++) {
      if (population[region] < 20)
        continue
      const latitudeBin = Math.min(LATITUDE_BINS - 1, Math.floor((mesh.regionLatitude[region] + Math.PI / 2) / BIN_ANGLE))
      const longitudeBin = Math.min(LONGITUDE_BINS - 1, Math.floor((mesh.regionLongitude[region] + Math.PI) / BIN_ANGLE))
      const bin = latitudeBin * LONGITUDE_BINS + longitudeBin
      binPopulation.set(bin, (binPopulation.get(bin) ?? 0) + population[region])
      let coast = false
      for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
        if (!landMask[mesh.neighbors[edge]]) {
          coast = true
          break
        }
      }
      const jitter = (this.hash(region ^ config.core.seed) % 1000) / 1000
      const score = habitability[region] * (1 + (riverMask[region] ? 0.06 : 0) + (coast ? 0.06 : 0))
        - 0.16 * floodRisk[region] + jitter * 0.015
      const previous = bestByBin.get(bin)
      if (!previous || score > previous.score)
        bestByBin.set(bin, { region, score })
      const componentId = component[region]
      const componentBest = bestByComponent.get(componentId)
      if (!componentBest || score > componentBest.score)
        bestByComponent.set(componentId, { region, score })
    }
    let largestComponent = 0
    for (const residents of componentPopulation)
      largestComponent = Math.max(largestComponent, residents)
    const minimumComponentPopulation = Math.min(MIN_SERVICE_COMPONENT_POPULATION, largestComponent)
    const componentSeeds = [...bestByComponent]
      .filter(([id]) => componentPopulation[id] >= minimumComponentPopulation)
      .sort((a, b) => componentPopulation[b[0]] - componentPopulation[a[0]] || a[0] - b[0])
      .map(([, candidate]) => candidate)
    const candidates = [...bestByBin]
      .filter(([, candidate]) => componentPopulation[component[candidate.region]] >= minimumComponentPopulation)
      .map(([bin, candidate]) => ({ ...candidate, mass: binPopulation.get(bin) ?? 0 }))
    const target = Math.max(baseTarget, componentSeeds.length)
    const selected = [...componentSeeds]
    const selectedRegions = new Set(selected.map(candidate => candidate.region))
    const baselineSpacing = Math.sqrt(habitableArea / target) * 0.42
    const nearestKm = new Float64Array(candidates.length).fill(Math.PI * PHYSICAL_RADIUS_KM)
    const updateNearest = (region: number) => {
      for (let index = 0; index < candidates.length; index++) {
        const distanceKm = mesh.distanceBetweenRegions(region, candidates[index].region) * PHYSICAL_RADIUS_KM
        nearestKm[index] = Math.min(nearestKm[index], distanceKm)
      }
    }
    for (const seed of componentSeeds)
      updateNearest(seed.region)
    for (const spacingFactor of [1, 0.7, 0.45]) {
      while (selected.length < target) {
        let bestIndex = -1
        let bestPriority = -Infinity
        for (let index = 0; index < candidates.length; index++) {
          const candidate = candidates[index]
          if (selectedRegions.has(candidate.region) || nearestKm[index] < baselineSpacing * spacingFactor)
            continue
          // Serve populated areas that remain far from a centre, while site quality
          // decides between nearby alternatives within the same demand area.
          const priority = Math.sqrt(candidate.mass) * Math.min(nearestKm[index], 1500)
            * (0.7 + 0.3 * clamp(candidate.score, 0, 1))
          if (priority > bestPriority || (priority === bestPriority && bestIndex >= 0 && candidate.region < candidates[bestIndex].region)) {
            bestPriority = priority
            bestIndex = index
          }
        }
        if (bestIndex < 0)
          break
        const chosen = candidates[bestIndex]
        selected.push(chosen)
        selectedRegions.add(chosen.region)
        updateNearest(chosen.region)
      }
    }
    const usedNames = new Set<string>()
    return selected.map(({ region }, id) => {
      const proposedName = this.settlementName(id, region, config.core.seed)
      const name = usedNames.has(proposedName) ? `${proposedName}·${id + 1}` : proposedName
      usedNames.add(name)
      return {
        id,
        region,
        name,
        rank: 'village' as SettlementRank,
        population: 0,
        hinterlandPopulation: 0,
        reasons: [],
      }
    })
  }

  private concentrateUrbanPopulation(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    config: WorldConfig,
    population: Float32Array,
    density: Float32Array,
    settlements: Settlement[],
  ): void {
    if (settlements.length === 0)
      return
    const owner = new Int32Array(mesh.numRegions).fill(-1)
    const distance = new Float32Array(mesh.numRegions).fill(Infinity)
    const queue = new IndexPriorityQueue(Math.max(64, settlements.length))
    for (const settlement of settlements) {
      owner[settlement.region] = settlement.id
      distance[settlement.region] = 0
      queue.push(settlement.region, 0)
    }
    const neighbors = mesh.neighbors
    const offsets = mesh.neighborOffsets
    const edgeDistances = mesh.neighborDistances
    const landMask = data.geography.landMask
    while (queue.size > 0) {
      const current = queue.pop()
      for (let edge = offsets[current]; edge < offsets[current + 1]; edge++) {
        const next = neighbors[edge]
        if (!landMask[next])
          continue
        const nextDistance = distance[current] + edgeDistances[edge]
        if (nextDistance >= distance[next])
          continue
        distance[next] = nextDistance
        owner[next] = owner[current]
        queue.push(next, nextDistance)
      }
    }
    const hinterland = new Float64Array(settlements.length)
    for (let region = 0; region < mesh.numRegions; region++) {
      if (owner[region] >= 0)
        hinterland[owner[region]] += population[region]
    }
    const urbanShare = new Float64Array(settlements.length)
    for (const settlement of settlements) {
      const served = hinterland[settlement.id]
      settlement.hinterlandPopulation = served
      // Larger agricultural hinterlands can sustain disproportionately larger
      // administrative and market centres; cap the transfer to retain rural residents.
      const serviceScale = clamp(served / 4_000_000, 0, 1)
      urbanShare[settlement.id] = clamp(config.civilization.urbanization * (0.06 + 0.65 * serviceScale ** 2), 0, 0.25)
      const region = settlement.region
      const coastal = [...mesh.forEachNeighborOfRegion(region)].some(neighbor => !landMask[neighbor])
      settlement.reasons = [
        data.hydrology!.riverMask[region] ? '靠近主河道' : '周边具有可居住腹地',
        coastal ? '临近海岸' : '位于陆地通道',
        served >= 2_000_000 ? '腹地人口较多' : '服务周边居民',
      ]
    }
    const urbanPopulation = new Float64Array(settlements.length)
    for (let region = 0; region < mesh.numRegions; region++) {
      const id = owner[region]
      if (id < 0 || population[region] === 0)
        continue
      const moved = population[region] * urbanShare[id]
      population[region] -= moved
      urbanPopulation[id] += moved
    }
    for (const settlement of settlements) {
      const region = settlement.region
      const localResidents = Math.min(LOCAL_CENTRE_RESIDENTS, population[region])
      population[region] += urbanPopulation[settlement.id]
      settlement.population = urbanPopulation[settlement.id] + localResidents
      settlement.rank = settlement.population >= 1_000_000
        ? 'metropolis'
        : settlement.population >= 250_000
          ? 'city'
          : settlement.population >= 15_000 ? 'town' : 'village'
    }
    for (let region = 0; region < mesh.numRegions; region++) {
      if (population[region] > 0)
        density[region] = population[region] / (mesh.regionArea[region] * AREA_SCALE_KM2)
    }
  }

  private settlementName(id: number, region: number, seed: number): string {
    const first = NAME_START[this.hash(region ^ seed) % NAME_START.length]
    const second = NAME_END[this.hash(id ^ (seed + 0x9E3779B9)) % NAME_END.length]
    return `${first}${second}`
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
