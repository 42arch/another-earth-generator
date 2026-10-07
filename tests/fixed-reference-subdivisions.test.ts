import type { SimulationContext } from '@/core/simulation/pipeline/types'
import { expect, it } from 'vitest'
import { FibonacciSphereBuilder } from '@/core/mesh/fibonacci-sphere-builder'
import SphericalMesh from '@/core/mesh/mesh'
import { cloneWorldConfig, DEFAULT_WORLD_CONFIG, REFERENCE_PLATE_SUBDIVISION_COUNT } from '@/core/simulation/config'
import { ContinentalCrustStage } from '@/core/simulation/pipeline/stages/continental-crust-stage'
import { PlateStage } from '@/core/simulation/pipeline/stages/plate-stage'
import { SuperPlateStage } from '@/core/simulation/pipeline/stages/super-plate-stage'

it('uses the fixed subdivision count even with a legacy count in configuration', () => {
  const config = cloneWorldConfig(DEFAULT_WORLD_CONFIG)
  Object.assign(config.geology, { plateCount: 4 })
  const referenceMesh = new SphericalMesh(new FibonacciSphereBuilder().build(642, 42, 0.75))
  const context: SimulationContext = { config, referenceMesh }

  new PlateStage().execute(context)

  const plates = context.referencePlates!
  expect(plates.plateSeeds).toHaveLength(REFERENCE_PLATE_SUBDIVISION_COUNT)
  expect(new Set(plates.regionPlate).size).toBe(100)
})

it('establishes moving plates before placing continents and applying crust-aware motion', () => {
  const config = cloneWorldConfig(DEFAULT_WORLD_CONFIG)
  const referenceMesh = new SphericalMesh(new FibonacciSphereBuilder().build(642, 42, 0.75))
  const context: SimulationContext = { config, referenceMesh }

  new PlateStage().execute(context)
  expect(context.referencePlateTopology?.plateCount).toBeGreaterThanOrEqual(config.geology.primaryPlateCount)
  expect(context.referencePlateTopology?.plateCount).toBeLessThanOrEqual(
    config.geology.primaryPlateCount + config.geology.microPlateCount,
  )
  expect(context.referenceLand).toBeUndefined()
  expect(context.referenceCrust).toBeUndefined()

  new ContinentalCrustStage().execute(context)
  expect(context.referenceLand?.candidateLandMask).toHaveLength(referenceMesh.numRegions)
  expect(context.referenceSuperPlates?.crust.regionCrustType).toHaveLength(referenceMesh.numRegions)

  new SuperPlateStage().execute(context)
  expect(context.plateAngularVelocity).toHaveLength(REFERENCE_PLATE_SUBDIVISION_COUNT * 3)
  expect(context.referenceMantleFlow).toHaveLength(referenceMesh.numRegions)
})
