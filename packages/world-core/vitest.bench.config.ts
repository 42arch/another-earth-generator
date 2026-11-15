import { defineConfig } from 'vitest/config'

const suites = [
  { name: 'mesh', include: 'benchmarks/mesh.perf.ts', testTimeout: 120_000 },
  { name: 'generation', include: 'benchmarks/generation.perf.ts', testTimeout: 120_000 },
  { name: 'geology', include: 'benchmarks/geology.perf.ts', testTimeout: 120_000 },
  { name: 'terrain', include: 'benchmarks/terrain.perf.ts', testTimeout: 300_000 },
  { name: 'climate', include: 'benchmarks/climate.perf.ts', testTimeout: 600_000 },
  { name: 'hydrology', include: 'benchmarks/hydrology.perf.ts', testTimeout: 900_000 },
  { name: 'ecology-legacy', include: 'benchmarks/ecology-legacy-comparison.ts', testTimeout: 900_000 },
] as const

export default defineConfig({
  test: {
    projects: suites.map(({ name, include, testTimeout }) => ({
      test: {
        name,
        include: [include],
        testTimeout,
      },
    })),
  },
})
