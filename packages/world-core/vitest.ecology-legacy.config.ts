import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['benchmarks/ecology-legacy-comparison.ts'], testTimeout: 900_000 } })
