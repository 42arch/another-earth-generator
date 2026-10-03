<script lang='ts'>
  import { Orbit } from '@lucide/svelte'
  import { Progress } from 'bits-ui'
  import { fade } from 'svelte/transition'
  import { appState } from '@/ui/state/app.svelte'

</script>

{#if appState.isGenerating}
  <div
    out:fade={{ duration: 250 }}
    class='pointer-events-auto fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#070a0f]/50 backdrop-blur-lg select-none'
  >
    <!-- 全息线框地球动效 -->
    <div class='globe-container relative flex items-center justify-center w-32 h-32 mb-8'>
      <!-- 3D 地球本体 -->
      <div class='globe relative w-full h-full rounded-full'>
        <!-- 经线 -->
        <div class='absolute inset-0 rounded-full border border-obs-amber/20'></div>
        <div class='absolute inset-0 rounded-full border border-obs-amber/20 [transform:rotateY(30deg)]'></div>
        <div class='absolute inset-0 rounded-full border border-obs-amber/20 [transform:rotateY(60deg)]'></div>
        <div class='absolute inset-0 rounded-full border border-obs-amber/20 [transform:rotateY(90deg)]'></div>
        <div class='absolute inset-0 rounded-full border border-obs-amber/20 [transform:rotateY(120deg)]'></div>
        <div class='absolute inset-0 rounded-full border border-obs-amber/20 [transform:rotateY(150deg)]'></div>

        <!-- 纬线 -->
        <div class='absolute inset-0 rounded-full border border-obs-amber/30 [transform:rotateX(90deg)]'></div>
        <div class='absolute rounded-full border border-obs-amber/10' style='width: 124px; height: 124px; left: 2px; top: 2px; transform: translateY(-16px) rotateX(90deg)'></div>
        <div class='absolute rounded-full border border-obs-amber/10' style='width: 124px; height: 124px; left: 2px; top: 2px; transform: translateY(16px) rotateX(90deg)'></div>
        <div class='absolute rounded-full border border-obs-amber/10' style='width: 111px; height: 111px; left: 8.5px; top: 8.5px; transform: translateY(-32px) rotateX(90deg)'></div>
        <div class='absolute rounded-full border border-obs-amber/10' style='width: 111px; height: 111px; left: 8.5px; top: 8.5px; transform: translateY(32px) rotateX(90deg)'></div>
        <div class='absolute rounded-full border border-obs-amber/10' style='width: 85px; height: 85px; left: 21.5px; top: 21.5px; transform: translateY(-48px) rotateX(90deg)'></div>
        <div class='absolute rounded-full border border-obs-amber/10' style='width: 85px; height: 85px; left: 21.5px; top: 21.5px; transform: translateY(48px) rotateX(90deg)'></div>
      </div>

      <!-- 雷达扫描线 -->
      <div class='absolute inset-0 rounded-full overflow-hidden'>
        <div class='w-full h-full bg-gradient-to-b from-transparent via-obs-amber/5 to-obs-amber/10 border-b border-obs-amber/30 animate-[radar_2s_linear_infinite]'></div>
      </div>
    </div>

    <!-- 标题与状态 -->
    <div class='flex flex-col items-center text-center px-4 max-w-sm z-10'>
      <h2 class='font-heading text-lg font-bold tracking-[0.18em] uppercase text-obs-text-main m-0'>
        Another Earth Generator
      </h2>

      <!-- 现代纤细进度条 (基于 bits-ui Progress) -->
      <Progress.Root
        value={null}
        class='relative w-48 h-0.5 bg-white/[0.08] rounded-full my-3 overflow-hidden'
      >
        <div
          class='absolute top-0 left-0 h-full bg-obs-amber rounded-full progress-bar'
        ></div>
      </Progress.Root>

      <!-- 阶段文字 -->
      <p class='font-sans text-xs text-obs-text-dim m-0 flex items-center gap-1.5'>
        <Orbit class='w-3 h-3 text-obs-amber shrink-0 animate-spin' style='animation-duration: 4s;' />
        <span>{appState.loadingStageText}</span>
      </p>
    </div>
  </div>
{/if}

<style>
  .progress-bar {
    animation: fake-progress 8s cubic-bezier(0.1, 0.8, 0.3, 1) forwards;
  }

  @keyframes fake-progress {
    0% { width: 0%; }
    10% { width: 30%; }
    30% { width: 60%; }
    60% { width: 85%; }
    100% { width: 95%; }
  }

  .globe-container {
    perspective: 800px;
  }
  .globe {
    transform-style: preserve-3d;
    animation: rotate-globe 12s linear infinite;
  }
  @keyframes rotate-globe {
    0% { transform: rotateX(20deg) rotateY(0deg); }
    100% { transform: rotateX(20deg) rotateY(360deg); }
  }
  @keyframes radar {
    0% { transform: translateY(-100%); }
    100% { transform: translateY(100%); }
  }
</style>
