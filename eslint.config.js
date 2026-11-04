import antfu from '@antfu/eslint-config'

const crossPackagePaths = ['**/world-data/**', '**/world-core/**', '**/cartography/**', '**/old-src/**']

export default antfu({
  svelte: true,
  ignores: ['docs/old-src/**', 'public/**', 'dist/**', 'dev-dist/**'],
},
{
  files: ['apps/web/src/**/*.{ts,svelte}', 'packages/*/src/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: [...crossPackagePaths, '@another-earth/*/*'],
        message: 'Import through a workspace package public export; legacy code is read-only.',
      }],
    }],
  },
},
{
  files: ['packages/world-data/src/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{ group: [...crossPackagePaths, '@another-earth/*', 'three', 'three/*', 'svelte', 'svelte/*', 'bits-ui', '@sveltejs/*'], message: 'world-data cannot import another project package, UI, rendering, or legacy code.' }],
    }],
  },
},
{
  files: ['packages/world-core/src/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{ group: [...crossPackagePaths, '@another-earth/cartography', '@another-earth/web', '@another-earth/*/*', 'three', 'three/*', 'svelte', 'svelte/*', 'bits-ui', '@sveltejs/*'], message: 'world-core may only consume world-data public exports and no UI or renderer.' }],
    }],
  },
},
{
  files: ['packages/cartography/src/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{ group: [...crossPackagePaths, '@another-earth/world-data', '@another-earth/web', '@another-earth/*/*', 'svelte', 'svelte/*', 'bits-ui', '@sveltejs/*'], message: 'cartography may only consume world-core public exports and no UI.' }],
    }],
  },
})
