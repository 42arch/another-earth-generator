import type { ElevationFields } from '#generation/nature/geology/tectonics/tectonic-elevation-generator'
import type { GeologyArtifact } from '#generation/nature/geology/types'
import type { SphericalMesh } from '#mesh/spherical-mesh'
import { algorithmMesh } from '#generation/nature/common/algorithm-mesh'
import { DEFAULT_GEOLOGY_PARAMETERS } from '#generation/stages/geology-stage'
import { createTerrainPipeline, DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS } from '#generation/stages/terrain-stage'
import { DeterministicRandom } from '#math/random'
import { afterEach, expect, it, vi } from 'vitest'
import { TerrainErosionProcessor } from './terrain-erosion-processor'
import { TerrainPostProcessor } from './terrain-post-processor'

afterEach(() => {
  vi.restoreAllMocks()
})

it('applies configured shaping erosion before final ridge/soil adjustment without mutating inputs', async () => {
  const erosion = vi.spyOn(TerrainErosionProcessor.prototype, 'generate')
  const drainage = vi.spyOn(TerrainErosionProcessor.prototype, 'rebuildDrainage')
  const result = await createTerrainPipeline().execute({ seed: 'legacy-postprocess', config: {
    planet: { physicalRadiusKm: 6371 },
    mesh: { subdivisionLevel: 3, irregularity: 0 },
    reference: { subdivisionLevel: 2 },
    geology: DEFAULT_GEOLOGY_PARAMETERS,
    landforms: DEFAULT_LANDFORM_PARAMETERS,
    terrain: DEFAULT_TERRAIN_PARAMETERS,
  } })
  const mesh = algorithmMesh(result.getOutput<SphericalMesh>('mesh'))
  const geology = result.getOutput<GeologyArtifact>('geology')
  const { fields } = result.getOutput<{ fields: ElevationFields }>('tectonic-elevation')
  const originalElevation = fields.elevation.slice()
  const steps: string[] = []
  const run = (roughness = 0.4) => new TerrainPostProcessor().generate(
    mesh,
    fields.elevation,
    geology.candidateLandMask,
    fields.spatialFields,
    fields.classification,
    new DeterministicRandom('legacy-postprocess'),
    0.65,
    roughness,
    0.75,
    0.1,
    0.5,
    undefined,
    fields.phasorRidge,
    fields.edifices.hotspot,
    fields.edifices.total,
    step => steps.push(step),
    true,
  )
  const restored = run()
  expect(steps).toEqual(['texture', 'elevation-shaping', 'shoreline', 'final'])
  expect(restored.elevationCoordinate).toEqual(run().elevationCoordinate)
  expect(restored.texture?.uniformLand.length).toBe(mesh.numRegions)
  expect(restored.finalization.topologyChanged.length).toBe(mesh.numRegions)
  expect(restored.landMask).toEqual(Uint8Array.from(restored.elevationCoordinate, value => value > 0 ? 1 : 0))
  expect(restored.elevationCoordinate.every(Number.isFinite)).toBe(true)
  expect(fields.elevation).toEqual(originalElevation)
  const noTexture = run(0)
  expect(restored.texture!.postDetail.some(value => value !== 0)).toBe(true)
  for (const field of ['tectonicBand', 'detail', 'uniformLand', 'postDetail'] as const)
    expect(noTexture.texture![field].every(value => value === 0)).toBe(true)
  expect(fields.elevation).toEqual(originalElevation)
  expect(erosion).toHaveBeenCalledTimes(4)
  expect(drainage).toHaveBeenCalledTimes(4)
})
