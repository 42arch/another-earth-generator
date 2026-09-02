<script lang='ts'>
  import {
    Compass,
    Dices,
    Globe,
    Grid,
    Layers,
    Map,
    Orbit,
    Radio,
    RotateCcw,
    SlidersHorizontal,
  } from '@lucide/svelte'
  import CivTooltip from '@/ui/components/CivTooltip.svelte'
  import { uiState } from '@/ui/state/ui-state.svelte'
</script>

<nav
  class='pointer-events-auto fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 p-1.5 rounded-xl obs-panel shadow-2xl backdrop-blur-xl border border-white/[0.1] bg-[#08120d]/90 select-none text-xs transition-all'
  aria-label='主操作工具栏'
>
  <!-- 1. 面板抽屉控制组 -->
  <div class='flex items-center gap-1'>
    <!-- 参数面板开关 -->
    <CivTooltip content='行星参数控制台 (Codex)'>
      <button
        type='button'
        onclick={() => uiState.codexDrawerOpen = !uiState.codexDrawerOpen}
        class="flex flex-col items-center justify-center min-w-11 py-1 px-2 rounded-lg transition-all duration-150 cursor-pointer border {uiState.codexDrawerOpen ? 'bg-obs-amber/20 border-obs-amber/60 text-obs-amber-light shadow-[0_0_12px_rgba(16,185,129,0.25)] font-semibold' : 'border-transparent text-obs-text-muted hover:text-obs-text-main hover:bg-white/[0.06]'}"
      >
        <SlidersHorizontal class="w-4 h-4 {uiState.codexDrawerOpen ? 'text-obs-amber' : 'text-obs-text-dim'}" />
        <span class='font-heading text-[10px] tracking-wide mt-0.5 leading-none'>参数</span>
      </button>
    </CivTooltip>

    <!-- 图层面板开关 -->
    <CivTooltip content='图层与视界控制 (Layers)'>
      <button
        type='button'
        onclick={() => uiState.layerDrawerOpen = !uiState.layerDrawerOpen}
        class="flex flex-col items-center justify-center min-w-11 py-1 px-2 rounded-lg transition-all duration-150 cursor-pointer border {uiState.layerDrawerOpen ? 'bg-obs-amber/20 border-obs-amber/60 text-obs-amber-light shadow-[0_0_12px_rgba(16,185,129,0.25)] font-semibold' : 'border-transparent text-obs-text-muted hover:text-obs-text-main hover:bg-white/[0.06]'}"
      >
        <Layers class="w-4 h-4 {uiState.layerDrawerOpen ? 'text-obs-amber' : 'text-obs-text-dim'}" />
        <span class='font-heading text-[10px] tracking-wide mt-0.5 leading-none'>图层</span>
      </button>
    </CivTooltip>

    <!-- 区域探测面板开关 -->
    <CivTooltip content='地表侦测详报 (Inspector)'>
      <button
        type='button'
        onclick={() => uiState.inspectorOpen = !uiState.inspectorOpen}
        class="flex flex-col items-center justify-center min-w-11 py-1 px-2 rounded-lg transition-all duration-150 cursor-pointer border {uiState.inspectorOpen ? 'bg-obs-amber/20 border-obs-amber/60 text-obs-amber-light shadow-[0_0_12px_rgba(16,185,129,0.25)] font-semibold' : 'border-transparent text-obs-text-muted hover:text-obs-text-main hover:bg-white/[0.06]'}"
      >
        <Radio class="w-4 h-4 {uiState.inspectorOpen ? 'text-obs-amber' : 'text-obs-text-dim'}" />
        <span class='font-heading text-[10px] tracking-wide mt-0.5 leading-none'>侦测</span>
      </button>
    </CivTooltip>
  </div>

  <!-- 分割线 -->
  <div class='w-px h-6 bg-white/[0.08] mx-0.5 self-center'></div>

  <!-- 2. 核心演化与生成组 -->
  <div class='flex items-center gap-1'>
    <!-- 随机种子 -->
    <CivTooltip content='随机演化全新种子 (Random Seed)'>
      <button
        type='button'
        onclick={() => uiState.randomizeSeed()}
        class='flex flex-col items-center justify-center min-w-11 py-1 px-2 rounded-lg text-obs-text-muted hover:text-obs-amber-light hover:bg-white/[0.06] border border-white/[0.06] hover:border-obs-amber/40 transition-all duration-150 cursor-pointer active:scale-95'
      >
        <Dices class='w-4 h-4 text-obs-amber' />
        <span class='font-heading text-[10px] tracking-wide mt-0.5 leading-none'>随机</span>
      </button>
    </CivTooltip>

    <!-- 重新演化 (核心高亮按钮) -->
    <CivTooltip content='按当前参数重新演算世界 (Regenerate)'>
      <button
        type='button'
        onclick={() => uiState.regenerateWorld()}
        class='flex flex-col items-center justify-center min-w-12 py-1 px-2.5 rounded-lg font-heading text-slate-950 font-bold bg-gradient-to-b from-emerald-400 to-emerald-500 hover:from-emerald-300 hover:to-emerald-400 shadow-[0_0_16px_rgba(16,185,129,0.4)] border border-emerald-200 transition-all duration-150 cursor-pointer active:scale-95'
      >
        <RotateCcw class='w-4 h-4 stroke-[2.5]' />
        <span class='font-heading text-[10px] tracking-wide mt-0.5 leading-none'>演化</span>
      </button>
    </CivTooltip>
  </div>

  <!-- 分割线 -->
  <div class='w-px h-6 bg-white/[0.08] mx-0.5 self-center'></div>

  <!-- 3. 视角与显示辅助组 -->
  <div class='flex items-center gap-1'>
    <CivTooltip content={uiState.viewMode === 'globe' ? '切换至二维世界地图' : '切换至三维星球'}>
      <button
        type='button'
        onclick={() => uiState.toggleViewMode()}
        class='flex flex-col items-center justify-center min-w-11 py-1 px-2 rounded-lg border border-obs-amber/40 bg-obs-amber/10 text-obs-amber-light hover:bg-obs-amber/20 transition-all duration-150 cursor-pointer active:scale-95'
        aria-label={uiState.viewMode === 'globe' ? '切换至二维地图' : '切换至三维星球'}
        aria-pressed={uiState.viewMode === 'map'}
      >
        {#if uiState.viewMode === 'globe'}
          <Globe class='w-4 h-4 text-obs-amber' />
          <span class='font-heading text-[10px] tracking-wide mt-0.5 leading-none'>3D</span>
        {:else}
          <Map class='w-4 h-4 text-obs-amber' />
          <span class='font-heading text-[10px] tracking-wide mt-0.5 leading-none'>2D</span>
        {/if}
      </button>
    </CivTooltip>

    {#if uiState.viewMode === 'map'}
      <CivTooltip content={uiState.mapProjection === 'mercator' ? '切换至 Equal Earth 等面积投影，完整显示两极' : '切换至 Web Mercator 投影，适合连续平移与局部浏览'}>
        <button
          type='button'
          onclick={() => uiState.toggleMapProjection()}
          class='flex flex-col items-center justify-center min-w-12 py-1 px-2 rounded-lg border border-sky-400/35 bg-sky-400/10 text-sky-100 hover:bg-sky-400/20 transition-all duration-150 cursor-pointer active:scale-95'
          aria-label={uiState.mapProjection === 'mercator' ? '当前为 Web Mercator，切换至 Equal Earth' : '当前为 Equal Earth，切换至 Web Mercator'}
          aria-pressed={uiState.mapProjection === 'equal-earth'}
        >
          <Map class='w-4 h-4 text-sky-300' />
          <span class='font-heading text-[10px] tracking-wide mt-0.5 leading-none'>
            {uiState.mapProjection === 'mercator' ? '墨卡托' : '等面积'}
          </span>
        </button>
      </CivTooltip>
    {/if}

    <!-- 自动自转 -->
    <CivTooltip content={uiState.viewMode === 'map' ? '二维地图不使用自动自转' : uiState.params.autoRotate ? '停止行星自转' : '开启行星自转'}>
      <button
        type='button'
        onclick={() => uiState.toggleLayer('autoRotate')}
        disabled={uiState.viewMode === 'map'}
        class="flex flex-col items-center justify-center min-w-11 py-1 px-2 rounded-lg transition-all duration-150 border {uiState.viewMode === 'map' ? 'cursor-not-allowed opacity-35 border-transparent text-obs-text-dim' : uiState.params.autoRotate ? 'cursor-pointer bg-obs-amber/20 border-obs-amber/60 text-obs-amber-light shadow-[0_0_10px_rgba(16,185,129,0.25)] font-semibold' : 'cursor-pointer border-transparent text-obs-text-muted hover:text-obs-text-main hover:bg-white/[0.06]'}"
        aria-label='自动自转'
      >
        <Orbit class="w-4 h-4 {uiState.params.autoRotate ? 'text-obs-amber' : 'text-obs-text-dim'}" />
        <span class='font-heading text-[10px] tracking-wide mt-0.5 leading-none'>自转</span>
      </button>
    </CivTooltip>

    <!-- 经纬网格 -->
    <CivTooltip content={uiState.params.showGraticule ? '隐藏经纬网格' : '显示经纬网格'}>
      <button
        type='button'
        onclick={() => uiState.toggleLayer('showGraticule')}
        class="flex flex-col items-center justify-center min-w-11 py-1 px-2 rounded-lg transition-all duration-150 cursor-pointer border {uiState.params.showGraticule ? 'bg-obs-amber/20 border-obs-amber/60 text-obs-amber-light shadow-[0_0_10px_rgba(16,185,129,0.25)] font-semibold' : 'border-transparent text-obs-text-muted hover:text-obs-text-main hover:bg-white/[0.06]'}"
        aria-label='经纬网'
      >
        <Grid class="w-4 h-4 {uiState.params.showGraticule ? 'text-obs-amber' : 'text-obs-text-dim'}" />
        <span class='font-heading text-[10px] tracking-wide mt-0.5 leading-none'>网格</span>
      </button>
    </CivTooltip>

    <!-- 复位视角 -->
    <CivTooltip content='复位相机视角至初始位置'>
      <button
        type='button'
        onclick={() => uiState.resetCamera()}
        class='flex flex-col items-center justify-center min-w-11 py-1 px-2 rounded-lg border border-transparent text-obs-text-muted hover:text-obs-amber hover:bg-white/[0.06] transition-all duration-150 cursor-pointer active:scale-95'
        aria-label='复位视角'
      >
        <Compass class='w-4 h-4 text-obs-text-dim' />
        <span class='font-heading text-[10px] tracking-wide mt-0.5 leading-none'>复位</span>
      </button>
    </CivTooltip>
  </div>
</nav>
