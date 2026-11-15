import type { GeologyArtifact, HydrologyArtifact, SphericalMesh, StaticLakeArtifact, TerrainArtifact } from '../src/index'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus, platform, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { expect, it } from 'vitest'
import { createHydrologyPipeline, DEFAULT_CLIMATE_PARAMETERS, DEFAULT_GEOLOGY_PARAMETERS, DEFAULT_HYDROLOGY_PARAMETERS, DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS, StageCache } from '../src/index'

function digest(array: Float32Array | Float64Array | Int32Array | Uint8Array | Uint32Array): string {
  return createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex')
}

function digestLakes(value: StaticLakeArtifact): string {
  const summaries = value.lakes.map(lake => ({ ...lake, regions: digest(lake.regions) }))
  return createHash('sha256').update(digest(value.lakeIndex)).update(JSON.stringify(summaries)).digest('hex')
}

function lakeShapeSummaries(mesh: SphericalMesh, value: StaticLakeArtifact, hydrology: HydrologyArtifact) {
  return value.lakes.map((lake) => {
    const members = new Set(lake.regions)
    let perimeterKm = 0
    let riverRegions = 0
    for (const region of lake.regions) {
      if (hydrology.riverMask[region])
        riverRegions++
      for (let slot = mesh.neighborOffsets[region]; slot < mesh.neighborOffsets[region + 1]; slot++) {
        if (members.has(mesh.neighbors[slot]))
          continue
        const edge = mesh.neighborEdges[slot]
        const leftTriangle = mesh.edgeTriangles[2 * edge]
        const rightTriangle = mesh.edgeTriangles[2 * edge + 1]
        const a = 3 * leftTriangle
        const b = 3 * rightTriangle
        const dot = mesh.dualVertices[a] * mesh.dualVertices[b] + mesh.dualVertices[a + 1] * mesh.dualVertices[b + 1] + mesh.dualVertices[a + 2] * mesh.dualVertices[b + 2]
        perimeterKm += Math.acos(Math.max(-1, Math.min(1, dot))) * mesh.physicalRadiusKm
      }
    }
    return { regions: lake.regions.length, areaKm2: lake.areaKm2, perimeterKm, compactness: 4 * Math.PI * lake.areaKm2 / (perimeterKm ** 2), riverRegionFraction: riverRegions / lake.regions.length }
  })
}

function typedArrayBytes(value: unknown, buffers = new Set<ArrayBuffer>()): number {
  if (!value || typeof value !== 'object')
    return 0
  if (ArrayBuffer.isView(value)) {
    if (!(value.buffer instanceof ArrayBuffer) || buffers.has(value.buffer))
      return 0
    buffers.add(value.buffer)
    return value.buffer.byteLength
  }
  return Object.values(value).reduce((sum, child) => sum + typedArrayBytes(child, buffers), 0)
}

function waterComponentStats(mesh: SphericalMesh, terrain: TerrainArtifact, geology: GeologyArtifact) {
  const visited = new Uint8Array(mesh.regionCount)
  const queue = new Uint32Array(mesh.regionCount)
  const minimumAreaKm2 = 4 * (4 * Math.PI / (10 * 4 ** 5 + 2)) * mesh.physicalRadiusKm ** 2
  let oceanComponents = 0
  let enclosedWaterComponents = 0
  let smallEnclosedWaterComponents = 0
  let largestEnclosedWaterAreaKm2 = 0
  for (let region = 0; region < mesh.regionCount; region++) {
    if (terrain.landMask[region] || visited[region])
      continue
    let head = 0
    let tail = 0
    let areaKm2 = 0
    let touchesCandidateOcean = false
    queue[tail++] = region
    visited[region] = 1
    while (head < tail) {
      const current = queue[head++]
      areaKm2 += mesh.areaKm2[current]
      touchesCandidateOcean ||= geology.candidateLandMask[current] === 0
      for (let edge = mesh.neighborOffsets[current]; edge < mesh.neighborOffsets[current + 1]; edge++) {
        const neighbor = mesh.neighbors[edge]
        if (terrain.landMask[neighbor] || visited[neighbor])
          continue
        visited[neighbor] = 1
        queue[tail++] = neighbor
      }
    }
    if (touchesCandidateOcean) {
      oceanComponents++
      continue
    }
    enclosedWaterComponents++
    largestEnclosedWaterAreaKm2 = Math.max(largestEnclosedWaterAreaKm2, areaKm2)
    if (areaKm2 < minimumAreaKm2)
      smallEnclosedWaterComponents++
  }
  return { oceanComponents, enclosedWaterComponents, smallEnclosedWaterComponents, largestEnclosedWaterAreaKm2, minimumAreaKm2 }
}

it('records I0/H0 fixed-seed output, cache invalidation and array resource bytes', async () => {
  const seeds = process.env.HYDROLOGY_BENCH_SEEDS?.split(',') ?? ['42']
  const levels = process.env.HYDROLOGY_BENCH_LEVELS?.split(',').map(Number) ?? [4, 5, 6]
  const rows = []
  for (const seed of seeds) {
    for (const level of levels) {
      const pipeline = createHydrologyPipeline(new StageCache(512 * 2 ** 20))
      const input = { seed, config: { planet: { physicalRadiusKm: 6371 }, mesh: { subdivisionLevel: level, irregularity: 0.5 }, reference: { subdivisionLevel: 6 }, geology: DEFAULT_GEOLOGY_PARAMETERS, landforms: DEFAULT_LANDFORM_PARAMETERS, terrain: DEFAULT_TERRAIN_PARAMETERS, climate: DEFAULT_CLIMATE_PARAMETERS, hydrology: DEFAULT_HYDROLOGY_PARAMETERS } }
      const coldStarted = performance.now()
      const cold = await pipeline.execute(input)
      const coldMs = performance.now() - coldStarted
      const hydrology = cold.getOutput<HydrologyArtifact>('hydrology-h0')
      const lakes = cold.getOutput<StaticLakeArtifact>('static-lakes-l1')
      const mesh = cold.getOutput<SphericalMesh>('mesh')
      const terrain = cold.getOutput<TerrainArtifact>('terrain')
      const geology = cold.getOutput<GeologyArtifact>('geology')
      const hashes = { runoff: digest(hydrology.annualRunoffMm), downstream: digest(hydrology.downstreamRegion), rivers: digest(hydrology.riverMask), contributingArea: digest(hydrology.contributingAreaKm2), lakes: digestLakes(lakes) }
      const hitStarted = performance.now()
      const hit = await pipeline.execute(input)
      const hitMs = performance.now() - hitStarted
      const changedStarted = performance.now()
      const changed = await pipeline.execute({ ...input, config: { ...input.config, hydrology: { ...input.config.hydrology, minimumRiverDrainageAreaKm2: input.config.hydrology.minimumRiverDrainageAreaKm2 + 1000 } } })
      const changedMs = performance.now() - changedStarted
      const forceStarted = performance.now()
      const forced = await pipeline.execute(input, { force: true })
      const forceMs = performance.now() - forceStarted
      const recomputed = forced.getOutput<HydrologyArtifact>('hydrology-h0')
      const recomputedLakes = forced.getOutput<StaticLakeArtifact>('static-lakes-l1')
      expect({ runoff: digest(recomputed.annualRunoffMm), downstream: digest(recomputed.downstreamRegion), rivers: digest(recomputed.riverMask), contributingArea: digest(recomputed.contributingAreaKm2), lakes: digestLakes(recomputedLakes) }).toEqual(hashes)
      expect(changed.plan.filter(stage => stage.action === 'execute').map(stage => stage.stageId)).toEqual(['hydrology-h0', 'static-lakes-l1'])
      let totalLandAreaKm2 = 0
      let totalLocalRunoffM3 = 0
      let riverRegions = 0
      const riverRegionsByStrahlerOrder: Record<number, number> = {}
      for (let r = 0; r < mesh.regionCount; r++) {
        if (hydrology.basinIndex[r] >= 0)
          totalLandAreaKm2 += mesh.areaKm2[r]
        totalLocalRunoffM3 += hydrology.annualRunoffVolumeM3[r]
        if (hydrology.riverMask[r]) {
          riverRegions++
          const order = hydrology.rivers[hydrology.riverIndex[r]].strahlerOrder
          riverRegionsByStrahlerOrder[order] = (riverRegionsByStrahlerOrder[order] ?? 0) + 1
        }
      }
      const riverSegments = hydrology.rivers.length
      const artifactBytes = typedArrayBytes(hydrology)
      const lakeArtifactBytes = typedArrayBytes(lakes)
      const lakeRegions = lakes.lakes.reduce((sum, lake) => sum + lake.regions.length, 0)
      const lakeAreaKm2 = lakes.lakes.reduce((sum, lake) => sum + lake.areaKm2, 0)
      const endorheicLakes = lakes.lakes.filter(lake => lake.endorheic).length
      rows.push({ seed, level, algorithmVersion: hydrology.algorithmVersion, lakeAlgorithmVersion: lakes.algorithmVersion, coldMs, hitMs, changedMs, forceMs, hashes, terrain: { algorithmVersion: terrain.algorithmVersion, elevationHash: digest(terrain.elevationKm), landMaskHash: digest(terrain.landMask), ...terrain.statistics, waterComponents: waterComponentStats(mesh, terrain, geology) }, cacheHitStages: hit.plan.filter(stage => stage.action === 'cache-hit').map(stage => stage.stageId), changedStages: changed.plan.filter(stage => stage.action === 'execute').map(stage => stage.stageId), cacheBytes: pipeline.cache.usedBytes, artifactBytes, lakeArtifactBytes, totalLandAreaKm2, totalLocalRunoffM3, riverRegions, riverRegionsByStrahlerOrder, riverSegments, effectiveRiverThresholdKm2: hydrology.effectiveRiverThresholdKm2, lakes: { count: lakes.lakes.length, lakeRegions, totalAreaKm2: lakeAreaKm2, endorheic: endorheicLakes, open: lakes.lakes.length - endorheicLakes, minimumLakeRegionCount: lakes.minimumLakeRegionCount, shapes: lakeShapeSummaries(mesh, lakes, hydrology) } })
    }
  }
  const report = { date: new Date().toISOString(), machine: { cpu: cpus()[0]?.model, platform: platform(), node: process.version }, config: { seeds, levels, physicalRadiusKm: 6371, irregularity: 0.5, referenceLevel: 6, climate: DEFAULT_CLIMATE_PARAMETERS, hydrology: DEFAULT_HYDROLOGY_PARAMETERS }, rows }
  const path = process.env.HYDROLOGY_BENCH_OUTPUT ? resolve(process.env.HYDROLOGY_BENCH_OUTPUT) : join(tmpdir(), `another-earth-m13a-hydrology-${Date.now()}.json`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`M1.3A hydrology benchmark written to ${path}\n`)
})
