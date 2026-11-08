import type { TerrainArtifact } from '#generation/nature/geography'
import type { SphericalMesh } from '#mesh/spherical-mesh'
import type { HydrologyArtifact } from './hydrology'

const MINIMUM_LAKE_REGION_COUNT = 2
const LAKE_ALGORITHM_VERSION = 'static-lakes-l1-v4' as const

export interface StaticLake {
  readonly id: string
  /** H0 basin that receives runoff from the lake's terrain depression. */
  readonly basinId: string
  /** True when the H0 basin terminates at an internal sink rather than ocean. */
  readonly endorheic: boolean
  readonly areaKm2: number
  /** Static spill surface inferred from the Priority Flood surface. km. */
  readonly waterLevelKm: number
  /** Region on the lake rim that routes out; null for a terminal sink. */
  readonly spillRegion: number | null
  /** Immediate H0 receiver after the spill region; null for a terminal sink. */
  readonly downstreamRegion: number | null
  readonly regions: Uint32Array
}

export interface StaticLakeArtifact {
  readonly meshId: string
  readonly terrainMeshId: string
  readonly hydrologyMeshId: string
  readonly algorithmVersion: typeof LAKE_ALGORITHM_VERSION
  readonly regionCount: number
  /** Index into lakes, or -1 when the region is not a static lake. */
  readonly lakeIndex: Int32Array
  readonly lakes: readonly StaticLake[]
  readonly minimumLakeRegionCount: typeof MINIMUM_LAKE_REGION_COUNT
}

function assertFinite(values: ArrayLike<number>, label: string, minimum = -Infinity): void {
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i]) || values[i] < minimum)
      throw new Error(`Invalid ${label} at ${i}`)
  }
}

/**
 * Finds retained terrain depressions from the difference between T0 elevation and
 * H0's spill surface. The spill surface remains a routing diagnostic; this output
 * does not modify terrain or claim dynamic lake storage.
 */
export function generateStaticLakesL1(mesh: SphericalMesh, terrain: Pick<TerrainArtifact, 'meshId' | 'elevationKm' | 'landMask'>, hydrology: HydrologyArtifact, check?: (fraction: number) => void): StaticLakeArtifact {
  const n = mesh.regionCount
  if (terrain.meshId !== mesh.meshId || hydrology.meshId !== mesh.meshId || hydrology.terrainMeshId !== mesh.meshId
    || terrain.elevationKm.length !== n || terrain.landMask.length !== n || hydrology.regionCount !== n
    || hydrology.filledElevationKm.length !== n || hydrology.downstreamRegion.length !== n || hydrology.basinIndex.length !== n) {
    throw new Error('Static lake input mesh mismatch')
  }

  const visited = new Uint8Array(n)
  const queue = new Uint32Array(n)
  const lakeIndex = new Int32Array(n).fill(-1)
  const lakes: StaticLake[] = []
  let processedRegions = 0

  for (let start = 0; start < n; start++) {
    if (visited[start] || !terrain.landMask[start] || !(hydrology.filledElevationKm[start] > terrain.elevationKm[start]))
      continue

    let head = 0
    let tail = 0
    queue[tail++] = start
    visited[start] = 1
    const members: number[] = []
    let areaKm2 = 0
    let waterLevelKm = -Infinity
    while (head < tail) {
      if ((processedRegions++ & 1023) === 0)
        check?.(processedRegions / n)
      const region = queue[head++]
      members.push(region)
      areaKm2 += mesh.areaKm2[region]
      waterLevelKm = Math.max(waterLevelKm, hydrology.filledElevationKm[region])
      for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
        const next = mesh.neighbors[edge]
        if (!visited[next] && terrain.landMask[next] && hydrology.filledElevationKm[next] > terrain.elevationKm[next]) {
          visited[next] = 1
          queue[tail++] = next
        }
      }
    }
    if (members.length < MINIMUM_LAKE_REGION_COUNT)
      continue

    members.sort((a, b) => a - b)
    const memberSet = new Set(members)
    const basinIndex = hydrology.basinIndex[members[0]]
    if (basinIndex < 0 || basinIndex >= hydrology.basins.length)
      throw new Error(`Static lake has no H0 basin at region ${members[0]}`)
    if (members.some(region => hydrology.basinIndex[region] !== basinIndex))
      throw new Error(`Static lake crosses H0 basin boundaries at region ${members[0]}`)
    const basin = hydrology.basins[basinIndex]

    let spillRegion: number | null = null
    for (const region of members) {
      const downstream = hydrology.downstreamRegion[region]
      if (downstream < 0 || memberSet.has(downstream))
        continue
      if (spillRegion === null
        || terrain.elevationKm[region] > terrain.elevationKm[spillRegion]
        || (terrain.elevationKm[region] === terrain.elevationKm[spillRegion] && region < spillRegion)) {
        spillRegion = region
      }
    }
    const routedRegion = spillRegion === null ? -1 : hydrology.downstreamRegion[spillRegion]
    if (routedRegion < 0)
      spillRegion = null
    const downstreamRegion = spillRegion === null ? null : routedRegion
    const index = lakes.length
    const lake: StaticLake = {
      id: `${mesh.meshId}:lake:${members[0]}`,
      basinId: basin.id,
      endorheic: basin.endorheic || downstreamRegion === null,
      areaKm2,
      waterLevelKm,
      spillRegion,
      downstreamRegion,
      regions: Uint32Array.from(members),
    }
    lakes.push(lake)
    for (const region of members)
      lakeIndex[region] = index
  }

  const artifact: StaticLakeArtifact = {
    meshId: mesh.meshId,
    terrainMeshId: terrain.meshId,
    hydrologyMeshId: hydrology.meshId,
    algorithmVersion: LAKE_ALGORITHM_VERSION,
    regionCount: n,
    lakeIndex,
    lakes,
    minimumLakeRegionCount: MINIMUM_LAKE_REGION_COUNT,
  }
  validateStaticLakeArtifact(artifact, mesh, terrain, hydrology)
  check?.(1)
  return artifact
}

export function validateStaticLakeArtifact(value: StaticLakeArtifact | null | undefined, mesh?: SphericalMesh, terrain?: Pick<TerrainArtifact, 'meshId' | 'elevationKm' | 'landMask'>, hydrology?: HydrologyArtifact): void {
  if (!value)
    throw new Error('Invalid static lake artifact structure')
  const n = value.regionCount
  if (value.algorithmVersion !== LAKE_ALGORITHM_VERSION || !value.meshId || value.terrainMeshId !== value.meshId || value.hydrologyMeshId !== value.meshId
    || !Number.isInteger(n) || n < 1 || !(value.lakeIndex instanceof Int32Array) || value.lakeIndex.length !== n || !Array.isArray(value.lakes)
    || value.minimumLakeRegionCount !== MINIMUM_LAKE_REGION_COUNT
    || (mesh && (mesh.meshId !== value.meshId || mesh.regionCount !== n))
    || (terrain && (terrain.meshId !== value.terrainMeshId || terrain.elevationKm.length !== n || terrain.landMask.length !== n))
    || (hydrology && (hydrology.meshId !== value.hydrologyMeshId || hydrology.regionCount !== n))) {
    throw new Error('Invalid static lake artifact structure')
  }

  const seen = new Uint8Array(n)
  for (let region = 0; region < n; region++) {
    const index = value.lakeIndex[region]
    if (index < -1 || index >= value.lakes.length)
      throw new Error(`Invalid lake index at region ${region}`)
    if (index >= 0 && terrain && !terrain.landMask[region])
      throw new Error(`Ocean region belongs to a static lake at ${region}`)
  }
  for (let index = 0; index < value.lakes.length; index++) {
    const lake: StaticLake = value.lakes[index]
    if (!lake.id || !lake.basinId || typeof lake.endorheic !== 'boolean' || !(lake.regions instanceof Uint32Array) || !lake.regions.length
      || lake.regions.length < value.minimumLakeRegionCount || !Number.isFinite(lake.areaKm2) || lake.areaKm2 <= 0 || !Number.isFinite(lake.waterLevelKm)
      || (lake.spillRegion !== null && (!Number.isInteger(lake.spillRegion) || lake.spillRegion < 0 || lake.spillRegion >= n))
      || (lake.downstreamRegion !== null && (!Number.isInteger(lake.downstreamRegion) || lake.downstreamRegion < 0 || lake.downstreamRegion >= n))
      || (lake.spillRegion === null) !== (lake.downstreamRegion === null)) {
      throw new Error(`Invalid static lake ${index}`)
    }
    let areaKm2 = 0
    const lakeMembers = new Set<number>()
    for (let position = 0; position < lake.regions.length; position++) {
      const region = lake.regions[position]
      if (region >= n || seen[region] || value.lakeIndex[region] !== index || (terrain && !terrain.landMask[region]))
        throw new Error(`Invalid region in static lake ${index}`)
      if (position && lake.regions[position - 1] >= region)
        throw new Error(`Static lake regions are not sorted in ${index}`)
      seen[region] = 1
      lakeMembers.add(region)
      if (mesh)
        areaKm2 += mesh.areaKm2[region]
      if (terrain && !(lake.waterLevelKm > terrain.elevationKm[region]))
        throw new Error(`Static lake water level is below region ${region}`)
    }
    if (mesh) {
      const pending = [lake.regions[0]]
      const connected = new Set<number>(pending)
      for (let head = 0; head < pending.length; head++) {
        const region = pending[head]
        for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
          const next = mesh.neighbors[edge]
          if (lakeMembers.has(next) && !connected.has(next)) {
            connected.add(next)
            pending.push(next)
          }
        }
      }
      if (connected.size !== lake.regions.length)
        throw new Error(`Static lake regions are disconnected in ${index}`)
    }
    if (hydrology) {
      const basinIndex = hydrology.basinIndex[lake.regions[0]]
      if (basinIndex < 0 || hydrology.basins[basinIndex]?.id !== lake.basinId || lake.regions.some(region => hydrology.basinIndex[region] !== basinIndex))
        throw new Error(`Invalid H0 basin reference in static lake ${index}`)
    }
    if (mesh && Math.abs(areaKm2 - lake.areaKm2) > Math.max(0.01, areaKm2 * 1e-6))
      throw new Error(`Invalid static lake area ${index}`)
    if (lake.spillRegion !== null && (!lake.regions.includes(lake.spillRegion) || (hydrology && hydrology.downstreamRegion[lake.spillRegion] !== lake.downstreamRegion)))
      throw new Error(`Invalid static lake spill reference ${index}`)
  }
  if (new Set(value.lakes.map(lake => lake.id)).size !== value.lakes.length)
    throw new Error('Duplicate static lake IDs')
  assertFinite(value.lakeIndex, 'lake indices')
}

export function queryStaticLakeRegion(lakes: StaticLakeArtifact, region: number): StaticLake | null {
  if (!Number.isInteger(region) || region < 0 || region >= lakes.regionCount)
    throw new RangeError('Invalid static lake region')
  const index = lakes.lakeIndex[region]
  if (index < 0)
    return null
  return { ...lakes.lakes[index], regions: lakes.lakes[index].regions.slice() }
}
