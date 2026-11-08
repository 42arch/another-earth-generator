import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['benchmarks/hydrology.perf.ts'], testTimeout: 900_000 } })
