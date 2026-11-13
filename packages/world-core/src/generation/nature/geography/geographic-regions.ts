import type { GeologyArtifact } from '../geology/types'
import type { SphericalMesh } from '#mesh/spherical-mesh'

type GeographicMesh = Pick<SphericalMesh, 'meshId' | 'regionCount' | 'areaKm2' | 'neighborOffsets' | 'neighbors' | 'neighborEdges' | 'edgeAngularDistances' | 'physicalRadiusKm'>

export interface GeographicRegionsArtifact {
  readonly meshId: string
  readonly algorithmVersion: 'geographic-regions-v3'
  /** Set by geographic-names, using the content signature that supplied the lexicon. */
  readonly nameContentSignature?: string
  /** -1 on water; indices address continents. */
  readonly continentIndex: Int32Array
  /** -1 outside an open ocean region. */
  readonly oceanIndex: Int32Array
  /** -1 outside a coastal or enclosed sea region. */
  readonly seaIndex: Int32Array
  readonly continents: readonly { readonly id: string, readonly areaKm2: number, readonly name?: string }[]
  readonly oceans: readonly { readonly id: string, readonly areaKm2: number, readonly name?: string }[]
  readonly seas: readonly { readonly id: string, readonly areaKm2: number }[]
}

interface HeapEntry { region: number, continent: number, distance: number }

class DistanceHeap {
  private entries: HeapEntry[] = []
  get size() { return this.entries.length }
  push(entry: HeapEntry) {
    const heap = this.entries
    let i = heap.length
    heap.push(entry)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (compare(heap[parent], entry) <= 0) break
      heap[i] = heap[parent]
      i = parent
    }
    heap[i] = entry
  }
  pop(): HeapEntry {
    const heap = this.entries
    const first = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      let i = 0
      while (2 * i + 1 < heap.length) {
        let child = 2 * i + 1
        if (child + 1 < heap.length && compare(heap[child + 1], heap[child]) < 0) child++
        if (compare(last, heap[child]) <= 0) break
        heap[i] = heap[child]
        i = child
      }
      heap[i] = last
    }
    return first
  }
}

function compare(a: HeapEntry, b: HeapEntry) {
  return a.distance - b.distance || a.continent - b.continent || a.region - b.region
}

/** Split broad connected water into basins only where land creates a marked clearance saddle. */
function splitOceanBasins(mesh: GeographicMesh, coastDistance: Float64Array, oceanIndex: Int32Array, oceans: { id: string, areaKm2: number }[], checkpoint: () => void): void {
  if (!oceans.length) return
  const original = oceanIndex.slice()
  const members: number[][] = Array.from({ length: oceans.length }, () => [])
  for (let region = 0; region < mesh.regionCount; region++)
    if (original[region] >= 0) members[original[region]].push(region)
  const revised: { id: string, areaKm2: number }[] = []
  const widest = new Float64Array(mesh.regionCount)
  const owner = new Int32Array(mesh.regionCount).fill(-1)
  const travel = new Float64Array(mesh.regionCount).fill(Infinity)
  const heap = new DistanceHeap()
  const edgeDistance = (edge: number) => mesh.edgeAngularDistances[mesh.neighborEdges[edge]] * mesh.physicalRadiusKm

  for (let basin = 0; basin < oceans.length; basin++) {
    const cells = members[basin]
    if (!cells.length) continue
    const peaks = cells.filter((region) => {
      for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
        const next = mesh.neighbors[edge]
        if (original[next] === basin && (coastDistance[next] > coastDistance[region] || (coastDistance[next] === coastDistance[region] && next < region))) return false
      }
      return true
    }).sort((a, b) => coastDistance[b] - coastDistance[a] || a - b)
    if (!peaks.length) throw new Error('Ocean basin has no interior maximum')
    const maximum = coastDistance[peaks[0]]
    const selected: number[] = []
    const addClearance = (seed: number) => {
      widest[seed] = coastDistance[seed]
      heap.push({ region: seed, continent: -1, distance: -widest[seed] })
      while (heap.size) {
        checkpoint()
        const { region, distance } = heap.pop()
        const clearance = -distance
        if (clearance !== widest[region]) continue
        for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
          const next = mesh.neighbors[edge]
          const candidate = Math.min(clearance, coastDistance[next])
          if (original[next] !== basin || candidate <= widest[next]) continue
          widest[next] = candidate
          heap.push({ region: next, continent: -1, distance: -candidate })
        }
      }
    }
    for (const peak of peaks) {
      checkpoint()
      if (coastDistance[peak] < maximum * 0.45) break
      if (!selected.length || widest[peak] < coastDistance[peak] * 0.55) {
        selected.push(peak)
        addClearance(peak)
      }
    }

    const partition = (seeds: readonly number[]) => {
      for (const region of cells) {
        owner[region] = -1
        travel[region] = Infinity
      }
      for (let index = 0; index < seeds.length; index++) {
        const region = seeds[index]
        owner[region] = index
        travel[region] = 0
        heap.push({ region, continent: index, distance: 0 })
      }
      while (heap.size) {
        checkpoint()
        const { region, continent: source, distance } = heap.pop()
        if (distance !== travel[region] || source !== owner[region]) continue
        for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
          const next = mesh.neighbors[edge]
          const candidate = distance + edgeDistance(edge)
          if (original[next] !== basin || candidate > travel[next] || (candidate === travel[next] && source >= owner[next])) continue
          owner[next] = source
          travel[next] = candidate
          heap.push({ region: next, continent: source, distance: candidate })
        }
      }
      const areas = new Float64Array(seeds.length)
      for (const region of cells) {
        if (owner[region] < 0) throw new Error('Ocean cell has no basin seed')
        areas[owner[region]] += mesh.areaKm2[region]
      }
      return areas
    }
    let areas = selected.length > 1 ? partition(selected) : new Float64Array([oceans[basin].areaKm2])
    if (selected.length > 1) {
      const largest = areas.reduce((best, area, index) => area > areas[best] ? index : best, 0)
      const kept = selected.filter((_, index) => index === largest || areas[index] >= oceans[basin].areaKm2 * 0.08)
      if (kept.length < selected.length) {
        selected.splice(0, selected.length, ...kept)
        areas = partition(selected)
      }
    }
    const indexes = selected.map((seed, index) => {
      const next = revised.length
      revised.push({ id: `ocean:${mesh.meshId}:${seed}`, areaKm2: areas[index] })
      return next
    })
    if (selected.length === 1) {
      for (const region of cells) oceanIndex[region] = indexes[0]
    }
    else {
      for (const region of cells) oceanIndex[region] = indexes[owner[region]]
    }
  }
  oceans.splice(0, oceans.length, ...revised)
}

/** Final land is grouped by connected mass and its dominant candidate ancestry. */
export function generateGeographicRegions(mesh: GeographicMesh, landMask: Uint8Array, geology: Pick<GeologyArtifact, 'meshId' | 'continents' | 'nearestContinentIndex'>, checkCancelled?: () => void): GeographicRegionsArtifact {
  const count = mesh.regionCount
  if (geology.meshId !== mesh.meshId || landMask.length !== count || geology.nearestContinentIndex.length !== count)
    throw new Error('Geographic regions require matching final terrain and geology meshes')
  const landComponent = new Int32Array(count).fill(-1)
  const waterComponent = new Int32Array(count).fill(-1)
  const queue = new Uint32Array(count)
  const landGroups: { first: number, area: number, source: number }[] = []
  const waterGroups: { first: number, area: number }[] = []
  let steps = 0
  const checkpoint = () => { if ((steps++ & 4095) === 0) checkCancelled?.() }
  for (let start = 0; start < count; start++) {
    const land = landMask[start] !== 0
    const assignment = land ? landComponent : waterComponent
    if (assignment[start] >= 0) continue
    const index = land ? landGroups.length : waterGroups.length
    assignment[start] = index
    queue[0] = start
    let end = 1
    let area = 0
    const ancestry = new Map<number, number>()
    for (let head = 0; head < end; head++) {
      checkpoint()
      const region = queue[head]
      const regionArea = mesh.areaKm2[region]
      area += regionArea
      if (land) {
        const candidate = geology.nearestContinentIndex[region]
        if (candidate >= 0) ancestry.set(candidate, (ancestry.get(candidate) ?? 0) + regionArea)
      }
      for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
        const next = mesh.neighbors[edge]
        if (Boolean(landMask[next]) !== land || assignment[next] >= 0) continue
        assignment[next] = index
        queue[end++] = next
      }
    }
    if (land) {
      const source = [...ancestry].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? -1
      landGroups.push({ first: start, area, source })
    }
    else waterGroups.push({ first: start, area })
  }

  const continentIndex = new Int32Array(count).fill(-1)
  const continents: { id: string, areaKm2: number }[] = []
  const continentBySource = new Map<number, number>()
  const groupContinent = new Int32Array(landGroups.length)
  for (let group = 0; group < landGroups.length; group++) {
    const source = landGroups[group].source
    let index = source >= 0 ? continentBySource.get(source) : undefined
    if (index === undefined) {
      index = continents.length
      continents.push({ id: source >= 0 ? geology.continents[source].id : `continent:${mesh.meshId}:${landGroups[group].first}`, areaKm2: 0 })
      if (source >= 0) continentBySource.set(source, index)
    }
    continents[index].areaKm2 += landGroups[group].area
    groupContinent[group] = index
  }
  for (let region = 0; region < count; region++)
    if (landComponent[region] >= 0) continentIndex[region] = groupContinent[landComponent[region]]

  const oceanIndex = new Int32Array(count).fill(-1)
  const seaIndex = new Int32Array(count).fill(-1)
  const oceans: { id: string, areaKm2: number }[] = []
  const seas: { id: string, areaKm2: number }[] = []
  const result = (): GeographicRegionsArtifact => ({ meshId: mesh.meshId, algorithmVersion: 'geographic-regions-v3', continentIndex, oceanIndex, seaIndex, continents, oceans, seas })
  if (!waterGroups.length) return result()
  if (!landGroups.length) {
    oceans.push({ id: `ocean:${mesh.meshId}:0`, areaKm2: waterGroups[0].area })
    oceanIndex.fill(0)
    return result()
  }

  // A sea has a sheltered interior behind a constriction. Eroding a physical
  // coastal band breaks narrow entrances without turning every coast into sea.
  const meanCellWidthKm = Math.sqrt(mesh.areaKm2.reduce((sum, area) => sum + area, 0) / count)
  const neckWidthKm = Math.max(2 * meanCellWidthKm, 0.03 * mesh.physicalRadiusKm)
  const coastDistance = new Float64Array(count).fill(Infinity)
  const heap = new DistanceHeap()
  const edgeDistance = (edge: number) => mesh.edgeAngularDistances[mesh.neighborEdges[edge]] * mesh.physicalRadiusKm
  for (let region = 0; region < count; region++) {
    if (continentIndex[region] < 0) continue
    for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
      const next = mesh.neighbors[edge]
      const distance = edgeDistance(edge)
      if (waterComponent[next] < 0 || distance >= coastDistance[next]) continue
      coastDistance[next] = distance
      heap.push({ region: next, continent: -1, distance })
    }
  }
  while (heap.size) {
    checkpoint()
    const { region, distance } = heap.pop()
    if (distance !== coastDistance[region]) continue
    for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
      const next = mesh.neighbors[edge]
      const candidate = distance + edgeDistance(edge)
      if (waterComponent[next] < 0 || candidate >= coastDistance[next]) continue
      coastDistance[next] = candidate
      heap.push({ region: next, continent: -1, distance: candidate })
    }
  }

  const coreIndex = new Int32Array(count).fill(-1)
  const cores: { first: number, area: number, maxDistance: number, waterGroup: number }[] = []
  for (let start = 0; start < count; start++) {
    if (waterComponent[start] < 0 || coastDistance[start] < neckWidthKm || coreIndex[start] >= 0) continue
    const index = cores.length
    const core = { first: start, area: 0, maxDistance: 0, waterGroup: waterComponent[start] }
    cores.push(core)
    coreIndex[start] = index
    queue[0] = start
    let end = 1
    for (let head = 0; head < end; head++) {
      checkpoint()
      const region = queue[head]
      core.area += mesh.areaKm2[region]
      core.maxDistance = Math.max(core.maxDistance, coastDistance[region])
      for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
        const next = mesh.neighbors[edge]
        if (waterComponent[next] !== core.waterGroup || coastDistance[next] < neckWidthKm || coreIndex[next] >= 0) continue
        coreIndex[next] = index
        queue[end++] = next
      }
    }
  }
  // Tiny or coarse water components can have no eroded core. Retain each as a
  // sea candidate by its farthest water cell.
  const represented = new Uint8Array(waterGroups.length)
  for (const core of cores) represented[core.waterGroup] = 1
  const farthestRegion = new Int32Array(waterGroups.length).fill(-1)
  for (let region = 0; region < count; region++) {
    const group = waterComponent[region]
    if (group < 0 || represented[group]) continue
    const best = farthestRegion[group]
    if (best < 0 || coastDistance[region] > coastDistance[best]) farthestRegion[group] = region
  }
  for (let group = 0; group < waterGroups.length; group++) {
    if (represented[group]) continue
    const best = farthestRegion[group]
    if (best >= 0) {
      coreIndex[best] = cores.length
      cores.push({ first: best, area: mesh.areaKm2[best], maxDistance: coastDistance[best], waterGroup: group })
    }
  }
  const globalMaxDistance = cores.reduce((best, core) => Math.max(best, core.maxDistance), 0)
  const totalCoreArea = cores.reduce((sum, core) => sum + core.area, 0)
  const openWater = waterGroups.reduce((best, group, index) => group.area > waterGroups[best].area ? index : best, 0)
  const largestCore = cores.reduce((best, core, index) => core.waterGroup === openWater && (best < 0 || core.area > cores[best].area) ? index : best, -1)
  const coreKind = cores.map((core, index) => core.maxDistance >= neckWidthKm && (index === largestCore || (core.maxDistance >= globalMaxDistance * 0.5 && core.area >= totalCoreArea * 0.08)) ? 'ocean' as const : 'sea' as const)
  const coreResultIndex = cores.map((core, index) => {
    const table = coreKind[index] === 'ocean' ? oceans : seas
    const resultIndex = table.length
    table.push({ id: `${coreKind[index]}:${mesh.meshId}:${core.first}`, areaKm2: 0 })
    return resultIndex
  })
  // Each coastal cell inherits its nearest open-water core through water only.
  const owner = new Int32Array(count).fill(-1)
  const travel = new Float64Array(count).fill(Infinity)
  for (let region = 0; region < count; region++) {
    if (coreIndex[region] < 0) continue
    owner[region] = coreIndex[region]
    travel[region] = 0
    heap.push({ region, continent: coreIndex[region], distance: 0 })
  }
  while (heap.size) {
    checkpoint()
    const { region, continent: core, distance } = heap.pop()
    if (distance !== travel[region] || core !== owner[region]) continue
    for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
      const next = mesh.neighbors[edge]
      const candidate = distance + edgeDistance(edge)
      if (waterComponent[next] < 0 || candidate > travel[next] || (candidate === travel[next] && core >= owner[next])) continue
      travel[next] = candidate
      owner[next] = core
      heap.push({ region: next, continent: core, distance: candidate })
    }
  }
  for (let region = 0; region < count; region++) {
    if (waterComponent[region] < 0) continue
    const core = owner[region]
    if (core < 0) throw new Error(`Water region ${region} has no sea or ocean core`)
    const index = coreResultIndex[core]
    if (coreKind[core] === 'ocean') {
      oceanIndex[region] = index
      oceans[index].areaKm2 += mesh.areaKm2[region]
    }
    else {
      seaIndex[region] = index
      seas[index].areaKm2 += mesh.areaKm2[region]
    }
  }
  splitOceanBasins(mesh, coastDistance, oceanIndex, oceans, checkpoint)
  return result()
}

export function validateGeographicRegions(value: GeographicRegionsArtifact, meshId: string, count: number, landMask: Uint8Array): void {
  if (value.meshId !== meshId || value.algorithmVersion !== 'geographic-regions-v3' || !(value.continentIndex instanceof Int32Array) || !(value.oceanIndex instanceof Int32Array) || !(value.seaIndex instanceof Int32Array) || value.continentIndex.length !== count || value.oceanIndex.length !== count || value.seaIndex.length !== count || !Array.isArray(value.continents) || !Array.isArray(value.oceans) || !Array.isArray(value.seas))
    throw new Error('Invalid geographic regions artifact')
  const ids = new Set<string>()
  for (const item of [...value.continents, ...value.oceans, ...value.seas]) {
    if (!item.id || ids.has(item.id) || !(item.areaKm2 > 0)) throw new Error('Invalid geographic region identity or area')
    ids.add(item.id)
  }
  for (let region = 0; region < count; region++) {
    const land = Boolean(landMask[region])
    const continent = value.continentIndex[region]
    const ocean = value.oceanIndex[region]
    const sea = value.seaIndex[region]
    if ((land && (continent < 0 || continent >= value.continents.length || ocean !== -1 || sea !== -1)) || (!land && (continent !== -1 || (ocean >= 0) === (sea >= 0) || ocean >= value.oceans.length || sea >= value.seas.length || ocean < -1 || sea < -1)))
      throw new Error(`Invalid geographic assignment at region ${region}`)
  }
}
