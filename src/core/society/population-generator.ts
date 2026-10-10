import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import type { Settlement, SettlementRank, SocietyData } from '@/core/society/society-data'
import { BIOME_CODES } from '@/core/ecology/biome-data'
import { HYDROLOGY_RADIUS_M } from '@/core/hydrology/hydrology-units'
import { computeSphericalDistanceField } from '@/core/math/distance-field'
import { clamp } from '@/core/math/math'
import { IndexPriorityQueue } from '@/core/math/priority-queue'

const PHYSICAL_RADIUS_KM = HYDROLOGY_RADIUS_M / 1000
const AREA_SCALE_KM2 = PHYSICAL_RADIUS_KM ** 2
const BIN_ANGLE = Math.PI / 90
const LONGITUDE_BINS = 180
const LATITUDE_BINS = 90
const MAX_SETTLEMENTS = 420
const ICE_SHEET_BIOME = BIOME_CODES.indexOf('IceSheet')
const NAME_START = ['青', '白', '赤', '金', '云', '星', '霜', '月', '松', '枫', '石', '岚', '远', '长', '清', '苍', '丹', '北', '南', '东', '西', '新', '古', '风', '晴', '溪', '海', '山', '川', '河', '林', '泉']
const NAME_END = ['湾', '原', '渡', '谷', '岭', '浦', '泽', '岗', '台', '港', '溪', '丘', '汀', '峪', '坡', '岸', '关', '洲', '桥', '林', '田', '岬', '泊', '川', '河', '山', '城', '津', '畔', '峰', '森', '海']

interface Candidate {
  region: number
  score: number
}

export class PopulationGenerator {
  generate(mesh: SphericalMesh, data: WorldSimulationState, config: WorldConfig): SocietyData {
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
    let habitableArea = 0

    for (let region = 0; region < count; region++) {
      if (!landMask[region] || data.biome.biomeClass[region] === ICE_SHEET_BIOME)
        continue
      const temperature = data.biome.annualTemperatureC[region]
      const season = clamp(data.biome.growingSeasonMonths[region] / 8, 0, 1)
      const warmth = clamp(1 - Math.abs(temperature - 17) / 38, 0, 1)
      const moisture = clamp(data.biome.aridityIndex[region] / 0.85, 0, 1)
      const elevation = data.geography.elevation[region]
      let steepestSlope = 0
      let coastal = false
      for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
        const neighbor = mesh.neighbors[edge]
        if (!landMask[neighbor]) {
          coastal = true
          continue
        }
        const edgeKm = Math.max(1, edgeDistances[edge] * PHYSICAL_RADIUS_KM)
        steepestSlope = Math.max(steepestSlope, Math.abs(elevation - data.geography.elevation[neighbor]) / edgeKm)
      }
      const terrain = Math.exp(-8 * steepestSlope - Math.max(0, elevation - 1.5) * 0.4)
      const water = Number.isFinite(riverDistance[region])
        ? Math.exp(-riverDistance[region] * PHYSICAL_RADIUS_KM / 180)
        : 0
      const production = season * (0.25 + 0.75 * warmth) * (0.2 + 0.8 * moisture)
      const score = clamp(production * terrain * (0.7 + 0.3 * water)
        + (coastal ? 0.035 * season * moisture : 0), 0, 1)
      habitability[region] = score
      if (score < 0.08)
        continue
      const density = 42 * config.society.populationScale * score ** 1.8
      const areaKm2 = mesh.regionArea[region] * AREA_SCALE_KM2
      populationDensity[region] = density
      population[region] = density * areaKm2
      habitableArea += areaKm2
    }

    const settlements = this.selectSettlements(mesh, data, config, habitability, population, habitableArea)
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
    population: Float32Array,
    habitableArea: number,
  ): Settlement[] {
    if (habitableArea === 0 || config.society.settlementDensity <= 0)
      return []
    const target = Math.min(MAX_SETTLEMENTS, Math.max(1, Math.round(habitableArea / 350_000 * config.society.settlementDensity)))
    const bestByBin = new Map<number, Candidate>()
    const landMask = data.geography.landMask
    const riverMask = data.hydrology!.riverMask
    for (let region = 0; region < mesh.numRegions; region++) {
      if (population[region] < 20)
        continue
      const latitudeBin = Math.min(LATITUDE_BINS - 1, Math.floor((mesh.regionLatitude[region] + Math.PI / 2) / BIN_ANGLE))
      const longitudeBin = Math.min(LONGITUDE_BINS - 1, Math.floor((mesh.regionLongitude[region] + Math.PI) / BIN_ANGLE))
      const bin = latitudeBin * LONGITUDE_BINS + longitudeBin
      let coast = false
      for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
        if (!landMask[mesh.neighbors[edge]]) {
          coast = true
          break
        }
      }
      const jitter = (this.hash(region ^ config.core.seed) % 1000) / 1000
      const score = habitability[region] * (1 + (riverMask[region] ? 0.08 : 0) + (coast ? 0.08 : 0))
        + jitter * 0.015
      const previous = bestByBin.get(bin)
      if (!previous || score > previous.score)
        bestByBin.set(bin, { region, score })
    }
    const candidates = [...bestByBin.values()].sort((a, b) => b.score - a.score || a.region - b.region)
    const selected: Candidate[] = []
    const baselineSpacing = Math.sqrt(habitableArea / target) * 0.42
    for (const spacingFactor of [1, 0.7, 0.45]) {
      const minimumDot = Math.cos(baselineSpacing * spacingFactor / PHYSICAL_RADIUS_KM)
      for (const candidate of candidates) {
        if (selected.length >= target)
          break
        let tooClose = false
        for (const placed of selected) {
          if (mesh.dotBetweenRegions(candidate.region, placed.region) > minimumDot) {
            tooClose = true
            break
          }
        }
        if (!tooClose)
          selected.push(candidate)
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
      settlement.rank = served >= 8_000_000
        ? 'metropolis'
        : served >= 2_000_000
          ? 'city'
          : served >= 300_000 ? 'town' : 'village'
      const rankFactor = settlement.rank === 'metropolis'
        ? 0.65
        : settlement.rank === 'city'
          ? 0.45
          : settlement.rank === 'town' ? 0.22 : 0.08
      urbanShare[settlement.id] = clamp(config.society.urbanization * rankFactor, 0, 0.8)
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
      population[region] += urbanPopulation[settlement.id]
      settlement.population = population[region]
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
