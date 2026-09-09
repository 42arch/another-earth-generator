<script lang='ts'>
  import { LoaderCircle, X } from '@lucide/svelte'
  import { fade } from 'svelte/transition'
  import { uiState } from '@/ui/state/ui-state.svelte'
</script>

{#if uiState.isGenerating}
  <div transition:fade={{ duration: 120 }} class='pointer-events-auto fixed bottom-20 left-1/2 z-50 flex w-[min(25rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-lg border border-white/14 bg-[#20252b]/98 px-3 py-2.5 text-xs text-white shadow-xl' role='status'>
    <LoaderCircle class='h-4 w-4 shrink-0 animate-spin text-obs-amber' />
    <div class='min-w-0 flex-1'>
      <div aria-live='polite' class='truncate'>{uiState.loadingStageText}</div>
      <div class='mt-1 h-0.5 overflow-hidden rounded bg-white/10'>
        <div class='h-full w-1/2 animate-[loading_1.2s_ease-in-out_infinite] rounded bg-obs-amber'></div>
      </div>
    </div>
    <button type='button' class='rounded p-1 text-obs-text-dim hover:bg-white/8 hover:text-white' onclick={() => uiState.cancelGeneration()} aria-label='取消生成' title='取消生成'>
      <X class='h-4 w-4' />
    </button>
  </div>
{/if}

<style>
  @keyframes loading {
    0% { transform: translateX(-110%); }
    100% { transform: translateX(210%); }
  }
</style>
