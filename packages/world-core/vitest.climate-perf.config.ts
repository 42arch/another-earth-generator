import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['benchmarks/climate.perf.ts'], testTimeout: 600_000 } })
