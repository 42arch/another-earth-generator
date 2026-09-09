<script lang='ts'>
  import { Dices, Globe2 } from '@lucide/svelte'
  import { uiState } from '@/ui/state/ui-state.svelte'
</script>

<header class='pointer-events-none fixed inset-x-4 top-3 z-40 flex items-center justify-between gap-3'>
  <div class='pointer-events-auto flex h-10 items-center gap-2.5 rounded-lg border border-white/12 bg-[#20252b]/96 px-3 shadow-md'>
    <Globe2 class='h-4 w-4 text-obs-amber' />
    <h1 class='m-0 text-sm font-semibold tracking-wide text-white'>Another Earth</h1>
  </div>

  <div class='pointer-events-auto flex h-10 items-center gap-3 rounded-lg border border-white/12 bg-[#20252b]/96 px-2 pl-3 text-xs text-obs-text-muted shadow-md select-none'>
    <span class='font-mono text-white'>#{uiState.appliedSeed}</span>
    <span class='hidden sm:inline'>{uiState.worldSummary.settlementCount} 个聚落</span>
    <span class='hidden md:inline'>{uiState.worldSummary.lakeCount} 个湖泊</span>
    {#if uiState.hasPendingChanges}
      <button type='button' onclick={() => uiState.openSettings()} class='rounded bg-amber-300/12 px-2 py-1 text-amber-200 hover:bg-amber-300/20'>
        {uiState.changedParamCount} 项待应用
      </button>
    {/if}
    <button type='button' onclick={() => uiState.createRandomWorld()} disabled={uiState.isGenerating} class='flex h-7 items-center gap-1.5 rounded-md border border-white/12 bg-white/6 px-2.5 text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40' title='使用随机种子生成一个新世界'>
      <Dices class='h-3.5 w-3.5' />
      <span class='hidden sm:inline'>新建世界</span>
    </button>
  </div>
</header>
