<script lang='ts'>
  import {
    Globe,
    Sparkles,
  } from '@lucide/svelte'
  import { uiState } from '@/ui/state/ui-state.svelte'
</script>

<header class='pointer-events-none fixed top-3 inset-x-4 z-40 flex items-center justify-between'>
  <!-- 左侧：Logo 与标题 -->
  <div class='pointer-events-auto flex items-center gap-2'>
    <div class='obs-panel flex items-center gap-2.5 px-3 py-1.5 rounded-lg shadow-lg border border-white/[0.08] bg-[#08120d]/80 backdrop-blur-md'>
      <Globe class='w-4 h-4 text-obs-amber shrink-0' />
      <div class='flex flex-col'>
        <h1 class='font-heading text-xs font-bold tracking-wider uppercase text-obs-text-main leading-tight m-0'>
          Another Earth
        </h1>
        <span class='text-[9px] font-sans text-obs-text-dim tracking-wide'>
          Planet Simulator
        </span>
      </div>
    </div>
  </div>

  <!-- 右侧：世界概况与种子统计 -->
  <div class='pointer-events-auto flex items-center gap-3 obs-panel px-3.5 py-1.5 rounded-lg shadow-lg border border-white/[0.08] bg-[#08120d]/80 backdrop-blur-md text-xs text-obs-text-muted select-none'>
    <div class='flex items-center gap-1.5 font-mono text-obs-amber-light text-[11px] font-semibold'>
      <Sparkles class='w-3 h-3 text-obs-amber' />
      <span>#{uiState.params.seed}</span>
    </div>
    <span class='text-white/10'>|</span>
    <span>{uiState.worldSummary.settlementCount} 聚落</span>
    <span class='text-white/10 hidden sm:inline'>|</span>
    <span class='hidden sm:inline'>{uiState.worldSummary.lakeCount} 湖泊</span>
    <span class='text-white/10 hidden md:inline'>|</span>
    <span class='hidden md:inline'>{uiState.worldSummary.riverSourceCount} 水系源头</span>
  </div>
</header>

