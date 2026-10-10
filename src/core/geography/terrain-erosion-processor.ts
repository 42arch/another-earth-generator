import type SphericalMesh from '@/core/mesh/mesh'
import { clamp } from '@/core/math/math'
import { IndexPriorityQueue } from '@/core/math/priority-queue'

export interface TerrainErosionFields {
  flowReceiver: Int32Array
  flowAccumulation: Float32Array
  glacialIndex: Float32Array
  erosionDelta: Float32Array
  depositionDelta: Float32Array
}

export interface TerrainErosionOptions {
  glacial: number
  hydraulic: number
  /** Skip flow diagnostics when another pass will rebuild drainage later. */
  drainageDiagnostics?: boolean
}

const FLOOD_NOISE_AMPLITUDE = 0.01
const FLOOD_CARVE_RADIUS_FRACTION = 0.3
const FLOOD_EPSILON = 1e-7
const INITIAL_FLOOD_CARVE = 0.5
const MID_FLOOD_FRACTION = 0.75
const MID_FLOOD_CARVE = 0.85

const GLACIAL_LATITUDE_DIVISOR = 4.5
const GLACIAL_ELEVATION_LOW = 0.5
const GLACIAL_ELEVATION_HIGH = 0.9
const GLACIAL_ELEVATION_FACTOR_SCALE = 0.3
const GLACIAL_ELEVATION_LATITUDE_BASE = 0.3
const GLACIAL_ELEVATION_LATITUDE_SCALE = 0.7
const GLACIAL_CARVE_RATE = 0.025
const GLACIAL_CONVERGENCE_BONUS = 0.015
const GLACIAL_DEPOSIT_AMOUNT = 0.007
const GLACIAL_FJORD_CARVE = 0.02
const GLACIAL_FLOW_THRESHOLD = 0.1
const GLACIAL_FJORD_THRESHOLD = 0.5
const GLACIAL_WIDENING_FRACTION = 0.4
const GLACIAL_TERMINUS_RATIO = 0.3
const GLACIAL_FJORD_ICE_MINIMUM = 0.2
const GLACIAL_POST_SMOOTH = 0.3

const HYDRAULIC_DEPOSIT_FRACTION = 0.5
const HYDRAULIC_SLOPE_SENSITIVITY = 50

/** Reference-style glacial, stream-power and thermal erosion on the sphere. */
export class TerrainErosionProcessor {
  generate(
    mesh: SphericalMesh,
    elevation: Float32Array,
    oceanMask: Uint8Array,
    options: TerrainErosionOptions,
  ): TerrainErosionFields {
    const glacialStrength = clamp(options.glacial, 0, 1)
    const hydraulicStrength = clamp(options.hydraulic, 0, 1)
    const glacialIterations = Math.round(glacialStrength * 10)
    const hydraulicIterations = Math.round(hydraulicStrength * 20)
    const totalIterations = Math.max(
      glacialIterations,
      hydraulicIterations,
    )
    const before = Float32Array.from(elevation)
    const neighborDistance = this.buildNeighborDistances(mesh)
    const landRegions = this.collectLandRegions(mesh, oceanMask)
    const flowReceiver = new Int32Array(mesh.numRegions).fill(-1)
    const flowAccumulation = new Float32Array(mesh.numRegions)
    const cellDistance = new Float32Array(mesh.numRegions)
    const glacialIndex = this.buildGlacialIndex(
      mesh,
      elevation,
      oceanMask,
      glacialStrength,
    )

    if (totalIterations > 0 && landRegions.length > 0) {
      if (hydraulicIterations > 0)
        this.priorityFloodCarve(mesh, elevation, oceanMask, INITIAL_FLOOD_CARVE)

      const iceReceiver = new Int32Array(mesh.numRegions).fill(-1)
      const iceFlow = new Float32Array(mesh.numRegions)
      const iceUpstreamCount = new Uint8Array(mesh.numRegions)
      const middleFloodIteration = Math.round(totalIterations * MID_FLOOD_FRACTION)
      let middleFloodComplete = false

      for (let iteration = 0; iteration < totalIterations; iteration++) {
        if (hydraulicIterations > 0 && !middleFloodComplete && iteration >= middleFloodIteration) {
          middleFloodComplete = true
          this.priorityFloodCarve(mesh, elevation, oceanMask, MID_FLOOD_CARVE)
        }

        const applyGlacial = iteration < glacialIterations && glacialStrength > 0
        const applyHydraulic = iteration < hydraulicIterations
        if ((applyGlacial || applyHydraulic) && (iteration === 0 || iteration === middleFloodIteration || (iteration & 3) === 0))
          landRegions.sort((a, b) => elevation[b] - elevation[a])

        if (applyGlacial) {
          this.erodeGlacial(
            mesh,
            elevation,
            oceanMask,
            landRegions,
            neighborDistance,
            glacialIndex,
            iceReceiver,
            iceFlow,
            iceUpstreamCount,
            glacialIterations,
            glacialStrength,
          )
        }

        if (applyHydraulic) {
          this.buildDrainage(
            mesh,
            elevation,
            landRegions,
            neighborDistance,
            flowReceiver,
            flowAccumulation,
            cellDistance,
          )
          this.erodeHydraulic(
            elevation,
            oceanMask,
            landRegions,
            flowReceiver,
            flowAccumulation,
            cellDistance,
            hydraulicStrength * 0.0006,
          )
        }
      }

      if (glacialIterations > 0)
        this.smoothGlaciatedTerrain(mesh, elevation, oceanMask, glacialIndex)
    }

    if (options.drainageDiagnostics !== false) {
      landRegions.sort((a, b) => elevation[b] - elevation[a])
      this.buildDrainage(
        mesh,
        elevation,
        landRegions,
        neighborDistance,
        flowReceiver,
        flowAccumulation,
        cellDistance,
      )
    }

    const erosionDelta = new Float32Array(mesh.numRegions)
    const depositionDelta = new Float32Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      const difference = elevation[region] - before[region]
      if (difference < 0)
        erosionDelta[region] = -difference
      else
        depositionDelta[region] = difference
    }

    return {
      flowReceiver,
      flowAccumulation,
      glacialIndex,
      erosionDelta,
      depositionDelta,
    }
  }

  /** Rebuilds depression-resolved drainage after all terrain shaping is complete. */
  rebuildDrainage(
    mesh: SphericalMesh,
    elevation: Float32Array,
    oceanMask: Uint8Array,
    fields: TerrainErosionFields,
  ): void {
    const routedElevation = Float32Array.from(elevation)
    this.priorityFloodCarve(
      mesh,
      routedElevation,
      oceanMask,
      INITIAL_FLOOD_CARVE,
    )
    const landRegions = this.collectLandRegions(mesh, oceanMask)
    landRegions.sort((a, b) => routedElevation[b] - routedElevation[a])
    this.buildDrainage(
      mesh,
      routedElevation,
      landRegions,
      null,
      fields.flowReceiver,
      fields.flowAccumulation,
      new Float32Array(mesh.numRegions),
    )
  }

  private priorityFloodCarve(
    mesh: SphericalMesh,
    elevation: Float32Array,
    oceanMask: Uint8Array,
    carveStrength: number,
  ): void {
    const openOcean = this.findLargestOcean(mesh, oceanMask)
    const surface = Float32Array.from(elevation)
    const drainTo = new Int32Array(mesh.numRegions).fill(-1)
    const visited = Uint8Array.from(oceanMask)
    const queue = new IndexPriorityQueue(mesh.numRegions / 2)

    for (let region = 0; region < mesh.numRegions; region++) {
      if (oceanMask[region] !== 0)
        continue
      const nStart = mesh.neighborOffsets[region]
      const nEnd = mesh.neighborOffsets[region + 1]
      for (let n = nStart; n < nEnd; n++) {
        const neighbor = mesh.neighbors[n]
        if (openOcean[neighbor] === 0)
          continue
        visited[region] = 1
        drainTo[region] = neighbor
        queue.push(region, surface[region] + this.cellNoise(region))
        break
      }
    }

    while (queue.size > 0) {
      const current = queue.pop()
      const currentSurface = surface[current]
      const nStart = mesh.neighborOffsets[current]
      const nEnd = mesh.neighborOffsets[current + 1]
      for (let n = nStart; n < nEnd; n++) {
        const neighbor = mesh.neighbors[n]
        if (visited[neighbor] !== 0)
          continue
        visited[neighbor] = 1
        drainTo[neighbor] = current
        if (elevation[neighbor] < currentSurface + FLOOD_EPSILON)
          surface[neighbor] = currentSurface + FLOOD_EPSILON
        queue.push(neighbor, surface[neighbor] + this.cellNoise(neighbor))
      }
    }

    for (let region = 0; region < mesh.numRegions; region++) {
      if (oceanMask[region] !== 0)
        continue
      const deficit = surface[region] - elevation[region]
      if (deficit <= FLOOD_EPSILON)
        continue
      const path: number[] = []
      let peakIndex = -1
      let peakElevation = -Infinity
      let current = region
      while (current >= 0 && oceanMask[current] === 0) {
        path.push(current)
        if (elevation[current] > peakElevation) {
          peakElevation = elevation[current]
          peakIndex = path.length - 1
        }
        current = drainTo[current]
      }
      if (peakIndex < 0)
        continue
      const radius = Math.max(
        3,
        Math.ceil(path.length * FLOOD_CARVE_RADIUS_FRACTION),
      )
      const start = Math.max(0, peakIndex - radius)
      const end = Math.min(path.length - 1, peakIndex + radius)
      let weightSum = 0
      for (let index = start; index <= end; index++)
        weightSum += 1 - Math.abs(index - peakIndex) / (radius + 1)
      for (let index = start; index <= end; index++) {
        const weight = (1 - Math.abs(index - peakIndex) / (radius + 1)) / weightSum
        elevation[path[index]] = Math.max(
          0,
          elevation[path[index]] - deficit * carveStrength * weight,
        )
      }
      elevation[region] += deficit * (1 - carveStrength)
    }

    const orderedLand = this.collectLandRegions(mesh, oceanMask)
    orderedLand.sort((a, b) => surface[a] - surface[b])
    for (const region of orderedLand) {
      const target = drainTo[region]
      if (target < 0)
        continue
      const targetElevation = oceanMask[target] !== 0 ? 0 : elevation[target]
      if (elevation[region] <= targetElevation)
        elevation[region] = targetElevation + FLOOD_EPSILON
    }
  }

  private findLargestOcean(mesh: SphericalMesh, oceanMask: Uint8Array): Uint8Array {
    const labels = new Int32Array(mesh.numRegions).fill(-1)
    const componentSizes: number[] = []
    for (let region = 0; region < mesh.numRegions; region++) {
      if (oceanMask[region] === 0 || labels[region] >= 0)
        continue
      const label = componentSizes.length
      const queue = [region]
      labels[region] = label
      let size = 0
      while (queue.length > 0) {
        const current = queue.pop()!
        size++
        const nStart = mesh.neighborOffsets[current]
        const nEnd = mesh.neighborOffsets[current + 1]
        for (let n = nStart; n < nEnd; n++) {
          const neighbor = mesh.neighbors[n]
          if (oceanMask[neighbor] === 0 || labels[neighbor] >= 0)
            continue
          labels[neighbor] = label
          queue.push(neighbor)
        }
      }
      componentSizes.push(size)
    }
    let largestLabel = -1
    for (let label = 0; label < componentSizes.length; label++) {
      if (largestLabel < 0 || componentSizes[label] > componentSizes[largestLabel])
        largestLabel = label
    }
    const result = new Uint8Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      if (labels[region] === largestLabel)
        result[region] = 1
    }
    return result
  }

  private buildGlacialIndex(
    mesh: SphericalMesh,
    elevation: Float32Array,
    oceanMask: Uint8Array,
    strength: number,
  ): Float32Array {
    const result = new Float32Array(mesh.numRegions)
    if (strength <= 0)
      return result
    const thresholdLatitude = Math.PI / 2
      - strength * Math.PI / GLACIAL_LATITUDE_DIVISOR
    for (let region = 0; region < mesh.numRegions; region++) {
      if (oceanMask[region] !== 0)
        continue
      const latitude = Math.abs(mesh.regionLatitude[region])
      const latitudeFactor = this.smoothstep(
        thresholdLatitude,
        Math.PI / 2,
        latitude,
      )
      const elevationFactor = this.smoothstep(
        GLACIAL_ELEVATION_LOW,
        GLACIAL_ELEVATION_HIGH,
        elevation[region],
      )
      const latitudeScale = this.smoothstep(Math.PI / 8, Math.PI / 3, latitude)
      result[region] = Math.max(
        latitudeFactor,
        elevationFactor
        * GLACIAL_ELEVATION_FACTOR_SCALE
        * (
          GLACIAL_ELEVATION_LATITUDE_BASE
          + GLACIAL_ELEVATION_LATITUDE_SCALE * latitudeScale
        ),
      ) * strength
    }
    return result
  }

  private erodeGlacial(
    mesh: SphericalMesh,
    elevation: Float32Array,
    oceanMask: Uint8Array,
    landRegions: number[],
    neighborDistance: Float32Array | null,
    glacialIndex: Float32Array,
    iceReceiver: Int32Array,
    iceFlow: Float32Array,
    iceUpstreamCount: Uint8Array,
    iterations: number,
    strength: number,
  ): void {
    iceReceiver.fill(-1)
    iceUpstreamCount.fill(0)
    for (const region of landRegions) {
      if (glacialIndex[region] <= 0)
        continue
      let bestNeighbor = -1
      let bestDrop = 0
      const nStart = mesh.neighborOffsets[region]
      const nEnd = mesh.neighborOffsets[region + 1]
      for (let n = nStart; n < nEnd; n++) {
        const neighbor = mesh.neighbors[n]
        const drop = elevation[region] - elevation[neighbor]
        if (drop > bestDrop) {
          bestDrop = drop
          bestNeighbor = neighbor
        }
      }
      iceReceiver[region] = bestNeighbor
    }
    iceFlow.set(glacialIndex)
    for (const region of landRegions) {
      const target = iceReceiver[region]
      if (target < 0 || iceFlow[region] <= 0)
        continue
      iceFlow[target] += iceFlow[region]
      iceUpstreamCount[target]++
    }

    const iterationScale = 1 / Math.max(1, iterations)
    for (const region of landRegions) {
      if (iceFlow[region] <= GLACIAL_FLOW_THRESHOLD)
        continue
      const deepening = GLACIAL_CARVE_RATE
        * iterationScale
        * iceFlow[region] ** 0.6
        * strength
      elevation[region] -= deepening
      let adjacency = mesh.neighborOffsets[region]
      const nStart = mesh.neighborOffsets[region]
      const nEnd = mesh.neighborOffsets[region + 1]
      for (let n = nStart; n < nEnd; n++) {
        const neighbor = mesh.neighbors[n]
        if (oceanMask[neighbor] === 0) {
          const slope = Math.abs(elevation[region] - elevation[neighbor])
            / Math.max(neighborDistance![adjacency], 1e-6)
          elevation[neighbor] -= deepening
            * GLACIAL_WIDENING_FRACTION
            * Math.max(0, 1 - slope)
        }
        adjacency++
      }
      if (iceUpstreamCount[region] >= 2) {
        elevation[region] -= GLACIAL_CONVERGENCE_BONUS
          * iterationScale
          * iceFlow[region] ** 0.4
      }
    }

    for (const region of landRegions) {
      if (iceFlow[region] <= GLACIAL_FLOW_THRESHOLD)
        continue
      const target = iceReceiver[region]
      if (
        target >= 0
        && oceanMask[target] === 0
        && glacialIndex[target] < glacialIndex[region] * GLACIAL_TERMINUS_RATIO
      ) {
        elevation[target] += GLACIAL_DEPOSIT_AMOUNT
          * iterationScale
          * iceFlow[region] ** 0.3
      }
    }

    for (const region of landRegions) {
      if (
        glacialIndex[region] <= GLACIAL_FJORD_ICE_MINIMUM
        || iceFlow[region] <= GLACIAL_FJORD_THRESHOLD
      ) {
        continue
      }
      let coastal = false
      const nStart = mesh.neighborOffsets[region]
      const nEnd = mesh.neighborOffsets[region + 1]
      for (let n = nStart; n < nEnd; n++) {
        const neighbor = mesh.neighbors[n]
        if (oceanMask[neighbor] !== 0) {
          coastal = true
          break
        }
      }
      if (coastal) {
        elevation[region] = Math.max(
          0,
          elevation[region]
          - GLACIAL_FJORD_CARVE * iterationScale * iceFlow[region] ** 0.5,
        )
      }
    }
    for (const region of landRegions)
      elevation[region] = Math.max(0, elevation[region])
  }

  private buildDrainage(
    mesh: SphericalMesh,
    elevation: Float32Array,
    landRegions: number[],
    neighborDistance: Float32Array | null,
    receiver: Int32Array,
    flow: Float32Array,
    cellDistance: Float32Array,
  ): void {
    receiver.fill(-1)
    cellDistance.fill(0)
    for (const region of landRegions) {
      let bestNeighbor = -1
      let bestDrop = -Infinity
      let bestAdjacency = -1
      for (
        let adjacency = mesh.neighborOffsets[region];
        adjacency < mesh.neighborOffsets[region + 1];
        adjacency++
      ) {
        const neighbor = mesh.neighbors[adjacency]
        const drop = elevation[region] - elevation[neighbor]
        if (drop > bestDrop) {
          bestDrop = drop
          bestNeighbor = neighbor
          bestAdjacency = adjacency
        }
      }
      receiver[region] = bestNeighbor
      if (bestAdjacency >= 0) {
        cellDistance[region] = neighborDistance
          ? Math.max(neighborDistance[bestAdjacency], 1e-6)
          : 1
      }
    }
    flow.fill(0)
    for (const region of landRegions)
      flow[region] = 1
    for (const region of landRegions) {
      const target = receiver[region]
      if (target >= 0)
        flow[target] += flow[region]
    }
  }

  private erodeHydraulic(
    elevation: Float32Array,
    oceanMask: Uint8Array,
    landRegions: number[],
    receiver: Int32Array,
    flow: Float32Array,
    cellDistance: Float32Array,
    erosionCoefficient: number,
  ): void {
    for (let index = landRegions.length - 1; index >= 0; index--) {
      const region = landRegions[index]
      const target = receiver[region]
      if (target < 0 || cellDistance[region] <= 0)
        continue
      const factor = erosionCoefficient * Math.sqrt(flow[region])
        / cellDistance[region]
      const receiverElevation = Math.max(elevation[target], 0)
      const nextElevation = Math.max(
        receiverElevation,
        (elevation[region] + factor * receiverElevation) / (1 + factor),
      )
      const eroded = elevation[region] - nextElevation
      if (eroded > 0 && oceanMask[target] === 0) {
        const downstream = receiver[target]
        const receiverSlope = downstream >= 0 && cellDistance[target] > 0
          ? Math.abs(elevation[target] - elevation[downstream]) / cellDistance[target]
          : 0
        const depositFraction = HYDRAULIC_DEPOSIT_FRACTION
          / (1 + receiverSlope * HYDRAULIC_SLOPE_SENSITIVITY)
        elevation[target] = Math.min(
          nextElevation,
          elevation[target] + eroded * depositFraction,
        )
      }
      elevation[region] = nextElevation
    }
  }

  private smoothGlaciatedTerrain(
    mesh: SphericalMesh,
    elevation: Float32Array,
    oceanMask: Uint8Array,
    glacialIndex: Float32Array,
  ): void {
    const result = Float32Array.from(elevation)
    for (let region = 0; region < mesh.numRegions; region++) {
      if (oceanMask[region] !== 0 || glacialIndex[region] <= 0)
        continue
      let sum = 0
      let count = 0
      const nStart = mesh.neighborOffsets[region]
      const nEnd = mesh.neighborOffsets[region + 1]
      for (let n = nStart; n < nEnd; n++) {
        const neighbor = mesh.neighbors[n]
        if (oceanMask[neighbor] !== 0)
          continue
        sum += elevation[neighbor]
        count++
      }
      if (count > 0) {
        result[region] = elevation[region]
          + (sum / count - elevation[region]) * GLACIAL_POST_SMOOTH
      }
    }
    elevation.set(result)
  }

  private buildNeighborDistances(mesh: SphericalMesh): Float32Array {
    const result = new Float32Array(mesh.neighbors.length)
    for (let region = 0; region < mesh.numRegions; region++) {
      for (
        let adjacency = mesh.neighborOffsets[region];
        adjacency < mesh.neighborOffsets[region + 1];
        adjacency++
      ) {
        result[adjacency] = mesh.distanceBetweenRegions(
          region,
          mesh.neighbors[adjacency],
        )
      }
    }
    return result
  }

  private collectLandRegions(mesh: SphericalMesh, oceanMask: Uint8Array): number[] {
    const result: number[] = []
    for (let region = 0; region < mesh.numRegions; region++) {
      if (oceanMask[region] === 0)
        result.push(region)
    }
    return result
  }

  private cellNoise(region: number): number {
    let hash = Math.imul(region, 2654435761) >>> 0
    hash = Math.imul((hash >>> 16) ^ hash, 0x45D9F3B) >>> 0
    hash = ((hash >>> 16) ^ hash) >>> 0
    return hash / 0xFFFFFFFF * FLOOD_NOISE_AMPLITUDE
  }

  private smoothstep(edge0: number, edge1: number, value: number): number {
    const ratio = clamp((value - edge0) / (edge1 - edge0), 0, 1)
    return ratio * ratio * (3 - 2 * ratio)
  }
}
