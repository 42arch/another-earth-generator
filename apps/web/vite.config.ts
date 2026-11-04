import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['../../docs/old-src/**'],
  },
})
