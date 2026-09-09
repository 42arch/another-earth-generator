<script lang='ts'>
  import { onMount } from 'svelte'
  import BottomToolbar from '@/ui/hud/BottomToolbar.svelte'
  import CivLoading from '@/ui/components/CivLoading.svelte'
  import LayerBar from '@/ui/hud/LayerBar.svelte'
  import RegionInspector from '@/ui/hud/RegionInspector.svelte'
  import TopBanner from '@/ui/hud/TopBanner.svelte'
  import { uiState } from '@/ui/state/ui-state.svelte'

  onMount(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        uiState.closePanels()
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  })
</script>

<div class='relative h-full w-full overflow-hidden pointer-events-none select-none font-sans'>
  <CivLoading />

  {#if uiState.generationError}
    <div role='alert' class='pointer-events-auto fixed left-1/2 top-16 z-50 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-red-300/20 bg-[#342326] p-3 text-sm text-white shadow-xl'>
      <p>{uiState.generationError}</p>
      <button type='button' class='mt-2 rounded border border-white/15 px-2 py-1 text-xs hover:bg-white/8' onclick={() => void uiState.retryGeneration()}>重试</button>
      <button type='button' class='ml-2 rounded px-2 py-1 text-xs text-obs-text-muted hover:text-white' onclick={() => uiState.generationError = null}>关闭</button>
    </div>
  {/if}

  <TopBanner />
  <LayerBar />
  {#if uiState.inspectorOpen}
    <RegionInspector />
  {/if}
  <BottomToolbar />
</div>
