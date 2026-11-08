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
// Suppress detached sub-sea fragments smaller than four L5 display regions.
const MIN_WATER_COMPONENT_AREA = 4 * (4 * Math.PI / (10 * 4 ** 5 + 2))

interface RankedLandRegion {
  region: number
  elevation: number
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

  /** Reapply the small-water-component filter after later terrain shaping passes. */
  repairSeaConnectivity(
    mesh: SphericalMesh,
    elevation: Float32Array,
    topologyDelta: Float32Array,
    topologyChanged: Uint8Array,
  ): void {
    if (elevation.length !== mesh.numRegions || topologyDelta.length !== mesh.numRegions || topologyChanged.length !== mesh.numRegions)
      throw new Error('Sea connectivity repair mesh mismatch')
    this.fillSmallWaterComponents(mesh, elevation, topologyDelta, topologyChanged)
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
  ): void {
    const visited = new Uint8Array(mesh.numRegions)
    const queue = new Uint32Array(mesh.numRegions)
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
        for (const neighbor of mesh.forEachNeighborOfRegion(current)) {
          if (visited[neighbor] !== 0 || elevation[neighbor] > SEA_LEVEL)
            continue
          visited[neighbor] = 1
          queue[tail++] = neighbor
        }
      }
      if (componentArea >= MIN_WATER_COMPONENT_AREA)
        continue
      for (let i = 0; i < tail; i++) {
        const member = queue[i]
        const previous = elevation[member]
        elevation[member] = FILL_LEVEL
        topologyDelta[member] += FILL_LEVEL - previous
        topologyChanged[member] = 1
      }
    }
  }
}
