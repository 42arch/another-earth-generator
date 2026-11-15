<script lang='ts'>
  import type { Snippet } from 'svelte'
  import { Satellite, X } from '@lucide/svelte'
  import { fly } from 'svelte/transition'
  import Badge from '@/ui/components/Badge.svelte'
  import { appState } from '@/ui/state/app.svelte'

  interface Props {
    open: boolean
    hasSelection: boolean
    selectionLabel?: string
    children: Snippet
  }

  const { open, hasSelection, selectionLabel = '', children }: Props = $props()
</script>

{#if open}
  <aside transition:fly={{ x: -300, duration: 200 }} class='pointer-events-auto fixed left-4 bottom-4 z-30 w-[340px] max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border border-white/10 bg-[#1e1e20]/85 text-obs-text-main shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-md'>
    <header class='flex items-center justify-between border-b border-white/[0.06] px-4 py-2 select-none'>
      <div class='flex items-center gap-2'>
        <Satellite class='h-4 w-4 text-obs-primary' />
        <h2 class='m-0 pt-[2px] font-heading text-[13px] font-bold tracking-wide uppercase'>{hasSelection ? selectionLabel : '行星探针读数'}</h2>
      </div>
      <div class='flex items-center gap-2'>
        {#if hasSelection}<Badge variant='slate' class='font-mono text-[9px] tracking-wider py-0.5 px-1.5'>MESH</Badge>{/if}
        <button type='button' onclick={() => appState.inspectorOpen = false} class='rounded-md p-1 text-obs-text-dim transition-colors hover:bg-white/[0.06] hover:text-obs-text-main' title='关闭探针面板' aria-label='关闭探针面板'><X class='h-4 w-4' /></button>
      </div>
    </header>
    <div class='custom-scrollbar max-h-[calc(100dvh-12rem)] overflow-y-auto p-3.5 text-xs'>
      {#if hasSelection}
        {@render children()}
      {:else}
        <div class='flex flex-col items-center gap-2 py-4 text-center text-xs text-obs-text-dim'>
          <Satellite class='h-6 w-6 animate-pulse text-obs-primary/60' />
          <span>点击行星地表区域，发射探针以获取环境数据</span>
        </div>
      {/if}
    </div>
  </aside>
{/if}
