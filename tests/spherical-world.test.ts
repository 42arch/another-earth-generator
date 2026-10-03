import { describe, expect, it } from 'vitest'
import { CandidateLandGenerator } from '@/core/geography/candidate-land-generator'
import { PLATE_BOUNDARY } from '@/core/geology/geology-data'
import { SphericalPlateBoundaryAnalyzer } from '@/core/geology/plate-boundary-analyzer'
import { SphericalPlateGenerator } from '@/core/geology/plate-generator'
import { PlatePropertiesGenerator } from '@/core/geology/plate-properties-generator'
import { FibonacciSphereBuilder } from '@/core/mesh/fibonacci-sphere-builder'
import SphericalMesh from '@/core/mesh/mesh'
import { ReferenceGridProjector } from '@/core/mesh/reference-grid-projector'
import { SphericalGraticuleGeometry } from '@/core/rendering/shared/graticule-geometry'
import { cloneGlobeGenParams, DEFAULT_GLOBE_GEN_PARAMS } from '@/core/simulation/config'
import { SphericalWorldGenerator } from '@/core/simulation/world-generator'

describe('spherical world framework invariants', () => {
  it('builds an elevated latitude-longitude graticule', () => {
    const radius = 100.75
    const geometry = new SphericalGraticuleGeometry().create(radius)
    const positions = geometry.getAttribute('position')

    expect(positions.count).toBeGreaterThan(0)
    expect(positions.count % 2).toBe(0)
    expect(geometry.userData.latitudeLineCount).toBe(11)
    expect(geometry.userData.longitudeLineCount).toBe(24)
    for (let vertex = 0; vertex < positions.count; vertex++) {
      expect(Math.hypot(
        positions.getX(vertex),
        positions.getY(vertex),
        positions.getZ(vertex),
      )).toBeCloseTo(radius, 4)
    }
    geometry.dispose()
  })

  it('builds a closed, irregular and area-preserving spherical mesh', () => {
    const mesh = new FibonacciSphereBuilder().build(162, 42)
    const repeated = new FibonacciSphereBuilder().build(162, 42)
    const alternate = new FibonacciSphereBuilder().build(162, 43)
    expect(mesh.numRegions).toBe(162)
    expect(mesh.numTriangles).toBe(320)
    expect(mesh.regionPosition).toEqual(repeated.regionPosition)
    expect(mesh.triangles).toEqual(repeated.triangles)
    expect(mesh.regionPosition).not.toEqual(alternate.regionPosition)

    let area = 0
    const degrees = new Set<number>()
    for (let region = 0; region < mesh.numRegions; region++) {
      const index = region * 3
      expect(Math.hypot(
        mesh.regionPosition[index],
        mesh.regionPosition[index + 1],
        mesh.regionPosition[index + 2],
      )).toBeCloseTo(1, 5)
      const degree = mesh.neighborOffsets[region + 1] - mesh.neighborOffsets[region]
      expect(degree).toBeGreaterThanOrEqual(3)
      degrees.add(degree)
      area += mesh.regionArea[region]
    }
    expect(degrees.size).toBeGreaterThan(2)
    expect(area).toBeCloseTo(4 * Math.PI, 4)

    const edgeUse = new Map<string, number>()
    for (let index = 0; index < mesh.triangles.length; index += 3) {
      const triangle = [mesh.triangles[index], mesh.triangles[index + 1], mesh.triangles[index + 2]]
      for (let edge = 0; edge < 3; edge++) {
        const a = triangle[edge]
        const b = triangle[(edge + 1) % 3]
        const key = `${Math.min(a, b)}:${Math.max(a, b)}`
        edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1)
      }
    }
    expect([...edgeUse.values()].every(count => count === 2)).toBe(true)
    expect(mesh.numRegions - edgeUse.size + mesh.numTriangles).toBe(2)
  })

  it('projects output sites to their nearest reference sites', () => {
    const reference = new Float32Array([
      1,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1,
      -1,
      0,
      0,
    ])
    const output = new Float32Array([
      0.95,
      0.05,
      0,
      0,
      0.2,
      0.98,
      -0.9,
      0.1,
      0,
    ])
    expect(new ReferenceGridProjector(reference).project(output)).toEqual(
      new Uint32Array([0, 2, 3]),
    )
  })

  it('generates deterministic, area-controlled candidate continents', () => {
    const mesh = new SphericalMesh(new FibonacciSphereBuilder().build(642, 42))
    const plates = new SphericalPlateGenerator().generate(mesh, 36, 42)
    const generator = new CandidateLandGenerator()
    const land = generator.generate(
      mesh,
      plates.regionPlate,
      plates.plateSeeds,
      4,
      0.3,
      0.35,
      42,
    )
    const repeated = generator.generate(
      mesh,
      plates.regionPlate,
      plates.plateSeeds,
      4,
      0.3,
      0.35,
      42,
    )
    let totalArea = 0
    for (let region = 0; region < mesh.numRegions; region++)
      totalArea += mesh.regionArea[region]

    expect(land.candidateLandMask).toEqual(repeated.candidateLandMask)
    expect(land.continentId).toEqual(repeated.continentId)
    expect(land.continentSeeds.length).toBe(4)
    expect(new Set(land.continentId.filter(id => id >= 0)).size).toBe(4)
    expect(land.landArea / totalArea).toBeGreaterThanOrEqual(0.24)
    expect(land.landArea / totalArea).toBeLessThan(0.34)

    const plateLand = new Int8Array(plates.plateSeeds.length).fill(-1)
    let mixedPlateRegions = 0
    for (let region = 0; region < mesh.numRegions; region++) {
      const plate = plates.regionPlate[region]
      const classification = land.candidateLandMask[region]
      if (plateLand[plate] < 0)
        plateLand[plate] = classification
      else if (classification !== plateLand[plate])
        mixedPlateRegions++
      expect(land.continentId[region] >= 0).toBe(classification === 1)
    }
    expect(mixedPlateRegions).toBeGreaterThan(0)
  })

  it('computes tangential Euler velocity and classifies active plate edges', () => {
    const analyzer = new SphericalPlateBoundaryAnalyzer()
    const velocity = analyzer.velocityAt(
      new Float32Array([0, 0, 2]),
      0,
      1,
      0,
      0,
    )
    expect(velocity).toEqual([0, 2, 0])
    expect(velocity[0]).toBe(0)

    const mesh = new SphericalMesh(
      new FibonacciSphereBuilder().build(42, 9),
    )
    const regionPlate = new Int16Array(mesh.numRegions)
    const candidateLandMask = new Uint8Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++)
      regionPlate[region] = mesh.regionPosition[region * 3] >= 0 ? 0 : 1
    for (let region = 0; region < mesh.numRegions; region++)
      candidateLandMask[region] = mesh.regionPosition[region * 3] >= 0 ? 1 : 0
    const crust = new PlatePropertiesGenerator().generate(
      mesh,
      regionPlate,
      new Uint32Array([0, 1]),
      candidateLandMask,
      9,
    )
    const result = analyzer.analyze(
      mesh,
      regionPlate,
      new Float32Array([0, 0, 1, 0, 0, -1]),
      crust,
    )
    expect(result.edgeBoundaryType.some(type => type !== PLATE_BOUNDARY.None)).toBe(true)
    expect(result.edgeStress.some(stress => stress > 0)).toBe(true)
    expect(result.regionStressDirection.length).toBe(mesh.numRegions * 3)
  })

  it('keeps the same reference mesh when output detail changes', () => {
    const params = cloneGlobeGenParams(DEFAULT_GLOBE_GEN_PARAMS)
    params.seed = 42
    params.detail = 162
    const generator = new SphericalWorldGenerator()
    const world = generator.generate(params)
    params.detail = 642
    const detailed = generator.generate(params)

    expect(world.mesh.numRegions).toBe(162)
    expect(detailed.mesh.numRegions).toBe(642)
    expect(detailed.referenceMesh).toBe(world.referenceMesh)
    expect(world.outputToReference.length).toBe(world.mesh.numRegions)
    expect(detailed.outputToReference.length).toBe(detailed.mesh.numRegions)
    expect([...detailed.outputToReference].every(
      region => region < detailed.referenceMesh.numRegions,
    )).toBe(true)
    expect(world.data.elevation.length).toBe(world.mesh.numRegions)
    expect(world.data.landMask.length).toBe(world.mesh.numRegions)
    expect(world.data.regionPlate.length).toBe(world.mesh.numRegions)
    expect(world.data.candidateLandMask.includes(1)).toBe(true)
    expect(world.data.candidateLandMask.includes(0)).toBe(true)
    expect(world.data.elevation.some((value, region) => (
      world.data.landMask[region] === 1 && value > 0.2
    ))).toBe(true)
    expect(world.data.elevation.some((value, region) => (
      world.data.landMask[region] === 0 && value < 0
    ))).toBe(true)
    expect(world.data.baseElevation.length).toBe(world.mesh.numRegions)
    expect(world.data.terrainNoise.length).toBe(world.mesh.numRegions)
    expect(world.data.terrainTexture.tectonicBand.length).toBe(world.mesh.numRegions)
    expect(world.data.terrainTexture.detail.length).toBe(world.mesh.numRegions)
    expect(world.data.terrainTexture.coastal.length).toBe(world.mesh.numRegions)
    expect(world.data.tectonics.regionCrustType.length).toBe(world.mesh.numRegions)
    expect(world.data.tectonics.regionDensity.length).toBe(world.mesh.numRegions)
    expect(world.data.tectonics.plateDensity.length).toBe(params.plateCount)
    expect(world.data.terrainFields.spatialFields.coastDistance.length).toBe(world.mesh.numRegions)
    expect(world.data.terrainFields.convergentInfluence.length).toBe(world.mesh.numRegions)
    expect(world.data.terrainFields.overridingInfluence.length).toBe(world.mesh.numRegions)
    expect(world.data.edifices.islandArc.length).toBe(world.mesh.numRegions)
    expect(world.data.edifices.volcanicArc.length).toBe(world.mesh.numRegions)
    expect(world.data.edifices.hotspot.length).toBe(world.mesh.numRegions)
    expect(world.data.edifices.largeIgneousProvince.length).toBe(world.mesh.numRegions)
    expect(world.data.tectonics.edgeSubductingPlate.length).toBe(
      world.mesh.voronoi.edgeRegions.length / 2,
    )
    expect(world.data.tectonics.edgeBoundaryType.length).toBe(
      world.mesh.voronoi.edgeRegions.length / 2,
    )
    expect(world.referencePlates.plateAngularVelocity.length).toBe(params.plateCount * 3)
    expect(new Set(world.referencePlates.regionPlate).size).toBe(params.plateCount)
    for (let region = 0; region < detailed.mesh.numRegions; region++) {
      expect(detailed.data.regionPlate[region]).toBe(
        detailed.referencePlates.regionPlate[detailed.outputToReference[region]],
      )
    }
  })
})
