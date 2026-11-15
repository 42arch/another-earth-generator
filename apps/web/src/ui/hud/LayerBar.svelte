<script lang='ts'>
  import type { Snippet } from 'svelte'
  import { Layers, X } from '@lucide/svelte'

  interface Props {
    open: boolean
    onClose: () => void
    children: Snippet
  }

  const { open, onClose, children }: Props = $props()
</script>

{#if open}
  <aside class='pointer-events-auto fixed right-4 top-16 bottom-4 z-40 flex w-[340px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1e1e20]/85 text-obs-text-main shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-md' aria-label='图层'>
    <header class='flex items-center justify-between border-b border-white/[0.06] px-4 py-2'>
      <div class='flex items-center gap-2'><Layers class='h-4 w-4 text-obs-primary' /><h2 class='m-0 pt-[2px] font-heading text-[13px] font-bold tracking-wide'>图层</h2></div>
      <button type='button' onclick={onClose} class='rounded-md p-1 text-obs-text-dim transition-colors hover:bg-white/[0.06] hover:text-obs-text-main' title='关闭图层面板' aria-label='关闭图层面板'><X class='h-4 w-4' /></button>
    </header>
    <div class='custom-scrollbar flex-1 overflow-y-auto p-3.5 text-xs'>
      {@render children()}
    </div>
  </aside>
{/if}
