import { expect, it } from 'vitest'
import { SphericalPlateBoundaryAnalyzer } from '@/core/geology/plate-boundary-analyzer'
import { SphericalPlateGenerator } from '@/core/geology/plate-generator'
import { PlatePropertiesGenerator } from '@/core/geology/plate-properties-generator'
import { SuperPlateGenerator } from '@/core/geology/super-plate-generator'
import { FibonacciSphereBuilder } from '@/core/mesh/fibonacci-sphere-builder'
import SphericalMesh from '@/core/mesh/mesh'

it('forms connected moving plates and keeps subdivision seams inactive', () => {
  const seed = 42
  const mesh = new SphericalMesh(new FibonacciSphereBuilder().build(642, seed, 0.75))
  const subdivisions = new SphericalPlateGenerator().generate(mesh, 40, seed)
  const candidateLand = Uint8Array.from({ length: mesh.numRegions }, (_, region) => (
    mesh.regionPosition[region * 3] > 0 ? 1 : 0
  ))
  const crust = new PlatePropertiesGenerator().generate(
    mesh,
    subdivisions.regionPlate,
    subdivisions.plateSeeds,
    candidateLand,
    seed,
  )
  const generator = new SuperPlateGenerator()
  const plates = generator.generate(mesh, subdivisions, subdivisions.plateAngularVelocity, crust, 7, 3, 0.8, seed)!
  const repeated = generator.generate(mesh, subdivisions, subdivisions.plateAngularVelocity, crust, 7, 3, 0.8, seed)!
  expect(plates.plateToSuper).toEqual(repeated.plateToSuper)
  expect(plates.plateCount).toBeGreaterThanOrEqual(7)
  expect(plates.plateCount).toBeLessThanOrEqual(10)
  expect(new Set(plates.regionPlate).size).toBe(plates.plateCount)
  for (let micro = 7; micro < plates.plateCount; micro++) {
    const region = plates.regionPlate.indexOf(micro)
    const neighboringMajorPlates = new Set<number>()
    for (let cell = 0; cell < mesh.numRegions; cell++) {
      if (plates.regionPlate[cell] !== micro)
        continue
      for (const neighbor of mesh.forEachNeighborOfRegion(cell)) {
        const group = plates.regionPlate[neighbor]
        if (group < 7)
          neighboringMajorPlates.add(group)
      }
    }
    expect(region).toBeGreaterThanOrEqual(0)
    expect(neighboringMajorPlates.size).toBeGreaterThanOrEqual(2)
  }

  for (let group = 0; group < plates.plateCount; group++) {
    const start = plates.regionPlate.indexOf(group)
    expect(start).toBeGreaterThanOrEqual(0)
    const seen = new Set<number>([start])
    const queue = [start]
    for (let head = 0; head < queue.length; head++) {
      for (const neighbor of mesh.forEachNeighborOfRegion(queue[head])) {
        if (plates.regionPlate[neighbor] === group && !seen.has(neighbor)) {
          seen.add(neighbor)
          queue.push(neighbor)
        }
      }
    }
    expect(seen.size).toBe(plates.regionPlate.filter(value => value === group).length)
  }

  const boundaries = new SphericalPlateBoundaryAnalyzer().analyze(
    mesh,
    plates.regionPlate,
    plates.plateAngularVelocity,
    plates.crust,
  )
  for (let edge = 0; edge < boundaries.edgeStress.length; edge++) {
    const a = mesh.voronoi.edgeRegions[edge * 2]
    const b = mesh.voronoi.edgeRegions[edge * 2 + 1]
    if (plates.regionPlate[a] === plates.regionPlate[b])
      expect(boundaries.edgeStress[edge]).toBe(0)
  }
})
