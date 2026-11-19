/* eslint-disable antfu/no-top-level-await -- Standalone data analysis, not a test runner. */
import type { ClimateArtifact, SphericalMesh, TerrainArtifact } from '../src/index'
import process from 'node:process'
import { testContentPack, testPipelineContent } from '../src/content/test-content'
import { createClimatePipeline, DEFAULT_CLIMATE_PARAMETERS, DEFAULT_GEOLOGY_PARAMETERS, DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS, extractMonthlyCirculation } from '../src/index'

const quantiles = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 1]
function summary(values: Float32Array, mesh: SphericalMesh, available?: Uint8Array) {
  const indices = Uint32Array.from(Array.from({ length: values.length }, (_, i) => i).filter(i => !available || available[i % mesh.regionCount]))
  indices.sort((a, b) => values[a] - values[b] || a - b)
  let totalArea = 0
  let weightedSum = 0
  for (const i of indices) {
    const area = mesh.areaKm2[i % mesh.regionCount]
    totalArea += area
    weightedSum += area * values[i]
  }
  let cursor = 0
  let area = 0
  const percentiles = quantiles.map((q) => {
    while (cursor < indices.length - 1 && area + mesh.areaKm2[indices[cursor] % mesh.regionCount] < q * totalArea) {
      area += mesh.areaKm2[indices[cursor] % mesh.regionCount]
      cursor++
    }
    return values[indices[cursor]]
  })
  return { mean: weightedSum / totalArea, percentiles: Object.fromEntries(quantiles.map((q, i) => [`p${q * 100}`, percentiles[i]])) }
}

async function diagnose(seed: string, level: number) {
  const config = {
    planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
    mesh: { subdivisionLevel: level, irregularity: 0.75 },
    geology: { ...DEFAULT_GEOLOGY_PARAMETERS },
    landforms: { ...DEFAULT_LANDFORM_PARAMETERS },
    terrain: { ...DEFAULT_TERRAIN_PARAMETERS },
    climate: { ...DEFAULT_CLIMATE_PARAMETERS, axialTiltDegrees: 23.5, precipitationScale: 1.8 },
  }
  const result = await createClimatePipeline().execute({ seed, config, ...testPipelineContent([testContentPack]) })
  const mesh = result.getOutput<SphericalMesh>('mesh')
  const climate = result.getOutput<ClimateArtifact>('climate-c0')
  const terrain = result.getOutput<TerrainArtifact>('terrain')
  const modes = Object.fromEntries(['nearest', 'resampled'].map((mode) => {
    const fields = extractMonthlyCirculation(mode === 'nearest' ? { ...climate, projectedCirculation: undefined } : climate)
    const kinds = Object.fromEntries(['wind', 'ocean'].map((kind) => {
      const east = kind === 'wind' ? fields.windEastMps : fields.oceanEastMps
      const north = kind === 'wind' ? fields.windNorthMps : fields.oceanNorthMps
      const available = kind === 'ocean' ? fields.oceanAvailable : undefined
      const speeds = Float32Array.from(east, (e, i) => Math.hypot(e, north[i]))
      const annual = new Float32Array(mesh.regionCount)
      const monthly = Array.from({ length: 12 }, (_, month) => {
        const slice = speeds.subarray(month * mesh.regionCount, (month + 1) * mesh.regionCount)
        for (let r = 0; r < mesh.regionCount; r++) annual[r] += slice[r] / 12
        return summary(slice, mesh, available)
      })
      return [kind, { pooledMonths: summary(speeds, mesh, available), annual: summary(annual, mesh, available), monthly }]
    }))
    return [mode, kinds]
  }))
  return { seed, config, versions: { terrain: terrain.algorithmVersion, climate: climate.algorithmVersion }, regionCount: mesh.regionCount, referenceRegionCount: climate.referenceRegionCount, modes }
}
const seeds = process.argv.slice(2)
const results = []
for (const seed of seeds.length ? seeds : ['1024', '42']) {
  process.stderr.write(`Sampling seed ${seed}…\n`)
  results.push(await diagnose(seed, seed === '1024' ? 7 : 6))
}
process.stdout.write(`${JSON.stringify({ command: 'bun run packages/world-core/benchmarks/circulation-display-diagnosis.ts', unit: 'm/s', scope: 'Area-weighted speed distributions; annual = mean of monthly vector magnitudes. Nearest is the v21 sampling rule applied to the same reference fields, not a rerun of an old algorithm.', results }, null, 2)}\n`)
