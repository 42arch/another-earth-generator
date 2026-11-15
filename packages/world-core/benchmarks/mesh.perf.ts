import { writeFileSync } from 'node:fs'
import { cpus, platform, release, tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { expect, it } from 'vitest'
import { buildSphericalVoronoi, generateIcosphere, latLonToCartesian, SphericalSpatialIndex, triangulateSphericalDelaunay, validateSphericalMesh } from '../src/index'
import { AleaRandom } from '../src/math/random'
import { jitterIcosphere } from '../src/mesh/jitter'

it('records L5–L7 geometry, topology, index and query costs without timing gates', () => {
  const reports = []
  const radius = 6371
  const warmup = buildSphericalVoronoi(generateIcosphere(3), radius)
  new SphericalSpatialIndex(warmup).findNearestRegion({ x: 0, y: 1, z: 0 })
  for (const configuration of [{ irregularity: 0, seed: '0' }, { irregularity: 0.75, seed: '42' }, { irregularity: 1, seed: '123' }]) {
    for (const level of [5, 6, 7]) {
      const trials = []
      for (let trial = 0; trial < 3; trial++) {
        const start = performance.now()
        const geometry = generateIcosphere(level)
        const subdivided = performance.now()
        if (configuration.irregularity > 0)
          jitterIcosphere(geometry.centers, configuration.irregularity, new AleaRandom(configuration.seed))
        const jittered = performance.now()
        const triangulated = configuration.irregularity > 0 ? { ...geometry, ...configuration, triangles: triangulateSphericalDelaunay(geometry.centers) } : geometry
        const generated = performance.now()
        const mesh = buildSphericalVoronoi(triangulated, radius)
        const topology = performance.now()
        const index = new SphericalSpatialIndex(mesh)
        const indexed = performance.now()
        expect(validateSphericalMesh(mesh)).toEqual({ valid: true, issues: [] })
        const p = { x: 0, y: 0, z: 0 }
        const directions = new Float64Array(15000)
        for (let i = 0; i < 5000; i++) {
          latLonToCartesian(Math.asin(2 * (i + 0.5) / 5000 - 1), i * 2.399963229728653, p)
          directions[3 * i] = p.x
          directions[3 * i + 1] = p.y
          directions[3 * i + 2] = p.z
        }
        let checksum = 0
        const querying = performance.now()
        for (let i = 0; i < 5000; i++) {
          p.x = directions[3 * i]
          p.y = directions[3 * i + 1]
          p.z = directions[3 * i + 2]
          checksum += index.findNearestRegion(p)
        }
        const queryMs = performance.now() - querying
        // High-resolution exact-nearest check, independent of the tree.
        for (let i = 0; i < 16; i++) {
          p.x = directions[3 * i]
          p.y = directions[3 * i + 1]
          p.z = directions[3 * i + 2]
          let best = -1
          let bestDistance = Infinity
          for (let r = 0; r < mesh.regionCount; r++) {
            const dx = p.x - mesh.centers[3 * r]
            const dy = p.y - mesh.centers[3 * r + 1]
            const dz = p.z - mesh.centers[3 * r + 2]
            const d = dx * dx + dy * dy + dz * dz
            if (d < bestDistance) {
              best = r
              bestDistance = d
            }
          }
          expect(index.findNearestRegion(p)).toBe(best)
        }
        const arrays: Record<string, number> = {}
        for (const [key, value] of Object.entries(mesh)) {
          if (ArrayBuffer.isView(value))
            arrays[key] = value.byteLength
        }
        trials.push({
          generationMs: generated - start,
          subdivisionMs: subdivided - start,
          jitterMs: jittered - subdivided,
          delaunayMs: generated - jittered,
          topologyMs: topology - generated,
          indexMs: indexed - topology,
          queries: 5000,
          queryMs,
          queryMicrosecondsMean: queryMs * 1000 / 5000,
          checksum,
          arrays,
          meshBytes: Object.values(arrays).reduce((a, b) => a + b, 0),
          indexBytes: index.byteLength,
          rssAfterValidationBytes: process.memoryUsage().rss,
        })
      }
      reports.push({ ...configuration, subdivisionLevel: level, regionCount: 10 * 4 ** level + 2, trials })
    }
  }
  const report = {
    algorithmVersion: 'icosphere-v1 / icosphere-jitter-v1',
    measuredAt: new Date().toISOString(),
    runtime: process.version,
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
    physicalRadiusKm: radius,

    configuration: 'regular and irregular (0.75 seed42, 1 seed123); 3 trials each, L3 warmup; 5000 deterministic global queries',
    memoryNote: 'Exact retained TypedArray bytes; RSS sampled after validation, NOT peak memory. Temporary Maps, sort workspace and validator allocations excluded from mesh/index bytes.',
    reports,
  }
  writeFileSync(join(tmpdir(), 'another-earth-m03-irregular-benchmark.json'), `${JSON.stringify(report, null, 2)}\n`)
})
