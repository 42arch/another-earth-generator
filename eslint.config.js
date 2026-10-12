import antfu from '@antfu/eslint-config'

export default antfu({
  svelte: true,
  rules: {
    'no-console': 'off',
  },
})
