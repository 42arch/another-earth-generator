<script lang='ts'>
  import {
    Activity,
    Castle,
    CloudRain,
    Grid,
    Layers,
    Languages,
    Mountain,
    Orbit,
    Thermometer,
    Trees,
    Waves,
    Wind,
    Workflow,
    X,
  } from '@lucide/svelte'
  import { fly } from 'svelte/transition'
  import { uiState } from '@/ui/state/ui-state.svelte'

  const displayModes = [
    { mode: 'terrain' as const, label: '自然地貌', icon: Mountain },
    { mode: 'biomes' as const, label: '生态群落', icon: Trees },
    { mode: 'elevation' as const, label: '高程图', icon: Activity },
    { mode: 'contours' as const, label: '等高线', icon: Layers },
    { mode: 'plates' as const, label: '板块构造', icon: Workflow },
    { mode: 'trade' as const, label: '贸易网络', icon: Activity },
    { mode: 'cultures' as const, label: '文化圈', icon: Trees },
    { mode: 'religions' as const, label: '宗教圈', icon: Orbit },
    { mode: 'polities' as const, label: '政体疆域', icon: Castle },
  ]
</script>

{#if uiState.layerDrawerOpen}
  <aside
    transition:fly={{ x: 300, duration: 200 }}
    class='pointer-events-auto fixed right-4 top-16 bottom-20 z-40 w-64 max-w-[calc(100vw-32px)] obs-panel rounded-xl shadow-2xl flex flex-col text-obs-text-main overflow-hidden border border-white/[0.1] bg-[#08120d]/90 backdrop-blur-xl'
  >
    <!-- 头部 -->
    <header class='flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-white/[0.02] select-none'>
      <div class='flex items-center gap-2'>
        <Layers class='w-4 h-4 text-obs-amber' />
        <div>
          <h2 class='font-heading text-sm font-bold tracking-wider uppercase text-obs-text-main m-0 leading-tight'>
            图层与视界
          </h2>
          <span class='text-[10px] text-obs-text-dim tracking-wide'>
            Layer & Perspectives
          </span>
        </div>
      </div>

      <button
        type='button'
        onclick={() => uiState.layerDrawerOpen = false}
        class='text-obs-text-dim hover:text-obs-text-main p-1 rounded-md hover:bg-white/[0.06] transition-colors cursor-pointer'
        title='关闭图层面板'
      >
        <X class='w-4 h-4' />
      </button>
    </header>

    <!-- 滚动内容区 -->
    <div class='flex-1 overflow-y-auto p-3.5 flex flex-col gap-3 custom-scrollbar text-xs'>
      <!-- 着色模式 -->
      <div class='flex flex-col gap-1.5'>
        <span class='text-[10px] uppercase tracking-wider text-obs-text-dim font-medium'>
          着色模式 (Display Mode)
        </span>
        <div class='flex flex-col gap-1'>
          {#each displayModes as item}
            {@const Icon = item.icon}
            <button
              type='button'
              onclick={() => uiState.setDisplayMode(item.mode)}
              class="flex items-center justify-between px-2.5 py-1.5 text-xs rounded-lg transition-all text-left cursor-pointer border {uiState.params.displayMode === item.mode ? 'bg-obs-amber/15 text-obs-amber-light border-obs-amber/50 font-semibold shadow-[0_0_10px_rgba(16,185,129,0.2)]' : 'text-obs-text-muted hover:text-obs-text-main hover:bg-white/[0.04] border-transparent'}"
            >
              <div class='flex items-center gap-2'>
                <Icon class="w-3.5 h-3.5 {uiState.params.displayMode === item.mode ? 'text-obs-amber' : 'text-obs-text-dim'}" />
                <span>{item.label}</span>
              </div>
              {#if uiState.params.displayMode === item.mode}
                <span class='w-1.5 h-1.5 rounded-full bg-obs-amber shadow-[0_0_6px_rgba(16,185,129,0.8)]'></span>
              {/if}
            </button>
          {/each}
        </div>
      </div>

      <!-- 地理要素 -->
      <div class='flex flex-col gap-1.5 border-t border-white/[0.06] pt-3'>
        <span class='text-[10px] uppercase tracking-wider text-obs-text-dim font-medium'>
          地理要素 (Features)
        </span>
        <div class='grid grid-cols-2 gap-1.5 text-[11px]'>
          <button
            type='button'
            onclick={() => uiState.toggleLayer('showCoastlines')}
            class="px-2 py-1.5 border rounded-lg flex items-center gap-1.5 cursor-pointer transition-all {uiState.params.showCoastlines ? 'bg-obs-blue/20 border-obs-blue/50 text-blue-300 shadow-[0_0_8px_rgba(56,189,248,0.15)]' : 'border-white/[0.06] text-obs-text-dim hover:text-obs-text-muted hover:bg-white/[0.03]'}"
          >
            <Waves class='w-3.5 h-3.5 text-obs-blue shrink-0' />
            <span>海岸线</span>
          </button>
          <button
            type='button'
            onclick={() => uiState.toggleLayer('showRivers')}
            class="px-2 py-1.5 border rounded-lg flex items-center gap-1.5 cursor-pointer transition-all {uiState.params.showRivers ? 'bg-obs-blue/20 border-obs-blue/50 text-blue-300 shadow-[0_0_8px_rgba(56,189,248,0.15)]' : 'border-white/[0.06] text-obs-text-dim hover:text-obs-text-muted hover:bg-white/[0.03]'}"
          >
            <Workflow class='w-3.5 h-3.5 text-obs-blue shrink-0' />
            <span>河流水系</span>
          </button>
          <button
            type='button'
            onclick={() => uiState.toggleLayer('showSettlements')}
            class="px-2 py-1.5 border rounded-lg flex items-center gap-1.5 cursor-pointer transition-all {uiState.params.showSettlements ? 'bg-obs-amber/20 border-obs-amber/50 text-obs-amber-light shadow-[0_0_8px_rgba(16,185,129,0.2)]' : 'border-white/[0.06] text-obs-text-dim hover:text-obs-text-muted hover:bg-white/[0.03]'}"
          >
            <Castle class='w-3.5 h-3.5 text-obs-amber shrink-0' />
            <span>文明聚落</span>
          </button>
          <button
            type='button'
            onclick={() => uiState.toggleLayer('showPlateBoundaries')}
            class="px-2 py-1.5 border rounded-lg flex items-center gap-1.5 cursor-pointer transition-all {uiState.params.showPlateBoundaries ? 'bg-obs-rose/20 border-obs-rose/50 text-rose-300 shadow-[0_0_8px_rgba(244,63,94,0.15)]' : 'border-white/[0.06] text-obs-text-dim hover:text-obs-text-muted hover:bg-white/[0.03]'}"
          >
            <Orbit class='w-3.5 h-3.5 text-obs-rose shrink-0' />
            <span>板块边界</span>
          </button>
        </div>
      </div>

      <!-- 气象与流场 -->
      <div class='flex flex-col gap-1.5 border-t border-white/[0.06] pt-3'>
        <span class='text-[10px] uppercase tracking-wider text-obs-text-dim font-medium'>
          气象与洋流 (Climate & Currents)
        </span>
        <div class='grid grid-cols-2 gap-1.5 text-[11px]'>
          <button
            type='button'
            onclick={() => uiState.toggleLayer('showTemperature')}
            class="px-2 py-1.5 border rounded-lg flex items-center gap-1.5 cursor-pointer transition-all {uiState.params.showTemperature ? 'bg-obs-rose/20 border-obs-rose/50 text-rose-300' : 'border-white/[0.06] text-obs-text-dim hover:text-obs-text-muted hover:bg-white/[0.03]'}"
          >
            <Thermometer class='w-3.5 h-3.5 text-obs-rose shrink-0' />
            <span>地表气温</span>
          </button>
          <button
            type='button'
            onclick={() => uiState.toggleLayer('showPrecipitation')}
            class="px-2 py-1.5 border rounded-lg flex items-center gap-1.5 cursor-pointer transition-all {uiState.params.showPrecipitation ? 'bg-obs-blue/20 border-obs-blue/50 text-blue-300' : 'border-white/[0.06] text-obs-text-dim hover:text-obs-text-muted hover:bg-white/[0.03]'}"
          >
            <CloudRain class='w-3.5 h-3.5 text-obs-blue shrink-0' />
            <span>降水分布</span>
          </button>
          <button
            type='button'
            onclick={() => uiState.toggleLayer('showFlux')}
            class="px-2 py-1.5 border rounded-lg flex items-center gap-1.5 cursor-pointer transition-all {uiState.params.showFlux ? 'bg-obs-amber/20 border-obs-amber/50 text-amber-300' : 'border-white/[0.06] text-obs-text-dim hover:text-obs-text-muted hover:bg-white/[0.03]'}"
          >
            <Activity class='w-3.5 h-3.5 text-obs-amber shrink-0' />
            <span>汇流强度</span>
          </button>
          <button
            type='button'
            onclick={() => uiState.toggleLayer('showWind')}
            class="px-2 py-1.5 border rounded-lg flex items-center gap-1.5 cursor-pointer transition-all {uiState.params.showWind ? 'bg-obs-cyan/20 border-obs-cyan/50 text-cyan-300' : 'border-white/[0.06] text-obs-text-dim hover:text-obs-text-muted hover:bg-white/[0.03]'}"
          >
            <Wind class='w-3.5 h-3.5 text-obs-cyan shrink-0' />
            <span>盛行风场</span>
          </button>
          <button
            type='button'
            onclick={() => uiState.toggleLayer('showOceanCurrents')}
            class="px-2 py-1.5 border rounded-lg flex items-center gap-1.5 cursor-pointer transition-all {uiState.params.showOceanCurrents ? 'bg-obs-blue/20 border-obs-blue/50 text-blue-300' : 'border-white/[0.06] text-obs-text-dim hover:text-obs-text-muted hover:bg-white/[0.03]'}"
          >
            <Waves class='w-3.5 h-3.5 text-obs-blue shrink-0' />
            <span>大洋环流</span>
          </button>
          <button
            type='button'
            onclick={() => uiState.toggleLayer('showSeaSurfaceTemperature')}
            class="px-2 py-1.5 border rounded-lg flex items-center gap-1.5 cursor-pointer transition-all {uiState.params.showSeaSurfaceTemperature ? 'bg-obs-amber/20 border-obs-amber/50 text-amber-300' : 'border-white/[0.06] text-obs-text-dim hover:text-obs-text-muted hover:bg-white/[0.03]'}"
          >
            <Thermometer class='w-3.5 h-3.5 text-obs-amber shrink-0' />
            <span>海表温度</span>
          </button>
          <button
            type='button'
            onclick={() => uiState.toggleLayer('showGraticule')}
            class="px-2 py-1.5 border rounded-lg flex items-center gap-1.5 cursor-pointer transition-all {uiState.params.showGraticule ? 'bg-white/[0.12] border-white/[0.25] text-obs-text-main font-medium' : 'border-white/[0.06] text-obs-text-dim hover:text-obs-text-muted hover:bg-white/[0.03]'}"
          >
            <Grid class='w-3.5 h-3.5 text-obs-text-muted shrink-0' />
            <span>经纬网</span>
          </button>
        </div>
      </div>

      <!-- 文明与交通 -->
      <div class='flex flex-col gap-1.5 border-t border-white/[0.06] pt-3'>
        <span class='text-[10px] uppercase tracking-wider text-obs-text-dim font-medium'>
          文明与交通 (Civilization)
        </span>
        <div class='grid grid-cols-2 gap-1.5 text-[11px]'>
          <button
            type='button'
            onclick={() => uiState.toggleLayer('showRoads')}
            class="px-2 py-1.5 border rounded-lg flex items-center gap-1.5 cursor-pointer transition-all {uiState.params.showRoads ? 'bg-obs-amber/20 border-obs-amber/50 text-amber-300' : 'border-white/[0.06] text-obs-text-dim hover:text-obs-text-muted hover:bg-white/[0.03]'}"
          >
            <Workflow class='w-3.5 h-3.5 text-obs-amber shrink-0' />
            <span>陆路网络</span>
          </button>
          <button
            type='button'
            onclick={() => uiState.toggleLayer('showShippingRoutes')}
            class="px-2 py-1.5 border rounded-lg flex items-center gap-1.5 cursor-pointer transition-all {uiState.params.showShippingRoutes ? 'bg-obs-blue/20 border-obs-blue/50 text-blue-300' : 'border-white/[0.06] text-obs-text-dim hover:text-obs-text-muted hover:bg-white/[0.03]'}"
          >
            <Waves class='w-3.5 h-3.5 text-obs-blue shrink-0' />
            <span>海运航线</span>
          </button>
          <button
            type='button'
            onclick={() => uiState.toggleLayer('showPoliticalBoundaries')}
            class="px-2 py-1.5 border rounded-lg flex items-center gap-1.5 cursor-pointer transition-all {uiState.params.showPoliticalBoundaries ? 'bg-obs-rose/20 border-obs-rose/50 text-rose-300' : 'border-white/[0.06] text-obs-text-dim hover:text-obs-text-muted hover:bg-white/[0.03]'}"
          >
            <Castle class='w-3.5 h-3.5 text-obs-rose shrink-0' />
            <span>政体边界</span>
          </button>
          <button
            type='button'
            onclick={() => uiState.toggleLayer('showCultureBoundaries')}
            class="px-2 py-1.5 border rounded-lg flex items-center gap-1.5 cursor-pointer transition-all {uiState.params.showCultureBoundaries ? 'bg-obs-amber/20 border-obs-amber/50 text-amber-300' : 'border-white/[0.06] text-obs-text-dim hover:text-obs-text-muted hover:bg-white/[0.03]'}"
          >
            <Trees class='w-3.5 h-3.5 text-obs-amber shrink-0' />
            <span>文化边界</span>
          </button>
          <button
            type='button'
            onclick={() => uiState.toggleLayer('showReligionBoundaries')}
            class="px-2 py-1.5 border rounded-lg flex items-center gap-1.5 cursor-pointer transition-all {uiState.params.showReligionBoundaries ? 'bg-violet-400/15 border-violet-300/40 text-violet-200' : 'border-white/[0.06] text-obs-text-dim hover:text-obs-text-muted hover:bg-white/[0.03]'}"
          >
            <Orbit class='w-3.5 h-3.5 text-violet-300 shrink-0' />
            <span>宗教边界</span>
          </button>
          <button
            type='button'
            onclick={() => uiState.toggleLayer('showHolySites')}
            class="px-2 py-1.5 border rounded-lg flex items-center gap-1.5 cursor-pointer transition-all {uiState.params.showHolySites ? 'bg-obs-amber/20 border-obs-amber/50 text-amber-300' : 'border-white/[0.06] text-obs-text-dim hover:text-obs-text-muted hover:bg-white/[0.03]'}"
          >
            <Mountain class='w-3.5 h-3.5 text-obs-amber shrink-0' />
            <span>圣地标记</span>
          </button>
        </div>
      </div>

      <!-- 渲染与交互 -->
      <div class='flex flex-col gap-1.5 border-t border-white/[0.06] pt-3'>
        <span class='text-[10px] uppercase tracking-wider text-obs-text-dim font-medium'>
          视界辅助 (Display)
        </span>
        <button
          type='button'
          onclick={() => uiState.toggleLayer('showMapLabels')}
          class="w-full py-1.5 border rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-all text-[11px] {uiState.params.showMapLabels ? 'border-obs-amber/60 bg-obs-amber/15 text-obs-amber-light font-medium' : 'border-white/[0.06] text-obs-text-dim hover:text-obs-text-muted hover:bg-white/[0.03]'}"
        >
          <Languages class='w-3 h-3' />
          <span>地图标签</span>
        </button>
        <div class='flex items-center justify-between text-[11px] gap-2'>
          <button
            type='button'
            onclick={() => uiState.toggleLayer('autoRotate')}
            class="flex-1 py-1.5 border rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-all {uiState.params.autoRotate ? 'border-obs-amber/60 bg-obs-amber/15 text-obs-amber-light font-medium' : 'border-white/[0.06] text-obs-text-dim hover:text-obs-text-muted hover:bg-white/[0.03]'}"
          >
            <Orbit class='w-3 h-3' />
            <span>自动自转</span>
          </button>
          <button
            type='button'
            onclick={() => uiState.toggleLayer('wireframe')}
            class="flex-1 py-1.5 border rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-all {uiState.params.wireframe ? 'border-obs-amber/60 bg-obs-amber/15 text-obs-amber-light font-medium' : 'border-white/[0.06] text-obs-text-dim hover:text-obs-text-muted hover:bg-white/[0.03]'}"
          >
            <Grid class='w-3 h-3' />
            <span>网格线框</span>
          </button>
        </div>
      </div>
    </div>
  </aside>
{/if}
