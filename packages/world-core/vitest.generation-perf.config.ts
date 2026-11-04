import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['benchmarks/generation.perf.ts'], testTimeout: 120000 },
})
