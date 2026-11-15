import type { TerrainArtifact } from '#generation/nature/geography'
import type { GeologyArtifact } from '#generation/nature/geology'
import type { PipelineEvent } from '#generation/pipeline'
import { normalizedElevationArrayToKm, normalizedElevationToKm, queryTerrainRegion, validateTerrainArtifact } from '#generation/nature/geography'
import { describe, expect, it } from 'vitest'
import { DEFAULT_GEOLOGY_PARAMETERS } from './geology-stage'
import { createTerrainPipeline, DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS } from './terrain-stage'

const input = () => ({ seed: 'M1.1B-fixed', config: { planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 }, mesh: { subdivisionLevel: 3, irregularity: 0.5 }, reference: { subdivisionLevel: 2 }, geology: { ...DEFAULT_GEOLOGY_PARAMETERS }, landforms: { ...DEFAULT_LANDFORM_PARAMETERS }, terrain: { ...DEFAULT_TERRAIN_PARAMETERS } } })

describe('terrain stage', () => {
  it('produces finite physical terrain, owned diagnostics and deterministic results', async () => {
    const pipeline = createTerrainPipeline()
    const events: PipelineEvent[] = []
    const first = await pipeline.execute(input(), { onEvent: event => events.push(event) })
    const progress = events.filter(e => e.stageId === 'tectonic-elevation' && e.type === 'stage-progress')
    expect(progress.some(e => e.message === '到陆地距离')).toBe(true)
    expect(progress.some(e => e.message === '火山与岛弧')).toBe(true)
    expect(progress.map(e => e.stageProgress)).toEqual(progress.map(e => e.stageProgress).sort((a, b) => a! - b!))
    const terrain = first.getOutput<TerrainArtifact>('terrain')
    const geology = first.getOutput<GeologyArtifact>('geology')
    const original = structuredClone(geology)
    validateTerrainArtifact(terrain, geology.meshId, geology.plateIndex.length, geology.plates.length)
    expect(terrain.landMask).toEqual(Uint8Array.from(terrain.elevationKm, v => v > 0 ? 1 : 0))
    expect(terrain.statistics.minimumElevationKm).toBeLessThan(0)
    expect(terrain.statistics.maximumElevationKm).toBeGreaterThan(0)
    expect(terrain.plateAngularVelocity).not.toEqual(geology.plateAngularVelocity)
    const cached = await pipeline.execute(input())
    expect(cached.plan.every(stage => stage.action === 'cache-hit')).toBe(true)
    expect(cached.getOutput('terrain')).toBe(terrain)
    expect((await pipeline.execute(input(), { force: true })).getOutput('terrain')).toEqual(terrain)
    expect((await createTerrainPipeline().execute(input())).getOutput('terrain')).toEqual(terrain)
    expect(geology).toEqual(original)
    expect(queryTerrainRegion(terrain, 0).elevationKm).toBe(terrain.elevationKm[0])
    expect(() => queryTerrainRegion(terrain, -1)).toThrow()
  })

  it('reuses tectonics and elevation skeleton when only postprocessing changes', async () => {
    const pipeline = createTerrainPipeline()
    const base = input()
    const first = await pipeline.execute(base)
    expect(pipeline.plan({ ...base, contentSignatures: { 'geographic-names': 'another-catalog' } }).filter(stage => stage.action === 'execute').map(stage => stage.stageId)).toEqual(['geographic-names'])
    const changed = { ...base, config: { ...base.config, terrain: { ...base.config.terrain, roughness: 0.1 } } }
    const next = await pipeline.execute(changed)
    expect(next.plan.filter(s => s.action === 'execute').map(s => s.stageId)).toEqual(['terrain', 'geographic-regions', 'geographic-names'])
    expect(next.getOutput<TerrainArtifact>('terrain').roughnessWeight).toEqual(first.getOutput<TerrainArtifact>('terrain').roughnessWeight)
    expect(next.getOutput<TerrainArtifact>('terrain').elevationKm).not.toEqual(first.getOutput<TerrainArtifact>('terrain').elevationKm)
    expect(DEFAULT_TERRAIN_PARAMETERS.terrainWarp).toBe(0.75)
    const warped = { ...base, config: { ...base.config, terrain: { ...base.config.terrain, terrainWarp: 0 } } }
    expect((await pipeline.execute(warped)).plan.filter(s => s.action === 'execute').map(s => s.stageId)).toEqual(['terrain', 'geographic-regions', 'geographic-names'])
    const volcanism = { ...changed, config: { ...changed.config, landforms: { ...changed.config.landforms, hotspotCount: 0 } } }
    expect((await pipeline.execute(volcanism)).plan.filter(s => s.action === 'execute').map(s => s.stageId)).toEqual(['tectonic-elevation', 'terrain', 'geographic-regions', 'geographic-names'])
  })

  it('publishes T0 after configured water and glacial erosion', async () => {
    const terrain = (await createTerrainPipeline().execute(input())).getOutput<TerrainArtifact>('terrain')
    expect(terrain.algorithmVersion).toBe('terrain-v26')
    expect(terrain.erosionCoordinate.some(v => v > 0)).toBe(true)
    expect(terrain.depositionCoordinate.every(Number.isFinite)).toBe(true)
    expect(terrain.roughnessWeight.every(v => v === 1)).toBe(true)
    expect(queryTerrainRegion(terrain, 0).roughnessWeight).toBe(terrain.roughnessWeight[0])
    const badWeight = structuredClone(terrain)
    badWeight.roughnessWeight[0] = 1.1
    expect(() => validateTerrainArtifact(badWeight)).toThrow('region 0')
    expect(terrain.regionalReliefKm.length).toBe(terrain.elevationKm.length)
    const broken = structuredClone(terrain)
    broken.regionalReliefKm[0] = Number.NaN
    expect(() => validateTerrainArtifact(broken)).toThrow('regionalReliefKm')
    expect(queryTerrainRegion(terrain, 0).regionalUpliftCoordinate).toBe(terrain.regionalUpliftCoordinate[0])
  })

  it('rejects obsolete continental uplift even after a full cache hit', async () => {
    const key = 'continentalUpliftKm'
    const pipeline = createTerrainPipeline()
    const base = input()
    await pipeline.execute(base)
    const obsolete = { ...base, config: { ...base.config, terrain: { ...base.config.terrain, [key]: 0 } } }
    expect(() => pipeline.plan(obsolete)).toThrow(`${key} is no longer supported`)
    await expect(pipeline.execute(obsolete)).rejects.toThrow(`${key} is no longer supported`)
    await expect(createTerrainPipeline().execute(obsolete)).rejects.toThrow(`${key} is no longer supported`)
  })

  it.each([0, 1])('supports all-ocean/all-continental candidate input %s', async (coverage) => {
    const base = input()
    base.config.geology.candidateLandCoverage = coverage
    const terrain = (await createTerrainPipeline().execute(base)).getOutput<TerrainArtifact>('terrain')
    validateTerrainArtifact(terrain)
  })

  it('applies the sea-level datum once and preserves radial geometry', async () => {
    const pipeline = createTerrainPipeline()
    const base = input()
    const first = (await pipeline.execute(base)).getOutput<TerrainArtifact>('terrain')
    base.config.planet.seaLevelDatumKm = 20
    const shifted = (await pipeline.execute(base)).getOutput<TerrainArtifact>('terrain')
    for (let r = 0; r < shifted.elevationKm.length; r++)
      expect(shifted.elevationKm[r]).toBeCloseTo(first.elevationKm[r] - 20, 4)
    expect(shifted.landMask.every(v => v === 0)).toBe(true)
    expect(shifted.statistics.landComponentCount).toBe(0)
    expect(shifted.statistics.largestLandAreaKm2).toBe(0)
    base.config.planet.seaLevelDatumKm = -6371
    await expect(pipeline.execute(base)).rejects.toThrow('Invalid sea level')
  })

  it('rejects malformed fields, contradictory land masks and invalid parameters', async () => {
    const pipeline = createTerrainPipeline()
    const base = input()
    const terrain = (await pipeline.execute(base)).getOutput<TerrainArtifact>('terrain')
    const broken = structuredClone(terrain)
    broken.landMask[0] = 1 - broken.landMask[0]
    expect(() => validateTerrainArtifact(broken)).toThrow('region 0')
    expect(() => validateTerrainArtifact({ ...terrain, elevationKm: new Float32Array(1) }, terrain.meshId, 642)).toThrow('field')
    expect(() => validateTerrainArtifact(terrain, 'wrong-mesh')).toThrow('identity')
    base.config.terrain.roughness = 0.8
    await expect(pipeline.execute(base)).rejects.toThrow('roughness')
    base.config.terrain.roughness = DEFAULT_TERRAIN_PARAMETERS.roughness
  })

  it('converts dimensionless shaping coordinates once, including near zero and deep water', () => {
    expect(normalizedElevationToKm(-0.5)).toBe(-4)
    expect(normalizedElevationToKm(-0.6)).toBeCloseTo(-4.8)
    expect(normalizedElevationToKm(-0.75)).toBeLessThan(-11)
    expect(normalizedElevationToKm(0.2)).toBeCloseTo(0.37)
    expect(normalizedElevationToKm(0.4)).toBeCloseTo(0.92)
    expect(normalizedElevationToKm(0.65)).toBeCloseTo(2.5)
    expect(normalizedElevationToKm(0.85)).toBeCloseTo(4.5)
    expect(normalizedElevationToKm(0.9)).toBeCloseTo(5.1)
    expect(normalizedElevationToKm(1)).toBe(7.7)
    expect(normalizedElevationToKm(1.2)).toBeCloseTo(11.3)
    const physical = normalizedElevationArrayToKm(new Float32Array([-1e-30, 0, 1e-30, 1e-20]))
    expect(Uint8Array.from(physical, v => v > 0 ? 1 : 0)).toEqual(new Uint8Array([0, 0, 1, 1]))
  })

  it('keeps the physical transfer monotone with matching gradients at each join', () => {
    let previousOcean = normalizedElevationToKm(-0.75)
    for (let step = -749; step <= 0; step++) {
      const current = normalizedElevationToKm(step / 1000)
      expect(current).toBeGreaterThan(previousOcean)
      previousOcean = current
    }
    let previous = normalizedElevationToKm(0)
    for (let step = 1; step <= 1200; step++) {
      const current = normalizedElevationToKm(step / 1000)
      expect(current).toBeGreaterThan(previous)
      previous = current
    }
    const delta = 1e-6
    for (const coordinate of [-0.6, 0.2, 0.4, 0.65, 0.85, 0.9, 1]) {
      const atJoin = normalizedElevationToKm(coordinate)
      const before = (atJoin - normalizedElevationToKm(coordinate - delta)) / delta
      const after = (normalizedElevationToKm(coordinate + delta) - atJoin) / delta
      expect(Math.abs(before - after)).toBeLessThan(0.01)
    }
  })
})
