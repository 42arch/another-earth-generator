import type { TerrainArtifact } from '../src/generation/nature/geography'
import type { SphericalMesh } from '../src/mesh/spherical-mesh'
import { createTerrainPipeline, DEFAULT_GEOLOGY_PARAMETERS, DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS } from '../src/index'
import { summarizeHypsometry } from './terrain-hypsometry-summary'

const samples = [
  { seed: '1024', subdivisionLevel: 4 },
  { seed: '1024', subdivisionLevel: 5 },
  { seed: '1024', subdivisionLevel: 7 },
  { seed: '1024', subdivisionLevel: 8 },
  { seed: '42', subdivisionLevel: 6 },
  { seed: '314159', subdivisionLevel: 6 },
  { seed: '8675309', subdivisionLevel: 6 },
] as const

const results = []
for (const sample of samples) {
  const generation = await createTerrainPipeline().execute({
    seed: sample.seed,
    config: {
      planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
      mesh: { subdivisionLevel: sample.subdivisionLevel, irregularity: 0.75 },
      geology: DEFAULT_GEOLOGY_PARAMETERS,
      landforms: DEFAULT_LANDFORM_PARAMETERS,
      terrain: DEFAULT_TERRAIN_PARAMETERS,
    },
  })
  const mesh = generation.getOutput<SphericalMesh>('mesh')
  const terrain = generation.getOutput<TerrainArtifact>('terrain')
  results.push({ ...sample, regionCount: mesh.regionCount, terrainVersion: terrain.algorithmVersion, ...summarizeHypsometry(mesh, terrain.elevationKm) })
}
console.log(JSON.stringify({
  command: 'node_modules/.bin/jiti packages/world-core/benchmarks/terrain-hypsometry.ts',
  method: 'area-weighted physical elevation by final Mesh region area',
  config: {
    planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
    meshIrregularity: 0.75,
    geology: DEFAULT_GEOLOGY_PARAMETERS,
    landforms: DEFAULT_LANDFORM_PARAMETERS,
    terrain: DEFAULT_TERRAIN_PARAMETERS,
  },
  samples: results,
}, null, 2))
