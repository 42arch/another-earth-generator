import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['benchmarks/mesh.perf.ts'], testTimeout: 120000 },
})
