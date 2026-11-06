import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['benchmarks/terrain.perf.ts'], testTimeout: 300000 },
})
