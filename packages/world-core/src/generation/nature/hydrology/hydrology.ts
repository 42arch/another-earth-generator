import type { ClimateArtifact } from '#generation/nature/climate/climate'
import type { TerrainArtifact } from '#generation/nature/geography'
import type { SphericalMesh } from '#mesh/spherical-mesh'

export interface HydrologyParameters {
  /** Below this monthly mean temperature precipitation is treated as snow. °C */
  readonly snowTemperatureMinC: number
  /** Above this monthly mean temperature precipitation is treated as rain. °C */
  readonly snowTemperatureMaxC: number
  /** Snow melt per positive degree-month. mm / °C / month */
  readonly degreeDayMeltFactorMmPerCMonth: number
  /** Temperature-index potential evapotranspiration. mm / °C / month */
  readonly evapotranspirationFactorMmPerCMonth: number
  /** Minimum contributing area for river cells, before the mesh support floor. km² */
  readonly minimumRiverDrainageAreaKm2: number
}

export const DEFAULT_HYDROLOGY_PARAMETERS: Readonly<HydrologyParameters> = Object.freeze({
  snowTemperatureMinC: -2,
  snowTemperatureMaxC: 2,
  degreeDayMeltFactorMmPerCMonth: 3,
  evapotranspirationFactorMmPerCMonth: 2,
  minimumRiverDrainageAreaKm2: 5000,
})

export interface CryosphereArtifact {
  readonly meshId: string
  readonly terrainMeshId: string
  readonly climateMeshId: string
  readonly algorithmVersion: 'cryosphere-i0-v1'
  readonly monthsPerYear: 12
  readonly layout: 'month-major'
  readonly regionCount: number
  /** End-of-month snow water equivalent, mm. Persistent glacier ice is not modeled. */
  readonly monthlySnowWaterEquivalentMm: Float32Array
  /** Snowfall input, mm/month; allows the annual snow storage ledger to be audited. */
  readonly monthlySnowfallMm: Float32Array
  /** Snowmelt supplied to surface water in each month, mm/month. */
  readonly monthlySnowmeltMm: Float32Array
  readonly annualSnowmeltMm: Float32Array
}

export interface BasinSummary {
  readonly id: string
  readonly outletRegion: number
  readonly endorheic: boolean
  readonly areaKm2: number
  readonly annualRunoffM3: number
}

export interface RiverSegment {
  readonly id: string
  readonly sourceRegion: number
  readonly mouthRegion: number
  /** Index into rivers; -1 if this segment ends at an outlet or below threshold. */
  readonly downstreamRiver: number
  readonly annualMeanDischargeM3s: number
  readonly strahlerOrder: number
  readonly endorheic: boolean
  readonly regions: Uint32Array
}

export interface HydrologyArtifact {
  readonly meshId: string
  readonly terrainMeshId: string
  readonly climateMeshId: string
  readonly cryosphereMeshId: string
  readonly algorithmVersion: 'hydrology-h0-v2'
  readonly regionCount: number
  readonly monthsPerYear: 12
  readonly layout: 'month-major'
  /** Monthly actual evapotranspiration, mm/month. */
  readonly monthlyEvapotranspirationMm: Float32Array
  /** Monthly surface runoff after evapotranspiration, mm/month. */
  readonly monthlyRunoffMm: Float32Array
  readonly annualRunoffMm: Float32Array
  /** Local annual runoff converted to m³/year, before upstream accumulation. */
  readonly annualRunoffVolumeM3: Float64Array
  /** Flow through each region after upstream accumulation, m³/s. */
  readonly accumulatedAnnualFlowM3s: Float64Array
  /** Land contributing area accumulated at each region, km². */
  readonly contributingAreaKm2: Float64Array
  /** Instant receiver, -1 at an ocean outlet or the internal sink. */
  readonly downstreamRegion: Int32Array
  /** Priority-flood routing surface. It does not replace terrain elevation. km. */
  readonly filledElevationKm: Float32Array
  /** Index into basins, -1 for ocean. */
  readonly basinIndex: Int32Array
  readonly basins: readonly BasinSummary[]
  /** 1 where contributing land area meets the configured threshold. */
  readonly riverMask: Uint8Array
  /** Index into rivers or -1 for non-river regions. */
  readonly riverIndex: Int32Array
  readonly rivers: readonly RiverSegment[]
  readonly effectiveRiverThresholdKm2: number
}

function requireFiniteArray(array: Float32Array | Float64Array, label: string, min = 0): void {
  for (let i = 0; i < array.length; i++) {
    if (!Number.isFinite(array[i]) || array[i] < min)
      throw new Error(`Invalid ${label} at ${i}`)
  }
}

export function validateCryosphereArtifact(value: CryosphereArtifact | null | undefined, meshId?: string, regionCount?: number): void {
  if (!value)
    throw new Error('Invalid cryosphere artifact structure')
  const expectedMeshId = meshId ?? value.meshId
  const expectedRegionCount = regionCount ?? value.regionCount
  if (value.meshId !== expectedMeshId || value.terrainMeshId !== expectedMeshId || value.climateMeshId !== expectedMeshId
    || value.algorithmVersion !== 'cryosphere-i0-v1' || value.monthsPerYear !== 12 || value.layout !== 'month-major'
    || value.regionCount !== expectedRegionCount
    || !(value.monthlySnowWaterEquivalentMm instanceof Float32Array) || value.monthlySnowWaterEquivalentMm.length !== 12 * expectedRegionCount
    || !(value.monthlySnowfallMm instanceof Float32Array) || value.monthlySnowfallMm.length !== 12 * expectedRegionCount
    || !(value.monthlySnowmeltMm instanceof Float32Array) || value.monthlySnowmeltMm.length !== 12 * expectedRegionCount
    || !(value.annualSnowmeltMm instanceof Float32Array) || value.annualSnowmeltMm.length !== expectedRegionCount) {
    throw new Error('Invalid cryosphere artifact structure')
  }
  requireFiniteArray(value.monthlySnowWaterEquivalentMm, 'snow water equivalent')
  requireFiniteArray(value.monthlySnowfallMm, 'snowfall')
  requireFiniteArray(value.monthlySnowmeltMm, 'snowmelt')
  requireFiniteArray(value.annualSnowmeltMm, 'annual snowmelt')
  for (let r = 0; r < expectedRegionCount; r++) {
    let melt = 0
    for (let month = 0; month < 12; month++)
      melt += value.monthlySnowmeltMm[month * expectedRegionCount + r]
    if (Math.abs(melt - value.annualSnowmeltMm[r]) > Math.max(0.01, melt * 1e-5))
      throw new Error(`Invalid annual snowmelt at region ${r}`)
  }
}

/** Deterministic monthly temperature-index snow storage. No persistent glacier mass balance is implied. */
export function generateCryosphereI0(mesh: SphericalMesh, terrain: Pick<TerrainArtifact, 'meshId' | 'landMask'>, climate: Pick<ClimateArtifact, 'meshId' | 'regionCount' | 'temperatureC' | 'precipitationMm'>, parameters: Pick<HydrologyParameters, 'snowTemperatureMinC' | 'snowTemperatureMaxC' | 'degreeDayMeltFactorMmPerCMonth'>, check?: (fraction: number) => void): CryosphereArtifact {
  const n = mesh.regionCount
  if (terrain.meshId !== mesh.meshId || climate.meshId !== mesh.meshId || climate.regionCount !== n || terrain.landMask.length !== n || !(climate.temperatureC instanceof Float32Array) || climate.temperatureC.length !== 12 * n || !(climate.precipitationMm instanceof Float32Array) || climate.precipitationMm.length !== 12 * n)
    throw new Error('Cryosphere input mesh mismatch')
  if (!(parameters.snowTemperatureMinC < parameters.snowTemperatureMaxC)
    || !Number.isFinite(parameters.degreeDayMeltFactorMmPerCMonth) || parameters.degreeDayMeltFactorMmPerCMonth < 0) {
    throw new RangeError('Invalid cryosphere parameters')
  }
  const snow = new Float32Array(12 * n)
  const snowfall = new Float32Array(12 * n)
  const melt = new Float32Array(12 * n)
  const annualMelt = new Float32Array(n)
  for (let r = 0; r < n; r++) {
    if ((r & 255) === 0)
      check?.(r / n)
    if (!terrain.landMask[r])
      continue
    let storage = 0
    for (let month = 0; month < 12; month++) {
      const index = month * n + r
      const temperature = climate.temperatureC[index]
      const precipitation = climate.precipitationMm[index]
      if (!Number.isFinite(temperature) || !Number.isFinite(precipitation) || precipitation < 0)
        throw new Error(`Invalid climate input at month ${month}, region ${r}`)
      const snowFraction = Math.max(0, Math.min(1, (parameters.snowTemperatureMaxC - temperature) / (parameters.snowTemperatureMaxC - parameters.snowTemperatureMinC)))
      const snowAmount = precipitation * snowFraction
      snowfall[index] = Math.fround(snowAmount)
      storage += snowAmount
      const amount = Math.min(storage, Math.max(0, temperature) * parameters.degreeDayMeltFactorMmPerCMonth)
      storage -= amount
      snow[index] = Math.fround(storage)
      melt[index] = Math.fround(amount)
      annualMelt[r] += amount
    }
  }
  const artifact: CryosphereArtifact = { meshId: mesh.meshId, terrainMeshId: terrain.meshId, climateMeshId: climate.meshId, algorithmVersion: 'cryosphere-i0-v1', monthsPerYear: 12, layout: 'month-major', regionCount: n, monthlySnowWaterEquivalentMm: snow, monthlySnowfallMm: snowfall, monthlySnowmeltMm: melt, annualSnowmeltMm: annualMelt }
  validateCryosphereArtifact(artifact)
  return artifact
}

class StableMinHeap {
  readonly #values: number[] = []
  readonly #elevation: Float32Array
  constructor(elevation: Float32Array) { this.#elevation = elevation }
  #less(a: number, b: number): boolean { return this.#elevation[a] < this.#elevation[b] || (this.#elevation[a] === this.#elevation[b] && a < b) }
  push(value: number): void {
    let i = this.#values.length
    this.#values.push(value)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.#less(value, this.#values[p]))
        break
      this.#values[i] = this.#values[p]
      i = p
    }
    this.#values[i] = value
  }

  pop(): number {
    const first = this.#values[0]
    const last = this.#values.pop()!
    if (this.#values.length) {
      let i = 0
      while (true) {
        const left = i * 2 + 1
        if (left >= this.#values.length)
          break
        const right = left + 1
        const child = right < this.#values.length && this.#less(this.#values[right], this.#values[left]) ? right : left
        if (!this.#less(this.#values[child], last))
          break
        this.#values[i] = this.#values[child]
        i = child
      }
      this.#values[i] = last
    }
    return first
  }

  get size(): number { return this.#values.length }
}

function priorityFlood(mesh: SphericalMesh, terrain: Pick<TerrainArtifact, 'elevationKm' | 'landMask'>, check?: (fraction: number) => void) {
  const n = mesh.regionCount
  const filled = Float32Array.from(terrain.elevationKm)
  const downstream = new Int32Array(n).fill(-2)
  const order = new Uint32Array(n)
  const heap = new StableMinHeap(filled)
  let count = 0
  for (let r = 0; r < n; r++) {
    if (!terrain.landMask[r]) {
      downstream[r] = -1
      heap.push(r)
    }
  }
  if (!heap.size) {
    let root = 0
    for (let r = 1; r < n; r++) {
      if (filled[r] < filled[root])
        root = r
    }
    downstream[root] = -1
    heap.push(root)
  }
  while (heap.size) {
    const current = heap.pop()
    if ((count & 1023) === 0)
      check?.(0.2 + 0.35 * count / n)
    order[count++] = current
    for (let e = mesh.neighborOffsets[current]; e < mesh.neighborOffsets[current + 1]; e++) {
      const next = mesh.neighbors[e]
      if (downstream[next] !== -2)
        continue
      downstream[next] = current
      if (filled[next] < filled[current])
        filled[next] = filled[current]
      heap.push(next)
    }
  }
  if (count !== n)
    throw new Error('Priority flood did not visit every region')
  return { filled, downstream, order }
}

function buildRiverSegments(mesh: SphericalMesh, downstream: Int32Array, mask: Uint8Array, discharge: Float64Array, endorheic: Uint8Array): { rivers: RiverSegment[], riverIndex: Int32Array } {
  const n = mesh.regionCount
  const upstreamCount = new Uint32Array(n)
  for (let r = 0; r < n; r++) {
    if (mask[r] && downstream[r] >= 0)
      upstreamCount[downstream[r]]++
  }
  const starts: number[] = []
  for (let r = 0; r < n; r++) {
    if (mask[r] && upstreamCount[r] !== 1)
      starts.push(r)
  }
  const regionToRiver = new Int32Array(n).fill(-1)
  const segments: { id: string, sourceRegion: number, mouthRegion: number, downstreamRegion: number, annualMeanDischargeM3s: number, regions: Uint32Array, endorheic: boolean }[] = []
  for (const start of starts) {
    const path: number[] = []
    let current = start
    while (true) {
      path.push(current)
      const next = downstream[current]
      if (next < 0 || !mask[next] || upstreamCount[next] !== 1)
        break
      current = next
    }
    const index = segments.length
    for (const region of path) regionToRiver[region] = index
    const mouthRegion = path[path.length - 1]
    segments.push({ id: `${mesh.meshId}:river:${start}`, sourceRegion: start, mouthRegion, downstreamRegion: downstream[mouthRegion], annualMeanDischargeM3s: discharge[start], regions: Uint32Array.from(path), endorheic: endorheic[start] !== 0 })
  }
  const upstream = segments.map(() => [] as number[])
  const downstreamRiver = new Int32Array(segments.length).fill(-1)
  for (let i = 0; i < segments.length; i++) {
    const nextRegion = segments[i].downstreamRegion
    if (nextRegion >= 0 && regionToRiver[nextRegion] >= 0) {
      const next = regionToRiver[nextRegion]
      if (next !== i) {
        downstreamRiver[i] = next
        upstream[next].push(i)
      }
    }
  }
  const order = new Uint8Array(segments.length)
  const pending = Uint32Array.from(upstream, list => list.length)
  const queue: number[] = []
  for (let i = 0; i < pending.length; i++) {
    if (!pending[i]) {
      order[i] = 1
      queue.push(i)
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]
    const next = downstreamRiver[i]
    if (next < 0)
      continue
    const incomingOrders = upstream[next].map(source => order[source])
    const maximum = Math.max(...incomingOrders)
    pending[next]--
    if (!pending[next]) {
      order[next] = Math.min(255, maximum + (incomingOrders.filter(value => value === maximum).length > 1 ? 1 : 0))
      queue.push(next)
    }
  }
  return { rivers: segments.map((segment, i) => ({ id: segment.id, sourceRegion: segment.sourceRegion, mouthRegion: segment.mouthRegion, downstreamRiver: downstreamRiver[i], annualMeanDischargeM3s: segment.annualMeanDischargeM3s, strahlerOrder: order[i] || 1, endorheic: segment.endorheic, regions: segment.regions })), riverIndex: regionToRiver }
}

/** Generates preliminary annual runoff, routing, drainage basins and thresholded river segments. */
export function generateHydrologyH0(mesh: SphericalMesh, terrain: Pick<TerrainArtifact, 'meshId' | 'elevationKm' | 'landMask'>, climate: Pick<ClimateArtifact, 'meshId' | 'regionCount' | 'temperatureC' | 'precipitationMm'>, cryosphere: CryosphereArtifact, parameters: Pick<HydrologyParameters, 'evapotranspirationFactorMmPerCMonth' | 'minimumRiverDrainageAreaKm2'> & { readonly orbitalPeriodDays: number }, check?: (fraction: number) => void): HydrologyArtifact {
  const n = mesh.regionCount
  if (terrain.meshId !== mesh.meshId || climate.meshId !== mesh.meshId || cryosphere.meshId !== mesh.meshId || climate.regionCount !== n || cryosphere.regionCount !== n || terrain.elevationKm.length !== n || terrain.landMask.length !== n || !(climate.temperatureC instanceof Float32Array) || climate.temperatureC.length !== 12 * n || !(climate.precipitationMm instanceof Float32Array) || climate.precipitationMm.length !== 12 * n)
    throw new Error('Hydrology input mesh mismatch')
  validateCryosphereArtifact(cryosphere, mesh.meshId, n)
  if (!Number.isFinite(parameters.evapotranspirationFactorMmPerCMonth) || parameters.evapotranspirationFactorMmPerCMonth < 0 || !Number.isFinite(parameters.minimumRiverDrainageAreaKm2) || parameters.minimumRiverDrainageAreaKm2 < 0 || !(parameters.orbitalPeriodDays > 0) || !Number.isFinite(parameters.orbitalPeriodDays))
    throw new RangeError('Invalid hydrology parameters')
  const monthlyEvap = new Float32Array(12 * n)
  const monthlyRunoff = new Float32Array(12 * n)
  const annualRunoff = new Float32Array(n)
  const localVolume = new Float64Array(n)
  const landArea = new Float64Array(n)
  for (let r = 0; r < n; r++) {
    if ((r & 255) === 0)
      check?.(0.2 * r / n)
    if (!terrain.landMask[r])
      continue
    landArea[r] = mesh.areaKm2[r]
    let year = 0
    for (let month = 0; month < 12; month++) {
      const i = month * n + r
      const precipitation = climate.precipitationMm[i]
      const temperature = climate.temperatureC[i]
      const melt = cryosphere.monthlySnowmeltMm[i]
      if (!Number.isFinite(precipitation) || precipitation < 0 || !Number.isFinite(temperature) || !Number.isFinite(melt) || melt < 0)
        throw new Error(`Invalid water balance input at month ${month}, region ${r}`)
      const liquid = Math.max(0, precipitation - cryosphere.monthlySnowfallMm[i]) + melt
      const evap = Math.min(liquid, Math.max(0, temperature) * parameters.evapotranspirationFactorMmPerCMonth)
      const runoff = Math.max(0, liquid - evap)
      monthlyEvap[i] = Math.fround(evap)
      monthlyRunoff[i] = Math.fround(runoff)
      year += monthlyRunoff[i]
    }
    annualRunoff[r] = Math.fround(year)
    localVolume[r] = annualRunoff[r] * mesh.areaKm2[r] * 1000
  }
  const { filled, downstream, order } = priorityFlood(mesh, terrain, check)
  const basinRoot = Int32Array.from({ length: n }, (_, r) => terrain.landMask[r] ? -2 : -1)
  for (let i = 0; i < n; i++) {
    if ((i & 1023) === 0)
      check?.(0.6 + 0.1 * i / n)
    const r = order[i]
    if (terrain.landMask[r]) {
      const receiver = downstream[r]
      basinRoot[r] = receiver < 0 ? r : terrain.landMask[receiver] ? basinRoot[receiver] : receiver
    }
  }
  const accumulatedVolume = localVolume.slice()
  for (let i = n - 1; i >= 0; i--) {
    if ((i & 1023) === 0)
      check?.(0.7 + 0.1 * (n - i) / n)
    const r = order[i]
    if (downstream[r] >= 0)
      accumulatedVolume[downstream[r]] += accumulatedVolume[r]
  }
  const roots = [...new Set(Array.from(basinRoot).filter(root => root >= 0))].sort((a, b) => a - b)
  const rootToIndex = new Map(roots.map((root, i) => [root, i]))
  const basinIndex = Int32Array.from(basinRoot, root => root < 0 ? -1 : rootToIndex.get(root)!)
  const basinAreas = new Float64Array(roots.length)
  for (let r = 0; r < n; r++) {
    if (basinIndex[r] >= 0)
      basinAreas[basinIndex[r]] += landArea[r]
  }
  const basins: BasinSummary[] = roots.map((root, index) => {
    return { id: `${mesh.meshId}:basin:${root}`, outletRegion: root, endorheic: downstream[root] < 0 && terrain.landMask[root] !== 0, areaKm2: basinAreas[index], annualRunoffM3: accumulatedVolume[root] }
  })
  const yearSeconds = parameters.orbitalPeriodDays * 86400
  const accumulatedFlow = new Float64Array(n)
  for (let r = 0; r < n; r++) accumulatedFlow[r] = accumulatedVolume[r] / yearSeconds
  const threshold = Math.max(parameters.minimumRiverDrainageAreaKm2, mesh.areaKm2.reduce((sum, area) => sum + area, 0) / n * 16)
  const contributingArea = new Float64Array(n)
  for (let r = 0; r < n; r++) {
    if (terrain.landMask[r])
      contributingArea[r] = landArea[r]
  }
  for (let i = n - 1; i >= 0; i--) {
    const r = order[i]
    if (downstream[r] >= 0)
      contributingArea[downstream[r]] += contributingArea[r]
  }
  const riverMask = Uint8Array.from({ length: n }, (_, r) => terrain.landMask[r] && contributingArea[r] >= threshold && accumulatedFlow[r] > 0 ? 1 : 0)
  const endorheicCells = Uint8Array.from({ length: n }, (_, r) => basinIndex[r] >= 0 && basins[basinIndex[r]].endorheic ? 1 : 0)
  const { rivers, riverIndex } = buildRiverSegments(mesh, downstream, riverMask, accumulatedFlow, endorheicCells)
  check?.(1)
  const artifact: HydrologyArtifact = { meshId: mesh.meshId, terrainMeshId: terrain.meshId, climateMeshId: climate.meshId, cryosphereMeshId: cryosphere.meshId, algorithmVersion: 'hydrology-h0-v2', regionCount: n, monthsPerYear: 12, layout: 'month-major', monthlyEvapotranspirationMm: monthlyEvap, monthlyRunoffMm: monthlyRunoff, annualRunoffMm: annualRunoff, annualRunoffVolumeM3: localVolume, accumulatedAnnualFlowM3s: accumulatedFlow, contributingAreaKm2: contributingArea, downstreamRegion: downstream, filledElevationKm: filled, basinIndex, basins, riverMask, riverIndex, rivers, effectiveRiverThresholdKm2: threshold }
  validateHydrologyArtifact(artifact, mesh, terrain, climate, cryosphere)
  return artifact
}

export function validateHydrologyArtifact(value: HydrologyArtifact | null | undefined, mesh?: SphericalMesh, terrain?: Pick<TerrainArtifact, 'meshId' | 'elevationKm' | 'landMask'>, climate?: Pick<ClimateArtifact, 'meshId' | 'regionCount' | 'temperatureC' | 'precipitationMm'>, cryosphere?: CryosphereArtifact): void {
  if (!value)
    throw new Error('Invalid hydrology artifact structure')
  const n = value.regionCount
  if (value.algorithmVersion !== 'hydrology-h0-v2' || value.monthsPerYear !== 12 || value.layout !== 'month-major' || !value.meshId || value.terrainMeshId !== value.meshId || value.climateMeshId !== value.meshId || value.cryosphereMeshId !== value.meshId
    || !Array.isArray(value.basins) || !Array.isArray(value.rivers)
    || (mesh && value.meshId !== mesh.meshId) || (terrain && value.terrainMeshId !== terrain.meshId) || (climate && value.climateMeshId !== climate.meshId) || (cryosphere && value.cryosphereMeshId !== cryosphere.meshId)
    || !Number.isInteger(n) || n < 1
    || !(value.monthlyEvapotranspirationMm instanceof Float32Array) || value.monthlyEvapotranspirationMm.length !== 12 * n
    || !(value.monthlyRunoffMm instanceof Float32Array) || value.monthlyRunoffMm.length !== 12 * n
    || !(value.annualRunoffMm instanceof Float32Array) || value.annualRunoffMm.length !== n
    || !(value.annualRunoffVolumeM3 instanceof Float64Array) || value.annualRunoffVolumeM3.length !== n
    || !(value.accumulatedAnnualFlowM3s instanceof Float64Array) || value.accumulatedAnnualFlowM3s.length !== n
    || !(value.contributingAreaKm2 instanceof Float64Array) || value.contributingAreaKm2.length !== n
    || !(value.downstreamRegion instanceof Int32Array) || value.downstreamRegion.length !== n
    || !(value.filledElevationKm instanceof Float32Array) || value.filledElevationKm.length !== n
    || !(value.basinIndex instanceof Int32Array) || value.basinIndex.length !== n
    || !(value.riverMask instanceof Uint8Array) || value.riverMask.length !== n || !(value.riverIndex instanceof Int32Array) || value.riverIndex.length !== n || !Number.isFinite(value.effectiveRiverThresholdKm2) || value.effectiveRiverThresholdKm2 < 0) {
    throw new Error('Invalid hydrology artifact structure')
  }
  requireFiniteArray(value.monthlyEvapotranspirationMm, 'monthly evapotranspiration')
  requireFiniteArray(value.monthlyRunoffMm, 'monthly runoff')
  requireFiniteArray(value.annualRunoffMm, 'annual runoff')
  requireFiniteArray(value.annualRunoffVolumeM3, 'runoff volume')
  requireFiniteArray(value.accumulatedAnnualFlowM3s, 'accumulated annual flow')
  requireFiniteArray(value.contributingAreaKm2, 'contributing area')
  requireFiniteArray(value.filledElevationKm, 'filled elevation', -Infinity)
  if (mesh && mesh.regionCount !== n)
    throw new Error('Hydrology Mesh region count mismatch')
  if (terrain && (terrain.landMask.length !== n || terrain.elevationKm.length !== n))
    throw new Error('Hydrology terrain array length mismatch')
  if (climate && (climate.regionCount !== n || climate.precipitationMm.length !== 12 * n || climate.temperatureC.length !== 12 * n))
    throw new Error('Hydrology climate array length mismatch')
  if (cryosphere && cryosphere.regionCount !== n)
    throw new Error('Hydrology cryosphere array length mismatch')
  for (let r = 0; r < n; r++) {
    const downstream = value.downstreamRegion[r]
    if (downstream < -1 || downstream >= n || downstream === r)
      throw new Error(`Invalid downstream region at ${r}`)
    if (mesh && downstream >= 0) {
      let adjacent = false
      for (let i = mesh.neighborOffsets[r]; i < mesh.neighborOffsets[r + 1]; i++) {
        if (mesh.neighbors[i] === downstream) {
          adjacent = true
          break
        }
      }
      if (!adjacent)
        throw new Error(`Downstream region is not adjacent at ${r}`)
    }
    if (value.basinIndex[r] < -1 || value.basinIndex[r] >= value.basins.length || value.riverMask[r] > 1 || value.riverIndex[r] < -1 || value.riverIndex[r] >= value.rivers.length || Boolean(value.riverMask[r]) !== (value.riverIndex[r] >= 0))
      throw new Error(`Invalid basin or river mask at ${r}`)
    if (terrain && Boolean(terrain.landMask[r]) !== (value.basinIndex[r] >= 0))
      throw new Error(`Invalid land basin assignment at ${r}`)
    if (downstream >= 0 && value.filledElevationKm[downstream] > value.filledElevationKm[r])
      throw new Error(`Priority-flood routing increases elevation at ${r}`)
    let annual = 0
    for (let month = 0; month < 12; month++) annual += value.monthlyRunoffMm[month * n + r]
    if (Math.abs(annual - value.annualRunoffMm[r]) > Math.max(0.01, annual * 1e-5))
      throw new Error(`Invalid annual runoff aggregation at ${r}`)
  }
  const state = new Uint8Array(n)
  for (let r = 0; r < n; r++) {
    let current = r
    while (current >= 0 && state[current] === 0) {
      state[current] = 1
      current = value.downstreamRegion[current]
    }
    if (current >= 0 && state[current] === 1)
      throw new Error(`Hydrology downstream graph has a cycle at ${current}`)
    current = r
    while (current >= 0 && state[current] === 1) {
      state[current] = 2
      current = value.downstreamRegion[current]
    }
  }
  for (const [i, basin] of value.basins.entries()) {
    if (!basin.id || !Number.isInteger(basin.outletRegion) || basin.outletRegion < 0 || basin.outletRegion >= n || !Number.isFinite(basin.areaKm2) || basin.areaKm2 < 0 || !Number.isFinite(basin.annualRunoffM3) || basin.annualRunoffM3 < 0)
      throw new Error(`Invalid basin summary ${i}`)
  }
  if (new Set(value.basins.map(basin => basin.id)).size !== value.basins.length)
    throw new Error('Duplicate basin IDs')
  for (const [i, river] of value.rivers.entries()) {
    if (!river.id || typeof river.endorheic !== 'boolean' || !(river.regions instanceof Uint32Array) || !river.regions.length || river.sourceRegion !== river.regions[0] || river.mouthRegion !== river.regions.at(-1) || river.downstreamRiver < -1 || river.downstreamRiver >= value.rivers.length || !Number.isFinite(river.annualMeanDischargeM3s) || river.annualMeanDischargeM3s < 0 || !Number.isInteger(river.strahlerOrder) || river.strahlerOrder < 1)
      throw new Error(`Invalid river segment ${i}`)
    for (let j = 0; j < river.regions.length; j++) {
      const region = river.regions[j]
      if (region >= n || !value.riverMask[region] || value.riverIndex[region] !== i)
        throw new Error(`Invalid river path region in segment ${i}`)
      if (j && value.downstreamRegion[river.regions[j - 1]] !== region)
        throw new Error(`Discontinuous river path in segment ${i}`)
    }
    if (river.downstreamRiver >= 0 && value.rivers[river.downstreamRiver].sourceRegion !== value.downstreamRegion[river.mouthRegion])
      throw new Error(`Invalid river segment connection ${i}`)
  }
  if (new Set(value.rivers.map(river => river.id)).size !== value.rivers.length)
    throw new Error('Duplicate river IDs')
  const riverState = new Uint8Array(value.rivers.length)
  for (let i = 0; i < value.rivers.length; i++) {
    let current = i
    while (current >= 0 && riverState[current] === 0) {
      riverState[current] = 1
      current = value.rivers[current].downstreamRiver
    }
    if (current >= 0 && riverState[current] === 1)
      throw new Error(`River network has a cycle at segment ${current}`)
    current = i
    while (current >= 0 && riverState[current] === 1) {
      riverState[current] = 2
      current = value.rivers[current].downstreamRiver
    }
  }
}

export function queryHydrologyRegion(hydro: HydrologyArtifact, region: number, climate?: ClimateArtifact, cryosphere?: CryosphereArtifact) {
  if (!Number.isInteger(region) || region < 0 || region >= hydro.regionCount)
    throw new RangeError('Invalid hydrology region')
  const n = hydro.regionCount
  const evapotranspiration = new Float32Array(12)
  const runoff = new Float32Array(12)
  const precipitation = new Float32Array(12)
  const snowmelt = new Float32Array(12)
  for (let month = 0; month < 12; month++) {
    const i = month * n + region
    precipitation[month] = climate?.precipitationMm[i] ?? 0
    evapotranspiration[month] = hydro.monthlyEvapotranspirationMm[i]
    runoff[month] = hydro.monthlyRunoffMm[i]
    snowmelt[month] = cryosphere?.monthlySnowmeltMm[i] ?? 0
  }
  const basin = hydro.basins[hydro.basinIndex[region]]
  const riverIndex = hydro.riverIndex[region]
  const river = riverIndex >= 0 ? hydro.rivers[riverIndex] : undefined
  return { region, annualRunoffMm: hydro.annualRunoffMm[region], annualRunoffVolumeM3: hydro.annualRunoffVolumeM3[region], accumulatedFlowM3s: hydro.accumulatedAnnualFlowM3s[region], contributingAreaKm2: hydro.contributingAreaKm2[region], downstreamRegion: hydro.downstreamRegion[region], filledElevationKm: hydro.filledElevationKm[region], basinId: basin?.id ?? null, basinOutletRegion: basin?.outletRegion ?? null, basinAreaKm2: basin?.areaKm2 ?? 0, basinAnnualRunoffM3: basin?.annualRunoffM3 ?? 0, basinEndorheic: basin?.endorheic ?? false, riverSegments: river ? [{ id: river.id, sourceRegion: river.sourceRegion, mouthRegion: river.mouthRegion, downstreamRiver: river.downstreamRiver, dischargeM3s: river.annualMeanDischargeM3s, strahlerOrder: river.strahlerOrder, endorheic: river.endorheic }] : [], monthlyPrecipitationMm: precipitation, monthlyEvapotranspirationMm: evapotranspiration, monthlyRunoffMm: runoff, monthlySnowmeltMm: snowmelt, meshId: hydro.meshId }
}
