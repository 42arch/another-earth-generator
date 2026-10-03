import { expect, it } from 'vitest'
import { CandidateLandGenerator } from '@/core/geography/candidate-land-generator'
import { CRUST_TYPE, PLATE_BOUNDARY } from '@/core/geology/geology-data'
import { SphericalPlateBoundaryAnalyzer } from '@/core/geology/plate-boundary-analyzer'
import { SphericalPlateGenerator } from '@/core/geology/plate-generator'
import { PlatePropertiesGenerator } from '@/core/geology/plate-properties-generator'
import { SuperPlateGenerator } from '@/core/geology/super-plate-generator'
import { FibonacciSphereBuilder } from '@/core/mesh/fibonacci-sphere-builder'
import SphericalMesh from '@/core/mesh/mesh'

it.each([2501, 42, 137])('contours continental crust across plate interiors for seed %i', (seed) => {
  const mesh = new SphericalMesh(new FibonacciSphereBuilder().build(20_000, seed, 0.75))
  const plates = new SphericalPlateGenerator().generate(mesh, 80, seed)
  const generator = new CandidateLandGenerator()
  const land = generator.generate(mesh, plates.regionPlate, plates.plateSeeds, 4, 0.3, 0.35, seed)
  const repeated = generator.generate(mesh, plates.regionPlate, plates.plateSeeds, 4, 0.3, 0.35, seed)
  const crust = new PlatePropertiesGenerator().generate(
    mesh,
    plates.regionPlate,
    plates.plateSeeds,
    land.candidateLandMask,
    seed,
  )
  const superPlates = new SuperPlateGenerator().generate(
    mesh,
    plates,
    plates.plateAngularVelocity,
    crust,
  )

  expect(land.candidateLandMask).toEqual(repeated.candidateLandMask)
  expect(land.continentId).toEqual(repeated.continentId)
  expect(superPlates).not.toBeNull()
  expect(superPlates!.crust.regionCrustType).toEqual(crust.regionCrustType)
  expect(superPlates!.crust.regionDensity).toEqual(crust.regionDensity)

  const totalArea = mesh.regionArea.reduce((sum, area) => sum + area, 0)
  const largestCellArea = Math.max(...mesh.regionArea)
  expect(Math.abs(land.landArea - totalArea * 0.3)).toBeLessThanOrEqual(largestCellArea)
  const seenCrustByPlate = new Uint8Array(plates.plateSeeds.length)
  for (let region = 0; region < mesh.numRegions; region++) {
    const landCell = land.candidateLandMask[region] === 1
    expect(land.continentId[region] >= 0).toBe(landCell)
    expect(crust.regionCrustType[region]).toBe(landCell ? CRUST_TYPE.Continental : CRUST_TYPE.Oceanic)
    const plate = plates.regionPlate[region]
    seenCrustByPlate[plate] |= landCell ? 2 : 1
  }
  expect(seenCrustByPlate.includes(3)).toBe(true)

  let candidateCoastEdges = 0
  let withinPlateCoastEdges = 0
  const { edgeRegions } = mesh.voronoi
  for (let edge = 0; edge < edgeRegions.length; edge += 2) {
    const a = edgeRegions[edge]
    const b = edgeRegions[edge + 1]
    if (land.candidateLandMask[a] === land.candidateLandMask[b])
      continue
    candidateCoastEdges++
    if (plates.regionPlate[a] === plates.regionPlate[b])
      withinPlateCoastEdges++
  }
  expect(withinPlateCoastEdges / candidateCoastEdges).toBeGreaterThan(0.5)
})

it('uses local crust rather than whole-plate labels for subduction', () => {
  const mesh = new SphericalMesh(new FibonacciSphereBuilder().build(162, 9))
  const regionPlate = new Int16Array(mesh.numRegions)
  const candidateLandMask = new Uint8Array(mesh.numRegions)
  for (let region = 0; region < mesh.numRegions; region++) {
    const oceanic = mesh.regionPosition[region * 3] >= 0
    regionPlate[region] = oceanic ? 0 : 1
    candidateLandMask[region] = oceanic ? 0 : 1
  }
  const crust = new PlatePropertiesGenerator().generate(
    mesh,
    regionPlate,
    new Uint32Array([0, 1]),
    candidateLandMask,
    9,
  )
  crust.plateCrustType.fill(CRUST_TYPE.Continental)
  const boundaries = new SphericalPlateBoundaryAnalyzer().analyze(
    mesh,
    regionPlate,
    new Float32Array([0, 0, 1, 0, 0, -1]),
    crust,
  )
  let oceanicSubductionEdges = 0
  for (let edge = 0; edge < boundaries.edgeBoundaryType.length; edge++) {
    if (boundaries.edgeBoundaryType[edge] !== PLATE_BOUNDARY.Convergent)
      continue
    oceanicSubductionEdges++
    expect(boundaries.edgeSubductingPlate[edge]).toBe(0)
    expect(boundaries.edgeOverridingPlate[edge]).toBe(1)
  }
  expect(oceanicSubductionEdges).toBeGreaterThan(0)
})
