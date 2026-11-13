<script lang='ts'>
  import type { Snippet } from 'svelte'
  import { Play, SlidersHorizontal, X } from '@lucide/svelte'
  import Tabs from '@/ui/components/Tabs.svelte'

  interface Props {
    open: boolean
    busy: boolean
    onClose: () => void
    onGenerate: () => void
    coreContent: Snippet
    natureContent: Snippet
    civilizationContent: Snippet
  }

  const { open, busy, onClose, onGenerate, coreContent, natureContent, civilizationContent }: Props = $props()
  type ParameterTab = 'nature' | 'civilization'
  let activeTab = $state<ParameterTab>('nature')
  const parameterTabs = [
    { value: 'nature' as const, label: '自然' },
    { value: 'civilization' as const, label: '文明' },
  ]
</script>

{#if open}
  <aside
    class='pointer-events-auto fixed left-4 top-16 bottom-4 z-40 w-[340px] max-w-[calc(100vw-32px)] bg-[#1e1e20]/85 backdrop-blur-md border border-white/10 rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] flex flex-col text-obs-text-main overflow-hidden'
    aria-label='参数设置'
  >
    <header class='flex items-center justify-between px-4 py-2 border-b border-white/[0.08]'>
      <div class='flex items-center gap-2'>
        <SlidersHorizontal class='w-4 h-4 text-obs-primary' />
        <div class='flex flex-col'>
          <h2 class='font-sans text-[13px] font-bold tracking-wide text-obs-text-main m-0 leading-none pt-[2px]'>参数设置</h2>
        </div>
      </div>
      <button type='button' onclick={onClose} class='text-obs-text-dim hover:text-obs-text-main p-1 rounded-md hover:bg-white/[0.06] transition-colors cursor-pointer' title='关闭参数面板' aria-label='关闭参数面板'>
        <X class='w-4 h-4' />
      </button>
    </header>

    <section class='shrink-0 px-4 pt-3'>
      <div class='flex items-center gap-2 mb-1'>
        <span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>全局参数</span>
        <div class='flex-1 h-px bg-white/5'></div>
      </div>
      {@render coreContent()}
    </section>

    <Tabs bind:value={activeTab} items={parameterTabs} ariaLabel='参数类别' class='min-h-0'>
      {#snippet content(tab)}
        {#if tab === 'nature'}
          {@render natureContent()}
        {:else}
          {@render civilizationContent()}
        {/if}
      {/snippet}
    </Tabs>

    <footer class='flex items-center justify-between px-4 py-2 border-t border-white/[0.06] bg-black/10'>
      <span class='text-[10px] text-obs-text-dim'>{busy ? '生成进行中…' : '调整参数后手动执行'}</span>
      <button type='button' class='flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold tracking-wider text-obs-primary border border-obs-primary/40 rounded-md bg-obs-primary/15 hover:bg-obs-primary/25 hover:border-obs-primary/70 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed' onclick={onGenerate} disabled={busy}>
        <Play class='w-3 h-3 fill-current' />
        <span>{busy ? '生成中…' : '开始生成'}</span>
      </button>
    </footer>
  </aside>
{/if}
