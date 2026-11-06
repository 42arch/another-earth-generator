import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['benchmarks/geology.perf.ts'], testTimeout: 120000 },
})
