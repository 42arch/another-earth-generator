<script lang='ts'>
  import { Compass, Sparkles } from '@lucide/svelte'
  import { fade } from 'svelte/transition'
  import { Progress } from 'bits-ui'
  import { uiState } from '@/ui/state/ui-state.svelte'
</script>

{#if uiState.isGenerating}
  <div
    out:fade={{ duration: 250 }}
    class='pointer-events-auto fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#070a0f]/90 backdrop-blur-xl select-none'
  >
    <!-- 浑天仪星盘线条动效 -->
    <div class='relative flex items-center justify-center w-36 h-36 mb-6'>
      <!-- 外部大圆环 (慢速顺时针) -->
      <div class='absolute inset-0 rounded-full border border-white/[0.12] border-dashed animate-[spin_24s_linear_infinite]'>
        <span class='absolute -top-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-obs-amber rounded-full'></span>
        <span class='absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-obs-amber rounded-full'></span>
      </div>

      <!-- 次级内环 (逆时针) -->
      <div class='absolute inset-2.5 rounded-full border border-white/[0.08] animate-[spin_16s_linear_infinite_reverse]'></div>

      <!-- 倾斜环 -->
      <div class='absolute inset-5 rounded-full border border-obs-amber/30 [transform:rotateX(60deg)] animate-[spin_10s_linear_infinite]'></div>

      <!-- 中心核心 -->
      <div class='relative z-10 flex items-center justify-center w-12 h-12 rounded-full bg-white/[0.03] border border-white/[0.1] shadow-[0_0_16px_rgba(16,185,129,0.2)]'>
        <Compass class='w-6 h-6 text-obs-amber' />
      </div>
    </div>

    <!-- 标题与状态 -->
    <div class='flex flex-col items-center text-center px-4 max-w-sm z-10'>
      <h2 class='font-heading text-lg font-bold tracking-[0.18em] uppercase text-obs-text-main m-0'>
        Another Earth Simulator
      </h2>

      <!-- 现代纤细进度条 (基于 bits-ui Progress) -->
      <Progress.Root
        value={null}
        class='relative w-48 h-0.5 bg-white/[0.08] rounded-full my-3 overflow-hidden'
      >
        <div
          class='absolute inset-0 bg-gradient-to-r from-transparent via-obs-amber to-transparent animate-[shimmer_1.5s_infinite] w-full'
          style='background-size: 200% 100%;'
        ></div>
      </Progress.Root>

      <!-- 阶段文字 -->
      <p class='font-sans text-xs text-obs-text-dim m-0 flex items-center gap-1.5'>
        <Sparkles class='w-3 h-3 text-obs-amber shrink-0 animate-spin' style='animation-duration: 4s;' />
        <span>{uiState.loadingStageText}</span>
      </p>
    </div>
  </div>
{/if}

<style>
  @keyframes shimmer {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }
</style>
