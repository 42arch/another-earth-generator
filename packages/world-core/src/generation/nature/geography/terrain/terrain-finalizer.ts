import type { AlgorithmMesh as SphericalMesh } from '#generation/nature/common/algorithm-mesh'

export interface TerrainFinalizationFields {
  /** Elevation change introduced by peak, isostatic and hypsometric shaping. */
  shapingDelta: Float32Array
  /** Elevation change introduced by topology repair. */
  topologyDelta: Float32Array
  /** Regions raised above sea level by topology repair. */
  topologyChanged: Uint8Array
  /** Elevation change introduced by surface post-processing after terrain warp. */
  postProcessDelta: Float32Array
}

export interface FinalizedTerrain {
  elevation: Float32Array
  landMask: Uint8Array
  fields: TerrainFinalizationFields
}

const SEA_LEVEL = 0
const PEAK_COMPRESS_POWER = 0.9
const ISOSTATIC_K = 0.07
const HYPS_BLEND = 0.4
const HYPS_LOW_BREAK = 0.6
const HYPS_MID_BREAK = 0.85
const HYPS_LOW_ELEV_FRAC = 0.25
const HYPS_MID_ELEV_FRAC = 0.35
const HYPS_HIGH_POWER = 0.7
const FILL_LEVEL = 0.005
const BREACH_MOUTH_LEVEL = 0.002
const BREACH_CARVE_STRENGTH = 0.85
const BREACH_SLOPE_EPSILON = 1e-6
// Suppress detached sub-sea fragments smaller than four L5 display regions.
const MIN_WATER_COMPONENT_AREA = 4 * (4 * Math.PI / (10 * 4 ** 5 + 2))

interface RankedLandRegion {
  region: number
  elevation: number
}

class StableSurfaceMinHeap {
  readonly #values: number[] = []
  readonly #surface: Float32Array
  constructor(surface: Float32Array) {
    this.#surface = surface
  }

  #less(a: number, b: number): boolean {
    const difference = this.#surface[a] - this.#surface[b]
    return difference < 0 || (difference === 0 && a < b)
  }

  push(region: number): void {
    let index = this.#values.length
    this.#values.push(region)
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (!this.#less(region, this.#values[parent]))
        break
      this.#values[index] = this.#values[parent]
      index = parent
    }
    this.#values[index] = region
  }

  pop(): number {
    const first = this.#values[0]
    const last = this.#values.pop()!
    if (this.#values.length > 0) {
      let index = 0
      while (true) {
        const left = index * 2 + 1
        if (left >= this.#values.length)
          break
        const right = left + 1
        const child = right < this.#values.length && this.#less(this.#values[right], this.#values[left]) ? right : left
        if (!this.#less(this.#values[child], last))
          break
        this.#values[index] = this.#values[child]
        index = child
      }
      this.#values[index] = last
    }
    return first
  }

  get size(): number {
    return this.#values.length
  }
}

/** Applies the reference generator's final hypsometry and sea-connectivity repair. */
export class TerrainFinalizer {
  generate(
    mesh: SphericalMesh,
    inputElevation: Float32Array,
  ): FinalizedTerrain {
    const elevation = Float32Array.from(inputElevation)
    const shapingDelta = new Float32Array(mesh.numRegions)
    const topologyDelta = new Float32Array(mesh.numRegions)
    const topologyChanged = new Uint8Array(mesh.numRegions)
    const postProcessDelta = new Float32Array(mesh.numRegions)

    this.applyPeakAndIsostaticShaping(elevation)
    this.applyHypsometricShaping(mesh, elevation)
    for (let region = 0; region < mesh.numRegions; region++)
      shapingDelta[region] = elevation[region] - inputElevation[region]

    this.fillSmallWaterComponents(
      mesh,
      elevation,
      topologyDelta,
      topologyChanged,
    )

    const landMask = new Uint8Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++)
      landMask[region] = elevation[region] > SEA_LEVEL ? 1 : 0

    return {
      elevation,
      landMask,
      fields: { shapingDelta, topologyDelta, topologyChanged, postProcessDelta },
    }
  }

  /** Reapply the small-water-component filter after later terrain shaping passes and breach closed coastal fills. */
  repairSeaConnectivity(
    mesh: SphericalMesh,
    elevation: Float32Array,
    topologyDelta: Float32Array,
    topologyChanged: Uint8Array,
  ): void {
    if (elevation.length !== mesh.numRegions || topologyDelta.length !== mesh.numRegions || topologyChanged.length !== mesh.numRegions)
      throw new Error('Sea connectivity repair mesh mismatch')
    const repaired = new Uint8Array(mesh.numRegions)
    const repairedCount = this.fillSmallWaterComponents(mesh, elevation, topologyDelta, topologyChanged, repaired)
    if (repairedCount > 0)
      this.drainRepairedDepressions(mesh, elevation, topologyDelta, repaired)
  }

  private applyPeakAndIsostaticShaping(elevation: Float32Array): void {
    for (let region = 0; region < elevation.length; region++) {
      let value = elevation[region]
      if (value > SEA_LEVEL)
        value = value ** PEAK_COMPRESS_POWER
      elevation[region] = value - Math.abs(value) * value * ISOSTATIC_K
    }
  }

  private applyHypsometricShaping(
    mesh: SphericalMesh,
    elevation: Float32Array,
  ): void {
    const land: RankedLandRegion[] = []
    for (let region = 0; region < mesh.numRegions; region++) {
      if (elevation[region] <= SEA_LEVEL)
        continue
      land.push({ region, elevation: elevation[region] })
    }
    if (land.length <= 1)
      return

    land.sort((a, b) => a.elevation - b.elevation)
    const minimum = land[0].elevation
    const maximum = land[land.length - 1].elevation
    const range = maximum - minimum
    if (range <= 0.01)
      return

    for (let index = 0; index < land.length; index++) {
      const item = land[index]
      const rank = index / (land.length - 1)
      const targetPercent = this.hypsometricTarget(rank)
      const target = minimum + targetPercent * range
      elevation[item.region] = item.elevation * (1 - HYPS_BLEND) + target * HYPS_BLEND
    }
  }

  private hypsometricTarget(rank: number): number {
    if (rank < HYPS_LOW_BREAK)
      return HYPS_LOW_ELEV_FRAC * rank / HYPS_LOW_BREAK
    if (rank < HYPS_MID_BREAK) {
      return HYPS_LOW_ELEV_FRAC
        + HYPS_MID_ELEV_FRAC
        * (rank - HYPS_LOW_BREAK)
        / (HYPS_MID_BREAK - HYPS_LOW_BREAK)
    }
    const t = (rank - HYPS_MID_BREAK) / (1 - HYPS_MID_BREAK)
    return HYPS_LOW_ELEV_FRAC
      + HYPS_MID_ELEV_FRAC
      + (1 - HYPS_LOW_ELEV_FRAC - HYPS_MID_ELEV_FRAC) * t ** HYPS_HIGH_POWER
  }

  private fillSmallWaterComponents(
    mesh: SphericalMesh,
    elevation: Float32Array,
    topologyDelta: Float32Array,
    topologyChanged: Uint8Array,
    repaired?: Uint8Array,
  ): number {
    const visited = new Uint8Array(mesh.numRegions)
    const queue = new Uint32Array(mesh.numRegions)
    let repairedCount = 0
    for (let region = 0; region < mesh.numRegions; region++) {
      if (elevation[region] > SEA_LEVEL || visited[region] !== 0)
        continue
      let head = 0
      let tail = 0
      let componentArea = 0
      queue[tail++] = region
      visited[region] = 1
      while (head < tail) {
        const current = queue[head++]
        componentArea += mesh.regionArea[current]
        this.forEachNeighbor(mesh, current, (neighbor) => {
          if (visited[neighbor] !== 0 || elevation[neighbor] > SEA_LEVEL)
            return
          visited[neighbor] = 1
          queue[tail++] = neighbor
        })
      }
      if (componentArea >= MIN_WATER_COMPONENT_AREA)
        continue
      for (let i = 0; i < tail; i++) {
        const member = queue[i]
        const previous = elevation[member]
        elevation[member] = FILL_LEVEL
        topologyDelta[member] += FILL_LEVEL - previous
        topologyChanged[member] = 1
        if (repaired)
          repaired[member] = 1
        repairedCount++
      }
    }
    return repairedCount
  }

  private drainRepairedDepressions(
    mesh: SphericalMesh,
    elevation: Float32Array,
    topologyDelta: Float32Array,
    repaired: Uint8Array,
  ): void {
    const n = mesh.numRegions
    const surface = Float32Array.from(elevation)
    const parent = new Int32Array(n).fill(-2)
    const popRank = new Int32Array(n)
    const heap = new StableSurfaceMinHeap(surface)
    for (let region = 0; region < n; region++) {
      if (elevation[region] <= SEA_LEVEL) {
        parent[region] = -1
        heap.push(region)
      }
    }
    if (heap.size === 0)
      return

    let rank = 0
    while (heap.size > 0) {
      const current = heap.pop()
      popRank[current] = rank++
      const currentSurface = surface[current]
      this.forEachNeighbor(mesh, current, (next) => {
        if (parent[next] !== -2)
          return
        parent[next] = current
        if (surface[next] < currentSurface)
          surface[next] = currentSurface
        heap.push(next)
      })
    }

    const wasDepression = new Uint8Array(n)
    for (let region = 0; region < n; region++) {
      if (elevation[region] > SEA_LEVEL && surface[region] > elevation[region])
        wasDepression[region] = 1
    }

    const visited = new Uint8Array(n)
    const queue = new Uint32Array(n)
    const affected = new Uint8Array(n)
    const carvedTarget = Float32Array.from(elevation)
    let anyAffected = false

    for (let start = 0; start < n; start++) {
      if (wasDepression[start] === 0 || visited[start] !== 0)
        continue
      let head = 0
      let tail = 0
      queue[tail++] = start
      visited[start] = 1
      let hasRepairedMember = false
      let entry = start
      let floor = Infinity
      while (head < tail) {
        const current = queue[head++]
        if (repaired[current] !== 0)
          hasRepairedMember = true
        if (popRank[current] < popRank[entry])
          entry = current
        if (elevation[current] < floor)
          floor = elevation[current]
        this.forEachNeighbor(mesh, current, (next) => {
          if (wasDepression[next] === 0 || visited[next] !== 0)
            return
          visited[next] = 1
          queue[tail++] = next
        })
      }
      const exitParent = parent[entry]
      const dammedByRepair = exitParent >= 0 && repaired[exitParent] !== 0
      if (!hasRepairedMember && !dammedByRepair)
        continue

      anyAffected = true
      for (let i = 0; i < tail; i++)
        affected[queue[i]] = 1

      const path: number[] = []
      let step = exitParent
      while (step >= 0 && elevation[step] > SEA_LEVEL) {
        path.push(step)
        step = parent[step]
      }
      path.reverse()
      for (let index = 0; index < path.length; index++) {
        const cell = path[index]
        affected[cell] = 1
        const fraction = (index + 1) / (path.length + 1)
        const ramp = BREACH_MOUTH_LEVEL + Math.max(0, floor - BREACH_MOUTH_LEVEL) * fraction
        if (elevation[cell] > ramp) {
          const carved = elevation[cell] - (elevation[cell] - ramp) * BREACH_CARVE_STRENGTH
          carvedTarget[cell] = Math.min(carvedTarget[cell], Math.max(BREACH_MOUTH_LEVEL, carved))
        }
      }
    }

    if (!anyAffected)
      return

    for (let region = 0; region < n; region++) {
      if (carvedTarget[region] < elevation[region]) {
        const previous = elevation[region]
        elevation[region] = carvedTarget[region]
        topologyDelta[region] += elevation[region] - previous
      }
    }

    const drainSurface = Float32Array.from(elevation)
    const drainParent = new Int32Array(n).fill(-2)
    const drainHeap = new StableSurfaceMinHeap(drainSurface)
    for (let region = 0; region < n; region++) {
      if (elevation[region] <= SEA_LEVEL) {
        drainParent[region] = -1
        drainHeap.push(region)
      }
    }

    while (drainHeap.size > 0) {
      const current = drainHeap.pop()
      const currentSurface = drainSurface[current]
      const currentBase = elevation[current] <= SEA_LEVEL ? 0 : currentSurface
      this.forEachNeighbor(mesh, current, (next) => {
        if (drainParent[next] !== -2)
          return
        drainParent[next] = current
        const preserveNaturalPit = wasDepression[next] !== 0 && affected[next] === 0
        if (!preserveNaturalPit && (affected[next] !== 0 || elevation[next] < currentSurface)) {
          let minimum = Math.fround(Math.max(BREACH_MOUTH_LEVEL, currentBase + BREACH_SLOPE_EPSILON))
          if (minimum <= currentBase)
            minimum = Math.fround(currentBase + Math.max(1e-6, Math.abs(currentBase) * 1e-6))
          if (elevation[next] < minimum) {
            const previous = elevation[next]
            elevation[next] = minimum
            topologyDelta[next] += elevation[next] - previous
          }
          drainSurface[next] = elevation[next]
        }
        else if (drainSurface[next] < currentSurface) {
          drainSurface[next] = currentSurface
        }
        drainHeap.push(next)
      })
    }
  }

  private forEachNeighbor(mesh: SphericalMesh, region: number, visit: (neighbor: number) => void): void {
    if (mesh.neighborOffsets && mesh.neighbors) {
      const start = mesh.neighborOffsets[region]
      const end = mesh.neighborOffsets[region + 1]
      for (let edge = start; edge < end; edge++)
        visit(mesh.neighbors[edge])
      return
    }
    for (const neighbor of mesh.forEachNeighborOfRegion(region))
      visit(neighbor)
  }
}
