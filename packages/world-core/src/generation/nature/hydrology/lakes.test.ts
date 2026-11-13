import type { ClimateArtifact } from '#generation/nature/climate/climate'
import type { TerrainArtifact } from '#generation/nature/geography'
import { createSphericalMesh } from '#mesh/spherical-mesh'
import { describe, expect, it } from 'vitest'
import { DEFAULT_HYDROLOGY_PARAMETERS, generateCryosphereI0, generateHydrologyH0 } from './hydrology'
import { generateStaticLakesL1, queryStaticLakeRegion, validateStaticLakeArtifact } from './lakes'

function makeInputs(hasOcean = true, multiRegionDepression = false) {
  const mesh = createSphericalMesh({ subdivisionLevel: 0, physicalRadiusKm: 6371, irregularity: 0, seed: 'static-lake-fixture' })
  const n = mesh.regionCount
  const landMask = new Uint8Array(n).fill(1)
  if (hasOcean)
    landMask[0] = 0
  const distance = new Int32Array(n).fill(-1)
  const queue = new Uint32Array(n)
  let head = 0
  let tail = 0
  queue[tail++] = 0
  distance[0] = 0
  while (head < tail) {
    const region = queue[head++]
    for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
      const next = mesh.neighbors[edge]
      if (distance[next] < 0) {
        distance[next] = distance[region] + 1
        queue[tail++] = next
      }
    }
  }
  const center = hasOcean ? Array.from({ length: n }, (_, region) => region).sort((a, b) => distance[b] - distance[a] || a - b)[0] : 0
  const fromCenter = new Int32Array(n).fill(-1)
  head = 0
  tail = 0
  queue[tail++] = center
  fromCenter[center] = 0
  while (head < tail) {
    const region = queue[head++]
    for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
      const next = mesh.neighbors[edge]
      if (fromCenter[next] < 0) {
        fromCenter[next] = fromCenter[region] + 1
        queue[tail++] = next
      }
    }
  }
  const terrain = {
    meshId: mesh.meshId,
    landMask,
    elevationKm: Float32Array.from({ length: n }, (_, region) => {
      if (!landMask[region])
        return -1
      if (fromCenter[region] === 0)
        return 0.1
      if (fromCenter[region] === 1)
        return multiRegionDepression ? 0.1 : 0.15
      if (fromCenter[region] === 2)
        return 0.8
      return 0.4
    }),
  } as Pick<TerrainArtifact, 'meshId' | 'landMask' | 'elevationKm'>
  const climate = {
    meshId: mesh.meshId,
    regionCount: n,
    temperatureC: new Float32Array(12 * n).fill(10),
    precipitationMm: new Float32Array(12 * n).fill(100),
    koppenClass: new Uint8Array(n).fill(1),
  } as ClimateArtifact
  const cryosphere = generateCryosphereI0(mesh, terrain, climate, DEFAULT_HYDROLOGY_PARAMETERS)
  const hydrology = generateHydrologyH0(mesh, terrain, climate, cryosphere, {
    evapotranspirationFactorMmPerCMonth: 2,
    minimumRiverDrainageAreaKm2: 0,
    riverDensityMultiplier: 1,
    orbitalPeriodDays: 365.25,
  })
  return { mesh, terrain, climate, hydrology, center }
}

describe('static lakes L1', () => {
  it('identifies a retained connected depression and exposes stable spill facts', () => {
    const { mesh, terrain, climate, hydrology, center } = makeInputs(true, true)
    const parameters = { evapotranspirationFactorMmPerCMonth: 2, orbitalPeriodDays: 365.25, minimumLakeAreaKm2: 0 }
    const first = generateStaticLakesL1(mesh, terrain, hydrology, climate, parameters)
    const second = generateStaticLakesL1(mesh, terrain, hydrology, climate, parameters)
    expect(first.minimumLakeRegionCount).toBe(2)
    expect(first.lakes.length).toBeGreaterThan(0)
    expect(first.lakeIndex[center]).toBeGreaterThanOrEqual(0)
    expect(first.lakes.every(lake => lake.regions.length >= 2)).toBe(true)
    expect(second.lakes.map(lake => lake.id)).toEqual(first.lakes.map(lake => lake.id))
    const lake = queryStaticLakeRegion(first, center)!
    expect(lake.waterLevelKm).toBeCloseTo(0.8)
    expect(lake.areaKm2).toBeCloseTo(lake.regions.reduce((sum, region) => sum + mesh.areaKm2[region], 0))
    expect(lake.spillRegion).not.toBeNull()
    expect(lake.downstreamRegion).toBe(hydrology.downstreamRegion[lake.spillRegion!])
    const originalRegion = first.lakes[first.lakeIndex[center]].regions[0]
    lake.regions[0] = 0xFFFFFFFF
    expect(first.lakes[first.lakeIndex[center]].regions[0]).toBe(originalRegion)
    validateStaticLakeArtifact(first, mesh, terrain, hydrology)
  })

  it('filters a depression represented by a single mesh region', () => {
    const { mesh, terrain, climate, hydrology, center } = makeInputs()
    const filledElevationKm = terrain.elevationKm.slice()
    filledElevationKm[center] = terrain.elevationKm[center] + 0.1
    const artifact = generateStaticLakesL1(mesh, terrain, { ...hydrology, filledElevationKm }, climate, { evapotranspirationFactorMmPerCMonth: 2, orbitalPeriodDays: 365.25, minimumLakeAreaKm2: 0 })
    expect(artifact.lakes).toHaveLength(0)
    expect(artifact.lakeIndex.every(index => index === -1)).toBe(true)
  })

  it('does not classify flat land or ocean as a lake', () => {
    const { mesh, terrain } = makeInputs()
    const flatTerrain = { ...terrain, elevationKm: Float32Array.from(terrain.elevationKm, value => value > 0 ? 0.4 : value) }
    const climate = {
      meshId: mesh.meshId,
      regionCount: mesh.regionCount,
      temperatureC: new Float32Array(12 * mesh.regionCount).fill(10),
      precipitationMm: new Float32Array(12 * mesh.regionCount).fill(100),
      koppenClass: new Uint8Array(mesh.regionCount).fill(1),
    } as ClimateArtifact
    const cryosphere = generateCryosphereI0(mesh, flatTerrain, climate, DEFAULT_HYDROLOGY_PARAMETERS)
    const flatHydrology = generateHydrologyH0(mesh, flatTerrain, climate, cryosphere, {
      evapotranspirationFactorMmPerCMonth: 2,
      minimumRiverDrainageAreaKm2: 0,
      riverDensityMultiplier: 1,
      orbitalPeriodDays: 365.25,
    })
    const lakes = generateStaticLakesL1(mesh, flatTerrain, flatHydrology, climate, { evapotranspirationFactorMmPerCMonth: 2, orbitalPeriodDays: 365.25, minimumLakeAreaKm2: 0 })
    expect(lakes.lakes).toHaveLength(0)
    expect(lakes.lakeIndex.every(index => index === -1)).toBe(true)
    expect(queryStaticLakeRegion(lakes, 0)).toBeNull()
    expect(() => queryStaticLakeRegion(lakes, mesh.regionCount)).toThrow('Invalid static lake region')
  })

  it('marks a lake draining to the H0 internal sink as endorheic', () => {
    const { mesh, terrain, climate, hydrology, center } = makeInputs(false)
    const neighbor = mesh.neighbors[mesh.neighborOffsets[center]]
    const filledElevationKm = terrain.elevationKm.slice()
    filledElevationKm[center] = terrain.elevationKm[center] + 0.1
    filledElevationKm[neighbor] = terrain.elevationKm[neighbor] + 0.1
    const artifact = generateStaticLakesL1(mesh, terrain, { ...hydrology, filledElevationKm }, climate, { evapotranspirationFactorMmPerCMonth: 2, orbitalPeriodDays: 365.25, minimumLakeAreaKm2: 0 })
    expect(artifact.lakes.length).toBeGreaterThan(0)
    expect(artifact.lakes.every(lake => lake.endorheic)).toBe(true)
  })

  it('rejects invalid indices and non-finite lake levels', () => {
    const { mesh, terrain, climate, hydrology, center } = makeInputs()
    const artifact = generateStaticLakesL1(mesh, terrain, hydrology, climate, { evapotranspirationFactorMmPerCMonth: 2, orbitalPeriodDays: 365.25, minimumLakeAreaKm2: 0 })
    const invalidIndex = { ...artifact, lakeIndex: artifact.lakeIndex.slice() }
    invalidIndex.lakeIndex[center] = artifact.lakes.length
    expect(() => validateStaticLakeArtifact(invalidIndex, mesh, terrain, hydrology)).toThrow('Invalid lake index')
    if (artifact.lakes.length) {
      const invalidLevel = { ...artifact, lakes: artifact.lakes.map((lake, index) => index ? lake : { ...lake, waterLevelKm: Number.NaN }) }
      expect(() => validateStaticLakeArtifact(invalidLevel, mesh, terrain, hydrology)).toThrow('Invalid static lake')
    }
  })
})
