<script lang='ts'>
  import type { ParameterKey, ParameterSpec } from '@/ui/state/parameter-catalog'
  import CivSlider from '@/ui/components/CivSlider.svelte'
  import { PARAMETERS } from '@/ui/state/parameter-catalog'
  import { uiState } from '@/ui/state/ui-state.svelte'

  let { keys }: { keys: readonly ParameterKey[] } = $props()
</script>

<div class='space-y-2'>
  {#each keys as key (key)}
    {@const spec: ParameterSpec = PARAMETERS[key]}
    <CivSlider {...spec} value={uiState.params[key]} oncommit={value => uiState.updateParam(key, value)} />
  {/each}
</div>
